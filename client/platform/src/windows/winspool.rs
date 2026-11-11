// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 经 winspool 查本机打印机：列表与状态来自 EnumPrinters / GetPrinter，能力（纸张、纸盒）来自 DeviceCapabilities，下发前试探纸张用 DocumentProperties；
//! 原始指令以 RAW 数据类型原样写给打印机；PDF 打印的作业设置在驱动的缺省 DEVMODE 上改好再交给 DocumentProperties 合并

use std::sync::Arc;

use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_INSUFFICIENT_BUFFER, GetLastError};
use windows::Win32::Graphics::Gdi::{
    DEVMODE_COLLATE, DEVMODEW, DM_COLLATE, DM_COLOR, DM_COPIES, DM_DEFAULTSOURCE, DM_DUPLEX, DM_IN_BUFFER, DM_ORIENTATION, DM_OUT_BUFFER, DM_PAPERLENGTH, DM_PAPERSIZE,
    DM_PAPERWIDTH, DMCOLLATE_TRUE, DMCOLOR_COLOR, DMCOLOR_MONOCHROME, DMDUP_HORIZONTAL, DMDUP_SIMPLEX, DMDUP_VERTICAL, DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT, DMPAPER_USER,
};
use windows::Win32::Graphics::Printing::{
    AbortPrinter, ClosePrinter, DOC_INFO_1W, DocumentPropertiesW, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, GetPrinterW, OpenPrinterW,
    PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W, StartDocPrinterW, StartPagePrinter, WritePrinter,
};
use windows::Win32::Storage::Xps::{DC_BINNAMES, DC_BINS, DC_COLORDEVICE, DC_COPIES, DC_DUPLEX, DC_PAPERNAMES, DC_PAPERS, DC_PAPERSIZE, DeviceCapabilitiesW};
use windows::core::{HSTRING, PCWSTR, PWSTR};
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::printing::{JobError, PaperCatalog, PaperFeed, PrinterCatalog, PrinterPapers, RawPrintResult, RawPrinter, SpoolTicket, TOLERANCE_MM};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{ColorMode, Details, DuplexMode, PaperInfo, PrintOptions, PrinterCapabilities, PrinterInfo, PrinterState, TrayInfo};

const STATUS_PAUSED: u32 = 0x1;
const STATUS_ERROR: u32 = 0x2;
const STATUS_PENDING_DELETION: u32 = 0x4;
const STATUS_PAPER_JAM: u32 = 0x8;
const STATUS_PAPER_OUT: u32 = 0x10;
const STATUS_PAPER_PROBLEM: u32 = 0x40;
const STATUS_OFFLINE: u32 = 0x80;
const STATUS_IO_ACTIVE: u32 = 0x100;
const STATUS_BUSY: u32 = 0x200;
const STATUS_PRINTING: u32 = 0x400;
const STATUS_NOT_AVAILABLE: u32 = 0x1000;
const STATUS_WAITING: u32 = 0x2000;
const STATUS_PROCESSING: u32 = 0x4000;
const STATUS_INITIALIZING: u32 = 0x8000;
const STATUS_WARMING_UP: u32 = 0x10000;
const STATUS_NO_TONER: u32 = 0x40000;
const STATUS_PAGE_PUNT: u32 = 0x80000;
const STATUS_USER_INTERVENTION: u32 = 0x100000;
const STATUS_OUT_OF_MEMORY: u32 = 0x200000;
const STATUS_DOOR_OPEN: u32 = 0x400000;
const STATUS_SERVER_UNKNOWN: u32 = 0x800000;
const STATUS_SERVER_OFFLINE: u32 = 0x2000000;

const OFFLINE_BITS: u32 = STATUS_OFFLINE | STATUS_NOT_AVAILABLE | STATUS_SERVER_OFFLINE;
const ERROR_BITS: u32 =
    STATUS_ERROR | STATUS_PENDING_DELETION | STATUS_PAPER_PROBLEM | STATUS_NO_TONER | STATUS_PAGE_PUNT | STATUS_USER_INTERVENTION | STATUS_OUT_OF_MEMORY | STATUS_DOOR_OPEN;
const BUSY_BITS: u32 = STATUS_IO_ACTIVE | STATUS_BUSY | STATUS_PRINTING | STATUS_WAITING | STATUS_PROCESSING | STATUS_INITIALIZING | STATUS_WARMING_UP;

