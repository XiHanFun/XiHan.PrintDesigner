// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 一个任务的渲染页：不显示的窗口里的 WKWebView，非持久化数据、页面脚本关闭、外部地址一律拦下；全部在主线程上调用

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::path::Path;
use std::ptr;
use std::rc::Rc;
use std::sync::Arc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
use objc2::{MainThreadMarker, MainThreadOnly, sel};
use objc2_app_kit::{NSBackingStoreType, NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSView, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSError, NSNumber, NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest, ns_string};
use objc2_web_kit::{WKAudiovisualMediaTypes, WKContentRuleList, WKContentWorld, WKWebView, WKWebViewConfiguration, WKWebpagePreferences, WKWebsiteDataStore};
use tokio::sync::{oneshot, watch};
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{Details, PrintDocument};

use super::delegates::{NavigationDelegate, PageState, PrintDelegate, SchemeHandler};
use super::main_thread::OnMain;
use super::urls::{self, DOCUMENT_URL, SCHEME};

/// 一个任务的渲染页
pub(super) struct Page {
    window: Retained<NSWindow>,
    webview: Retained<WKWebView>,
    /// WKWebView 只弱引用导航委托，由这里保活
    _navigation: Retained<NavigationDelegate>,
    state: Rc<PageState>,
    /// 最近一次打印操作的回调对象，回调之前由这里保活
    printing: RefCell<Option<Retained<PrintDelegate>>>,
}

/// 建好并开始载入的渲染页
pub(super) struct Opened {
    /// 渲染页
    pub(super) page: OnMain<Page>,
    /// 文档载入完成或失败
    pub(super) loaded: oneshot::Receiver<Result<(), JobError>>,
    /// 渲染进程意外退出
    pub(super) crashed: watch::Receiver<Option<JobError>>,
}

/// 载入后记下的问题：第一个被拦下的外部地址与第一个任务里没有的资源编号
pub(super) struct Findings {
    /// 被拦下的外部地址，协议加主机
    pub(super) blocked: Option<String>,
    /// 任务里没有的资源编号
    pub(super) missing: Option<String>,
}

