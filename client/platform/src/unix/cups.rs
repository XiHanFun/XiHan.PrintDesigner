// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 运行时加载的 libcups：查打印机、纸张与纸盒、写原始指令、把 PDF 作业交给打印池。不在链接期依赖 libcups

use std::ffi::{CStr, CString, c_char, c_int, c_uint, c_void};
use std::ptr;
use std::sync::Arc;

use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::printing::{JobError, PaperCatalog, PaperFeed, PrinterCatalog, PrinterPapers, RawPrintResult, RawPrinter, SpoolTicket};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{ColorMode, Details, DuplexMode, PaperInfo, PrintOptions, PrinterCapabilities, PrinterInfo, PrinterState, TrayInfo};

#[cfg(target_os = "macos")]
const LIBRARY: &str = "/usr/lib/libcups.2.dylib";
#[cfg(not(target_os = "macos"))]
const LIBRARY: &str = "libcups.so.2";

/// 原始指令的文档格式
const FORMAT_RAW: &str = "application/vnd.cups-raw";
/// PDF 的文档格式
const FORMAT_PDF: &str = "application/pdf";

const MEDIA_FLAGS_DEFAULT: c_uint = 0;
const DEST_FLAGS_NONE: c_uint = 0;
const CONNECT_TIMEOUT_MS: c_int = 30_000;
const HTTP_STATUS_CONTINUE: c_int = 100;
const IPP_STATUS_ERROR_NOT_FOUND: c_int = 0x0406;
const IPP_TAG_INTEGER: c_int = 0x21;
const IPP_TAG_RANGE: c_int = 0x33;
const PRINTER_REMOTE: i64 = 0x0002;
const PRINTER_COLOR: i64 = 0x0008;
const PRINTER_DUPLEX: i64 = 0x0010;
const PRINTER_DISCOVERED: i64 = 0x0100_0000;
const STATE_IDLE: i64 = 3;
const STATE_PROCESSING: i64 = 4;
const STATE_STOPPED: i64 = 5;
const WRITE_CHUNK: usize = 64 * 1024;
const NETWORK_SCHEMES: [&str; 11] = ["ipp", "ipps", "http", "https", "socket", "lpd", "smb", "dnssd", "mdns", "ipp14", "implicitclass"];

/// cups_option_t
#[repr(C)]
struct CupsOption {
    name: *mut c_char,
    value: *mut c_char,
}

/// cups_dest_t
#[repr(C)]
struct CupsDest {
    name: *mut c_char,
    instance: *mut c_char,
    is_default: c_int,
    num_options: c_int,
    options: *mut CupsOption,
}

/// cups_size_t：尺寸与边距都是百分之一毫米
#[repr(C)]
struct CupsSize {
    media: [c_char; 128],
    width: c_int,
    length: c_int,
    bottom: c_int,
    left: c_int,
    right: c_int,
    top: c_int,
}

impl CupsSize {
    fn empty() -> CupsSize {
        CupsSize {
            media: [0; 128],
            width: 0,
            length: 0,
            bottom: 0,
            left: 0,
            right: 0,
            top: 0,
        }
    }

    fn media(&self) -> String {
        // SAFETY: media 是 CUPS 写入的以 0 结尾的定长数组；empty() 建成全 0，最后一个元素不会被 CUPS 覆盖成非 0
        unsafe { CStr::from_ptr(self.media.as_ptr()) }.to_string_lossy().into_owned()
    }

    fn width_mm(&self) -> f64 {
        f64::from(self.width) / 100.0
    }

    fn height_mm(&self) -> f64 {
        f64::from(self.length) / 100.0
    }
}

type Http = c_void;
type CupsDinfo = c_void;
type IppAttribute = c_void;

/// 声明要从 libcups 取的函数，生成函数表与按名字取符号的加载代码
macro_rules! cups_api {
    ($($field:ident = $symbol:literal: fn($($argument:ty),*) $(-> $result:ty)?;)*) => {
        /// libcups 的函数表
        struct Api {
            $($field: unsafe extern "C" fn($($argument),*) $(-> $result)?,)*
        }

        impl Api {
            /// 从 dlopen 得到的句柄里逐个取符号；缺任何一个都失败
            ///
            /// # Safety
            /// handle 必须是 dlopen 返回的有效句柄，且每个符号的 C 原型与上面声明的一致
            unsafe fn load(handle: *mut c_void) -> Result<Api, String> {
                Ok(Api {
                    $($field: {
                        // SAFETY: 调用方保证句柄有效；符号存在时它就是上面声明原型的 C 函数，函数指针与数据指针同宽
                        let pointer = unsafe { symbol(handle, $symbol)? };
                        unsafe { std::mem::transmute::<*mut c_void, unsafe extern "C" fn($($argument),*) $(-> $result)?>(pointer) }
                    },)*
                })
            }
        }
    };
}

