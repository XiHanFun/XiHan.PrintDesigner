// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! WebView2 渲染线程：一个跑消息循环的 STA 线程，上面建好隐藏窗口与 WebView2 环境；每个任务一个隐藏渲染页，
//! 页面脚本关闭，只载入任务文档，资源只从任务里取，其余请求一律拒绝。所有 WebView2 调用都在这个线程上执行，结果经 oneshot 送回

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{oneshot, watch};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    DownloadStartingEventHandler, NavigationCompletedEventHandler, NavigationStartingEventHandler, NewWindowRequestedEventHandler, PermissionRequestedEventHandler,
    PrintCompletedHandler, ProcessFailedEventHandler, WebResourceRequestedEventHandler, take_pwstr,
};
use windows::Win32::Foundation::{E_INVALIDARG, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::Win32::UI::WindowsAndMessaging::{
    CW_USEDEFAULT, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, MSG, PostMessageW, PostQuitMessage, RegisterClassW, TranslateMessage,
    WINDOW_EX_STYLE, WM_APP, WNDCLASSW, WS_OVERLAPPEDWINDOW,
};
use windows::core::{BOOL, HSTRING, Interface, PCWSTR, PWSTR, w};
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{Details, PrintDocument};

/// 任务文档所在的保留地址
pub(crate) const ORIGIN: &str = "https://print.local/";

/// 任务文档的地址
pub(crate) const DOCUMENT_URI: &str = "https://print.local/doc.html";

const RESOURCE_PREFIX: &str = "https://print.local/r/";
const WM_TASK: u32 = WM_APP + 1;

/// 等字体就绪后数出输出页与没有载入成功的图片
const READY_SCRIPT: &str = r#"(() => document.fonts.ready.then(() => JSON.stringify({
  sheets: document.querySelectorAll('[data-part="sheet"]').length,
  broken: Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).length,
  title: document.title,
})))()"#;

type Task = Box<dyn FnOnce() + Send>;

/// 渲染线程
pub(crate) struct RenderThread {
    sender: Mutex<Sender<Task>>,
    window: isize,
    version: String,
}

struct ThreadState {
    window: HWND,
    environment: Option<ICoreWebView2Environment>,
    receiver: Receiver<Task>,
    pages: HashMap<u64, Rc<PageState>>,
    closed: Vec<u64>,
}

thread_local! {
    static STATE: RefCell<Option<ThreadState>> = const { RefCell::new(None) };
}

/// 一个渲染页在渲染线程上的状态
struct PageState {
    controller: RefCell<Option<ICoreWebView2Controller>>,
    blocked: RefCell<Option<String>>,
    missing: RefCell<Option<String>>,
}

impl RenderThread {
    /// 起渲染线程并建 WebView2 环境：先清空上次留下的渲染数据；没装 WebView2 运行时时给出原因
    pub(crate) async fn start(data_directory: PathBuf, cleared: impl FnOnce(std::io::Result<()>)) -> Result<Arc<RenderThread>, String> {
        if data_directory.exists() {
            cleared(std::fs::remove_dir_all(&data_directory));
        }
        let (sender, receiver) = std::sync::mpsc::channel::<Task>();
        let (ready, started) = oneshot::channel::<Result<(isize, String), String>>();
        std::thread::Builder::new()
            .name("webview2-render".into())
            .spawn(move || run(data_directory, receiver, ready))
            .map_err(|error| format!("起不了渲染线程：{error}"))?;
        let (window, version) = started.await.map_err(|_| "渲染线程意外退出".to_owned())??;
        Ok(Arc::new(RenderThread {
            sender: Mutex::new(sender),
            window,
            version,
        }))
    }

    /// WebView2 运行时版本
    pub(crate) fn version(&self) -> &str {
        &self.version
    }

    /// 把一段工作交给渲染线程执行
    fn post(&self, task: Task) {
        if self.sender.lock().unwrap().send(task).is_ok() {
            // SAFETY: window 是渲染线程建的窗口，消息只用来唤醒它
            let _ = unsafe { PostMessageW(Some(HWND(self.window as _)), WM_TASK, WPARAM(0), LPARAM(0)) };
        }
    }

