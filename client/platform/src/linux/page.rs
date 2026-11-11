// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 一个任务的渲染页：离屏窗口里的 WebView。页面脚本不跑、不联网，文档与资源只从任务里取，其余地址一律拦下；
//! 就绪后逐组只显示这组的输出页，经 GTK 的「打印到文件」打印机出 PDF。全部在 GTK 主线程上执行

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::Duration;

use gtk::prelude::*;
use serde_json::Value;
use tokio::sync::{Notify, oneshot};
use webkit2gtk::gio;
use webkit2gtk::{
    FileChooserRequestExt, NavigationPolicyDecision, NavigationPolicyDecisionExt, PermissionRequestExt, PolicyDecisionExt, PolicyDecisionType, PrintOperation, PrintOperationExt,
    ResponsePolicyDecision, ResponsePolicyDecisionExt, Settings, SettingsExt, URIRequestExt, URISchemeRequest, URISchemeRequestExt, URISchemeResponse, URISchemeResponseExt,
    UserContentInjectedFrames, UserContentManager, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebView, WebViewExt,
};
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{Details, DocumentResource, PrintDocument};

use super::render::Shared;
use super::{gtk_ffi, pdf};
use crate::unix::GroupRender;

/// 自定义协议
pub(super) const SCHEME: &str = "xihan-print";
/// 任务文档所在的保留地址
const ORIGIN: &str = "xihan-print://print.local/";
/// 任务文档的地址
const DOCUMENT_URI: &str = "xihan-print://print.local/doc.html";
/// 资源地址的前缀
const RESOURCE_PREFIX: &str = "xihan-print://print.local/r/";
/// SDK 写进文档的资源地址前缀，载入前整串换成自定义协议
const SOURCE_ORIGIN: &str = "https://print.local/";
/// 检测脚本所在的隔离脚本世界
const WORLD: &str = "xihan-print";

/// 文档的内容安全策略：只许取任务里的资源，不跑脚本
const CONTENT_POLICY: &str =
    "default-src xihan-print: data: blob:; style-src xihan-print: data: blob: 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri xihan-print:; form-action 'none'";

/// 文档开始解析前注入隔离世界：记下内容安全策略拦下的地址
const WATCH_SCRIPT: &str =
    "globalThis.xihanBlocked = []; document.addEventListener('securitypolicyviolation', event => { globalThis.xihanBlocked.push(event.blockedURI); }, true);";

/// 把懒加载的图片改成立即加载，等图片与字体就绪后数出输出页、没有载入成功的图片，带回拦下的地址
const READY_SCRIPT: &str = r#"
for (const image of document.images) {
  if (image.loading === 'lazy') image.loading = 'eager';
}
await Promise.all(Array.from(document.images, image => image.complete ? null : new Promise(resolve => {
  image.addEventListener('load', resolve, { once: true });
  image.addEventListener('error', resolve, { once: true });
})));
await document.fonts.ready;
await new Promise(resolve => setTimeout(resolve, 0));
return JSON.stringify({
  sheets: document.querySelectorAll('[data-part="sheet"]').length,
  broken: Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).length,
  blocked: globalThis.xihanBlocked || [],
});
"#;

/// 整页转灰度
const GRAYSCALE_SCRIPT: &str = "document.documentElement.style.setProperty('filter', 'grayscale(1)'); return true;";

/// 只显示 SHOWN 里的输出页，其余 display:none，最后一张显示的取消分页；作者写的行内值先记下，每组从它恢复
const SHOW_SCRIPT: &str = r#"
const sheets = document.querySelectorAll('[data-part="sheet"]');
const saved = globalThis.xihanSaved || (globalThis.xihanSaved = new Map());
sheets.forEach((sheet, index) => {
  if (!saved.has(sheet)) {
    saved.set(sheet, ['display', 'break-after'].map(name => [sheet.style.getPropertyValue(name), sheet.style.getPropertyPriority(name)]));
  }
  const [[display, displayPriority], [breakAfter, breakPriority]] = saved.get(sheet);
  if (SHOWN.has(index)) sheet.style.setProperty('display', display, displayPriority);
  else sheet.style.setProperty('display', 'none', 'important');
  if (index === LAST) sheet.style.setProperty('break-after', 'auto', 'important');
  else sheet.style.setProperty('break-after', breakAfter, breakPriority);
});
return sheets.length;
"#;

/// 一个任务的文档与资源，以及载入时记下的问题
pub(super) struct Task {
    html: glib::Bytes,
    resources: HashMap<String, DocumentResource>,
    missing: RefCell<Option<String>>,
    blocked: RefCell<Option<String>>,
}