const ATTRIBUTE_NETWORK: u32 = 0x10;
const ATTRIBUTE_WORK_OFFLINE: u32 = 0x400;
const PAPER_NAME_LENGTH: usize = 64;
const BIN_NAME_LENGTH: usize = 24;
const ERROR_INVALID_PRINTER_NAME: u32 = 1801;
const ERROR_INVALID_DATATYPE: u32 = 1804;
const CHUNK_BYTES: usize = 64 * 1024;

/// winspool 上的打印机
pub(crate) struct WindowsPrinters;

/// 打开的打印机句柄，释放时关闭
struct Handle(PRINTER_HANDLE);

// SAFETY: 打印机句柄可以在线程之间转交，同一时刻只在一个线程上用
unsafe impl Send for Handle {}

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: 句柄由 OpenPrinterW 打开，只关一次
        let _ = unsafe { ClosePrinter(self.0) };
    }
}

fn open(name: &str) -> Result<Handle, u32> {
    let mut handle = PRINTER_HANDLE::default();
    // SAFETY: name 在调用期间有效，handle 是输出参数
    match unsafe { OpenPrinterW(&HSTRING::from(name), &mut handle, None) } {
        Ok(()) => Ok(Handle(handle)),
        Err(error) => Err(error.code().0 as u32 & 0xFFFF),
    }
}

/// 按 8 字节对齐的缓冲：放得下含指针的结构
fn aligned(bytes: usize) -> Vec<u64> {
    vec![0u64; bytes.div_ceil(8).max(1)]
}

fn as_bytes(buffer: &mut [u64]) -> &mut [u8] {
    // SAFETY: u64 的切片按字节看长度乘 8，对齐更宽
    unsafe { std::slice::from_raw_parts_mut(buffer.as_mut_ptr().cast(), buffer.len() * 8) }
}

fn text(value: PWSTR) -> Option<String> {
    if value.is_null() {
        return None;
    }
    // SAFETY: winspool 给的字符串以 0 结尾，在缓冲有效期间可读
    let text = unsafe { value.to_string() }.ok()?;
    (!text.is_empty()).then_some(text)
}

/// 由 PRINTER_INFO_2 的状态位与属性位得出状态：脱机、暂停优先，其次卡纸、缺纸、出错、忙
pub(crate) fn state_of(status: u32, attributes: u32) -> PrinterState {
    if status & OFFLINE_BITS != 0 || attributes & ATTRIBUTE_WORK_OFFLINE != 0 {
        PrinterState::Offline
    } else if status & STATUS_PAUSED != 0 {
        PrinterState::Paused
    } else if status & STATUS_PAPER_JAM != 0 {
        PrinterState::PaperJam
    } else if status & STATUS_PAPER_OUT != 0 {
        PrinterState::PaperOut
    } else if status & ERROR_BITS != 0 {
        PrinterState::Error
    } else if status & BUSY_BITS != 0 {
        PrinterState::Busy
    } else if status & STATUS_SERVER_UNKNOWN != 0 {
        PrinterState::Unknown
    } else {
        PrinterState::Ready
    }
}

fn info_of(info: &PRINTER_INFO_2W, default: Option<&str>, capabilities: Option<PrinterCapabilities>) -> PrinterInfo {
    let name = text(info.pPrinterName).unwrap_or_default();
    PrinterInfo {
        is_default: default.is_some_and(|default| default.eq_ignore_ascii_case(&name)),
        status: state_of(info.Status, info.Attributes),
        status_flags: i64::from(info.Status),
        location: text(info.pLocation),
        comment: text(info.pComment),
        driver: text(info.pDriverName),
        port: text(info.pPortName),
        is_network: info.Attributes & ATTRIBUTE_NETWORK != 0,
        capabilities,
        name,
    }
}