    /// 在渲染线程上执行，结果经 reply 送回；渲染线程已退出时为 RENDER_FAILED
    async fn call<R: Send + 'static>(&self, work: impl FnOnce(oneshot::Sender<R>) + Send + 'static) -> Result<R, JobError> {
        self.request(work).await.map_err(|_| JobError::failure(errors::RENDER_FAILED, "渲染线程没有回复", None))
    }

    /// 在渲染线程上执行，返回等结果的接收端
    fn request<R: Send + 'static>(&self, work: impl FnOnce(oneshot::Sender<R>) + Send + 'static) -> oneshot::Receiver<R> {
        let (reply, result) = oneshot::channel();
        self.post(Box::new(move || work(reply)));
        result
    }

    /// 建渲染页、载入文档并等到字体与图片就绪；超过期限报 RENDER_TIMEOUT
    pub(crate) async fn open(self: &Arc<Self>, document: Arc<PrintDocument>, timeout: Duration, cancel: &Cancel) -> Result<Page, JobError> {
        let id = next_id();
        let expected = u64::from(document.sheet_count());
        let (crash_sender, crashed) = watch::channel(None);
        let mut page = Page {
            thread: self.clone(),
            id,
            crashed,
            title: String::new(),
        };
        let loading = async {
            let navigated = self.call(move |reply| create_page(id, document, crash_sender, reply)).await?;
            page.guard(async { navigated.await.map_err(|_| JobError::failure(errors::RENDER_FAILED, "渲染页没能建好", None))? })
                .await?;
            let ready: Value = serde_json::from_str(page.evaluate(READY_SCRIPT).await?.as_str().unwrap_or("{}")).unwrap_or_default();
            Ok::<Value, JobError>(ready)
        };
        let ready = match cancel.run(tokio::time::timeout(timeout, loading)).await? {
            Ok(ready) => ready?,
            Err(_) => {
                return Err(JobError::failure(
                    errors::RENDER_TIMEOUT,
                    format!("文档超过 {:.0} 秒没有就绪", timeout.as_secs_f64()),
                    Some(Details::new().with("timeout", true)),
                ));
            }
        };
        let (blocked, missing) = self
            .call(move |reply| {
                let found = page_state(id).map(|state| (state.blocked.borrow().clone(), state.missing.borrow().clone()));
                let _ = reply.send(found.unwrap_or_default());
            })
            .await?;
        if let Some(url) = blocked {
            return Err(JobError::failure(
                errors::RESOURCE_BLOCKED,
                "文档引用了任务以外的资源，已拒绝",
                Some(Details::new().with("url", url)),
            ));
        }
        if let Some(resource) = missing {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                "文档引用了任务里没有的资源",
                Some(Details::new().with("resource", resource)),
            ));
        }
        let broken = ready["broken"].as_u64().unwrap_or(0);
        if broken > 0 {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("有 {broken} 张图片解码失败"),
                Some(Details::new().with("images", broken)),
            ));
        }
        let sheets = ready["sheets"].as_u64().unwrap_or(0);
        if sheets != expected {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("文档里有 {sheets} 张输出页，纸张分组写的是 {expected} 张"),
                Some(Details::new().with("expected", expected).with("actual", sheets)),
            ));
        }
        page.title = ready["title"].as_str().unwrap_or_default().to_owned();
        Ok(page)
    }
}

/// 渲染页：丢弃时在渲染线程上关闭
pub(crate) struct Page {
    thread: Arc<RenderThread>,
    id: u64,
    crashed: watch::Receiver<Option<String>>,
    /// 文档标题，打印池里的文档名
    pub title: String,
}

impl Drop for Page {
    fn drop(&mut self) {
        let id = self.id;
        self.thread.post(Box::new(move || close_page(id)));
    }
}

/// 一组纸张的打印设置
#[derive(Clone, Debug)]
pub(crate) struct PrintSettings {
    /// 打印机
    pub printer: String,
    /// 纸张宽，英寸
    pub width_inches: f64,
    /// 纸张高，英寸
    pub height_inches: f64,
    /// 是否横放
    pub landscape: bool,
    /// 页码范围，空串为全部
    pub ranges: String,
    /// 份数
    pub copies: i32,
    /// 逐份
    pub collate: bool,
    /// 双面方式
    pub duplex: xihan_print_client_core::protocol::DuplexMode,
    /// 灰度
    pub grayscale: bool,
}

/// 交给打印池的结果
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PrintStatus {
    /// 成功
    Succeeded,
    /// 打印机不可用
    PrinterUnavailable,
    /// 其他错误，带状态值
    Other(i32),
    /// 打印机不接受这组设置
    InvalidSettings,
}