/// 资源字节交给 GLib，不复制
struct SharedBytes(Arc<Vec<u8>>);

impl AsRef<[u8]> for SharedBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

/// 渲染页在载入与打印时等的事件
#[derive(Default)]
struct Events {
    loaded: RefCell<Option<oneshot::Sender<Result<(), String>>>>,
    failure: RefCell<Option<JobError>>,
    failed: Notify,
}

impl Events {
    fn fail(&self, error: JobError) {
        self.failure.borrow_mut().get_or_insert(error);
        self.failed.notify_waiters();
    }

    /// 等到渲染进程意外退出
    async fn crashed(&self) -> JobError {
        loop {
            let notified = self.failed.notified();
            if let Some(error) = self.failure.borrow().clone() {
                return error;
            }
            notified.await;
        }
    }
}

/// 把任务文档渲染成各组 PDF：载入并等就绪（受期限与取消令牌约束），按需转灰度，再逐组出 PDF
pub(super) async fn render(
    shared: Rc<Shared>,
    document: Arc<PrintDocument>,
    groups: Vec<GroupRender>,
    grayscale: bool,
    timeout: Duration,
    cancel: Cancel,
) -> Result<Vec<Vec<u8>>, JobError> {
    let page = Page::open(&shared, &document);
    tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(JobError::Cancelled),
        result = page.load(document.sheet_count()) => result?,
        _ = glib::timeout_future(timeout) => {
            return Err(JobError::failure(errors::RENDER_TIMEOUT, format!("文档超过 {} 没有就绪", describe(timeout)), Some(Details::new().with("timeout", true))));
        }
    }
    if grayscale {
        cancel.run(page.call(GRAYSCALE_SCRIPT)).await??;
    }
    let mut pdfs = Vec::with_capacity(groups.len());
    for group in &groups {
        let shown: Vec<String> = group.sheets.iter().map(usize::to_string).collect();
        let last = group.sheets.last().map_or(-1, |sheet| *sheet as i64);
        let script = SHOW_SCRIPT.replace("SHOWN", &format!("new Set([{}])", shown.join(","))).replace("LAST", &last.to_string());
        cancel.run(page.call(&script)).await??;
        let file = shared.output_file();
        let pdf = cancel.run(page.print(&shared.printer, group, &file)).await;
        let _ = std::fs::remove_file(&file);
        pdfs.push(pdf??);
    }
    Ok(pdfs)
}

fn describe(duration: Duration) -> String {
    if duration >= Duration::from_secs(1) && duration.subsec_millis() == 0 {
        format!("{} 秒", duration.as_secs())
    } else {
        format!("{} 毫秒", duration.as_millis())
    }
}

/// 一个任务的渲染页；释放时注销任务、关掉窗口
struct Page {
    shared: Rc<Shared>,
    window: gtk::OffscreenWindow,
    view: WebView,
    task: Rc<Task>,
    events: Rc<Events>,
}

impl Page {
    fn open(shared: &Rc<Shared>, document: &PrintDocument) -> Page {
        let manager = UserContentManager::new();
        manager.add_script(&UserScript::for_world(
            WATCH_SCRIPT,
            UserContentInjectedFrames::TopFrame,
            UserScriptInjectionTime::Start,
            WORLD,
            &[],
            &[],
        ));
        let view = WebView::builder().web_context(&shared.context).user_content_manager(&manager).settings(&settings()).build();
        let window = gtk::OffscreenWindow::new();
        window.set_default_size(1024, 768);
        window.add(&view);
        window.show_all();

        let task = Rc::new(Task {
            html: glib::Bytes::from_owned(document.html.replace(SOURCE_ORIGIN, ORIGIN).into_bytes()),
            resources: document.resources.iter().map(|resource| (resource.id.clone(), resource.clone())).collect(),
            missing: RefCell::new(None),
            blocked: RefCell::new(None),
        });
        shared.tasks.borrow_mut().insert(key(&view), task.clone());

        let events = Rc::new(Events::default());
        view.connect_decide_policy(decide_policy);
        view.connect_create(|_, _| None);
        view.connect_permission_request(|_, request| {
            request.deny();
            true
        });
        view.connect_script_dialog(|_, _| true);
        view.connect_run_file_chooser(|_, request| {
            request.cancel();
            true
        });
        let weak = Rc::downgrade(&events);
        view.connect_load_changed(move |_, event| {
            if event == webkit2gtk::LoadEvent::Finished
                && let Some(sender) = weak.upgrade().and_then(|events| events.loaded.borrow_mut().take())
            {
                let _ = sender.send(Ok(()));
            }
        });
        let weak = Rc::downgrade(&events);
        view.connect_load_failed(move |_, _, uri, error| {
            if let Some(sender) = weak.upgrade().and_then(|events| events.loaded.borrow_mut().take()) {
                let _ = sender.send(Err(format!("{}（{uri}）", error.message())));
            }
            true
        });
        let weak = Rc::downgrade(&events);
        view.connect_web_process_terminated(move |_, reason| {
            if let Some(events) = weak.upgrade() {
                events.fail(JobError::failure(
                    errors::RENDER_FAILED,
                    format!("渲染进程意外退出：{reason:?}"),
                    Some(Details::new().with("reason", format!("{reason:?}"))),
                ));
            }
        });
        Page {
            shared: shared.clone(),
            window,
            view,
            task,
            events,
        }
    }

