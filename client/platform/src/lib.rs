// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 曦寒打印客户端的平台实现：Windows 上是 WebView2 渲染与 winspool 打印；macOS 与 Linux 上是 WebKit 渲染成 PDF、经 CUPS 下发。
//! 应用只经这里的函数取平台能力，不直接碰各平台模块。

pub mod autostart;

#[cfg(unix)]
mod unix;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::paths::AppPaths;
use xihan_print_client_core::printing::{HtmlPrintEngine, PaperCatalog, PrintDialog, PrinterCatalog, RawPrinter};
use xihan_print_client_core::time::Timestamp;

/// 操作系统：windows、macos、linux
pub fn os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// 处理器架构：x64、arm64，其余照 Rust 的写法
pub fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

/// 客户端在本机读写的目录与文件
pub fn app_paths() -> AppPaths {
    #[cfg(windows)]
    return windows::app_paths();
    #[cfg(target_os = "macos")]
    return macos::app_paths();
    #[cfg(target_os = "linux")]
    return linux::app_paths();
}

/// 某一时刻本地时间相对 UTC 的偏移，秒
pub fn local_offset(at: Timestamp) -> i32 {
    #[cfg(windows)]
    return windows::local_offset(at);
    #[cfg(unix)]
    return unix::local_offset(at);
}

/// 绑定监听：Windows 上先设独占地址，别的进程不能再绑同一端口
pub fn bind_listener(address: SocketAddr) -> std::io::Result<std::net::TcpListener> {
    #[cfg(windows)]
    return windows::bind_exclusive(address);
    #[cfg(unix)]
    return xihan_print_client_core::server::bind_default(address);
}

/// 本机打印：查打印机、下发前核对纸张、写原始指令
#[derive(Clone)]
pub struct Printing {
    /// 查打印机
    pub catalog: Arc<dyn PrinterCatalog>,
    /// 下发前核对纸张
    pub papers: Arc<dyn PaperCatalog>,
    /// 写原始指令；平台不支持时为 None
    pub raw: Option<Arc<dyn RawPrinter>>,
}

/// 取本机打印的实现；查不了打印机时给出原因
pub fn printing() -> Result<Printing, String> {
    #[cfg(windows)]
    return Ok(windows::printing());
    #[cfg(unix)]
    return unix::printing();
}

/// 渲染引擎的创建参数
#[derive(Clone)]
pub struct EngineOptions {
    /// 渲染引擎的数据目录，创建时清空
    pub data_directory: PathBuf,
    /// 下发前核对纸张
    pub papers: Arc<dyn PaperCatalog>,
    /// 系统打印对话框；为 None 时不支持 dialog 选项
    pub dialog: Option<Arc<dyn PrintDialog>>,
    /// 载入文档到就绪的期限，超过时报 RENDER_TIMEOUT；应用用 defaults::RENDER_TIMEOUT
    pub render_timeout: Duration,
    /// 日志
    pub log: SharedLog,
}

/// 建 HTML 通道的渲染引擎；在任意线程上调用，引擎内部自己转到要求的线程。不可用时给出写给用户看的原因
pub async fn create_engine(options: EngineOptions) -> Result<Arc<dyn HtmlPrintEngine>, String> {
    #[cfg(windows)]
    return windows::create_engine(options).await;
    #[cfg(target_os = "macos")]
    return macos::create_engine(options).await;
    #[cfg(target_os = "linux")]
    return linux::create_engine(options).await;
}

/// 系统打印对话框；平台没有时为 None
pub fn print_dialog() -> Option<Arc<dyn PrintDialog>> {
    #[cfg(windows)]
    return Some(windows::print_dialog());
    #[cfg(unix)]
    return None;
}

/// 签名校验的结论
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignatureState {
    /// 签名可信，签名者是预期的发布者
    Trusted,
    /// 文件没有签名
    Unsigned,
    /// 有签名但不可信：证书链、时间戳或吊销检查没通过，或文件被改过
    Untrusted(i32),
    /// 签名可信，但签名者不是预期的发布者
    WrongPublisher(String),
    /// 这个平台不校验安装包的签名
    Unsupported,
}

/// 校验安装包的签名与签名者（证书的 CN 或 O）
pub fn verify_installer(path: &Path, publisher: &str) -> SignatureState {
    #[cfg(windows)]
    return windows::authenticode::verify(path, publisher);
    #[cfg(unix)]
    {
        let _ = (path, publisher);
        SignatureState::Unsupported
    }
}

/// 静默运行安装包：装完启动客户端；平台不支持自动安装时返回错误
pub fn launch_installer(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    return windows::launch_installer(path);
    #[cfg(unix)]
    {
        let _ = path;
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "这个平台不自动安装新版"))
    }
}