impl Page {
    /// 渲染进程意外退出时以 RENDER_FAILED 中止
    async fn guard<T>(&self, work: impl std::future::Future<Output = Result<T, JobError>>) -> Result<T, JobError> {
        let mut crashed = self.crashed.clone();
        tokio::select! {
            result = work => result,
            changed = crashed.wait_for(Option::is_some) => {
                let kind = changed.map(|kind| kind.clone().unwrap_or_default()).unwrap_or_default();
                Err(JobError::failure(errors::RENDER_FAILED, format!("渲染进程意外退出：{kind}"), None))
            }
        }
    }

    /// 调 DevTools 协议的方法，返回结果
    pub(crate) async fn devtools(&self, method: &'static str, parameters: Value) -> Result<Value, JobError> {
        let id = self.id;
        let parameters = parameters.to_string();
        let answer = self.thread.request(move |reply: oneshot::Sender<Result<String, String>>| {
            let Some(webview) = webview_of(id) else {
                let _ = reply.send(Err("渲染页已关闭".into()));
                return;
            };
            let reply = Rc::new(RefCell::new(Some(reply)));
            let respond = reply.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                if let Some(reply) = respond.borrow_mut().take() {
                    let _ = reply.send(result.map(|_| json).map_err(|error| error.message()));
                }
                Ok(())
            }));
            // SAFETY: 在渲染线程上调用，字符串在调用期间有效
            if let Err(error) = unsafe { webview.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(parameters), &handler) }
                && let Some(reply) = reply.borrow_mut().take()
            {
                let _ = reply.send(Err(error.message()));
            }
        });
        let json = self
            .guard(async { answer.await.map_err(|_| JobError::failure(errors::RENDER_FAILED, "渲染页没有回复", None)) })
            .await?;
        let json = json.map_err(|message| JobError::failure(errors::RENDER_FAILED, format!("渲染页调用 {method} 失败：{message}"), None))?;
        serde_json::from_str(&json).map_err(|_| JobError::failure(errors::RENDER_FAILED, format!("渲染页调用 {method} 的结果不是 JSON"), None))
    }

    /// 在页面里求值一段检测脚本（页面脚本关闭时照样可用），返回值
    pub(crate) async fn evaluate(&self, expression: &str) -> Result<Value, JobError> {
        let root = self
            .devtools("Runtime.evaluate", json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }))
            .await?;
        if let Some(exception) = root.get("exceptionDetails") {
            let text = exception["exception"]["description"]
                .as_str()
                .or_else(|| exception["text"].as_str())
                .unwrap_or_default()
                .to_owned();
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                "渲染页里的检测脚本出错",
                Some(Details::new().with("exception", text)),
            ));
        }
        Ok(root["result"]["value"].clone())
    }

    /// 按设置交给打印机
    pub(crate) async fn print(&self, settings: PrintSettings) -> Result<PrintStatus, JobError> {
        let id = self.id;
        let answer = self.thread.request(move |reply: oneshot::Sender<PrintStatus>| {
            let reply = Rc::new(RefCell::new(Some(reply)));
            let respond = reply.clone();
            let send = move |status: PrintStatus| {
                if let Some(reply) = respond.borrow_mut().take() {
                    let _ = reply.send(status);
                }
            };
            let send_now = send.clone();
            let started = (|| -> windows::core::Result<()> {
                let webview = webview_of(id).ok_or_else(|| windows::core::Error::from(E_INVALIDARG))?;
                let environment = environment()?.cast::<ICoreWebView2Environment6>()?;
                // SAFETY: 在渲染线程上调用 WebView2
                unsafe {
                    let print = environment.CreatePrintSettings()?;
                    apply(&print, &settings)?;
                    let handler = PrintCompletedHandler::create(Box::new(move |result, status| {
                        send(match result {
                            Err(error) if error.code() == E_INVALIDARG => PrintStatus::InvalidSettings,
                            Err(error) => PrintStatus::Other(error.code().0),
                            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => PrintStatus::Succeeded,
                            Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE => PrintStatus::PrinterUnavailable,
                            Ok(()) => PrintStatus::Other(status.0),
                        });
                        Ok(())
                    }));
                    webview.cast::<ICoreWebView2_16>()?.Print(&print, &handler)
                }
            })();
            if let Err(error) = started {
                send_now(if error.code() == E_INVALIDARG {
                    PrintStatus::InvalidSettings
                } else {
                    PrintStatus::Other(error.code().0)
                });
            }
        });
        self.guard(async { answer.await.map_err(|_| JobError::failure(errors::SPOOL_FAILED, "打印没有回复", None)) })
            .await
    }
}

