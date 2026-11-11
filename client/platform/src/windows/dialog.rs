// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 系统打印对话框：以请求的打印机、份数、逐份、双面、颜色与页码为初值，在自己的 STA 线程上弹出；
//! 所有者是屏幕中央置顶的小窗，对话框出现在浏览器前面；令牌取消时替用户点「取消」

use std::sync::Arc;
use std::sync::atomic::{AtomicIsize, Ordering};

use tokio::sync::oneshot;
use windows::Win32::Foundation::{GlobalFree, HGLOBAL, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    DEVMODE_COLLATE, DEVMODEW, DM_COLLATE, DM_COLOR, DM_COPIES, DM_DUPLEX, DM_OUT_BUFFER, DMCOLLATE_TRUE, DMCOLOR_COLOR, DMCOLOR_MONOCHROME, DMDUP_HORIZONTAL, DMDUP_SIMPLEX,
    DMDUP_VERTICAL,
};
use windows::Win32::Graphics::Printing::{ClosePrinter, DocumentPropertiesW, OpenPrinterW, PRINTER_HANDLE};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock};
use windows::Win32::UI::Controls::Dialogs::{
    DEVNAMES, PD_COLLATE, PD_NOCURRENTPAGE, PD_NOSELECTION, PD_PAGENUMS, PD_RESULT_PRINT, PD_USEDEVMODECOPIESANDCOLLATE, PRINTDLGEXW, PRINTPAGERANGE, PrintDlgExW,
    START_PAGE_GENERAL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GW_ENABLEDPOPUP, GetSystemMetrics, GetWindow, PostMessageW, RegisterClassW, SM_CXSCREEN, SM_CYSCREEN, SW_SHOWNA,
    SetForegroundWindow, ShowWindow, WM_COMMAND, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};
use windows::core::{HSTRING, w};
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::printing::{PrintDialog, PrintDialogChoice};
use xihan_print_client_core::protocol::{ColorMode, DuplexMode, PrintOptions};

const MAX_RANGES: usize = 32;
const CANCEL_COMMAND: usize = 2;

/// 系统打印对话框
pub(crate) struct SystemPrintDialog;

impl PrintDialog for SystemPrintDialog {
    fn ask(&self, printer: String, options: PrintOptions, sheet_count: u32, cancel: Cancel) -> BoxFuture<'static, Option<PrintDialogChoice>> {
        Box::pin(async move {
            let owner = Arc::new(AtomicIsize::new(0));
            let (reply, answer) = oneshot::channel();
            let shared = owner.clone();
            let started = std::thread::Builder::new().name("print-dialog".into()).spawn(move || {
                let _ = reply.send(show(&printer, &options, sheet_count, &shared));
            });
            if started.is_err() {
                return None;
            }
            tokio::pin!(answer);
            tokio::select! {
                choice = &mut answer => choice.ok().flatten(),
                _ = cancel.cancelled() => {
                    cancel_dialog(owner.load(Ordering::Acquire));
                    let _ = answer.await;
                    None
                }
            }
        })
    }
}

/// 给所有者名下正开着的那个对话框发「取消」
fn cancel_dialog(owner: isize) {
    if owner == 0 {
        return;
    }
    // SAFETY: owner 是对话框线程建的窗口；只发消息不等结果
    unsafe {
        if let Ok(dialog) = GetWindow(HWND(owner as _), GW_ENABLEDPOPUP)
            && dialog.0 as isize != owner
        {
            let _ = PostMessageW(Some(dialog), WM_COMMAND, WPARAM(CANCEL_COMMAND), LPARAM(0));
        }
    }
}

/// 页码范围写成对话框的页段；写法不对时为空
pub(crate) fn ranges_of(text: Option<&str>, sheet_count: u32) -> Vec<(u32, u32)> {
    let Some(text) = text else {
        return Vec::new();
    };
    text.split(',')
        .filter_map(|part| {
            let mut bounds = part.split('-');
            let first: u32 = bounds.next()?.parse().ok()?;
            let last: u32 = bounds.next().map_or(Some(first), |last| last.parse().ok())?;
            (first >= 1 && first <= sheet_count).then_some((first, last.clamp(first, sheet_count)))
        })
        .take(MAX_RANGES)
        .collect()
}

/// 对话框的页段写回页码范围
pub(crate) fn ranges_text(ranges: &[(u32, u32)]) -> Option<String> {
    (!ranges.is_empty()).then(|| {
        ranges
            .iter()
            .map(|(first, last)| if first == last { first.to_string() } else { format!("{first}-{last}") })
            .collect::<Vec<_>>()
            .join(",")
    })
}

