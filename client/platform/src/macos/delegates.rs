// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 渲染页的 Objective-C 对象：导航委托只放行任务文档，scheme 处理器供任务文档与资源，打印委托等打印操作结束。全部只在主线程上使用

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::Arc;

use block2::DynBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::NSPrintOperation;
use objc2_foundation::{NSData, NSDictionary, NSError, NSHTTPURLResponse, NSString, NSURL, NSURLErrorDomain, NSURLErrorResourceUnavailable, ns_string};
use objc2_web_kit::{WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKURLSchemeHandler, WKURLSchemeTask, WKWebView};
use tokio::sync::{oneshot, watch};
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::PrintDocument;
use xihan_print_client_core::protocol::codes::errors;

use super::urls::{self, DOCUMENT_URL, FrameNavigation, Route};

/// 一个渲染页在主线程上共用的状态：导航委托与 scheme 处理器写，渲染流程读
pub(super) struct PageState {
    /// 任务文档
    pub(super) document: Arc<PrintDocument>,
    /// 改写了保留地址的文档，UTF-8
    pub(super) html: Vec<u8>,
    /// 文档载入完成或失败时送出结果，只送一次
    pub(super) loaded: Cell<Option<oneshot::Sender<Result<(), JobError>>>>,
    /// 载入任务文档的那次导航；只认它的完成与失败
    pub(super) navigation: RefCell<Option<Retained<WKNavigation>>>,
    /// 第一个被拦下的任务以外的地址：协议加主机
    pub(super) blocked: RefCell<Option<String>>,
    /// 第一个任务里没有的资源编号
    pub(super) missing: RefCell<Option<String>>,
    /// 渲染进程意外退出时写入
    pub(super) crashed: watch::Sender<Option<JobError>>,
}

impl PageState {
    /// 载入任务文档的那次导航结束时送出结果；别的导航不管
    fn finish_loading(&self, navigation: Option<&WKNavigation>, result: Result<(), JobError>) {
        let ours = matches!((self.navigation.borrow().as_deref(), navigation), (Some(expected), Some(actual)) if std::ptr::eq(expected, actual));
        if ours && let Some(sender) = self.loaded.take() {
            let _ = sender.send(result);
        }
    }
}

define_class!(
    // SAFETY: NSObject 没有子类化的要求；这个类不实现 Drop
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Rc<PageState>]
    /// 渲染页的导航委托：主框架只放行任务文档，子框架只放行任务里的地址；记下载入结果与渲染进程退出
    pub(super) struct NavigationDelegate;

    unsafe impl NSObjectProtocol for NavigationDelegate {}

    unsafe impl WKNavigationDelegate for NavigationDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy(&self, _web_view: &WKWebView, action: &WKNavigationAction, decision: &DynBlock<dyn Fn(WKNavigationActionPolicy)>) {
            let policy = if self.allows(action) { WKNavigationActionPolicy::Allow } else { WKNavigationActionPolicy::Cancel };
            decision.call((policy,));
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.ivars().finish_loading(navigation, Ok(()));
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>, error: &NSError) {
            self.ivars().finish_loading(navigation, Err(load_failure(error)));
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>, error: &NSError) {
            self.ivars().finish_loading(navigation, Err(load_failure(error)));
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn did_terminate(&self, _web_view: &WKWebView) {
            self.ivars().crashed.send_replace(Some(JobError::failure(errors::RENDER_FAILED, "渲染进程意外退出", None)));
        }
    }
);

impl NavigationDelegate {
    /// 以渲染页的状态创建
    pub(super) fn new(state: Rc<PageState>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(state);
        // SAFETY: NSObject 的 init 没有额外要求
        unsafe { msg_send![super(this), init] }
    }

    /// 主框架只放行任务文档，子框架按 frame_navigation 处理，新窗口一律拦下
    fn allows(&self, action: &WKNavigationAction) -> bool {
        // SAFETY: 导航动作由 WebKit 在回调里给出，在回调期间有效
        let url = unsafe { action.request() }
            .URL()
            .and_then(|url| url.absoluteString())
            .map(|url| url.to_string())
            .unwrap_or_default();
        // SAFETY: 同上
        let Some(frame) = (unsafe { action.targetFrame() }) else {
            return false;
        };
        // SAFETY: 同上
        if unsafe { frame.isMainFrame() } {
            return url == DOCUMENT_URL;
        }
        match urls::frame_navigation(&url) {
            FrameNavigation::Allow => true,
            FrameNavigation::Cancel => false,
            FrameNavigation::Block(origin) => {
                self.ivars().blocked.borrow_mut().get_or_insert(origin);
                false
            }
        }
    }
}