cups_api! {
    get_dests = "cupsGetDests2": fn(*mut Http, *mut *mut CupsDest) -> c_int;
    free_dests = "cupsFreeDests": fn(c_int, *mut CupsDest);
    get_dest = "cupsGetDest": fn(*const c_char, *const c_char, c_int, *mut CupsDest) -> *mut CupsDest;
    get_option = "cupsGetOption": fn(*const c_char, c_int, *mut CupsOption) -> *const c_char;
    add_option = "cupsAddOption": fn(*const c_char, *const c_char, c_int, *mut *mut CupsOption) -> c_int;
    free_options = "cupsFreeOptions": fn(c_int, *mut CupsOption);
    copy_dest_info = "cupsCopyDestInfo": fn(*mut Http, *mut CupsDest) -> *mut CupsDinfo;
    free_dest_info = "cupsFreeDestInfo": fn(*mut CupsDinfo);
    check_dest_supported = "cupsCheckDestSupported": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, *const c_char, *const c_char) -> c_int;
    find_dest_supported = "cupsFindDestSupported": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, *const c_char) -> *mut IppAttribute;
    ipp_get_value_tag = "ippGetValueTag": fn(*mut IppAttribute) -> c_int;
    ipp_get_integer = "ippGetInteger": fn(*mut IppAttribute, c_int) -> c_int;
    ipp_get_range = "ippGetRange": fn(*mut IppAttribute, c_int, *mut c_int) -> c_int;
    ipp_get_count = "ippGetCount": fn(*mut IppAttribute) -> c_int;
    ipp_get_string = "ippGetString": fn(*mut IppAttribute, c_int, *mut *const c_char) -> *const c_char;
    localize_value = "cupsLocalizeDestValue": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, *const c_char, *const c_char) -> *const c_char;
    media_count = "cupsGetDestMediaCount": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_uint) -> c_int;
    media_by_index = "cupsGetDestMediaByIndex": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_int, c_uint, *mut CupsSize) -> c_int;
    media_by_size = "cupsGetDestMediaBySize": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_int, c_int, c_uint, *mut CupsSize) -> c_int;
    media_default = "cupsGetDestMediaDefault": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_uint, *mut CupsSize) -> c_int;
    localize_media = "cupsLocalizeDestMedia": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_uint, *mut CupsSize) -> *const c_char;
    connect_dest = "cupsConnectDest": fn(*mut CupsDest, c_uint, c_int, *mut c_int, *mut c_char, usize, *mut c_void, *mut c_void) -> *mut Http;
    http_close = "httpClose": fn(*mut Http);
    create_dest_job = "cupsCreateDestJob": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, *mut c_int, *const c_char, c_int, *mut CupsOption) -> c_int;
    start_dest_document = "cupsStartDestDocument": fn(*mut Http, *mut CupsDest, *mut CupsDinfo, c_int, *const c_char, *const c_char, c_int, *mut CupsOption, c_int) -> c_int;
    write_request_data = "cupsWriteRequestData": fn(*mut Http, *const c_char, usize) -> c_int;
    finish_dest_document = "cupsFinishDestDocument": fn(*mut Http, *mut CupsDest, *mut CupsDinfo) -> c_int;
    cancel_dest_job = "cupsCancelDestJob": fn(*mut Http, *mut CupsDest, c_int) -> c_int;
    last_error = "cupsLastError": fn() -> c_int;
    last_error_string = "cupsLastErrorString": fn() -> *const c_char;
}

/// 从句柄里取一个符号
///
/// # Safety
/// handle 必须是 dlopen 返回的有效句柄
unsafe fn symbol(handle: *mut c_void, name: &str) -> Result<*mut c_void, String> {
    let text = CString::new(name).expect("符号名不含 0");
    // SAFETY: handle 有效，text 是以 0 结尾的字符串
    let pointer = unsafe { libc::dlsym(handle, text.as_ptr()) };
    if pointer.is_null() {
        Err(format!("libcups 里没有 {name}：{}", dl_error()))
    } else {
        Ok(pointer)
    }
}

fn dl_error() -> String {
    // SAFETY: dlerror 返回本线程最近一次 dl 调用的错误说明，或 NULL
    let message = unsafe { libc::dlerror() };
    if message.is_null() {
        "未知原因".to_owned()
    } else {
        // SAFETY: 非 NULL 时是以 0 结尾的字符串，在下次 dl 调用前有效
        unsafe { CStr::from_ptr(message) }.to_string_lossy().into_owned()
    }
}

fn text(pointer: *const c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    // SAFETY: 非 NULL 的指针都来自 CUPS，是以 0 结尾的字符串，在所属对象释放前有效
    let value = unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned();
    (!value.is_empty()).then_some(value)
}

fn c_string(value: &str) -> CString {
    CString::new(value.replace('\0', "")).expect("已去掉 0 字节")
}

/// 加载好的 libcups；句柄在进程退出前一直有效
struct Library {
    api: Api,
}

// SAFETY: Api 里只有 C 函数指针，libcups 的函数可以在任意线程上调用（默认连接与最近错误按线程保存）
unsafe impl Send for Library {}
// SAFETY: 同上，函数表加载后只读
unsafe impl Sync for Library {}

impl Library {
    /// 本线程最近一次 CUPS 调用的错误说明
    fn last_error(&self) -> String {
        // SAFETY: cupsLastErrorString 没有参数，返回本线程的错误说明或 NULL
        text(unsafe { (self.api.last_error_string)() }).unwrap_or_else(|| "未知原因".to_owned())
    }

    /// 本线程最近一次 CUPS 调用的 IPP 状态
    fn last_status(&self) -> c_int {
        // SAFETY: cupsLastError 没有参数
        unsafe { (self.api.last_error)() }
    }