fn default_printer() -> std::io::Result<Option<String>> {
    let mut size = 0u32;
    // SAFETY: 先只问长度
    if !unsafe { GetDefaultPrinterW(None, &mut size) }.as_bool() {
        // SAFETY: 读本线程的最后错误
        let error = unsafe { GetLastError() };
        if error == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if error != ERROR_INSUFFICIENT_BUFFER {
            return Err(std::io::Error::from_raw_os_error(error.0 as i32));
        }
    }
    let mut name = vec![0u16; size as usize + 1];
    // SAFETY: name 按问到的长度分配
    if !unsafe { GetDefaultPrinterW(Some(PWSTR(name.as_mut_ptr())), &mut size) }.as_bool() {
        // SAFETY: 读本线程的最后错误
        let error = unsafe { GetLastError() };
        return if error == ERROR_FILE_NOT_FOUND {
            Ok(None)
        } else {
            Err(std::io::Error::from_raw_os_error(error.0 as i32))
        };
    }
    let end = name.iter().position(|unit| *unit == 0).unwrap_or(name.len());
    Ok(Some(String::from_utf16_lossy(&name[..end])))
}

fn capability(name: &HSTRING, port: &HSTRING, which: windows::Win32::Storage::Xps::PRINTER_DEVICE_CAPABILITIES, output: Option<PWSTR>) -> i32 {
    // SAFETY: 名称以 0 结尾；output 由调用方按 DeviceCapabilities 问到的个数分配
    unsafe { DeviceCapabilitiesW(name, port, which, output, None) }
}

/// 由驱动报的纸张号、尺寸（0.1 mm）与名称组出纸张列表；三者条数取最小
pub(crate) fn papers_of(ids: &[u16], sizes: &[i32], names: &[u16]) -> Vec<PaperInfo> {
    let count = ids.len().min(sizes.len() / 2).min(names.len() / PAPER_NAME_LENGTH);
    (0..count)
        .map(|index| {
            let field = &names[index * PAPER_NAME_LENGTH..(index + 1) * PAPER_NAME_LENGTH];
            let end = field.iter().position(|unit| *unit == 0).unwrap_or(field.len());
            PaperInfo {
                id: i32::from(ids[index]),
                name: String::from_utf16_lossy(&field[..end]),
                width_mm: f64::from(sizes[index * 2]) / 10.0,
                height_mm: f64::from(sizes[index * 2 + 1]) / 10.0,
            }
        })
        .collect()
}

/// 由驱动报的纸盒号与名称组出纸盒列表；两者条数取最小
pub(crate) fn trays_of(ids: &[u16], names: &[u16]) -> Vec<TrayInfo> {
    let count = ids.len().min(names.len() / BIN_NAME_LENGTH);
    (0..count)
        .map(|index| {
            let field = &names[index * BIN_NAME_LENGTH..(index + 1) * BIN_NAME_LENGTH];
            let end = field.iter().position(|unit| *unit == 0).unwrap_or(field.len());
            TrayInfo {
                id: i32::from(ids[index]),
                name: String::from_utf16_lossy(&field[..end]),
            }
        })
        .collect()
}

fn trays(name: &HSTRING, port: &HSTRING) -> Vec<TrayInfo> {
    let count = capability(name, port, DC_BINS, None);
    if count <= 0 {
        return Vec::new();
    }
    let count = count as usize;
    let mut ids = vec![0u16; count];
    let mut names = vec![0u16; count * BIN_NAME_LENGTH];
    let id_count = capability(name, port, DC_BINS, Some(PWSTR(ids.as_mut_ptr())));
    let name_count = capability(name, port, DC_BINNAMES, Some(PWSTR(names.as_mut_ptr())));
    if id_count <= 0 || name_count <= 0 {
        return Vec::new();
    }
    trays_of(&ids[..count.min(id_count as usize)], &names[..count.min(name_count as usize) * BIN_NAME_LENGTH])
}

fn capabilities(name: &str, port: Option<&str>) -> PrinterCapabilities {
    let name = HSTRING::from(name);
    let port = HSTRING::from(port.unwrap_or(""));
    let count = capability(&name, &port, DC_PAPERS, None);
    let papers = if count > 0 {
        let count = count as usize;
        let mut ids = vec![0u16; count];
        let mut sizes = vec![0i32; count * 2];
        let mut names = vec![0u16; count * PAPER_NAME_LENGTH];
        let id_count = capability(&name, &port, DC_PAPERS, Some(PWSTR(ids.as_mut_ptr())));
        let size_count = capability(&name, &port, DC_PAPERSIZE, Some(PWSTR(sizes.as_mut_ptr().cast())));
        let name_count = capability(&name, &port, DC_PAPERNAMES, Some(PWSTR(names.as_mut_ptr())));
        if id_count <= 0 || size_count <= 0 || name_count <= 0 {
            Vec::new()
        } else {
            papers_of(
                &ids[..count.min(id_count as usize)],
                &sizes[..count.min(size_count as usize) * 2],
                &names[..count.min(name_count as usize) * PAPER_NAME_LENGTH],
            )
        }
    } else {
        Vec::new()
    };
    PrinterCapabilities {
        color: capability(&name, &port, DC_COLORDEVICE, None) == 1,
        duplex: capability(&name, &port, DC_DUPLEX, None) == 1,
        max_copies: capability(&name, &port, DC_COPIES, None).max(1) as u32,
        papers,
        trays: trays(&name, &port),
    }
}

