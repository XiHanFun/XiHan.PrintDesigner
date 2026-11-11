// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! WebKitGTK 渲染器：所有 GTK 与 WebKit 调用都经 glib::MainContext::default() 转到 GTK 主线程上执行，结果经 oneshot 送回；
//! 同时有几个任务时各用一个独立的 WebView

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::oneshot;
use webkit2gtk::{CacheModel, SecurityManagerExt, WebContext, WebContextExt, WebsiteDataManager};
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::PrintDocument;
use xihan_print_client_core::protocol::codes::errors;

use super::{gtk_ffi, page, pdf};
use crate::unix::{GroupRender, PdfRenderer};

/// 渲染引擎名称
const NAME: &str = "WebKitGTK";

/// 等 GTK 主线程建好渲染引擎的期限
const CREATE_TIMEOUT: Duration = Duration::from_secs(30);

static NEXT_RENDERER: AtomicU64 = AtomicU64::new(1);

thread_local! {
    /// GTK 主线程上各渲染器的共享部分，按渲染器编号
    static RENDERERS: RefCell<HashMap<u64, Rc<Shared>>> = RefCell::new(HashMap::new());
}

/// 一个渲染器在 GTK 主线程上的共享部分：WebContext、「打印到文件」打印机、临时 PDF 的目录与正在渲染的任务
pub(super) struct Shared {
    /// 注册了自定义协议的 WebContext，数据放在渲染数据目录下
    pub(super) context: WebContext,
    /// GTK 的「打印到文件」打印机名称
    pub(super) printer: String,
    /// 正在渲染的任务，按 WebView
    pub(super) tasks: RefCell<HashMap<usize, Rc<page::Task>>>,
    output: PathBuf,
    next_file: Cell<u64>,
}

impl Shared {
    /// 下一个临时 PDF 的路径
    pub(super) fn output_file(&self) -> PathBuf {
        let index = self.next_file.get();
        self.next_file.set(index + 1);
        self.output.join(format!("{index}.pdf"))
    }
}

/// 经 WebKitGTK 把任务文档渲染成 PDF；本身只记着编号与版本，GTK 对象都留在 GTK 主线程上
pub(crate) struct WebKitRenderer {
    id: u64,
    version: String,
}

impl WebKitRenderer {
    /// 清空数据目录后在 GTK 主线程上建好 WebContext 并找到「打印到文件」打印机；GTK 没在主线程上初始化或主循环没在跑时给出原因
    pub(crate) async fn create(data_directory: PathBuf, log: SharedLog) -> Result<WebKitRenderer, String> {
        match std::fs::remove_dir_all(&data_directory) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => log.warn(&format!("清空渲染数据目录失败，沿用上次的数据：{error}")),
            _ => {}
        }
        let id = NEXT_RENDERER.fetch_add(1, Ordering::Relaxed);
        let receiver = on_main(move || Box::pin(create_on_main(id, data_directory)));
        match tokio::time::timeout(CREATE_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result.map(|version| WebKitRenderer { id, version }),
            Ok(Err(_)) => Err("GTK 主线程没有建好 WebKitGTK 渲染引擎".to_owned()),
            Err(_) => Err(format!("GTK 主循环 {} 秒内没有响应，WebKitGTK 渲染引擎没有建成", CREATE_TIMEOUT.as_secs())),
        }
    }

    /// WebKitGTK 的版本
    pub(crate) fn version_text(&self) -> &str {
        &self.version
    }
}

impl Drop for WebKitRenderer {
    fn drop(&mut self) {
        let id = self.id;
        glib::MainContext::default().invoke(move || {
            RENDERERS.with(|renderers| renderers.borrow_mut().remove(&id));
        });
    }
}

impl PdfRenderer for WebKitRenderer {
    fn name(&self) -> &str {
        NAME
    }

    fn version(&self) -> Option<String> {
        Some(self.version.clone())
    }