    /// 取本机的全部打印目标；CUPS 连不上时失败
    fn dests(self: &Arc<Self>) -> std::io::Result<Dests> {
        let mut array: *mut CupsDest = ptr::null_mut();
        // SAFETY: 第一个参数为 CUPS_HTTP_DEFAULT（NULL），array 是本函数里的有效指针
        let count = unsafe { (self.api.get_dests)(ptr::null_mut(), &mut array) };
        if count <= 0 {
            let status = self.last_status();
            if status != 0 && status != IPP_STATUS_ERROR_NOT_FOUND {
                return Err(std::io::Error::other(format!("查不了 CUPS 里的打印机：{}", self.last_error())));
            }
        }
        Ok(Dests {
            library: self.clone(),
            count: count.max(0),
            array,
        })
    }
}

/// cupsGetDests2 取得的打印目标，释放时交还 CUPS
struct Dests {
    library: Arc<Library>,
    count: c_int,
    array: *mut CupsDest,
}

impl Dests {
    fn iter(&self) -> impl Iterator<Item = *mut CupsDest> + '_ {
        // SAFETY: array 指向 count 个连续的 cups_dest_t
        (0..self.count as usize).map(move |index| unsafe { self.array.add(index) })
    }

    /// 按名称找打印目标（不分大小写），不含实例
    fn find(&self, name: &str) -> Option<*mut CupsDest> {
        if self.array.is_null() {
            return None;
        }
        let name = c_string(name);
        // SAFETY: name 以 0 结尾，实例传 NULL，array 与 count 来自 cupsGetDests2
        let dest = unsafe { (self.library.api.get_dest)(name.as_ptr(), ptr::null(), self.count, self.array) };
        (!dest.is_null()).then_some(dest)
    }

    fn option(&self, dest: *mut CupsDest, name: &str) -> Option<String> {
        let name = c_string(name);
        // SAFETY: dest 属于这批目标，选项数组与个数都由 CUPS 填写
        unsafe { text((self.library.api.get_option)(name.as_ptr(), (*dest).num_options, (*dest).options)) }
    }

    fn name(dest: *mut CupsDest) -> String {
        // SAFETY: dest 属于这批目标，name 总是有效的字符串
        unsafe { text((*dest).name) }.unwrap_or_default()
    }

    fn instance(dest: *mut CupsDest) -> Option<String> {
        // SAFETY: dest 属于这批目标，instance 为 NULL 或有效字符串
        unsafe { text((*dest).instance) }
    }

    fn is_default(dest: *mut CupsDest) -> bool {
        // SAFETY: dest 属于这批目标
        unsafe { (*dest).is_default != 0 }
    }

    fn number(&self, dest: *mut CupsDest, name: &str) -> Option<i64> {
        self.option(dest, name).and_then(|value| value.trim().parse().ok())
    }

    /// 打印机状态与状态位
    fn state(&self, dest: *mut CupsDest) -> (PrinterState, i64) {
        let state = self.number(dest, "printer-state").unwrap_or(0);
        let reasons = self.option(dest, "printer-state-reasons").unwrap_or_default();
        (map_state(state, &reasons), state)
    }

    /// 停用或不接收作业
    fn is_stopped(&self, dest: *mut CupsDest) -> bool {
        self.number(dest, "printer-state") == Some(STATE_STOPPED) || self.option(dest, "printer-is-accepting-jobs").is_some_and(|value| value.eq_ignore_ascii_case("false"))
    }

    fn info(&self, dest: *mut CupsDest) -> PrinterInfo {
        let (status, flags) = self.state(dest);
        let mut info = PrinterInfo::named(&Dests::name(dest), status);
        info.is_default = Dests::is_default(dest);
        info.status_flags = flags;
        info.location = self.option(dest, "printer-location");
        info.comment = self.option(dest, "printer-info");
        info.driver = self.option(dest, "printer-make-and-model");
        info.port = self.option(dest, "device-uri");
        let kind = self.number(dest, "printer-type").unwrap_or(0);
        let scheme = info.port.as_deref().and_then(|uri| uri.split_once(':')).map(|(scheme, _)| scheme.to_ascii_lowercase());
        info.is_network = kind & (PRINTER_REMOTE | PRINTER_DISCOVERED) != 0 || scheme.is_some_and(|scheme| NETWORK_SCHEMES.contains(&scheme.as_str()));
        info
    }

    /// 打印机能力：颜色、双面、份数上限来自 IPP 属性，纸张来自媒体列表
    fn capabilities(&self, dest: *mut CupsDest) -> PrinterCapabilities {
        let kind = self.number(dest, "printer-type").unwrap_or(0);
        let Some(info) = DestInfo::copy(&self.library, ptr::null_mut(), dest) else {
            return PrinterCapabilities {
                color: kind & PRINTER_COLOR != 0,
                duplex: kind & PRINTER_DUPLEX != 0,
                max_copies: 1,
                papers: Vec::new(),
                trays: Vec::new(),
            };
        };
        let api = &self.library.api;
        let color = c_string("print-color-mode");
        let color_value = c_string("color");
        let sides = c_string("sides");
        let sides_value = c_string("two-sided-long-edge");
        let copies = c_string("copies");
        // SAFETY: dest 与 info 都有效，http 为 CUPS_HTTP_DEFAULT，选项名与值以 0 结尾
        let (color, duplex, attribute) = unsafe {
            (
                (api.check_dest_supported)(ptr::null_mut(), dest, info.pointer, color.as_ptr(), color_value.as_ptr()) != 0,
                (api.check_dest_supported)(ptr::null_mut(), dest, info.pointer, sides.as_ptr(), sides_value.as_ptr()) != 0,
                (api.find_dest_supported)(ptr::null_mut(), dest, info.pointer, copies.as_ptr()),
            )
        };
        let max_copies = if attribute.is_null() {
            1
        } else {
            // SAFETY: attribute 属于 info，在 info 释放前有效
            match unsafe { (api.ipp_get_value_tag)(attribute) } {
                IPP_TAG_RANGE => {
                    let mut upper: c_int = 1;
                    // SAFETY: 同上，upper 是本函数里的有效内存
                    unsafe { (api.ipp_get_range)(attribute, 0, &mut upper) };
                    upper
                }
                // SAFETY: 同上
                IPP_TAG_INTEGER => unsafe { (api.ipp_get_integer)(attribute, 0) },
                _ => 1,
            }
        };
        PrinterCapabilities {
            color,
            duplex,
            max_copies: max_copies.max(1) as u32,
            papers: info.papers(dest),
            trays: info.trays(dest).into_iter().map(|(tray, _)| tray).collect(),
        }
    }
}