    /// 载入文档并等到就绪，再核对拦下的地址、缺的资源、坏的图片与输出页张数
    async fn load(&self, expected: u32) -> Result<(), JobError> {
        let (sender, receiver) = oneshot::channel();
        *self.events.loaded.borrow_mut() = Some(sender);
        self.view.load_uri(DOCUMENT_URI);
        let loaded = tokio::select! {
            result = receiver => result.unwrap_or_else(|_| Err("渲染页没有报告载入结果".to_owned())),
            error = self.events.crashed() => return Err(error),
        };
        loaded.map_err(|message| JobError::failure(errors::RENDER_FAILED, format!("文档载入失败：{message}"), None))?;

        let text = self.call(READY_SCRIPT).await?;
        let report: Value = serde_json::from_str(&text).map_err(|error| {
            JobError::failure(
                errors::RENDER_FAILED,
                format!("渲染页里的检测脚本给出的结果读不懂：{error}"),
                Some(Details::new().with("result", text.clone())),
            )
        })?;

        let policy_blocked = report["blocked"]
            .as_array()
            .and_then(|list| list.iter().filter_map(Value::as_str).find(|url| !url.is_empty()).map(origin_of));
        if let Some(url) = self.task.blocked.borrow().clone().or(policy_blocked) {
            return Err(JobError::failure(
                errors::RESOURCE_BLOCKED,
                "文档引用了任务以外的资源，已拒绝",
                Some(Details::new().with("url", url)),
            ));
        }
        if let Some(resource) = self.task.missing.borrow().clone() {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                "文档引用了任务里没有的资源",
                Some(Details::new().with("resource", resource)),
            ));
        }
        let broken = report["broken"].as_u64().unwrap_or(0);
        if broken > 0 {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("有 {broken} 张图片解码失败"),
                Some(Details::new().with("images", broken)),
            ));
        }
        let sheets = report["sheets"].as_u64().unwrap_or(0);
        if sheets != u64::from(expected) {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("文档里有 {sheets} 张输出页，纸张分组写的是 {expected} 张"),
                Some(Details::new().with("expected", expected).with("actual", sheets)),
            ));
        }
        Ok(())
    }

    /// 在隔离世界里执行一段异步函数体，带回它返回值的字符串形式
    async fn call(&self, body: &str) -> Result<String, JobError> {
        let result = tokio::select! {
            result = self.view.call_async_javascript_function_future(body, None, Some(WORLD), None) => result,
            error = self.events.crashed() => return Err(error),
        };
        match result {
            Ok(value) => Ok(gtk_ffi::javascript_text(&value).unwrap_or_default()),
            Err(error) => Err(JobError::failure(
                errors::RENDER_FAILED,
                "渲染页里的检测脚本出错",
                Some(Details::new().with("exception", error.message())),
            )),
        }
    }

    /// 经「打印到文件」打印机出这组的 PDF：纸张宽同这组、高多出 paper_slack 点，边距 0；读回后把每页裁回这组的尺寸，
    /// 页数与这组的输出页张数不符时 PDF_FAILED
    async fn print(&self, printer: &str, group: &GroupRender, file: &Path) -> Result<Vec<u8>, JobError> {
        let uri = glib::filename_to_uri(file, None).map_err(|error| pdf_failed(format!("临时文件的地址写不出来：{error}")))?;
        let settings = gtk::PrintSettings::new();
        settings.set_printer(printer);
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(&uri));
        settings.set_print_pages(gtk::PrintPages::All);
        settings.set_page_set(gtk::PageSet::All);
        settings.set_n_copies(1);
        settings.set_collate(false);
        settings.set_reverse(false);
        settings.set_number_up(1);
        settings.set_scale(100.0);
        settings.set_use_color(true);

        let name = format!("xihan_{}x{}mm", group.width_mm, group.height_mm);
        let (width_pt, height_pt) = (group.width_mm * POINTS_PER_MM, group.height_mm * POINTS_PER_MM);
        let paper = gtk::PaperSize::new_custom(&name, &name, width_pt, height_pt + paper_slack(group.width_mm, group.height_mm), gtk::Unit::Points);
        let setup = gtk::PageSetup::new();
        setup.set_paper_size(&paper);
        setup.set_orientation(gtk::PageOrientation::Portrait);
        setup.set_top_margin(0.0, gtk::Unit::Mm);
        setup.set_bottom_margin(0.0, gtk::Unit::Mm);
        setup.set_left_margin(0.0, gtk::Unit::Mm);
        setup.set_right_margin(0.0, gtk::Unit::Mm);

        let operation = PrintOperation::new(&self.view);
        operation.set_print_settings(&settings);
        operation.set_page_setup(&setup);
        let (sender, receiver) = oneshot::channel::<Result<(), String>>();
        let sender = Rc::new(RefCell::new(Some(sender)));
        let failed = sender.clone();
        operation.connect_failed(move |_, error| {
            if let Some(sender) = failed.borrow_mut().take() {
                let _ = sender.send(Err(error.message().to_owned()));
            }
        });
        operation.connect_finished(move |_| {
            if let Some(sender) = sender.borrow_mut().take() {
                let _ = sender.send(Ok(()));
            }
        });
        operation.print();
        let finished = tokio::select! {
            result = receiver => result.unwrap_or_else(|_| Err("打印操作没有报告结果".to_owned())),
            error = self.events.crashed() => return Err(error),
        };
        finished.map_err(|message| pdf_failed(format!("出 PDF 失败：{message}")))?;
        let pdf = std::fs::read(file).map_err(|error| pdf_failed(format!("读不回出好的 PDF：{error}")))?;
        if !pdf.starts_with(b"%PDF-") {
            return Err(pdf_failed("打印到文件的结果不是 PDF".to_owned()));
        }
        let (pdf, pages) = pdf::trim(&pdf, width_pt, height_pt).map_err(|message| pdf_failed(format!("裁不了出好的 PDF：{message}")))?;
        if pages != group.sheets.len() {
            return Err(JobError::failure(
                errors::PDF_FAILED,
                format!("{}×{} mm 这组出了 {pages} 页 PDF，输出页是 {} 张", group.width_mm, group.height_mm, group.sheets.len()),
                Some(Details::new().with("expected", group.sheets.len()).with("actual", pages)),
            ));
        }
        Ok(pdf)
    }
}

