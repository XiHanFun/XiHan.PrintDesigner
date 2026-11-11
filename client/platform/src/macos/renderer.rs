// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! WKWebView 渲染器：每个任务一个渲染页，载入并等到就绪、核对后逐组打印成 PDF 文件再读回；WebKit 调用都派发到主线程上

use std::any::Any;
use std::cell::Cell;
use std::fs;
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::{ClassType, MainThreadMarker, sel};
use objc2_foundation::{NSBundle, NSError, NSSize, NSString, NSURL, ns_string};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};
use serde::Deserialize;
use tokio::sync::{Mutex, oneshot, watch};
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::{LogLevel, SharedLog};
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{Details, PrintDocument, number};

use super::main_thread::{OnMain, on_main, reply};
use super::page::{Opened, Page};
use super::{pdf, scripts};
use crate::unix::{GroupRender, PdfRenderer};

/// 内容规则：拦下一切地址，只放行任务文档与资源、data:、blob:、about:
const CONTENT_RULES: &str = r#"[
  { "trigger": { "url-filter": ".*" }, "action": { "type": "block" } },
  { "trigger": { "url-filter": "^xihan-print://print\\.local/" }, "action": { "type": "ignore-previous-rules" } },
  { "trigger": { "url-filter": "^data:" }, "action": { "type": "ignore-previous-rules" } },
  { "trigger": { "url-filter": "^blob:" }, "action": { "type": "ignore-previous-rules" } },
  { "trigger": { "url-filter": "^about:" }, "action": { "type": "ignore-previous-rules" } }
]"#;

const MILLIMETERS_PER_INCH: f64 = 25.4;
const POINTS_PER_INCH: f64 = 72.0;
const CSS_PIXELS_PER_INCH: f64 = 96.0;

/// 经 WKWebView 把任务文档渲染成 PDF
pub(crate) struct WebKitRenderer {
    shared: Arc<Shared>,
}

struct Shared {
    rules: OnMain<Retained<WKContentRuleList>>,
    version: Option<String>,
    output: PathBuf,
    serial: AtomicU64,
    printing: Mutex<()>,
    log: SharedLog,
}

/// 就绪检测脚本的结果
#[derive(Deserialize)]
struct Ready {
    sheets: u64,
    broken: u64,
    blocked: Option<String>,
}

impl WebKitRenderer {
    /// 清空渲染数据目录，在主线程上编译内容规则；系统的 WebKit 太旧或规则编译不了时给出原因
    pub(crate) async fn create(data_directory: &Path, log: SharedLog) -> Result<Self, String> {
        match fs::remove_dir_all(data_directory) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => log.write(LogLevel::Warning, "清空渲染数据目录失败，沿用上次的数据", Some(&error)),
            _ => {}
        }
        let rules_directory = data_directory.join("rules");
        let output = data_directory.join("pdf");
        for directory in [&rules_directory, &output] {
            fs::create_dir_all(directory).map_err(|error| format!("建不了渲染数据目录 {}：{error}", directory.display()))?;
        }

        let compiled = on_main(move |mtm| compile_rules(mtm, &rules_directory)).await.map_err(|error| error.to_string())??;
        let rules = compiled.await.map_err(|_| "编译内容规则没有回复".to_owned())??;
        let version = webkit_version();
        log.info(&format!("WebKit {}", version.as_deref().unwrap_or("版本未知")));
        Ok(WebKitRenderer {
            shared: Arc::new(Shared {
                rules,
                version,
                output,
                serial: AtomicU64::new(0),
                printing: Mutex::new(()),
                log,
            }),
        })
    }
}

impl PdfRenderer for WebKitRenderer {
    fn name(&self) -> &str {
        "WebKit"
    }

    fn version(&self) -> Option<String> {
        self.shared.version.clone()
    }