/// 把设置写进 WebView2 的打印设置：纸张宽高与方向按核对的结果，页边距为 0，原大，打印背景，不加页眉页脚
///
/// # Safety
/// 在渲染线程上调用
unsafe fn apply(print: &ICoreWebView2PrintSettings, settings: &PrintSettings) -> windows::core::Result<()> {
    use xihan_print_client_core::protocol::DuplexMode;
    // SAFETY: 由调用方保证在渲染线程上
    unsafe {
        print.SetOrientation(if settings.landscape {
            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
        } else {
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
        })?;
        print.SetPageWidth(settings.width_inches)?;
        print.SetPageHeight(settings.height_inches)?;
        print.SetMarginTop(0.0)?;
        print.SetMarginBottom(0.0)?;
        print.SetMarginLeft(0.0)?;
        print.SetMarginRight(0.0)?;
        print.SetScaleFactor(1.0)?;
        print.SetShouldPrintBackgrounds(true)?;
        print.SetShouldPrintHeaderAndFooter(false)?;
        let second = print.cast::<ICoreWebView2PrintSettings2>()?;
        second.SetPrinterName(&HSTRING::from(settings.printer.as_str()))?;
        second.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
        second.SetPagesPerSide(1)?;
        second.SetPageRanges(&HSTRING::from(settings.ranges.as_str()))?;
        second.SetCopies(settings.copies)?;
        second.SetCollation(if settings.collate {
            COREWEBVIEW2_PRINT_COLLATION_COLLATED
        } else {
            COREWEBVIEW2_PRINT_COLLATION_UNCOLLATED
        })?;
        second.SetDuplex(match settings.duplex {
            DuplexMode::LongEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
            DuplexMode::ShortEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
            DuplexMode::Simplex => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
        })?;
        second.SetColorMode(if settings.grayscale {
            COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE
        } else {
            COREWEBVIEW2_PRINT_COLOR_MODE_COLOR
        })?;
    }
    Ok(())
}

fn next_id() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn environment() -> windows::core::Result<ICoreWebView2Environment> {
    STATE
        .with(|state| state.borrow().as_ref().and_then(|state| state.environment.clone()))
        .ok_or_else(|| windows::core::Error::from(E_INVALIDARG))
}

fn page_state(id: u64) -> Option<Rc<PageState>> {
    STATE.with(|state| state.borrow().as_ref().and_then(|state| state.pages.get(&id).cloned()))
}

fn webview_of(id: u64) -> Option<ICoreWebView2> {
    let controller = page_state(id)?.controller.borrow().clone()?;
    // SAFETY: 在渲染线程上读控制器的 WebView
    unsafe { controller.CoreWebView2() }.ok()
}

fn close_page(id: u64) {
    let state = STATE.with(|state| {
        let mut state = state.borrow_mut();
        let state = state.as_mut()?;
        let page = state.pages.remove(&id);
        if page.is_none() {
            state.closed.push(id);
        }
        page
    });
    if let Some(controller) = state.and_then(|page| page.controller.borrow_mut().take()) {
        // SAFETY: 在渲染线程上关闭控制器
        let _ = unsafe { controller.Close() };
    }
}

fn was_closed(id: u64) -> bool {
    STATE.with(|state| {
        state.borrow_mut().as_mut().is_some_and(|state| {
            let found = state.closed.iter().position(|item| *item == id);
            if let Some(index) = found {
                state.closed.swap_remove(index);
            }
            found.is_some()
        })
    })
}