/// 每毫米的点数
const POINTS_PER_MM: f64 = 72.0 / 25.4;

/// 纸张比这组高出的点数：WebKit 按取整后的文档宽度与纸张宽高比算每页的高度（再取整），
/// 高出这些后每张输出页都落在一页之内，出 PDF 后再裁掉
fn paper_slack(width_mm: f64, height_mm: f64) -> f64 {
    let width_px = width_mm * 96.0 / 25.4;
    (width_mm + height_mm) * POINTS_PER_MM / (width_px - 1.0).max(1.0) + 1.0
}

impl Drop for Page {
    fn drop(&mut self) {
        self.shared.tasks.borrow_mut().remove(&key(&self.view));
        // SAFETY: 窗口与里面的 WebView 只归这个渲染页所有，销毁后不再使用
        unsafe { self.window.destroy() };
    }
}

fn pdf_failed(message: String) -> JobError {
    JobError::failure(errors::PDF_FAILED, message, None)
}

/// 渲染页的设置：不跑页面脚本，关掉存储、媒体、插件、开发者工具与各种弹窗，打印背景
fn settings() -> Settings {
    let settings = Settings::new();
    settings.set_enable_javascript(true);
    settings.set_enable_javascript_markup(false);
    settings.set_javascript_can_open_windows_automatically(false);
    settings.set_javascript_can_access_clipboard(false);
    settings.set_allow_modal_dialogs(false);
    settings.set_allow_file_access_from_file_urls(false);
    settings.set_allow_universal_access_from_file_urls(false);
    settings.set_allow_top_navigation_to_data_urls(false);
    settings.set_auto_load_images(true);
    settings.set_print_backgrounds(true);
    settings.set_default_charset("utf-8");
    settings.set_enable_html5_database(false);
    settings.set_enable_html5_local_storage(false);
    settings.set_enable_page_cache(false);
    settings.set_enable_dns_prefetching(false);
    settings.set_enable_developer_extras(false);
    settings.set_enable_write_console_messages_to_stdout(false);
    settings.set_enable_media(false);
    settings.set_enable_media_stream(false);
    settings.set_enable_mediasource(false);
    settings.set_enable_encrypted_media(false);
    settings.set_enable_webaudio(false);
    settings.set_enable_webgl(false);
    settings.set_enable_webrtc(false);
    settings.set_enable_fullscreen(false);
    settings.set_enable_back_forward_navigation_gestures(false);
    settings.set_enable_site_specific_quirks(false);
    settings.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);
    settings
}