    fn render(
        &self,
        document: Arc<PrintDocument>,
        groups: Vec<GroupRender>,
        grayscale: bool,
        timeout: Duration,
        cancel: Cancel,
    ) -> BoxFuture<'static, Result<Vec<Vec<u8>>, JobError>> {
        let shared = self.shared.clone();
        Box::pin(async move { shared.render(document, groups, grayscale, timeout, cancel).await })
    }

    fn merge(&self, pdfs: Vec<Vec<u8>>) -> Result<Vec<u8>, JobError> {
        pdf::merge(pdfs)
    }
}

impl Shared {
    async fn render(self: Arc<Self>, document: Arc<PrintDocument>, groups: Vec<GroupRender>, grayscale: bool, timeout: Duration, cancel: Cancel) -> Result<Vec<Vec<u8>>, JobError> {
        let expected = u64::from(document.sheet_count());
        check_groups(&groups, expected)?;
        let viewport = viewport(&groups);
        let opened = {
            let (shared, document) = (self.clone(), document.clone());
            on_main(move |mtm| Page::open(mtm, shared.rules.get(mtm), document, viewport)).await??
        };
        let Opened { page, loaded, mut crashed } = opened;
        let page = Arc::new(page);

        let not_ready = || {
            JobError::failure(
                errors::RENDER_TIMEOUT,
                format!("文档超过 {:.0} 秒没有就绪", timeout.as_secs_f64()),
                Some(Details::new().with("timeout", true)),
            )
        };
        let ready = guarded(&cancel, &mut crashed, timeout, not_ready, async {
            reply(loaded, "文档载入").await?;
            let text = call(&page, scripts::READY.to_owned()).await?;
            serde_json::from_str::<Ready>(&text).map_err(|error| JobError::failure(errors::RENDER_FAILED, format!("就绪检测的结果读不出来：{error}"), None))
        })
        .await?;

        let findings = {
            let page = page.clone();
            on_main(move |mtm| page.get(mtm).findings()).await?
        };
        if let Some(url) = findings.blocked.or(ready.blocked) {
            return Err(JobError::failure(
                errors::RESOURCE_BLOCKED,
                "文档引用了任务以外的资源，已拒绝",
                Some(Details::new().with("url", url)),
            ));
        }
        if let Some(resource) = findings.missing {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                "文档引用了任务里没有的资源",
                Some(Details::new().with("resource", resource)),
            ));
        }
        if ready.broken > 0 {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("有 {} 张图片解码失败", ready.broken),
                Some(Details::new().with("images", ready.broken)),
            ));
        }
        if ready.sheets != expected {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("文档里有 {} 张输出页，纸张分组写的是 {expected} 张", ready.sheets),
                Some(Details::new().with("expected", expected).with("actual", ready.sheets)),
            ));
        }

        guarded(&cancel, &mut crashed, timeout, not_ready, async {
            call(&page, scripts::prepare(grayscale)).await.map(drop)
        })
        .await?;

        let mut pdfs = Vec::with_capacity(groups.len());
        for (index, group) in groups.iter().enumerate() {
            let too_slow = || {
                JobError::failure(
                    errors::RENDER_TIMEOUT,
                    format!("第 {} 组输出页超过 {:.0} 秒没有渲染成 PDF", index + 1, timeout.as_secs_f64()),
                    Some(Details::new().with("timeout", true).with("group", index)),
                )
            };
            let pdf = guarded(&cancel, &mut crashed, timeout, too_slow, self.print_group(&page, index, group)).await?;
            pdfs.push(pdf);
        }
        Ok(pdfs)
    }

    /// 只显示这组的输出页，按这组的纸张打印成 PDF 文件后读回；同一时刻只跑一个打印操作
    async fn print_group(&self, page: &Arc<OnMain<Page>>, index: usize, group: &GroupRender) -> Result<Vec<u8>, JobError> {
        let shown: usize = serde_json::from_str(&call(page, scripts::show(&group.sheets)).await?)
            .map_err(|error| JobError::failure(errors::RENDER_FAILED, format!("显示第 {} 组输出页的结果读不出来：{error}", index + 1), None))?;
        if shown != group.sheets.len() {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("第 {} 组只显示出 {shown} 张输出页，要的是 {} 张", index + 1, group.sheets.len()),
                None,
            ));
        }

        let _printing = self.printing.lock().await;
        let path = self.output.join(format!("{}-{}.pdf", std::process::id(), self.serial.fetch_add(1, Ordering::Relaxed)));
        let (width, height) = (points(group.width_mm), points(group.height_mm));
        let finished = {
            let (page, path) = (page.clone(), path.clone());
            let keep: Box<dyn Any + Send> = Box::new(page.clone());
            on_main(move |mtm| page.get(mtm).print(mtm, width, height, &path, keep)).await??
        };
        let succeeded = finished
            .await
            .map_err(|_| JobError::failure(errors::RENDER_FAILED, format!("第 {} 组输出页的打印操作没有回复", index + 1), None))?;
        let read = if succeeded {
            tokio::fs::read(&path).await
        } else {
            Err(io::Error::other("打印操作没有完成"))
        };
        if let Err(error) = tokio::fs::remove_file(&path).await
            && error.kind() != io::ErrorKind::NotFound
        {
            self.log.write(LogLevel::Warning, &format!("删不掉 PDF 临时文件 {}", path.display()), Some(&error));
        }
        let bytes = read.map_err(|error| {
            JobError::failure(
                errors::RENDER_FAILED,
                format!("第 {} 组输出页没能渲染成 PDF：{error}", index + 1),
                Some(
                    Details::new()
                        .with("group", index)
                        .with("widthMm", number(group.width_mm))
                        .with("heightMm", number(group.height_mm)),
                ),
            )
        })?;
        if !bytes.starts_with(b"%PDF-") {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("第 {} 组输出页渲染出的不是 PDF", index + 1),
                Some(Details::new().with("group", index)),
            ));
        }
        Ok(bytes)
    }
}