/// 在渲染线程上建渲染页：建好后配置、挂事件、导航到任务文档，导航完成时经 navigated 回复
fn create_page(id: u64, document: Arc<PrintDocument>, crash: watch::Sender<Option<String>>, reply: oneshot::Sender<oneshot::Receiver<Result<(), JobError>>>) {
    let (navigated_sender, navigated) = oneshot::channel();
    let _ = reply.send(navigated);
    let navigated_sender = Rc::new(RefCell::new(Some(navigated_sender)));
    let fail = {
        let navigated_sender = navigated_sender.clone();
        move |message: String| {
            if let Some(sender) = navigated_sender.borrow_mut().take() {
                let _ = sender.send(Err(JobError::failure(errors::RENDER_FAILED, message, None)));
            }
        }
    };
    let state = Rc::new(PageState {
        controller: RefCell::new(None),
        blocked: RefCell::new(None),
        missing: RefCell::new(None),
    });
    let (window, environment) = match STATE.with(|cell| {
        let mut cell = cell.borrow_mut();
        let cell = cell.as_mut()?;
        cell.pages.insert(id, state.clone());
        Some((cell.window, cell.environment.clone()?))
    }) {
        Some(found) => found,
        None => return fail("WebView2 环境不可用".into()),
    };
    let created = (|| -> windows::core::Result<()> {
        let environment10 = environment.cast::<ICoreWebView2Environment10>()?;
        // SAFETY: 在渲染线程上调用 WebView2
        unsafe {
            let options = environment10.CreateCoreWebView2ControllerOptions()?;
            options.SetProfileName(w!("print"))?;
            options.SetIsInPrivateModeEnabled(true)?;
            let failed = fail.clone();
            let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |result, controller| {
                let controller = match (result, controller) {
                    (Ok(()), Some(controller)) => controller,
                    (Err(error), _) => {
                        failed(format!("渲染页没能建好：{}", error.message()));
                        return Ok(());
                    }
                    _ => {
                        failed("渲染页没能建好".into());
                        return Ok(());
                    }
                };
                if was_closed(id) {
                    let _ = controller.Close();
                    return Ok(());
                }
                *state.controller.borrow_mut() = Some(controller.clone());
                if let Err(error) = configure(&controller, &environment, &document, &state, &crash, navigated_sender.clone()) {
                    failed(format!("渲染页没能配置好：{}", error.message()));
                }
                Ok(())
            }));
            environment10.CreateCoreWebView2ControllerWithOptions(window, &options, &handler)
        }
    })();
    if let Err(error) = created {
        fail(format!("渲染页没能建好：{}", error.message()));
    }
}

type Navigated = Rc<RefCell<Option<oneshot::Sender<Result<(), JobError>>>>>;

/// 关脚本与各种交互，挂上资源拦截与导航、权限、下载、新窗口、进程失败的处理，再导航到任务文档
fn configure(
    controller: &ICoreWebView2Controller,
    environment: &ICoreWebView2Environment,
    document: &Arc<PrintDocument>,
    state: &Rc<PageState>,
    crash: &watch::Sender<Option<String>>,
    navigated: Navigated,
) -> windows::core::Result<()> {
    let mut token = 0i64;
    // SAFETY: 在渲染线程上调用 WebView2；回调都在这个线程上触发
    unsafe {
        controller.SetIsVisible(false)?;
        let webview = controller.CoreWebView2()?;
        let settings = webview.Settings()?;
        settings.SetIsScriptEnabled(false)?;
        settings.SetIsWebMessageEnabled(false)?;
        settings.SetAreHostObjectsAllowed(false)?;
        settings.SetAreDefaultScriptDialogsEnabled(false)?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        settings.SetIsBuiltInErrorPageEnabled(false)?;
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            settings.SetAreBrowserAcceleratorKeysEnabled(false)?;
        }
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
            settings.SetIsGeneralAutofillEnabled(false)?;
            settings.SetIsPasswordAutosaveEnabled(false)?;
        }
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings5>() {
            settings.SetIsPinchZoomEnabled(false)?;
        }
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings6>() {
            settings.SetIsSwipeNavigationEnabled(false)?;
        }
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings8>() {
            settings.SetIsReputationCheckingRequired(false)?;
        }

        match webview.cast::<ICoreWebView2_22>() {
            Ok(webview) => {
                webview.AddWebResourceRequestedFilterWithRequestSourceKinds(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)?
            }
            Err(_) => webview.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
        }
        let resources = {
            let environment = environment.clone();
            let document = document.clone();
            let state = state.clone();
            WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    respond(&environment, &document, &state, &args)?;
                }
                Ok(())
            }))
        };
        webview.add_WebResourceRequested(&resources, &mut token)?;

        let navigation = NavigationStartingEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if take_pwstr(uri) != DOCUMENT_URI {
                    args.SetCancel(true)?;
                }
            }
            Ok(())
        }));
        webview.add_NavigationStarting(&navigation, &mut token)?;
        let frames = NavigationStartingEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if !take_pwstr(uri).starts_with(ORIGIN) {
                    args.SetCancel(true)?;
                }
            }
            Ok(())
        }));
        webview.add_FrameNavigationStarting(&frames, &mut token)?;
        let windows = NewWindowRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        webview.add_NewWindowRequested(&windows, &mut token)?;
        let permissions = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            }
            Ok(())
        }));
        webview.add_PermissionRequested(&permissions, &mut token)?;
        if let Ok(webview4) = webview.cast::<ICoreWebView2_4>() {
            let downloads = DownloadStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetCancel(true)?;
                }
                Ok(())
            }));
            webview4.add_DownloadStarting(&downloads, &mut token)?;
        }
        let crash = crash.clone();
        let failures = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(args) = args {
                args.ProcessFailedKind(&mut kind)?;
            }
            let _ = crash.send(Some(format!("{}", kind.0)));
            Ok(())
        }));
        webview.add_ProcessFailed(&failures, &mut token)?;

        let completed = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(sender) = navigated.borrow_mut().take() else {
                return Ok(());
            };
            let mut success = BOOL::default();
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            if let Some(args) = args {
                args.IsSuccess(&mut success)?;
                args.WebErrorStatus(&mut status)?;
            }
            let _ = sender.send(if success.as_bool() {
                Ok(())
            } else {
                Err(JobError::failure(errors::RENDER_FAILED, format!("文档载入失败：{}", status.0), None))
            });
            Ok(())
        }));
        webview.add_NavigationCompleted(&completed, &mut token)?;
        webview.Navigate(&HSTRING::from(DOCUMENT_URI))?;
    }
    Ok(())
}