impl Page {
    /// 建渲染页并开始载入任务文档；视口为 viewport 大小（point，等于 CSS 像素）
    pub(super) fn open(mtm: MainThreadMarker, rules: &WKContentRuleList, document: Arc<PrintDocument>, viewport: NSSize) -> Result<Opened, JobError> {
        let (loaded, loaded_receiver) = oneshot::channel();
        let (crashed, crashed_receiver) = watch::channel(None);
        let state = Rc::new(PageState {
            html: urls::rewrite_html(&document.html).into_bytes(),
            document,
            loaded: Cell::new(Some(loaded)),
            navigation: RefCell::new(None),
            blocked: RefCell::new(None),
            missing: RefCell::new(None),
            crashed,
        });
        let navigation = NavigationDelegate::new(state.clone(), mtm);
        let handler = SchemeHandler::new(state.clone(), mtm);
        let url = NSURL::URLWithString(&NSString::from_str(DOCUMENT_URL)).ok_or_else(|| JobError::failure(errors::INTERNAL, "任务文档的地址不合法", None))?;

        // SAFETY: 以下都是主线程上对新建对象的调用，参数都是有效对象
        let webview = unsafe {
            let configuration = WKWebViewConfiguration::new(mtm);
            configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
            let page_preferences = WKWebpagePreferences::new(mtm);
            page_preferences.setAllowsContentJavaScript(false);
            configuration.setDefaultWebpagePreferences(Some(&page_preferences));
            configuration.setURLSchemeHandler_forURLScheme(Some(ProtocolObject::from_ref(&*handler)), &NSString::from_str(SCHEME));
            configuration.userContentController().addContentRuleList(rules);
            configuration.setMediaTypesRequiringUserActionForPlayback(WKAudiovisualMediaTypes::All);
            let preferences = configuration.preferences();
            preferences.setJavaScriptCanOpenWindowsAutomatically(false);
            if preferences.respondsToSelector(sel!(setShouldPrintBackgrounds:)) {
                preferences.setShouldPrintBackgrounds(true);
            }
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), viewport);
            let webview = WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &configuration);
            webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation)));
            webview
        };

        let frame = NSRect::new(NSPoint::new(0.0, 0.0), viewport);
        // SAFETY: 主线程上新建窗口；关闭时不自行释放，由 Retained 管理
        let window =
            unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), frame, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false) };
        // SAFETY: 同上
        unsafe { window.setReleasedWhenClosed(false) };
        window.setExcludedFromWindowsMenu(true);
        let view: &NSView = &webview;
        window.setContentView(Some(view));

        // SAFETY: 主线程上调用，请求是有效对象
        let navigation_started = unsafe { webview.loadRequest(&NSURLRequest::requestWithURL(&url)) };
        let Some(navigation_started) = navigation_started else {
            return Err(JobError::failure(errors::RENDER_FAILED, "渲染页没能开始载入任务文档", None));
        };
        *state.navigation.borrow_mut() = Some(navigation_started);
        let page = Page {
            window,
            webview,
            _navigation: navigation,
            state,
            printing: RefCell::new(None),
        };
        Ok(Opened {
            page: OnMain::new(page, mtm),
            loaded: loaded_receiver,
            crashed: crashed_receiver,
        })
    }

    /// 在隔离环境里执行一段 callAsyncJavaScript 函数体；结果是脚本返回的文本，脚本没有返回文本时为 None
    pub(super) fn call(&self, mtm: MainThreadMarker, body: &str) -> oneshot::Receiver<Result<Option<String>, JobError>> {
        let (sender, receiver) = oneshot::channel();
        let sender = Cell::new(Some(sender));
        let completion = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
            let Some(sender) = sender.take() else {
                return;
            };
            // SAFETY: WebKit 传来的是有效对象或 nil，回调期间有效
            let outcome = match unsafe { error.as_ref() } {
                Some(error) => Err(script_failure(error)),
                // SAFETY: 同上
                None => Ok(unsafe { result.as_ref() }.and_then(|value| value.downcast_ref::<NSString>()).map(|text| text.to_string())),
            };
            let _ = sender.send(outcome);
        });
        // SAFETY: 主线程上调用；frame 为 nil 表示主框架，参数为 nil 表示没有参数
        unsafe {
            self.webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(body),
                None,
                None,
                &WKContentWorld::defaultClientWorld(mtm),
                Some(&completion),
            );
        }
        receiver
    }

    /// 载入后记下的问题
    pub(super) fn findings(&self) -> Findings {
        Findings {
            blocked: self.state.blocked.borrow().clone(),
            missing: self.state.missing.borrow().clone(),
        }
    }

    /// 把当前显示的输出页按 width × height（point）的纸张、边距 0、原大存成 PDF 文件；结束时送出是否成功。
    /// keep 在打印操作结束之前一直保活，用来保住渲染页本身
    pub(super) fn print(&self, mtm: MainThreadMarker, width: f64, height: f64, output: &Path, keep: Box<dyn Any + Send>) -> Result<oneshot::Receiver<bool>, JobError> {
        let path = output
            .to_str()
            .ok_or_else(|| JobError::failure(errors::INTERNAL, format!("PDF 临时文件的路径不是 UTF-8：{}", output.display()), None))?;
        let info = NSPrintInfo::new();
        info.setPaperSize(NSSize::new(width, height));
        info.setTopMargin(0.0);
        info.setBottomMargin(0.0);
        info.setLeftMargin(0.0);
        info.setRightMargin(0.0);
        info.setScalingFactor(1.0);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Clip);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        // SAFETY: 这几个键与值都是 AppKit 导出的常量；字典的值类型与键要求的一致
        unsafe {
            info.setJobDisposition(NSPrintSaveJob);
            let settings = info.dictionary();
            let target: &AnyObject = &NSURL::fileURLWithPath(&NSString::from_str(path));
            settings.insert(NSPrintJobSavingURL, target);
            let no_header: &AnyObject = &NSNumber::new_bool(false);
            settings.insert(NSPrintHeaderAndFooter, no_header);
        }

        // SAFETY: 主线程上调用，打印设置是有效对象
        let operation = unsafe { self.webview.printOperationWithPrintInfo(&info) };
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        operation.setJobTitle(Some(ns_string!("XiHan Print")));
        if let Some(view) = operation.view() {
            view.setFrame(self.webview.bounds());
        }

        let (finished, receiver) = oneshot::channel();
        let delegate = PrintDelegate::new(finished, keep, mtm);
        let target: &AnyObject = &delegate;
        // SAFETY: 委托对象实现了 printOperationDidRun:success:contextInfo:，在回调之前由 printing 保活；contextInfo 不用
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &self.window,
                Some(target),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                ptr::null_mut(),
            );
        }
        *self.printing.borrow_mut() = Some(delegate);
        Ok(receiver)
    }
}

impl Drop for Page {
    fn drop(&mut self) {
        // SAFETY: Page 只在主线程上释放；停止载入、摘掉委托后再关掉窗口
        unsafe {
            self.webview.stopLoading();
            self.webview.setNavigationDelegate(None);
        }
        self.webview.removeFromSuperview();
        self.window.close();
    }
}

/// 检测脚本出错的错误：带脚本的异常信息
fn script_failure(error: &NSError) -> JobError {
    let message = error
        .userInfo()
        .objectForKey(ns_string!("WKJavaScriptExceptionMessage"))
        .and_then(|value| value.downcast_ref::<NSString>().map(|text| text.to_string()))
        .unwrap_or_else(|| error.localizedDescription().to_string());
    JobError::failure(errors::RENDER_FAILED, "渲染页里的检测脚本出错", Some(Details::new().with("exception", message)))
}