/// 每组至少有一张输出页，序号都在全文的张数之内
fn check_groups(groups: &[GroupRender], sheet_count: u64) -> Result<(), JobError> {
    if groups.is_empty() {
        return Err(JobError::failure(errors::INTERNAL, "没有要渲染的输出页", None));
    }
    for (index, group) in groups.iter().enumerate() {
        if group.sheets.is_empty() || group.sheets.iter().any(|&sheet| sheet as u64 >= sheet_count) {
            return Err(JobError::failure(
                errors::INTERNAL,
                format!("第 {} 组要显示的输出页不在全文的 {sheet_count} 张之内", index + 1),
                None,
            ));
        }
    }
    Ok(())
}

/// 渲染页的视口：各组里最宽、最高的纸张，单位 point（等于 CSS 像素）
fn viewport(groups: &[GroupRender]) -> NSSize {
    let pixels = |millimeters: f64| millimeters / MILLIMETERS_PER_INCH * CSS_PIXELS_PER_INCH;
    let width = groups.iter().map(|group| group.width_mm).fold(0.0, f64::max);
    let height = groups.iter().map(|group| group.height_mm).fold(0.0, f64::max);
    NSSize::new(pixels(width).ceil(), pixels(height).ceil())
}

/// 毫米换算成 point
fn points(millimeters: f64) -> f64 {
    millimeters / MILLIMETERS_PER_INCH * POINTS_PER_INCH
}

/// 在渲染页里执行一段函数体，取它返回的文本
async fn call(page: &Arc<OnMain<Page>>, body: String) -> Result<String, JobError> {
    let page = page.clone();
    let answer = on_main(move |mtm| page.get(mtm).call(mtm, &body)).await?;
    reply(answer, "渲染页里的脚本")
        .await?
        .ok_or_else(|| JobError::failure(errors::RENDER_FAILED, "渲染页里的脚本没有返回结果", None))
}

/// 在期限内执行一段工作：令牌取消时报已取消，渲染进程退出时报它的错误，超过期限时报 expired 给出的错误
async fn guarded<T>(
    cancel: &Cancel,
    crashed: &mut watch::Receiver<Option<JobError>>,
    limit: Duration,
    expired: impl FnOnce() -> JobError,
    work: impl Future<Output = Result<T, JobError>>,
) -> Result<T, JobError> {
    let watched = async {
        tokio::select! {
            biased;
            error = crash(crashed) => Err(error),
            result = work => result,
        }
    };
    match cancel.run(tokio::time::timeout(limit, watched)).await {
        Err(_) => Err(JobError::Cancelled),
        Ok(Err(_)) => Err(expired()),
        Ok(Ok(result)) => result,
    }
}