/// 应答一个资源请求：文档本身、任务里的资源、保留地址下其他的 404，其余 403 并记下被拦的地址
///
/// # Safety
/// 在渲染线程上调用
unsafe fn respond(
    environment: &ICoreWebView2Environment,
    document: &PrintDocument,
    state: &PageState,
    args: &ICoreWebView2WebResourceRequestedEventArgs,
) -> windows::core::Result<()> {
    // SAFETY: 由调用方保证在渲染线程上
    unsafe {
        let mut uri = PWSTR::null();
        args.Request()?.Uri(&mut uri)?;
        let uri = take_pwstr(uri);
        if uri.starts_with("data:") || uri.starts_with("blob:") {
            return Ok(());
        }
        let response = if uri == DOCUMENT_URI {
            response(environment, 200, "OK", Some("text/html; charset=utf-8"), document.html.as_bytes())?
        } else if let Some(rest) = uri.strip_prefix(RESOURCE_PREFIX) {
            let id = rest.split(['?', '#']).next().unwrap_or_default();
            match document.resource(id) {
                Some(resource) => response(environment, 200, "OK", Some(&resource.mime), &resource.data)?,
                None => {
                    state.missing.borrow_mut().get_or_insert_with(|| id.to_owned());
                    response(environment, 404, "Not Found", None, &[])?
                }
            }
        } else if uri.starts_with(ORIGIN) {
            response(environment, 404, "Not Found", None, &[])?
        } else {
            state.blocked.borrow_mut().get_or_insert_with(|| origin_of(&uri));
            response(environment, 403, "Forbidden", None, &[])?
        };
        args.SetResponse(&response)
    }
}

/// 被拦地址写给浏览器看的部分：协议加主机；认不出时取前 64 个字符
pub(crate) fn origin_of(uri: &str) -> String {
    match uri.split_once("://") {
        Some((scheme, rest)) => format!("{scheme}://{}", rest.split(['/', '?', '#']).next().unwrap_or_default()),
        None => uri.chars().take(64).collect(),
    }
}

/// # Safety
/// 在渲染线程上调用
unsafe fn response(environment: &ICoreWebView2Environment, status: i32, reason: &str, mime: Option<&str>, body: &[u8]) -> windows::core::Result<ICoreWebView2WebResourceResponse> {
    let headers = match mime {
        Some(mime) => format!("Content-Type: {mime}\r\nCache-Control: no-store"),
        None => "Cache-Control: no-store".to_owned(),
    };
    // SAFETY: 由调用方保证在渲染线程上；body 在调用期间有效，内存流复制一份
    unsafe {
        let stream = SHCreateMemStream(Some(body));
        environment.CreateWebResourceResponse(stream.as_ref(), status, &HSTRING::from(reason), &HSTRING::from(headers))
    }
}