/// 只放行任务文档所在的保留地址；新窗口、不能显示的响应（下载）一律拦下
fn decide_policy(_view: &WebView, decision: &webkit2gtk::PolicyDecision, kind: PolicyDecisionType) -> bool {
    match kind {
        PolicyDecisionType::NavigationAction => {
            let uri = decision
                .downcast_ref::<NavigationPolicyDecision>()
                .and_then(|navigation| navigation.navigation_action())
                .and_then(|action| action.request())
                .and_then(|request| request.uri())
                .map(|uri| uri.to_string())
                .unwrap_or_default();
            if uri.starts_with(ORIGIN) || uri == "about:blank" || uri == "about:srcdoc" {
                decision.use_();
            } else {
                decision.ignore();
            }
            true
        }
        PolicyDecisionType::NewWindowAction => {
            decision.ignore();
            true
        }
        PolicyDecisionType::Response => match decision.downcast_ref::<ResponsePolicyDecision>() {
            Some(response) if !response.is_mime_type_supported() => {
                decision.ignore();
                true
            }
            _ => false,
        },
        _ => false,
    }
}

/// WebView 在任务表里的键
fn key(view: &WebView) -> usize {
    view.as_ptr() as usize
}

/// 被拦地址的协议加主机（含端口），不带路径、查询与账号
fn origin_of(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
            let host = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
            format!("{}://{host}", scheme.to_ascii_lowercase())
        }
        None => url.chars().take(64).collect(),
    }
}

/// 自定义协议的请求：文档、任务里的资源，同一保留地址下的其余路径 404，别的主机记为拦下
pub(super) fn serve(shared: &Weak<Shared>, request: &URISchemeRequest) {
    let uri = request.uri().map(|uri| uri.to_string()).unwrap_or_default();
    let task = shared
        .upgrade()
        .and_then(|shared| request.web_view().and_then(|view| shared.tasks.borrow().get(&key(&view)).cloned()));
    let Some(task) = task else {
        respond(request, 404, "Not Found", None, &glib::Bytes::from_static(b""));
        return;
    };
    if uri == DOCUMENT_URI {
        respond(request, 200, "OK", Some("text/html"), &task.html);
    } else if let Some(rest) = uri.strip_prefix(RESOURCE_PREFIX) {
        let id = rest.split(['?', '#']).next().unwrap_or_default();
        match task.resources.get(id) {
            Some(resource) => respond(request, 200, "OK", Some(&resource.mime), &glib::Bytes::from_owned(SharedBytes(resource.data.clone()))),
            None => {
                task.missing.borrow_mut().get_or_insert_with(|| id.to_owned());
                respond(request, 404, "Not Found", None, &glib::Bytes::from_static(b""));
            }
        }
    } else if uri.starts_with(ORIGIN) {
        respond(request, 404, "Not Found", None, &glib::Bytes::from_static(b""));
    } else {
        task.blocked.borrow_mut().get_or_insert_with(|| origin_of(&uri));
        respond(request, 403, "Forbidden", None, &glib::Bytes::from_static(b""));
    }
}

fn respond(request: &URISchemeRequest, status: u32, reason: &str, mime: Option<&str>, body: &glib::Bytes) {
    let stream = gio::MemoryInputStream::from_bytes(body);
    let response = URISchemeResponse::new(&stream, body.len() as i64);
    response.set_status(status, Some(reason));
    if let Some(mime) = mime {
        response.set_content_type(mime);
    }
    gtk_ffi::set_response_headers(&response, &[("Content-Security-Policy", CONTENT_POLICY), ("Cache-Control", "no-store")]);
    request.finish_with_response(&response);
}

#[cfg(test)]
mod tests {
    use super::origin_of;

    #[test]
    fn reports_only_the_scheme_and_host_of_blocked_urls() {
        assert_eq!(origin_of("https://example.com/logo.png?token=secret"), "https://example.com");
        assert_eq!(origin_of("HTTP://user:pass@example.com:8080#x"), "http://example.com:8080");
        assert_eq!(origin_of("https://example.com"), "https://example.com");
    }
}