impl Drop for Dests {
    fn drop(&mut self) {
        if !self.array.is_null() {
            // SAFETY: array 与 count 来自 cupsGetDests2，只释放一次
            unsafe { (self.library.api.free_dests)(self.count, self.array) };
        }
    }
}

/// cupsCopyDestInfo 取得的打印目标能力，释放时交还 CUPS
struct DestInfo {
    library: Arc<Library>,
    http: *mut Http,
    pointer: *mut CupsDinfo,
}

impl DestInfo {
    fn copy(library: &Arc<Library>, http: *mut Http, dest: *mut CupsDest) -> Option<DestInfo> {
        // SAFETY: http 为 NULL（默认连接）或 cupsConnectDest 得到的连接，dest 有效
        let pointer = unsafe { (library.api.copy_dest_info)(http, dest) };
        (!pointer.is_null()).then(|| DestInfo {
            library: library.clone(),
            http,
            pointer,
        })
    }

    /// 打印机报的纸张：编号是序号，名称取本地化的名称，同名的只留一个
    fn papers(&self, dest: *mut CupsDest) -> Vec<PaperInfo> {
        let api = &self.library.api;
        // SAFETY: dest 与 info 有效
        let count = unsafe { (api.media_count)(self.http, dest, self.pointer, MEDIA_FLAGS_DEFAULT) };
        let mut papers: Vec<PaperInfo> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for index in 0..count.max(0) {
            let mut size = CupsSize::empty();
            // SAFETY: index 在媒体个数内，size 是本函数里的有效内存
            if unsafe { (api.media_by_index)(self.http, dest, self.pointer, index, MEDIA_FLAGS_DEFAULT, &mut size) } == 0 || size.width <= 0 || size.length <= 0 {
                continue;
            }
            let media = size.media();
            if seen.contains(&media) {
                continue;
            }
            // SAFETY: 同上；返回的字符串属于 info
            let name = text(unsafe { (api.localize_media)(self.http, dest, self.pointer, MEDIA_FLAGS_DEFAULT, &mut size) }).unwrap_or_else(|| media.clone());
            papers.push(PaperInfo {
                id: index,
                name,
                width_mm: size.width_mm(),
                height_mm: size.height_mm(),
            });
            seen.push(media);
        }
        papers
    }

    /// 打印机报的纸盒（media-source-supported）：编号是序号，名称取本地化的名称，第二项是 IPP 关键字
    fn trays(&self, dest: *mut CupsDest) -> Vec<(TrayInfo, String)> {
        let api = &self.library.api;
        let name = c_string("media-source");
        // SAFETY: dest 与 info 有效，选项名以 0 结尾；返回的属性属于 info
        let attribute = unsafe { (api.find_dest_supported)(self.http, dest, self.pointer, name.as_ptr()) };
        if attribute.is_null() {
            return Vec::new();
        }
        // SAFETY: attribute 属于 info，在 info 释放前有效
        let count = unsafe { (api.ipp_get_count)(attribute) };
        let mut trays = Vec::new();
        for index in 0..count.max(0) {
            // SAFETY: 同上，index 在值的个数内；不要语言标记
            let Some(keyword) = text(unsafe { (api.ipp_get_string)(attribute, index, ptr::null_mut()) }) else {
                continue;
            };
            let value = c_string(&keyword);
            // SAFETY: dest 与 info 有效，选项名与值以 0 结尾；返回的字符串属于 info
            let localized = text(unsafe { (api.localize_value)(self.http, dest, self.pointer, name.as_ptr(), value.as_ptr()) });
            trays.push((
                TrayInfo {
                    id: index,
                    name: localized.unwrap_or_else(|| keyword.clone()),
                },
                keyword,
            ));
        }
        trays
    }