fn show(printer: &str, options: &PrintOptions, sheet_count: u32, owner_cell: &AtomicIsize) -> Option<PrintDialogChoice> {
    // SAFETY: 本线程只为这一次对话框服务：STA、所有者窗口、全局内存都在本函数里建、本函数里释放
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let owner = create_owner()?;
        owner_cell.store(owner.0 as isize, Ordering::Release);
        let devmode = initial_devmode(printer, options);
        let devnames = devnames(printer);
        let mut ranges = [PRINTPAGERANGE::default(); MAX_RANGES];
        let preset = ranges_of(options.page_ranges.as_deref(), sheet_count);
        for (slot, (first, last)) in ranges.iter_mut().zip(&preset) {
            *slot = PRINTPAGERANGE {
                nFromPage: *first,
                nToPage: *last,
            };
        }
        let mut flags = PD_NOSELECTION | PD_NOCURRENTPAGE | PD_USEDEVMODECOPIESANDCOLLATE;
        if !preset.is_empty() {
            flags |= PD_PAGENUMS;
        }
        if options.collate {
            flags |= PD_COLLATE;
        }
        let mut dialog = PRINTDLGEXW {
            lStructSize: std::mem::size_of::<PRINTDLGEXW>() as u32,
            hwndOwner: owner,
            hDevMode: devmode.unwrap_or_default(),
            hDevNames: devnames.unwrap_or_default(),
            Flags: flags,
            nPageRanges: preset.len() as u32,
            nMaxPageRanges: MAX_RANGES as u32,
            lpPageRanges: ranges.as_mut_ptr(),
            nMinPage: 1,
            nMaxPage: sheet_count.max(1),
            nCopies: options.copies,
            nStartPage: START_PAGE_GENERAL,
            ..Default::default()
        };
        let shown = PrintDlgExW(&mut dialog);
        owner_cell.store(0, Ordering::Release);
        let _ = DestroyWindow(owner);
        let choice = if shown.is_ok() && dialog.dwResultAction == PD_RESULT_PRINT {
            Some(choice_of(&dialog, &ranges, printer, options))
        } else {
            None
        };
        for memory in [dialog.hDevMode, dialog.hDevNames] {
            if !memory.is_invalid() {
                let _ = GlobalFree(Some(memory));
            }
        }
        choice
    }
}

/// 读对话框里选定的打印机与选项
///
/// # Safety
/// dialog 是 PrintDlgExW 填好的结果
unsafe fn choice_of(dialog: &PRINTDLGEXW, ranges: &[PRINTPAGERANGE], printer: &str, options: &PrintOptions) -> PrintDialogChoice {
    // SAFETY: 由调用方保证 dialog 里的全局内存有效
    unsafe {
        let chosen = read_devnames(dialog.hDevNames).unwrap_or_else(|| printer.to_owned());
        let mut result = options.clone();
        result.dialog = false;
        result.page_ranges = if dialog.Flags.contains(PD_PAGENUMS) {
            ranges_text(
                &ranges[..dialog.nPageRanges as usize]
                    .iter()
                    .map(|range| (range.nFromPage, range.nToPage))
                    .collect::<Vec<_>>(),
            )
        } else {
            None
        };
        if let Some(mode) = read_devmode(dialog.hDevMode) {
            if mode.dmFields.contains(DM_COPIES) {
                result.copies = u32::try_from(mode.Anonymous1.Anonymous1.dmCopies).unwrap_or(1).clamp(1, 999);
            }
            if mode.dmFields.contains(DM_COLLATE) {
                result.collate = mode.dmCollate == DMCOLLATE_TRUE;
            }
            if mode.dmFields.contains(DM_DUPLEX) {
                result.duplex = match mode.dmDuplex {
                    DMDUP_VERTICAL => DuplexMode::LongEdge,
                    DMDUP_HORIZONTAL => DuplexMode::ShortEdge,
                    _ => DuplexMode::Simplex,
                };
            }
            if mode.dmFields.contains(DM_COLOR) {
                result.color = if mode.dmColor == DMCOLOR_MONOCHROME { ColorMode::Grayscale } else { ColorMode::Color };
            }
        } else {
            result.copies = dialog.nCopies.clamp(1, 999);
            result.collate = dialog.Flags.contains(PD_COLLATE);
        }
        PrintDialogChoice { printer: chosen, options: result }
    }
}

/// 屏幕中央置顶的 1×1 小窗，作对话框的所有者
///
/// # Safety
/// 在对话框线程上调用
unsafe fn create_owner() -> Option<HWND> {
    // SAFETY: 由调用方保证在对话框线程上
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(owner_proc),
            hInstance: instance.into(),
            lpszClassName: w!("XiHanPrintDialogOwner"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let x = GetSystemMetrics(SM_CXSCREEN) / 2;
        let y = GetSystemMetrics(SM_CYSCREEN) / 2;
        let owner = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            w!("XiHanPrintDialogOwner"),
            w!(""),
            WS_POPUP,
            x,
            y,
            1,
            1,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .ok()?;
        let _ = ShowWindow(owner, SW_SHOWNA);
        let _ = SetForegroundWindow(owner);
        Some(owner)
    }
}