impl PrinterCatalog for WindowsPrinters {
    fn list(&self) -> std::io::Result<Vec<PrinterInfo>> {
        let default = default_printer()?;
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed = 0u32;
        let mut count = 0u32;
        // SAFETY: 先只问要多大的缓冲
        let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut count) };
        if needed == 0 {
            return Ok(Vec::new());
        }
        for _ in 0..4 {
            let mut buffer = aligned(needed as usize);
            let bytes = as_bytes(&mut buffer);
            let size = needed as usize;
            // SAFETY: 缓冲按问到的大小分配并按指针对齐
            match unsafe { EnumPrintersW(flags, PCWSTR::null(), 2, Some(&mut bytes[..size]), &mut needed, &mut count) } {
                Ok(()) => {
                    // SAFETY: 缓冲里依次是 count 个 PRINTER_INFO_2W
                    let infos = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_2W>(), count as usize) };
                    return Ok(infos.iter().map(|info| info_of(info, default.as_deref(), None)).collect());
                }
                Err(error) if error.code() == ERROR_INSUFFICIENT_BUFFER.to_hresult() => continue,
                Err(error) => return Err(std::io::Error::other(error)),
            }
        }
        Err(std::io::Error::from_raw_os_error(ERROR_INSUFFICIENT_BUFFER.0 as i32))
    }

    fn get(&self, name: &str) -> std::io::Result<Option<PrinterInfo>> {
        let handle = match open(name) {
            Ok(handle) => handle,
            Err(ERROR_INVALID_PRINTER_NAME) => return Ok(None),
            Err(code) => return Err(std::io::Error::from_raw_os_error(code as i32)),
        };
        let mut needed = 0u32;
        // SAFETY: 先只问要多大的缓冲
        let _ = unsafe { GetPrinterW(handle.0, 2, None, &mut needed) };
        let mut buffer = aligned(needed as usize);
        let bytes = as_bytes(&mut buffer);
        // SAFETY: 缓冲按问到的大小分配并按指针对齐
        unsafe { GetPrinterW(handle.0, 2, Some(&mut bytes[..needed as usize]), &mut needed) }.map_err(std::io::Error::other)?;
        // SAFETY: 缓冲开头是一个 PRINTER_INFO_2W
        let info = unsafe { &*buffer.as_ptr().cast::<PRINTER_INFO_2W>() };
        let printer_name = text(info.pPrinterName).unwrap_or_else(|| name.to_owned());
        let capabilities = capabilities(&printer_name, text(info.pPortName).as_deref());
        Ok(Some(info_of(info, default_printer()?.as_deref(), Some(capabilities))))
    }

    fn default_printer_name(&self) -> std::io::Result<Option<String>> {
        default_printer()
    }
}

/// 一台打印机的纸张能力：试探纸张时照渲染引擎的写法，在驱动的缺省 DEVMODE 上设方向与纸张宽高，交给 DocumentProperties 合并，读驱动留下的纸张
struct WindowsPrinterPapers {
    handle: Handle,
    name: HSTRING,
    papers: Vec<PaperInfo>,
    trays: Vec<TrayInfo>,
    defaults: Option<Vec<u64>>,
}

/// 驱动的缺省 DEVMODE，按驱动要的两倍分配；读不出时为 None
fn default_devmode(handle: &Handle, name: &HSTRING) -> Option<Vec<u64>> {
    // SAFETY: 先只问 DEVMODE 的大小
    let size = unsafe { DocumentPropertiesW(None, handle.0, name, None, None, 0) };
    (size as usize >= std::mem::size_of::<DEVMODEW>())
        .then(|| aligned(size as usize * 2))
        .and_then(|mut buffer| {
            // SAFETY: 缓冲按驱动要的两倍分配
            let result = unsafe { DocumentPropertiesW(None, handle.0, name, Some(buffer.as_mut_ptr().cast()), None, DM_OUT_BUFFER.0) };
            (result >= 0).then_some(buffer)
        })
}

