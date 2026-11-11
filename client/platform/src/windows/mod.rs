// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! Windows：WebView2 渲染、winspool 打印、系统打印对话框、注册表开机自启、Authenticode 校验

pub(crate) mod authenticode;
pub(crate) mod autostart;
mod dialog;
mod engine;
mod render;
mod winspool;

#[cfg(test)]
mod engine_tests;

use std::net::SocketAddr;
use std::os::windows::io::FromRawSocket;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use windows::Win32::Foundation::SYSTEMTIME;
use windows::Win32::Networking::WinSock::{
    self, AF_INET, AF_INET6, INVALID_SOCKET, IPPROTO_TCP, SO_EXCLUSIVEADDRUSE, SOCK_STREAM, SOCKADDR, SOCKADDR_IN, SOCKADDR_IN6, SOL_SOCKET, SOMAXCONN, WSADATA, WSAStartup, bind,
    closesocket, listen, setsockopt, socket,
};
use windows::Win32::System::Time::SystemTimeToTzSpecificLocalTimeEx;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, PCWSTR};
use xihan_print_client_core::paths::AppPaths;
use xihan_print_client_core::printing::{HtmlPrintEngine, PrintDialog};
use xihan_print_client_core::time::Timestamp;

use crate::{EngineOptions, Printing};

const VENDOR: &str = "XiHanFun";
const PRODUCT: &str = "PrintClient";

/// 运行安装包时附带的参数：静默安装、不重启系统、装完启动客户端
pub(crate) const INSTALLER_ARGUMENTS: &str = "/SILENT /SUPPRESSMSGBOXES /NORESTART /LAUNCH";

/// 设置在 %AppData%，日志、渲染数据、更新与扩展数据在 %LocalAppData%，策略在 %ProgramData%，都在 XiHanFun\PrintClient 下
pub(crate) fn app_paths() -> AppPaths {
    let root = |name: &str, fallback: &str| PathBuf::from(std::env::var_os(name).unwrap_or_else(|| fallback.into())).join(VENDOR).join(PRODUCT);
    let roaming = root("APPDATA", ".");
    let local = root("LOCALAPPDATA", ".");
    let machine = root("ProgramData", "C:\\ProgramData");
    AppPaths {
        settings_directory: roaming,
        log_directory: local.join("logs"),
        renderer_data_directory: local.join("webview"),
        update_directory: local.join("updates"),
        data_directory: local.join("data"),
        policy_file: machine.join("policy.json"),
    }
}

/// 某一时刻本地时间相对 UTC 的偏移，秒：按系统当前时区与那一刻是否在夏令时算
pub(crate) fn local_offset(at: Timestamp) -> i32 {
    let utc = system_time(at, 0);
    let mut local = SYSTEMTIME::default();
    // SAFETY: utc 与 local 都是本函数里的有效内存；不传时区时用系统当前时区
    if unsafe { SystemTimeToTzSpecificLocalTimeEx(None, &utc, &mut local) }.is_err() {
        return 0;
    }
    let seconds = |time: &SYSTEMTIME| {
        let days = xihan_print_client_core::time::days_from_civil(i64::from(time.wYear), u32::from(time.wMonth), u32::from(time.wDay));
        days * 86_400 + i64::from(time.wHour) * 3600 + i64::from(time.wMinute) * 60 + i64::from(time.wSecond)
    };
    (seconds(&local) - seconds(&utc)) as i32
}

fn system_time(at: Timestamp, offset: i32) -> SYSTEMTIME {
    let civil = at.civil(offset);
    SYSTEMTIME {
        wYear: civil.year as u16,
        wMonth: civil.month as u16,
        wDayOfWeek: 0,
        wDay: civil.day as u16,
        wHour: civil.hour as u16,
        wMinute: civil.minute as u16,
        wSecond: civil.second as u16,
        wMilliseconds: civil.millisecond as u16,
    }
}