    /// 按尺寸请求时打印机实际会用的纸张；没有这个尺寸、也不接受自定义尺寸时为 None
    fn by_size(&self, dest: *mut CupsDest, width_mm: f64, height_mm: f64) -> Option<CupsSize> {
        let mut size = CupsSize::empty();
        let width = (width_mm * 100.0).round() as c_int;
        let length = (height_mm * 100.0).round() as c_int;
        // SAFETY: dest 与 info 有效，size 是本函数里的有效内存
        let found = unsafe { (self.library.api.media_by_size)(self.http, dest, self.pointer, width, length, MEDIA_FLAGS_DEFAULT, &mut size) };
        (found != 0 && size.width > 0 && size.length > 0).then_some(size)
    }

    /// 打印机的缺省纸张
    fn default_media(&self, dest: *mut CupsDest) -> Option<CupsSize> {
        let mut size = CupsSize::empty();
        // SAFETY: dest 与 info 有效，size 是本函数里的有效内存
        let found = unsafe { (self.library.api.media_default)(self.http, dest, self.pointer, MEDIA_FLAGS_DEFAULT, &mut size) };
        (found != 0 && size.width > 0 && size.length > 0).then_some(size)
    }

    fn supports(&self, dest: *mut CupsDest, option: &str, value: &str) -> bool {
        let option = c_string(option);
        let value = c_string(value);
        // SAFETY: dest 与 info 有效，选项名与值以 0 结尾
        unsafe { (self.library.api.check_dest_supported)(self.http, dest, self.pointer, option.as_ptr(), value.as_ptr()) != 0 }
    }
}

impl Drop for DestInfo {
    fn drop(&mut self) {
        // SAFETY: pointer 来自 cupsCopyDestInfo，只释放一次
        unsafe { (self.library.api.free_dest_info)(self.pointer) };
    }
}

/// cupsConnectDest 得到的连接，关闭时交还 CUPS
struct Connection {
    library: Arc<Library>,
    http: *mut Http,
}