/// 等到渲染进程退出；渲染页已经释放时一直等下去
async fn crash(crashed: &mut watch::Receiver<Option<JobError>>) -> JobError {
    loop {
        let current = crashed.borrow_and_update().clone();
        if let Some(error) = current {
            return error;
        }
        if crashed.changed().await.is_err() {
            return std::future::pending().await;
        }
    }
}

/// 编译好的内容规则，或编译不了的原因
type CompiledRules = Result<OnMain<Retained<WKContentRuleList>>, String>;

/// 在主线程上开始编译内容规则；系统的 WebKit 没有 callAsyncJavaScript（macOS 11 之前）时给出原因
fn compile_rules(mtm: MainThreadMarker, directory: &Path) -> Result<oneshot::Receiver<CompiledRules>, String> {
    if !WKWebView::class().responds_to(sel!(callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:)) {
        return Err("HTML 通道要 macOS 11 或更高版本的 WebKit".to_owned());
    }
    let path = directory.to_str().ok_or_else(|| format!("渲染数据目录的路径不是 UTF-8：{}", directory.display()))?;
    let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), true);
    // SAFETY: 主线程上调用，地址是有效的目录
    let store = unsafe { WKContentRuleListStore::storeWithURL(Some(&url), mtm) }.ok_or_else(|| format!("打不开内容规则库 {}", directory.display()))?;

    let (sender, receiver) = oneshot::channel();
    let sender = Cell::new(Some(sender));
    let completion = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
        let Some(sender) = sender.take() else {
            return;
        };
        let result = match MainThreadMarker::new() {
            None => Err("内容规则编译完的回调不在主线程上".to_owned()),
            // SAFETY: WebKit 传来的是有效对象或 nil，回调期间有效
            Some(mtm) => match unsafe { Retained::retain(list) } {
                Some(list) => Ok(OnMain::new(list, mtm)),
                // SAFETY: 同上
                None => Err(match unsafe { error.as_ref() } {
                    Some(error) => format!("编译内容规则失败：{}", error.localizedDescription()),
                    None => "编译内容规则失败，WebKit 没有给出原因".to_owned(),
                }),
            },
        };
        let _ = sender.send(result);
    });
    // SAFETY: 主线程上调用，标识与规则都是有效的字符串
    unsafe {
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(ns_string!("xihan-print-local-only")),
            Some(&NSString::from_str(CONTENT_RULES)),
            Some(&completion),
        );
    }
    Ok(receiver)
}

/// 系统 WebKit 框架的版本号
fn webkit_version() -> Option<String> {
    let bundle = NSBundle::bundleWithIdentifier(ns_string!("com.apple.WebKit"))?;
    let version = bundle.objectForInfoDictionaryKey(ns_string!("CFBundleVersion"))?;
    version.downcast_ref::<NSString>().map(|text| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(sheets: &[usize], width_mm: f64, height_mm: f64) -> GroupRender {
        GroupRender {
            sheets: sheets.to_vec(),
            width_mm,
            height_mm,
        }
    }

    #[test]
    fn sizes_the_viewport_to_the_largest_paper() {
        let size = viewport(&[group(&[0], 210.0, 297.0), group(&[1], 297.0, 210.0)]);
        assert_eq!((size.width, size.height), (1123.0, 1123.0));
        assert!((points(210.0) - 595.2756).abs() < 0.001);
    }

    #[test]
    fn rejects_groups_outside_the_document() {
        assert!(check_groups(&[group(&[0, 1], 210.0, 297.0)], 2).is_ok());
        assert!(check_groups(&[group(&[2], 210.0, 297.0)], 2).is_err());
        assert!(check_groups(&[group(&[], 210.0, 297.0)], 2).is_err());
        assert!(check_groups(&[], 2).is_err());
    }
}