/// 先设独占地址再绑定并监听，别的进程不能再绑同一端口
pub(crate) fn bind_exclusive(address: SocketAddr) -> std::io::Result<std::net::TcpListener> {
    let mut data = WSADATA::default();
    // SAFETY: data 是有效的输出缓冲；WSAStartup 按引用计数，多次调用无害
    let started = unsafe { WSAStartup(0x0202, &mut data) };
    if started != 0 {
        return Err(std::io::Error::from_raw_os_error(started));
    }
    let family = if address.is_ipv4() { AF_INET } else { AF_INET6 };
    // SAFETY: 参数都是常量
    let handle = unsafe { socket(i32::from(family.0), SOCK_STREAM, IPPROTO_TCP.0) }.map_err(std::io::Error::other)?;
    if handle == INVALID_SOCKET {
        return Err(std::io::Error::last_os_error());
    }
    let fail = |handle| {
        let error = std::io::Error::from_raw_os_error(unsafe { WinSock::WSAGetLastError() }.0);
        // SAFETY: handle 是本函数建的套接字，失败时关掉
        unsafe { closesocket(handle) };
        error
    };
    let exclusive = 1i32.to_ne_bytes();
    // SAFETY: handle 有效，选项值是 4 字节整数
    if unsafe { setsockopt(handle, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, Some(&exclusive)) } != 0 {
        return Err(fail(handle));
    }
    let bound = match address {
        SocketAddr::V4(v4) => {
            let mut name = SOCKADDR_IN {
                sin_family: AF_INET,
                sin_port: v4.port().to_be(),
                ..Default::default()
            };
            name.sin_addr.S_un.S_addr = u32::from_ne_bytes(v4.ip().octets());
            // SAFETY: name 在调用期间有效，长度与类型一致
            unsafe { bind(handle, &name as *const SOCKADDR_IN as *const SOCKADDR, std::mem::size_of::<SOCKADDR_IN>() as i32) }
        }
        SocketAddr::V6(v6) => {
            let mut name = SOCKADDR_IN6 {
                sin6_family: AF_INET6,
                sin6_port: v6.port().to_be(),
                ..Default::default()
            };
            name.sin6_addr.u.Byte = v6.ip().octets();
            // SAFETY: name 在调用期间有效，长度与类型一致
            unsafe { bind(handle, &name as *const SOCKADDR_IN6 as *const SOCKADDR, std::mem::size_of::<SOCKADDR_IN6>() as i32) }
        }
    };
    // SAFETY: handle 已绑定
    if bound != 0 || unsafe { listen(handle, SOMAXCONN as i32) } != 0 {
        return Err(fail(handle));
    }
    // SAFETY: handle 是本函数建好、已在监听的套接字，交给 TcpListener 管理
    let listener = unsafe { std::net::TcpListener::from_raw_socket(handle.0 as u64) };
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// winspool 的打印机查询、纸张核对与原始指令
pub(crate) fn printing() -> Printing {
    let printers = Arc::new(winspool::WindowsPrinters);
    Printing {
        catalog: printers.clone(),
        papers: printers.clone(),
        raw: Some(printers),
    }
}

/// 建 WebView2 渲染引擎；没有 WebView2 运行时时给出原因
pub(crate) async fn create_engine(options: EngineOptions) -> Result<Arc<dyn HtmlPrintEngine>, String> {
    let engine = engine::WebView2Engine::create(options).await?;
    Ok(Arc::new(engine))
}

/// 系统打印对话框
pub(crate) fn print_dialog() -> Arc<dyn PrintDialog> {
    Arc::new(dialog::SystemPrintDialog)
}

/// 静默运行安装包，装完启动客户端
pub(crate) fn launch_installer(path: &Path) -> std::io::Result<()> {
    let file = HSTRING::from(path.as_os_str());
    let arguments = HSTRING::from(INSTALLER_ARGUMENTS);
    // SAFETY: 字符串在调用期间有效
    let result = unsafe { ShellExecuteW(None, &HSTRING::from("open"), &file, &arguments, PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize > 32 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_the_directories_under_the_vendor_folder() {
        let paths = app_paths();
        assert!(paths.settings_directory.ends_with("XiHanFun\\PrintClient"));
        assert!(paths.log_directory.ends_with("XiHanFun\\PrintClient\\logs"));
        assert!(paths.policy_file.ends_with("XiHanFun\\PrintClient\\policy.json"));
    }

    #[test]
    fn binds_a_port_exclusively() {
        let first = bind_exclusive("127.0.0.1:0".parse().unwrap()).unwrap();
        let address = first.local_addr().unwrap();
        assert!(bind_exclusive(address).is_err());
        assert!(std::net::TcpListener::bind(address).is_err());
    }
}