    fn render(
        &self,
        document: Arc<PrintDocument>,
        groups: Vec<GroupRender>,
        grayscale: bool,
        timeout: Duration,
        cancel: Cancel,
    ) -> BoxFuture<'static, Result<Vec<Vec<u8>>, JobError>> {
        let id = self.id;
        Box::pin(async move {
            let receiver = on_main(move || {
                Box::pin(async move {
                    match RENDERERS.with(|renderers| renderers.borrow().get(&id).cloned()) {
                        Some(shared) => page::render(shared, document, groups, grayscale, timeout, cancel).await,
                        None => Err(JobError::failure(errors::RENDER_FAILED, "渲染引擎已经关闭", None)),
                    }
                })
            });
            receiver
                .await
                .unwrap_or_else(|_| Err(JobError::failure(errors::RENDER_FAILED, "GTK 主线程没有完成渲染", None)))
        })
    }

    fn merge(&self, pdfs: Vec<Vec<u8>>) -> Result<Vec<u8>, JobError> {
        pdf::merge(&pdfs).map_err(|message| JobError::failure(errors::PDF_FAILED, format!("合并 PDF 失败：{message}"), None))
    }
}

/// 把一段工作转到 GTK 主线程上：在那里建出 future 并跑到完，结果经 oneshot 送回
fn on_main<T: Send + 'static>(work: impl FnOnce() -> Pin<Box<dyn Future<Output = T>>> + Send + 'static) -> oneshot::Receiver<T> {
    let (sender, receiver) = oneshot::channel();
    glib::MainContext::default().invoke(move || {
        let future = work();
        glib::MainContext::default().spawn_local(async move {
            let _ = sender.send(future.await);
        });
    });
    receiver
}

/// 在 GTK 主线程上建渲染器的共享部分，返回 WebKitGTK 的版本
async fn create_on_main(id: u64, data_directory: PathBuf) -> Result<String, String> {
    if !gtk::is_initialized_main_thread() {
        return Err("GTK 没有在主线程上初始化，用不了 WebKitGTK 渲染引擎".to_owned());
    }
    let output = data_directory.join("print");
    std::fs::create_dir_all(&output).map_err(|error| format!("建不了渲染数据目录 {}：{error}", output.display()))?;
    let manager = WebsiteDataManager::builder()
        .base_data_directory(data_directory.join("data").to_string_lossy().into_owned())
        .base_cache_directory(data_directory.join("cache").to_string_lossy().into_owned())
        .build();
    let context = WebContext::with_website_data_manager(&manager);
    context.set_cache_model(CacheModel::DocumentViewer);
    context.add_path_to_sandbox(&output, false);
    if let Some(security) = context.security_manager() {
        security.register_uri_scheme_as_secure(page::SCHEME);
        security.register_uri_scheme_as_cors_enabled(page::SCHEME);
    }
    let printer = gtk_ffi::find_file_printer()
        .await
        .ok_or_else(|| "GTK 里没有「打印到文件」打印机（缺 GTK 的 file 打印后端），WebKitGTK 出不了 PDF".to_owned())?;
    let shared = Rc::new(Shared {
        context: context.clone(),
        printer,
        tasks: RefCell::new(HashMap::new()),
        output,
        next_file: Cell::new(1),
    });
    let weak = Rc::downgrade(&shared);
    context.register_uri_scheme(page::SCHEME, move |request| page::serve(&weak, request));
    RENDERERS.with(|renderers| renderers.borrow_mut().insert(id, shared));
    // SAFETY: 这三个函数没有参数，只返回编译进库里的版本号
    let (major, minor, micro) = unsafe {
        (
            webkit2gtk::ffi::webkit_get_major_version(),
            webkit2gtk::ffi::webkit_get_minor_version(),
            webkit2gtk::ffi::webkit_get_micro_version(),
        )
    };
    Ok(format!("{major}.{minor}.{micro}"))
}