/// 渲染线程本身：初始化 COM、建隐藏窗口与 WebView2 环境，然后跑消息循环
fn run(data_directory: PathBuf, receiver: Receiver<Task>, ready: oneshot::Sender<Result<(isize, String), String>>) {
    // SAFETY: 本线程只做 WebView2 的 STA 工作
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: w!("XiHanPrintRender"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let window = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("XiHanPrintRender"),
            w!("XiHanPrintRender"),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            800,
            600,
            None,
            None,
            Some(instance.into()),
            None,
        ) {
            Ok(window) => window,
            Err(error) => {
                let _ = ready.send(Err(format!("建不了渲染窗口：{}", error.message())));
                return;
            }
        };
        STATE.with(|state| {
            *state.borrow_mut() = Some(ThreadState {
                window,
                environment: None,
                receiver,
                pages: HashMap::new(),
                closed: Vec::new(),
            })
        });

        let options = CoreWebView2EnvironmentOptions::default();
        options.set_additional_browser_arguments("--disable-background-networking --disable-component-update --no-pings".to_owned());
        options.set_are_browser_extensions_enabled(false);
        let options: ICoreWebView2EnvironmentOptions = options.into();
        let ready = Rc::new(RefCell::new(Some(ready)));
        let answer = ready.clone();
        let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |result, environment| {
            let Some(ready) = answer.borrow_mut().take() else {
                return Ok(());
            };
            match (result, environment) {
                (Ok(()), Some(environment)) => {
                    let mut version = PWSTR::null();
                    let _ = environment.BrowserVersionString(&mut version);
                    let version = take_pwstr(version);
                    STATE.with(|state| {
                        if let Some(state) = state.borrow_mut().as_mut() {
                            state.environment = Some(environment);
                        }
                    });
                    let _ = ready.send(Ok((window.0 as isize, version)));
                }
                (Err(error), _) => {
                    let _ = ready.send(Err(describe_environment_error(&error)));
                    PostQuitMessage(0);
                }
                _ => {
                    let _ = ready.send(Err("WebView2 环境没能建好".into()));
                    PostQuitMessage(0);
                }
            }
            Ok(())
        }));
        let directory = HSTRING::from(data_directory.as_os_str());
        if let Err(error) = CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &directory, &options, &handler) {
            if let Some(ready) = ready.borrow_mut().take() {
                let _ = ready.send(Err(describe_environment_error(&error)));
            }
            let _ = DestroyWindow(window);
            return;
        }

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        STATE.with(|state| state.borrow_mut().take());
    }
}

fn describe_environment_error(error: &windows::core::Error) -> String {
    const FILE_NOT_FOUND: i32 = 0x80070002_u32 as i32;
    if error.code().0 == FILE_NOT_FOUND {
        "没有检测到 WebView2 运行时".to_owned()
    } else {
        format!("WebView2 环境没能建好：{}", error.message())
    }
}

extern "system" fn window_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if message == WM_TASK {
        loop {
            let task = STATE.with(|state| state.borrow().as_ref().and_then(|state| state.receiver.try_recv().ok()));
            match task {
                Some(task) => task(),
                None => break,
            }
        }
        return LRESULT(0);
    }
    // SAFETY: 其余消息交给缺省处理
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

impl Drop for RenderThread {
    fn drop(&mut self) {
        let window = self.window;
        self.post(Box::new(move || {
            let pages: Vec<u64> = STATE.with(|state| state.borrow().as_ref().map(|state| state.pages.keys().copied().collect()).unwrap_or_default());
            for id in pages {
                close_page(id);
            }
            // SAFETY: 在渲染线程上销毁自己的窗口并结束消息循环
            unsafe {
                let _ = DestroyWindow(HWND(window as _));
                PostQuitMessage(0);
            }
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::origin_of;

    #[test]
    fn reports_only_the_origin_of_blocked_addresses() {
        assert_eq!(origin_of("https://example.com/logo.png?token=secret"), "https://example.com");
        assert_eq!(origin_of("http://10.0.0.1:8080"), "http://10.0.0.1:8080");
    }
}