define_class!(
    // SAFETY: NSObject 没有子类化的要求；这个类不实现 Drop
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Rc<PageState>]
    /// 渲染页 scheme 的处理器：doc.html 回任务文档，r/{id} 回任务里的资源，没有的资源回 404 并记下编号，其他主机拦下并记下
    pub(super) struct SchemeHandler;

    unsafe impl NSObjectProtocol for SchemeHandler {}

    unsafe impl WKURLSchemeHandler for SchemeHandler {
        #[unsafe(method(webView:startURLSchemeTask:))]
        fn start_task(&self, _web_view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            self.serve(task);
        }

        #[unsafe(method(webView:stopURLSchemeTask:))]
        fn stop_task(&self, _web_view: &WKWebView, _task: &ProtocolObject<dyn WKURLSchemeTask>) {}
    }
);

impl SchemeHandler {
    /// 以渲染页的状态创建
    pub(super) fn new(state: Rc<PageState>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(state);
        // SAFETY: NSObject 的 init 没有额外要求
        unsafe { msg_send![super(this), init] }
    }

    /// 在开始回调里一次回完：响应头、内容与结束
    fn serve(&self, task: &ProtocolObject<dyn WKURLSchemeTask>) {
        let state = self.ivars();
        // SAFETY: 任务由 WebKit 在回调里给出，回调期间有效
        let Some(url) = (unsafe { task.request() }).URL() else {
            fail(task);
            return;
        };
        let text = url.absoluteString().map(|text| text.to_string()).unwrap_or_default();
        match urls::route(&text) {
            Route::Document => respond(task, &url, 200, Some("text/html; charset=utf-8"), &state.html),
            Route::Resource(id) => match state.document.resource(id) {
                Some(resource) => respond(task, &url, 200, Some(&resource.mime), &resource.data),
                None => {
                    state.missing.borrow_mut().get_or_insert_with(|| id.to_owned());
                    respond(task, &url, 404, None, &[]);
                }
            },
            Route::NotFound => respond(task, &url, 404, None, &[]),
            Route::Outside(origin) => {
                state.blocked.borrow_mut().get_or_insert(origin);
                fail(task);
            }
        }
    }
}

/// 回一个 HTTP 响应：状态码、媒体类型与内容，不缓存
fn respond(task: &ProtocolObject<dyn WKURLSchemeTask>, url: &NSURL, status: isize, mime: Option<&str>, body: &[u8]) {
    let no_store = NSString::from_str("no-store");
    let headers = match mime {
        Some(mime) => NSDictionary::from_slices(&[ns_string!("Cache-Control"), ns_string!("Content-Type")], &[&*no_store, &*NSString::from_str(mime)]),
        None => NSDictionary::from_slices(&[ns_string!("Cache-Control")], &[&*no_store]),
    };
    let Some(response) = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(NSHTTPURLResponse::alloc(), url, status, Some(ns_string!("HTTP/1.1")), Some(&headers))
    else {
        fail(task);
        return;
    };
    // SAFETY: 任务还没有回过响应，也没有被停止
    unsafe {
        task.didReceiveResponse(&response);
        task.didReceiveData(&NSData::with_bytes(body));
        task.didFinish();
    }
}

/// 以资源不可用结束任务
fn fail(task: &ProtocolObject<dyn WKURLSchemeTask>) {
    // SAFETY: NSURLErrorDomain 是 Foundation 导出的常量
    let error = NSError::new(NSURLErrorResourceUnavailable, unsafe { NSURLErrorDomain });
    // SAFETY: 任务还没有回过响应，也没有被停止
    unsafe { task.didFailWithError(&error) };
}

/// 文档载入失败的错误
fn load_failure(error: &NSError) -> JobError {
    JobError::failure(errors::RENDER_FAILED, format!("文档载入失败：{}", error.localizedDescription()), None)
}

/// 打印委托的状态
pub(super) struct PrintState {
    finished: Cell<Option<oneshot::Sender<bool>>>,
    keep: Cell<Option<Box<dyn Any + Send>>>,
}

define_class!(
    // SAFETY: NSObject 没有子类化的要求；这个类不实现 Drop
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = PrintState]
    /// 打印操作结束时的回调对象：送出是否成功，并在之后释放打印期间要保活的对象
    pub(super) struct PrintDelegate;

    unsafe impl NSObjectProtocol for PrintDelegate {}

    impl PrintDelegate {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn did_run(&self, _operation: &NSPrintOperation, success: bool, _context: *mut c_void) {
            if let Some(finished) = self.ivars().finished.take() {
                let _ = finished.send(success);
            }
            if let Some(keep) = self.ivars().keep.take() {
                DispatchQueue::main().exec_async(move || drop(keep));
            }
        }
    }
);

impl PrintDelegate {
    /// 以结束时送出结果的通道与打印期间要保活的对象创建
    pub(super) fn new(finished: oneshot::Sender<bool>, keep: Box<dyn Any + Send>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PrintState {
            finished: Cell::new(Some(finished)),
            keep: Cell::new(Some(keep)),
        });
        // SAFETY: NSObject 的 init 没有额外要求
        unsafe { msg_send![super(this), init] }
    }
}
