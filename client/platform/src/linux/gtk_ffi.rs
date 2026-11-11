// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! gtk-rs、webkit2gtk-rs 没有包装的几个 C 函数：GTK 的打印机枚举、JavaScriptCore 值转字符串、给自定义协议的响应加头。
//! 这些库已经由 gtk、webkit2gtk 的 sys 包链接进来，这里只声明原型

use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::rc::Rc;

use glib::ObjectType;
use glib::ffi::{GFALSE, GTRUE, gboolean, gpointer};
use glib::translate::{FromGlibPtrFull, ToGlibPtr};
use tokio::sync::oneshot;

/// GtkPrinter
#[repr(C)]
struct GtkPrinter {
    _private: [u8; 0],
}

/// SoupMessageHeaders
#[repr(C)]
struct SoupMessageHeaders {
    _private: [u8; 0],
}

type GtkPrinterFunc = unsafe extern "C" fn(printer: *mut GtkPrinter, data: gpointer) -> gboolean;

/// SOUP_MESSAGE_HEADERS_RESPONSE
const SOUP_MESSAGE_HEADERS_RESPONSE: c_int = 1;

unsafe extern "C" {
    fn gtk_enumerate_printers(func: GtkPrinterFunc, data: gpointer, destroy: Option<unsafe extern "C" fn(gpointer)>, wait: gboolean);
    fn gtk_printer_is_virtual(printer: *mut GtkPrinter) -> gboolean;
    fn gtk_printer_accepts_pdf(printer: *mut GtkPrinter) -> gboolean;
    fn gtk_printer_get_name(printer: *mut GtkPrinter) -> *const c_char;
    fn jsc_value_to_string(value: *mut c_void) -> *mut c_char;
    fn soup_message_headers_new(kind: c_int) -> *mut SoupMessageHeaders;
    fn soup_message_headers_append(headers: *mut SoupMessageHeaders, name: *const c_char, value: *const c_char);
}

/// 枚举时的状态：找到时或枚举结束时把结果送出
struct Search {
    sender: RefCell<Option<oneshot::Sender<Option<String>>>>,
}

impl Search {
    fn finish(&self, name: Option<String>) {
        if let Some(sender) = self.sender.borrow_mut().take() {
            let _ = sender.send(name);
        }
    }
}

unsafe extern "C" fn on_printer(printer: *mut GtkPrinter, data: gpointer) -> gboolean {
    // SAFETY: data 是 find_file_printer 里交出的 Rc<Search>，在 on_search_done 之前一直有效
    let search = unsafe { &*(data as *const Search) };
    // SAFETY: printer 是 GTK 在回调期间传入的有效 GtkPrinter
    let matches = unsafe { gtk_printer_is_virtual(printer) != GFALSE && gtk_printer_accepts_pdf(printer) != GFALSE };
    if !matches {
        return GFALSE;
    }
    // SAFETY: 同上；名称属于这台打印机，这里立刻复制
    let name = unsafe { CStr::from_ptr(gtk_printer_get_name(printer)) }.to_string_lossy().into_owned();
    search.finish(Some(name));
    GTRUE
}

unsafe extern "C" fn on_search_done(data: gpointer) {
    // SAFETY: data 是 find_file_printer 里 Rc::into_raw 交出的指针，GTK 只调用一次销毁回调
    let search = unsafe { Rc::from_raw(data as *const Search) };
    search.finish(None);
}

/// 在 GTK 主线程上找 GTK 的「打印到文件」打印机：虚拟打印机且接受 PDF；没有时为 None
pub(super) async fn find_file_printer() -> Option<String> {
    let (sender, receiver) = oneshot::channel();
    let search = Rc::new(Search {
        sender: RefCell::new(Some(sender)),
    });
    let data = Rc::into_raw(search) as gpointer;
    // SAFETY: 回调与销毁回调都是本模块的函数，data 由销毁回调收回；不等待，结果在主循环里送出
    unsafe { gtk_enumerate_printers(on_printer, data, Some(on_search_done), GFALSE) };
    receiver.await.ok().flatten()
}

/// JavaScriptCore 值转成字符串；值转不成字符串时为 None
pub(super) fn javascript_text(value: &impl ObjectType) -> Option<String> {
    let pointer = value.as_ptr() as *mut c_void;
    // SAFETY: pointer 是有效的 JSCValue；返回新分配的字符串或 NULL
    let text = unsafe { jsc_value_to_string(pointer) };
    // SAFETY: 非 NULL 时由 GString 接管释放
    (!text.is_null()).then(|| unsafe { glib::GString::from_glib_full(text) }.to_string())
}

/// 给自定义协议的响应设上头
pub(super) fn set_response_headers(response: &webkit2gtk::URISchemeResponse, headers: &[(&str, &str)]) {
    // SAFETY: 新建的响应头由 webkit_uri_scheme_response_set_http_headers 接管
    let soup = unsafe { soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE) };
    for (name, value) in headers {
        let name = CString::new(*name).expect("头名不含 0");
        let value = CString::new(*value).expect("头值不含 0");
        // SAFETY: soup 有效，名称与值以 0 结尾，libsoup 复制它们
        unsafe { soup_message_headers_append(soup, name.as_ptr(), value.as_ptr()) };
    }
    let response: *mut webkit2gtk::ffi::WebKitURISchemeResponse = response.to_glib_none().0;
    // SAFETY: response 有效；响应头的所有权交给 WebKit
    unsafe { webkit2gtk::ffi::webkit_uri_scheme_response_set_http_headers(response, soup.cast()) };
}