/// 把改过的 DEVMODE 交给驱动合并，返回驱动写出的完整 DEVMODE
fn merge_devmode(handle: &Handle, name: &HSTRING, input: &[u64]) -> Option<Vec<u64>> {
    let mut output = vec![0u64; input.len()];
    // SAFETY: 两个缓冲大小相同，都按驱动要的两倍分配
    let merged = unsafe {
        DocumentPropertiesW(
            None,
            handle.0,
            name,
            Some(output.as_mut_ptr().cast()),
            Some(input.as_ptr().cast()),
            DM_IN_BUFFER.0 | DM_OUT_BUFFER.0,
        )
    };
    (merged >= 0).then_some(output)
}

impl WindowsPrinterPapers {
    fn open(name: &str, papers: Vec<PaperInfo>, trays: Vec<TrayInfo>) -> Option<WindowsPrinterPapers> {
        let handle = open(name).ok()?;
        let name = HSTRING::from(name);
        let defaults = default_devmode(&handle, &name);
        Some(WindowsPrinterPapers {
            handle,
            name,
            papers,
            trays,
            defaults,
        })
    }
}

/// 由合并后的 DEVMODE 得出驱动留下的纸张：标了宽高的按宽高；否则按纸张号查驱动报的纸张；都没有时按填着的宽高；读不出时为 None
pub(crate) fn resolved_of(fields: u32, orientation: i16, paper_size: i16, width: i16, length: i16, papers: &[PaperInfo]) -> Option<PaperFeed> {
    let landscape = fields & DM_ORIENTATION.0 != 0 && orientation as u32 == DMORIENT_LANDSCAPE;
    let sized = width > 0 && length > 0;
    let size_fields = DM_PAPERWIDTH.0 | DM_PAPERLENGTH.0;
    if fields & size_fields == size_fields && sized {
        return Some(PaperFeed::new(f64::from(width) / 10.0, f64::from(length) / 10.0, landscape));
    }
    if fields & DM_PAPERSIZE.0 != 0
        && paper_size > 0
        && paper_size as u32 != DMPAPER_USER
        && let Some(known) = papers.iter().find(|paper| paper.id == i32::from(paper_size))
    {
        return Some(PaperFeed::new(known.width_mm, known.height_mm, landscape));
    }
    sized.then(|| PaperFeed::new(f64::from(width) / 10.0, f64::from(length) / 10.0, landscape))
}

impl PrinterPapers for WindowsPrinterPapers {
    fn papers(&self) -> &[PaperInfo] {
        &self.papers
    }

    fn trays(&self) -> &[TrayInfo] {
        &self.trays
    }

    fn resolve(&self, request: &PaperFeed) -> Option<PaperFeed> {
        let defaults = self.defaults.as_ref()?;
        let mut input = defaults.clone();
        // SAFETY: input 是驱动给的完整 DEVMODE 的副本，开头按 DEVMODEW 的布局
        unsafe {
            let mode = &mut *input.as_mut_ptr().cast::<DEVMODEW>();
            mode.dmFields |= DM_ORIENTATION | DM_PAPERWIDTH | DM_PAPERLENGTH;
            mode.Anonymous1.Anonymous1.dmOrientation = if request.landscape { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT } as i16;
            mode.Anonymous1.Anonymous1.dmPaperWidth = (request.width_mm * 10.0).round() as i16;
            mode.Anonymous1.Anonymous1.dmPaperLength = (request.height_mm * 10.0).round() as i16;
        }
        let output = merge_devmode(&self.handle, &self.name, &input)?;
        // SAFETY: output 由驱动写成完整的 DEVMODE
        let mode = unsafe { &*output.as_ptr().cast::<DEVMODEW>() };
        // SAFETY: 打印机的 DEVMODE 用的是联合体里的打印字段
        let print = unsafe { mode.Anonymous1.Anonymous1 };
        resolved_of(
            mode.dmFields.0,
            print.dmOrientation,
            print.dmPaperSize,
            print.dmPaperWidth,
            print.dmPaperLength,
            &self.papers,
        )
    }
}