impl Connection {
    fn open(library: &Arc<Library>, dest: *mut CupsDest) -> Option<Connection> {
        let mut resource: [c_char; 1024] = [0; 1024];
        // SAFETY: dest 有效，resource 是本函数里的缓冲区，取消标志与回调都为 NULL
        let http = unsafe {
            (library.api.connect_dest)(
                dest,
                DEST_FLAGS_NONE,
                CONNECT_TIMEOUT_MS,
                ptr::null_mut(),
                resource.as_mut_ptr(),
                resource.len(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        (!http.is_null()).then(|| Connection { library: library.clone(), http })
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: http 来自 cupsConnectDest，只关闭一次
        unsafe { (self.library.api.http_close)(self.http) };
    }
}

/// 交给 cupsCreateDestJob 的作业选项
struct Options {
    library: Arc<Library>,
    count: c_int,
    array: *mut CupsOption,
}

impl Options {
    fn new(library: &Arc<Library>) -> Options {
        Options {
            library: library.clone(),
            count: 0,
            array: ptr::null_mut(),
        }
    }

    fn add(&mut self, name: &str, value: &str) {
        let name = c_string(name);
        let value = c_string(value);
        // SAFETY: 名称与值以 0 结尾，CUPS 复制它们；array 与 count 只经 cupsAddOption 修改
        self.count = unsafe { (self.library.api.add_option)(name.as_ptr(), value.as_ptr(), self.count, &mut self.array) };
    }
}

impl Drop for Options {
    fn drop(&mut self) {
        if !self.array.is_null() {
            // SAFETY: array 与 count 来自 cupsAddOption，只释放一次
            unsafe { (self.library.api.free_options)(self.count, self.array) };
        }
    }
}

/// 打印机状态：脱机原因优先，其次停用、卡纸、缺纸、其余出错原因，最后看处理中与空闲
fn map_state(state: i64, reasons: &str) -> PrinterState {
    let keywords: Vec<&str> = reasons.split(',').map(str::trim).filter(|reason| !reason.is_empty() && *reason != "none").collect();
    let base = |reason: &str| -> String {
        let reason = reason.to_ascii_lowercase();
        for suffix in ["-error", "-warning", "-report"] {
            if let Some(stripped) = reason.strip_suffix(suffix) {
                return stripped.to_owned();
            }
        }
        reason
    };
    let has = |names: &[&str]| keywords.iter().any(|reason| names.contains(&base(reason).as_str()));
    if has(&["offline"]) {
        return PrinterState::Offline;
    }
    if state == STATE_STOPPED {
        return PrinterState::Paused;
    }
    if has(&["media-jam"]) {
        return PrinterState::PaperJam;
    }
    if has(&["media-empty", "media-needed"]) {
        return PrinterState::PaperOut;
    }
    if keywords.iter().any(|reason| reason.to_ascii_lowercase().ends_with("-error")) {
        return PrinterState::Error;
    }
    match state {
        STATE_PROCESSING => PrinterState::Busy,
        STATE_IDLE => PrinterState::Ready,
        _ => PrinterState::Unknown,
    }
}

/// 自定义尺寸的 media 写法
fn custom_media(width_mm: f64, height_mm: f64) -> String {
    let format = |value: f64| {
        let text = format!("{value:.2}");
        text.trim_end_matches('0').trim_end_matches('.').to_owned()
    };
    format!("Custom.{}x{}mm", format(width_mm), format(height_mm))
}

fn printer_details(printer: &str) -> Details {
    Details::new().with("printer", printer)
}

/// 经 libcups 访问本机的打印系统；libcups 在运行时加载
#[derive(Clone)]
pub(crate) struct Cups {
    library: Arc<Library>,
}

impl Cups {
    /// 加载 libcups（Linux 上是 libcups.so.2，macOS 上是 /usr/lib/libcups.2.dylib）；本机没有时给出原因
    pub(crate) fn open() -> Result<Cups, String> {
        let name = c_string(LIBRARY);
        // SAFETY: name 以 0 结尾；句柄在进程退出前不关闭
        let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
        if handle.is_null() {
            return Err(format!("本机没有 CUPS（加载 {LIBRARY} 失败：{}）", dl_error()));
        }
        // SAFETY: handle 是刚打开的有效句柄，各符号的原型与 CUPS 头文件一致
        let api = unsafe { Api::load(handle) }?;
        Ok(Cups {
            library: Arc::new(Library { api }),
        })
    }

    /// 打印机不存在时给出 PRINTER_NOT_FOUND，停用或不接收作业时给出 PRINTER_OFFLINE
    pub(crate) fn check_printer(&self, printer: &str) -> Result<(), JobError> {
        let dests = self
            .library
            .dests()
            .map_err(|error| JobError::failure(errors::PRINTER_OFFLINE, error.to_string(), Some(printer_details(printer))))?;
        ready_dest(&dests, printer).map(|_| ())
    }

    /// 把一份 PDF 作为一个作业交给打印机：份数、逐份、双面、灰度、纸张、横放、缩放、纸盒与页码范围都写成作业选项；
    /// page_ranges 为 None 时打全部页。打印机不存在时 PRINTER_NOT_FOUND，停用时 PRINTER_OFFLINE，纸盒没有了时 TRAY_NOT_FOUND，提交失败时 SPOOL_FAILED
    pub(crate) fn submit_pdf(&self, printer: &str, pdf: &[u8], options: &PrintOptions, sheet: &SheetFeed, title: &str) -> Result<SpoolTicket, JobError> {
        let SheetFeed { feed, scale, tray, page_ranges } = sheet;
        let library = &self.library;
        let dests = library
            .dests()
            .map_err(|error| JobError::failure(errors::PRINTER_OFFLINE, error.to_string(), Some(printer_details(printer))))?;
        let dest = ready_dest(&dests, printer)?;
        let name = Dests::name(dest);
        let connection = Connection::open(library, dest).ok_or_else(|| spool_failed(library, &name, "cupsConnectDest"))?;
        let info = DestInfo::copy(library, connection.http, dest).ok_or_else(|| spool_failed(library, &name, "cupsCopyDestInfo"))?;

        let mut job_options = Options::new(library);
        job_options.add("copies", &options.copies.max(1).to_string());
        job_options.add(
            "multiple-document-handling",
            if options.collate {
                "separate-documents-collated-copies"
            } else {
                "separate-documents-uncollated-copies"
            },
        );
        job_options.add(
            "sides",
            match options.duplex {
                DuplexMode::Simplex => "one-sided",
                DuplexMode::LongEdge => "two-sided-long-edge",
                DuplexMode::ShortEdge => "two-sided-short-edge",
            },
        );
        match options.color {
            ColorMode::Grayscale => job_options.add("print-color-mode", "monochrome"),
            ColorMode::Color if info.supports(dest, "print-color-mode", "color") => job_options.add("print-color-mode", "color"),
            ColorMode::Color => {}
        }
        let media = match info.by_size(dest, feed.width_mm, feed.height_mm) {
            Some(size) => size.media(),
            None => custom_media(feed.width_mm, feed.height_mm),
        };
        job_options.add("media", &media);
        job_options.add("orientation-requested", if feed.landscape { "4" } else { "3" });
        job_options.add("print-scaling", scaling(*scale));
        if let Some(tray) = tray {
            let trays = info.trays(dest);
            let (_, keyword) = trays.iter().find(|(known, _)| known.id == tray.id && known.name == tray.name).ok_or_else(|| {
                JobError::failure(
                    errors::TRAY_NOT_FOUND,
                    format!("打印机「{name}」没有纸盒「{}」了", tray.name),
                    Some(printer_details(&name).with("tray", tray.name.as_str())),
                )
            })?;
            job_options.add("media-source", keyword);
        }
        if let Some(ranges) = page_ranges {
            job_options.add("page-ranges", ranges);
        }

        let title = c_string(title);
        let mut job_id: c_int = 0;
        // SAFETY: 连接、目标与能力都有效，job_id 是本函数里的有效内存，选项数组归 job_options 所有
        let status = unsafe { (library.api.create_dest_job)(connection.http, dest, info.pointer, &mut job_id, title.as_ptr(), job_options.count, job_options.array) };
        if status >= 0x0100 || job_id <= 0 {
            return Err(spool_failed(library, &name, "cupsCreateDestJob"));
        }
        write_document(library, &connection, dest, &info, job_id, &title, FORMAT_PDF, pdf, None).map_err(|error| error.into_job_error(library, &name))?;
        Ok(SpoolTicket {
            printer: name,
            document_name: title.to_string_lossy().into_owned(),
            system_job_id: Some(job_id as u32),
        })
    }
}

/// 一个 PDF 作业怎么下发：核对出的纸张与缩放倍数、选项指定的纸盒，以及要打的页（按 PDF 的页码，None 为全部）
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SheetFeed {
    /// 纸张与方向
    pub feed: PaperFeed,
    /// 内容的缩放倍数，1 为原大
    pub scale: f64,
    /// 纸盒
    pub tray: Option<TrayInfo>,
    /// 页码范围，如 1-3,5
    pub page_ranges: Option<String>,
}

/// 缩放倍数写成 print-scaling：不是原大时按可打印区域等比放进纸张，原大时不缩放
fn scaling(scale: f64) -> &'static str {
    if (scale - 1.0).abs() > 1e-9 { "fit" } else { "none" }
}

/// 找到可以接收作业的打印目标
fn ready_dest(dests: &Dests, printer: &str) -> Result<*mut CupsDest, JobError> {
    let dest = dests
        .find(printer)
        .ok_or_else(|| JobError::failure(errors::PRINTER_NOT_FOUND, format!("没有这台打印机：{printer}"), Some(printer_details(printer))))?;
    if dests.is_stopped(dest) {
        let (status, flags) = dests.state(dest);
        let name = Dests::name(dest);
        return Err(JobError::failure(
            errors::PRINTER_OFFLINE,
            format!("打印机已停用或不接收作业：{name}"),
            Some(printer_details(&name).with("status", status.name()).with("statusFlags", flags)),
        ));
    }
    Ok(dest)
}

fn spool_failed(library: &Library, printer: &str, call: &str) -> JobError {
    JobError::failure(
        errors::SPOOL_FAILED,
        format!("交给打印池失败：{}", library.last_error()),
        Some(
            printer_details(printer)
                .with("call", call)
                .with("ippStatus", library.last_status())
                .with("cupsError", library.last_error()),
        ),
    )
}

/// 写文档时没有完成的原因
enum WriteError {
    /// CUPS 调用失败
    Failed(&'static str),
    /// 令牌取消了，作业已撤下
    Cancelled,
}

impl WriteError {
    fn into_job_error(self, library: &Library, printer: &str) -> JobError {
        match self {
            WriteError::Failed(call) => spool_failed(library, printer, call),
            WriteError::Cancelled => JobError::Cancelled,
        }
    }
}

/// 开始作业里唯一的一份文档、分块写入、结束文档；令牌取消或写入失败时撤下作业
#[allow(clippy::too_many_arguments)]
fn write_document(
    library: &Arc<Library>,
    connection: &Connection,
    dest: *mut CupsDest,
    info: &DestInfo,
    job_id: c_int,
    name: &CStr,
    format: &str,
    data: &[u8],
    cancel: Option<&Cancel>,
) -> Result<(), WriteError> {
    let api = &library.api;
    let format = c_string(format);
    // SAFETY: 连接、目标、能力有效，作业号来自 cupsCreateDestJob，文档名与格式以 0 结尾，不带文档选项，这是最后一份文档
    let started = unsafe { (api.start_dest_document)(connection.http, dest, info.pointer, job_id, name.as_ptr(), format.as_ptr(), 0, ptr::null_mut(), 1) };
    if started != HTTP_STATUS_CONTINUE {
        cancel_job(library, dest, job_id);
        return Err(WriteError::Failed("cupsStartDestDocument"));
    }
    for chunk in data.chunks(WRITE_CHUNK) {
        if cancel.is_some_and(Cancel::is_cancelled) {
            cancel_job(library, dest, job_id);
            return Err(WriteError::Cancelled);
        }
        // SAFETY: chunk 在本次调用期间有效，长度如实传入
        let written = unsafe { (api.write_request_data)(connection.http, chunk.as_ptr().cast(), chunk.len()) };
        if written != HTTP_STATUS_CONTINUE {
            cancel_job(library, dest, job_id);
            return Err(WriteError::Failed("cupsWriteRequestData"));
        }
    }
    // SAFETY: 连接、目标与能力有效，文档已写完
    let status = unsafe { (api.finish_dest_document)(connection.http, dest, info.pointer) };
    if status >= 0x0100 {
        return Err(WriteError::Failed("cupsFinishDestDocument"));
    }
    Ok(())
}

/// 另开一条连接撤下作业；原连接可能停在半截请求上
fn cancel_job(library: &Arc<Library>, dest: *mut CupsDest, job_id: c_int) {
    if let Some(connection) = Connection::open(library, dest) {
        // SAFETY: 新连接与目标有效，作业号来自 cupsCreateDestJob
        unsafe { (library.api.cancel_dest_job)(connection.http, dest, job_id) };
    }
}

impl PrinterCatalog for Cups {
    fn list(&self) -> std::io::Result<Vec<PrinterInfo>> {
        let dests = self.library.dests()?;
        Ok(dests.iter().filter(|dest| Dests::instance(*dest).is_none()).map(|dest| dests.info(dest)).collect())
    }

    fn get(&self, name: &str) -> std::io::Result<Option<PrinterInfo>> {
        let dests = self.library.dests()?;
        Ok(dests.find(name).map(|dest| {
            let mut info = dests.info(dest);
            info.capabilities = Some(dests.capabilities(dest));
            info
        }))
    }

    fn default_printer_name(&self) -> std::io::Result<Option<String>> {
        let dests = self.library.dests()?;
        Ok(dests.iter().find(|dest| Dests::is_default(*dest) && Dests::instance(*dest).is_none()).map(Dests::name))
    }
}

/// 一台打印机的纸张能力：打印目标与它的能力一直留到用完
struct CupsPapers {
    _dests: Dests,
    dest: *mut CupsDest,
    info: DestInfo,
    papers: Vec<PaperInfo>,
    trays: Vec<TrayInfo>,
}

// SAFETY: 打印目标与能力归这个对象独占，只经 CUPS 函数访问，CUPS 不要求在创建它们的线程上使用
unsafe impl Send for CupsPapers {}

impl PrinterPapers for CupsPapers {
    fn papers(&self) -> &[PaperInfo] {
        &self.papers
    }

    fn resolve(&self, request: &PaperFeed) -> Option<PaperFeed> {
        let size = self
            .info
            .by_size(self.dest, request.width_mm, request.height_mm)
            .or_else(|| self.info.default_media(self.dest))?;
        Some(PaperFeed::new(size.width_mm(), size.height_mm(), request.landscape))
    }

    fn trays(&self) -> &[TrayInfo] {
        &self.trays
    }
}

impl PaperCatalog for Cups {
    fn open(&self, printer: &str) -> Option<Box<dyn PrinterPapers>> {
        let dests = self.library.dests().ok()?;
        let dest = dests.find(printer)?;
        let info = DestInfo::copy(&self.library, ptr::null_mut(), dest)?;
        let papers = info.papers(dest);
        let trays = info.trays(dest).into_iter().map(|(tray, _)| tray).collect();
        Some(Box::new(CupsPapers {
            _dests: dests,
            dest,
            info,
            papers,
            trays,
        }))
    }
}

impl RawPrinter for Cups {
    fn write(&self, printer: String, data: Arc<Vec<u8>>, document_name: String, cancel: Cancel) -> BoxFuture<'static, Result<RawPrintResult, JobError>> {
        let library = self.library.clone();
        Box::pin(async move {
            let token = cancel.clone();
            let task = tokio::task::spawn_blocking(move || write_raw(&library, &printer, &data, &document_name, &token));
            match cancel.run(task).await? {
                Ok(result) => result,
                Err(error) => Err(JobError::failure(errors::INTERNAL, format!("写原始指令的线程出错：{error}"), None)),
            }
        })
    }
}

/// 以 application/vnd.cups-raw 把字节原样交给打印机
fn write_raw(library: &Arc<Library>, printer: &str, data: &[u8], document_name: &str, cancel: &Cancel) -> Result<RawPrintResult, JobError> {
    let dests = library
        .dests()
        .map_err(|error| JobError::failure(errors::PRINTER_OFFLINE, error.to_string(), Some(printer_details(printer))))?;
    let dest = ready_dest(&dests, printer)?;
    let name = Dests::name(dest);
    let connection = Connection::open(library, dest).ok_or_else(|| spool_failed(library, &name, "cupsConnectDest"))?;
    let info = DestInfo::copy(library, connection.http, dest).ok_or_else(|| spool_failed(library, &name, "cupsCopyDestInfo"))?;
    let title = c_string(document_name);
    let mut job_id: c_int = 0;
    // SAFETY: 连接、目标与能力都有效，job_id 是本函数里的有效内存，不带作业选项
    let status = unsafe { (library.api.create_dest_job)(connection.http, dest, info.pointer, &mut job_id, title.as_ptr(), 0, ptr::null_mut()) };
    if status >= 0x0100 || job_id <= 0 {
        return Err(spool_failed(library, &name, "cupsCreateDestJob"));
    }
    write_document(library, &connection, dest, &info, job_id, &title, FORMAT_RAW, data, Some(cancel)).map_err(|error| error.into_job_error(library, &name))?;
    Ok(RawPrintResult {
        bytes: data.len() as u64,
        spooled: SpoolTicket {
            printer: name,
            document_name: document_name.to_owned(),
            system_job_id: Some(job_id as u32),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_cups_states_and_reasons() {
        assert_eq!(map_state(3, "none"), PrinterState::Ready);
        assert_eq!(map_state(4, ""), PrinterState::Busy);
        assert_eq!(map_state(5, "paused"), PrinterState::Paused);
        assert_eq!(map_state(3, "offline-report"), PrinterState::Offline);
        assert_eq!(map_state(5, "offline-report,paused"), PrinterState::Offline);
        assert_eq!(map_state(4, "media-empty-error"), PrinterState::PaperOut);
        assert_eq!(map_state(3, "media-needed-warning"), PrinterState::PaperOut);
        assert_eq!(map_state(4, "media-jam-error,media-empty-error"), PrinterState::PaperJam);
        assert_eq!(map_state(3, "toner-empty-error"), PrinterState::Error);
        assert_eq!(map_state(3, "toner-low-warning"), PrinterState::Ready);
        assert_eq!(map_state(0, ""), PrinterState::Unknown);
    }

    #[test]
    fn scales_only_when_the_content_is_not_at_its_own_size() {
        assert_eq!(scaling(1.0), "none");
        assert_eq!(scaling(0.5), "fit");
        assert_eq!(scaling(2.1), "fit");
    }

    #[test]
    fn writes_custom_sizes_in_millimetres() {
        assert_eq!(custom_media(100.0, 70.0), "Custom.100x70mm");
        assert_eq!(custom_media(101.6, 152.4), "Custom.101.6x152.4mm");
    }
}
