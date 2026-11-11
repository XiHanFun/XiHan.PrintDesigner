// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! Linux：目录按 XDG 约定，开机自启是 XDG autostart 里的 .desktop，HTML 通道用 WebKitGTK 渲染成 PDF、经 CUPS 下发

pub(crate) mod autostart;
mod gtk_ffi;
mod page;
mod pdf;
mod render;

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::Arc;

use xihan_print_client_core::paths::AppPaths;
use xihan_print_client_core::printing::HtmlPrintEngine;

use crate::unix::{PdfPipelineEngine, open_cups};

/// 管理员下发的策略文件
const POLICY_FILE: &str = "/etc/xihanfun/print-client/policy.json";

/// 本客户端在各 XDG 目录下的子目录
const APP_DIRECTORY: [&str; 2] = ["xihanfun", "print-client"];

/// 客户端在本机读写的目录与文件：设置在 $XDG_CONFIG_HOME，日志在 $XDG_STATE_HOME，渲染数据与更新在 $XDG_CACHE_HOME，扩展数据在 $XDG_DATA_HOME
pub(crate) fn app_paths() -> AppPaths {
    let app = |base: PathBuf| APP_DIRECTORY.iter().fold(base, |path, part| path.join(part));
    let cache = app(xdg_directory("XDG_CACHE_HOME", ".cache"));
    AppPaths {
        settings_directory: app(xdg_directory("XDG_CONFIG_HOME", ".config")),
        log_directory: app(xdg_directory("XDG_STATE_HOME", ".local/state")).join("logs"),
        renderer_data_directory: cache.join("webkit"),
        update_directory: cache.join("updates"),
        data_directory: app(xdg_directory("XDG_DATA_HOME", ".local/share")),
        policy_file: PathBuf::from(POLICY_FILE),
    }
}

/// XDG 基础目录：环境变量是绝对路径时用它，否则用主目录下的缺省位置
pub(crate) fn xdg_directory(variable: &str, fallback: &str) -> PathBuf {
    match std::env::var_os(variable).map(PathBuf::from).filter(|path| path.is_absolute()) {
        Some(path) => path,
        None => home_directory().join(fallback),
    }
}

/// 当前用户的主目录：$HOME，没有时取用户数据库里的记录
fn home_directory() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) {
        return PathBuf::from(home);
    }
    let mut buffer = vec![0 as libc::c_char; 16 * 1024];
    // SAFETY: passwd 是本函数里的有效内存，全 0 是合法的初值
    let mut passwd: libc::passwd = unsafe { std::mem::zeroed() };
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: 各指针都指向本函数里的有效内存，缓冲区长度如实传入
    let status = unsafe { libc::getpwuid_r(libc::getuid(), &mut passwd, buffer.as_mut_ptr(), buffer.len(), &mut result) };
    if status == 0 && !result.is_null() && !passwd.pw_dir.is_null() {
        // SAFETY: pw_dir 指向 buffer 里以 0 结尾的字符串
        let directory = unsafe { std::ffi::CStr::from_ptr(passwd.pw_dir) };
        return PathBuf::from(OsStr::from_bytes(directory.to_bytes()));
    }
    PathBuf::from("/")
}

/// 建 WebKitGTK 渲染器与 CUPS 打印组成的 HTML 通道；CUPS 不可用时只能导出 PDF。WebKitGTK 不可用时给出写给用户看的原因
pub(crate) async fn create_engine(options: crate::EngineOptions) -> Result<Arc<dyn HtmlPrintEngine>, String> {
    let renderer = render::WebKitRenderer::create(options.data_directory.clone(), options.log.clone()).await?;
    options.log.info(&format!("渲染引擎 WebKitGTK {}", renderer.version_text()));
    let cups = match open_cups() {
        Ok(cups) => Some(cups),
        Err(reason) => {
            options.log.warn(&format!("{reason}；HTML 通道只能导出 PDF，不能打印"));
            None
        }
    };
    Ok(Arc::new(PdfPipelineEngine::new(Arc::new(renderer), cups, options)))
}