impl PaperCatalog for WindowsPrinters {
    fn open(&self, printer: &str) -> Option<Box<dyn PrinterPapers>> {
        let info = self.get(printer).ok()??;
        let (papers, trays) = info.capabilities.map(|capabilities| (capabilities.papers, capabilities.trays)).unwrap_or_default();
        WindowsPrinterPapers::open(&info.name, papers, trays).map(|papers| Box::new(papers) as Box<dyn PrinterPapers>)
    }
}

/// 打印机报的纸张；查不到时为空
pub(crate) fn printer_papers(printer: &str) -> Vec<PaperInfo> {
    WindowsPrinters
        .get(printer)
        .ok()
        .flatten()
        .and_then(|info| info.capabilities)
        .map(|capabilities| capabilities.papers)
        .unwrap_or_default()
}

/// 驱动报的纸张里与这种放法同尺寸的一种的纸张号；没有时为 None
pub(crate) fn paper_id_for(papers: &[PaperInfo], feed: &PaperFeed) -> Option<i16> {
    papers
        .iter()
        .find(|paper| (paper.width_mm - feed.width_mm).abs() <= TOLERANCE_MM && (paper.height_mm - feed.height_mm).abs() <= TOLERANCE_MM)
        .and_then(|paper| i16::try_from(paper.id).ok())
        .filter(|id| *id > 0)
}

/// PDF 打印一个作业的 DEVMODE：在驱动的缺省设置上设纸张（驱动报过的用纸张号，否则按自定义宽高）、方向、纸盒、份数、逐份、双面与颜色，再交给驱动合并
pub(crate) fn job_devmode(printer: &str, feed: &PaperFeed, tray: Option<&TrayInfo>, options: &PrintOptions, papers: &[PaperInfo]) -> Result<Vec<u64>, JobError> {
    let handle = match open(printer) {
        Ok(handle) => handle,
        Err(ERROR_INVALID_PRINTER_NAME) => {
            return Err(JobError::failure(
                errors::PRINTER_NOT_FOUND,
                format!("没有这台打印机：{printer}"),
                Some(Details::new().with("printer", printer)),
            ));
        }
        Err(code) => return Err(failure("OpenPrinter", code)),
    };
    let name = HSTRING::from(printer);
    let mut input = default_devmode(&handle, &name).ok_or_else(|| failure("DocumentProperties", last_error()))?;
    // SAFETY: input 是驱动给的完整 DEVMODE，开头按 DEVMODEW 的布局；打印机的 DEVMODE 用的是联合体里的打印字段
    unsafe {
        let mode = &mut *input.as_mut_ptr().cast::<DEVMODEW>();
        mode.dmFields |= DM_ORIENTATION | DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH | DM_COPIES | DM_COLLATE | DM_DUPLEX | DM_COLOR;
        let print = &mut mode.Anonymous1.Anonymous1;
        print.dmOrientation = if feed.landscape { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT } as i16;
        print.dmPaperSize = paper_id_for(papers, feed).unwrap_or(DMPAPER_USER as i16);
        print.dmPaperWidth = (feed.width_mm * 10.0).round() as i16;
        print.dmPaperLength = (feed.height_mm * 10.0).round() as i16;
        print.dmCopies = options.copies.clamp(1, 999) as i16;
        if let Some(tray) = tray {
            mode.dmFields |= DM_DEFAULTSOURCE;
            mode.Anonymous1.Anonymous1.dmDefaultSource = tray.id as i16;
        }
        mode.dmCollate = if options.collate { DMCOLLATE_TRUE } else { DEVMODE_COLLATE(0) };
        mode.dmDuplex = match options.duplex {
            DuplexMode::LongEdge => DMDUP_VERTICAL,
            DuplexMode::ShortEdge => DMDUP_HORIZONTAL,
            DuplexMode::Simplex => DMDUP_SIMPLEX,
        };
        mode.dmColor = if options.color == ColorMode::Grayscale { DMCOLOR_MONOCHROME } else { DMCOLOR_COLOR };
    }
    merge_devmode(&handle, &name, &input).ok_or_else(|| failure("DocumentProperties", last_error()))
}