extern "system" fn owner_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> windows::Win32::Foundation::LRESULT {
    // SAFETY: 所有者窗口的消息都交给缺省处理
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

/// 驱动的缺省 DEVMODE 上设好份数、逐份、双面与颜色，放进可移动的全局内存
///
/// # Safety
/// 在对话框线程上调用
unsafe fn initial_devmode(printer: &str, options: &PrintOptions) -> Option<HGLOBAL> {
    let name = HSTRING::from(printer);
    let mut handle = PRINTER_HANDLE::default();
    // SAFETY: 由调用方保证在对话框线程上；句柄在本函数里关闭
    unsafe {
        OpenPrinterW(&name, &mut handle, None).ok()?;
        let size = DocumentPropertiesW(None, handle, &name, None, None, 0);
        let memory = (size > 0).then(|| GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size as usize * 2).ok()).flatten();
        let filled = memory.and_then(|memory| {
            let mode = GlobalLock(memory).cast::<DEVMODEW>();
            if mode.is_null() {
                return None;
            }
            let written = DocumentPropertiesW(None, handle, &name, Some(mode), None, DM_OUT_BUFFER.0) >= 0;
            if written {
                let mode = &mut *mode;
                mode.dmFields |= DM_COPIES | DM_COLLATE | DM_DUPLEX | DM_COLOR;
                mode.Anonymous1.Anonymous1.dmCopies = options.copies as i16;
                mode.dmCollate = if options.collate { DMCOLLATE_TRUE } else { DEVMODE_COLLATE(0) };
                mode.dmDuplex = match options.duplex {
                    DuplexMode::LongEdge => DMDUP_VERTICAL,
                    DuplexMode::ShortEdge => DMDUP_HORIZONTAL,
                    DuplexMode::Simplex => DMDUP_SIMPLEX,
                };
                mode.dmColor = if options.color == ColorMode::Grayscale { DMCOLOR_MONOCHROME } else { DMCOLOR_COLOR };
            }
            let _ = GlobalUnlock(memory);
            written.then_some(memory)
        });
        let _ = ClosePrinter(handle);
        filled
    }
}

/// 只写打印机名的 DEVNAMES，放进可移动的全局内存
///
/// # Safety
/// 在对话框线程上调用
unsafe fn devnames(printer: &str) -> Option<HGLOBAL> {
    let header = std::mem::size_of::<DEVNAMES>() / 2;
    let name: Vec<u16> = printer.encode_utf16().collect();
    let total = header + 1 + name.len() + 1 + 1;
    // SAFETY: 由调用方保证在对话框线程上；内存按总长分配并清零
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total * 2).ok()?;
        let base = GlobalLock(memory).cast::<u16>();
        if base.is_null() {
            return None;
        }
        let names = &mut *base.cast::<DEVNAMES>();
        names.wDriverOffset = header as u16;
        names.wDeviceOffset = (header + 1) as u16;
        names.wOutputOffset = (header + 1 + name.len() + 1) as u16;
        std::ptr::copy_nonoverlapping(name.as_ptr(), base.add(header + 1), name.len());
        let _ = GlobalUnlock(memory);
        Some(memory)
    }
}

/// # Safety
/// memory 是对话框给回的 DEVNAMES
unsafe fn read_devnames(memory: HGLOBAL) -> Option<String> {
    if memory.is_invalid() {
        return None;
    }
    // SAFETY: 由调用方保证 memory 是 DEVNAMES
    unsafe {
        let base = GlobalLock(memory).cast::<u16>();
        if base.is_null() {
            return None;
        }
        let offset = (*base.cast::<DEVNAMES>()).wDeviceOffset as usize;
        let start = base.add(offset);
        let mut length = 0;
        while *start.add(length) != 0 {
            length += 1;
        }
        let name = String::from_utf16_lossy(std::slice::from_raw_parts(start, length));
        let _ = GlobalUnlock(memory);
        (!name.is_empty()).then_some(name)
    }
}

/// # Safety
/// memory 是对话框给回的 DEVMODE
unsafe fn read_devmode(memory: HGLOBAL) -> Option<DEVMODEW> {
    if memory.is_invalid() {
        return None;
    }
    // SAFETY: 由调用方保证 memory 是 DEVMODE，只读开头的公共部分
    unsafe {
        let mode = GlobalLock(memory).cast::<DEVMODEW>();
        if mode.is_null() {
            return None;
        }
        let copy = *mode;
        let _ = GlobalUnlock(memory);
        Some(copy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_page_ranges_both_ways() {
        assert_eq!(ranges_of(Some("1-3,5,9-20"), 10), vec![(1, 3), (5, 5), (9, 10)]);
        assert_eq!(ranges_of(Some("11"), 10), Vec::<(u32, u32)>::new());
        assert_eq!(ranges_of(None, 10), Vec::<(u32, u32)>::new());
        assert_eq!(ranges_text(&[(1, 3), (5, 5)]).as_deref(), Some("1-3,5"));
        assert_eq!(ranges_text(&[]), None);
    }
}