/// winspool 调用失败：SPOOL_FAILED，details 带调用名与系统错误码
fn failure(call: &str, error: u32) -> JobError {
    let message = match error {
        ERROR_INVALID_DATATYPE => "这台打印机的驱动不接受原始指令".to_owned(),
        0 => "打印机不再接收数据".to_owned(),
        _ => format!("打印池调用 {call} 失败：{}", std::io::Error::from_raw_os_error(error as i32)),
    };
    JobError::failure(errors::SPOOL_FAILED, message, Some(Details::new().with("call", call).with("win32Error", error)))
}

fn last_error() -> u32 {
    // SAFETY: 读本线程的最后错误
    unsafe { GetLastError() }.0
}

fn write_raw(printer: &str, data: &[u8], document_name: &str, cancel: &Cancel) -> Result<RawPrintResult, JobError> {
    let handle = match open(printer) {
        Ok(handle) => handle,
        Err(ERROR_INVALID_PRINTER_NAME) => {
            return Err(JobError::failure(
                errors::PRINTER_NOT_FOUND,
                format!("没有这台打印机：{printer}"),
                Some(Details::new().with("printer", printer)),
            ));
        }
        Err(code) => return Err(failure("OpenPrinter", code)),
    };
    let mut name: Vec<u16> = document_name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut datatype: Vec<u16> = "RAW".encode_utf16().chain(std::iter::once(0)).collect();
    let info = DOC_INFO_1W {
        pDocName: PWSTR(name.as_mut_ptr()),
        pOutputFile: PWSTR::null(),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
    };
    // SAFETY: info 里的字符串在调用期间有效
    let job = unsafe { StartDocPrinterW(handle.0, 1, &info) };
    if job == 0 {
        return Err(failure("StartDocPrinter", last_error()));
    }
    let result = (|| {
        // SAFETY: 文档已开始
        if !unsafe { StartPagePrinter(handle.0) }.as_bool() {
            return Err(failure("StartPagePrinter", last_error()));
        }
        let mut total = 0usize;
        while total < data.len() {
            if cancel.is_cancelled() {
                return Err(JobError::Cancelled);
            }
            let chunk = &data[total..(total + CHUNK_BYTES).min(data.len())];
            let mut written = 0u32;
            // SAFETY: chunk 在调用期间有效
            if !unsafe { WritePrinter(handle.0, chunk.as_ptr().cast(), chunk.len() as u32, &mut written) }.as_bool() {
                return Err(failure("WritePrinter", last_error()));
            }
            if written == 0 {
                return Err(failure("WritePrinter", 0));
            }
            total += written as usize;
        }
        // SAFETY: 页已开始
        if !unsafe { EndPagePrinter(handle.0) }.as_bool() {
            return Err(failure("EndPagePrinter", last_error()));
        }
        // SAFETY: 文档已开始
        if !unsafe { EndDocPrinter(handle.0) }.as_bool() {
            return Err(failure("EndDocPrinter", last_error()));
        }
        Ok(total as u64)
    })();
    match result {
        Ok(bytes) => Ok(RawPrintResult {
            bytes,
            spooled: SpoolTicket {
                printer: printer.to_owned(),
                document_name: document_name.to_owned(),
                system_job_id: Some(job),
            },
        }),
        Err(error) => {
            // SAFETY: 文档已开始，没写完时作废
            let _ = unsafe { AbortPrinter(handle.0) };
            Err(error)
        }
    }
}

impl RawPrinter for WindowsPrinters {
    fn write(&self, printer: String, data: Arc<Vec<u8>>, document_name: String, cancel: Cancel) -> BoxFuture<'static, Result<RawPrintResult, JobError>> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || write_raw(&printer, &data, &document_name, &cancel))
                .await
                .unwrap_or_else(|_| Err(JobError::failure(errors::INTERNAL, "客户端内部错误，详情见日志", None)))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_status_bits_with_offline_and_paused_first() {
        assert_eq!(state_of(0, 0), PrinterState::Ready);
        assert_eq!(state_of(STATUS_PAUSED | STATUS_PAPER_OUT, 0), PrinterState::Paused);
        assert_eq!(state_of(0, ATTRIBUTE_WORK_OFFLINE), PrinterState::Offline);
        assert_eq!(state_of(STATUS_PAPER_JAM | STATUS_ERROR, 0), PrinterState::PaperJam);
        assert_eq!(state_of(STATUS_DOOR_OPEN, 0), PrinterState::Error);
        assert_eq!(state_of(STATUS_PRINTING, 0), PrinterState::Busy);
        assert_eq!(state_of(STATUS_SERVER_UNKNOWN, 0), PrinterState::Unknown);
    }

    #[test]
    fn builds_trays_from_driver_tables() {
        let mut names = vec![0u16; BIN_NAME_LENGTH * 3];
        for (index, name) in ["自动选择", "Tray 2"].iter().enumerate() {
            let units: Vec<u16> = name.encode_utf16().collect();
            names[index * BIN_NAME_LENGTH..index * BIN_NAME_LENGTH + units.len()].copy_from_slice(&units);
        }
        let trays = trays_of(&[7, 260], &names);
        assert_eq!(
            trays,
            vec![
                TrayInfo {
                    id: 7, name: "自动选择".into()
                },
                TrayInfo { id: 260, name: "Tray 2".into() }
            ]
        );
        assert!(trays_of(&[7], &names[..BIN_NAME_LENGTH - 1]).is_empty());
    }

    #[test]
    fn finds_the_paper_number_of_a_listed_size() {
        let papers = vec![
            PaperInfo {
                id: 9,
                name: "A4".into(),
                width_mm: 210.0,
                height_mm: 297.0,
            },
            PaperInfo {
                id: 0,
                name: "零号".into(),
                width_mm: 100.0,
                height_mm: 60.0,
            },
        ];
        assert_eq!(paper_id_for(&papers, &PaperFeed::new(210.4, 296.8, true)), Some(9));
        assert_eq!(paper_id_for(&papers, &PaperFeed::new(100.0, 60.0, false)), None);
        assert_eq!(paper_id_for(&papers, &PaperFeed::new(148.0, 210.0, false)), None);
    }

    #[test]
    fn builds_papers_from_driver_tables() {
        let mut names = vec![0u16; PAPER_NAME_LENGTH * 2];
        for (index, name) in ["A4", "自定义"].iter().enumerate() {
            for (offset, unit) in name.encode_utf16().enumerate() {
                names[index * PAPER_NAME_LENGTH + offset] = unit;
            }
        }
        let papers = papers_of(&[9, 256, 3], &[2100, 2970, 1000, 1500], &names);
        assert_eq!(
            papers,
            vec![
                PaperInfo {
                    id: 9,
                    name: "A4".into(),
                    width_mm: 210.0,
                    height_mm: 297.0
                },
                PaperInfo {
                    id: 256,
                    name: "自定义".into(),
                    width_mm: 100.0,
                    height_mm: 150.0
                }
            ]
        );
    }

    #[test]
    fn reads_the_paper_the_driver_keeps() {
        let papers = vec![PaperInfo {
            id: 9,
            name: "A4".into(),
            width_mm: 210.0,
            height_mm: 297.0,
        }];
        let all = DM_ORIENTATION.0 | DM_PAPERWIDTH.0 | DM_PAPERLENGTH.0;
        assert_eq!(resolved_of(all, 2, 0, 1000, 700, &papers), Some(PaperFeed::new(100.0, 70.0, true)));
        assert_eq!(resolved_of(DM_PAPERSIZE.0, 1, 9, 0, 0, &papers), Some(PaperFeed::new(210.0, 297.0, false)));
        assert_eq!(resolved_of(0, 1, 0, 0, 0, &papers), None);
    }

    #[test]
    fn writes_raw_bytes_to_the_test_printer() {
        let (Ok(printer), Ok(output)) = (std::env::var("XIHAN_PRINT_TEST_PRINTER"), std::env::var("XIHAN_PRINT_TEST_OUTPUT")) else {
            eprintln!("没有配置测试打印机（XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT），跳过");
            return;
        };
        let _ = std::fs::remove_file(&output);
        let result = write_raw(&printer, b"^XA^FO50,50^FDXiHan^FS^XZ", "曦寒打印测试", &Cancel::new()).unwrap();
        assert_eq!(result.bytes, 25);
        assert!(result.spooled.system_job_id.is_some());
        for _ in 0..100 {
            if std::fs::metadata(&output).is_ok_and(|meta| meta.len() > 0) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert_eq!(std::fs::read(&output).unwrap(), b"^XA^FO50,50^FDXiHan^FS^XZ");
        assert!(matches!(write_raw("XiHan 不存在的打印机 7f3a", b"x", "x", &Cancel::new()), Err(JobError::Failure(error)) if error.code == errors::PRINTER_NOT_FOUND));
    }
}
