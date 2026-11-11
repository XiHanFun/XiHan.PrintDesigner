// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 曦寒打印客户端的托盘程序：组装 core 与 platform，提供托盘、主窗口、授权窗口与新版提示。
//! 开源版程序调用 `run(Extensions::default())`；收费版程序依赖这个库，在 [`Extensions`] 里登记自己的能力后调用同一个 `run`。

mod commands;
mod consent;
mod host;
mod http;
mod tray;
mod updates;
mod windows;

use std::sync::Arc;

use tauri::{Manager, RunEvent, Wry};
use xihan_print_client_core::printing::{CompletionTracker, JobObserver, RequestExtension};
use xihan_print_client_core::server::HandshakeGate;

pub use host::Host;
pub use xihan_print_client_core as core;
pub use xihan_print_client_platform as platform;

/// 主窗口里扩展登记的一页
#[derive(Clone, Debug, serde::Serialize)]
pub struct ExtensionPage {
    /// 页面标识，在主窗口的页签里唯一
    pub id: String,
    /// 页签上的名字
    pub title: String,
    /// 页面地址：扩展经自己注册的 xihan-ext 资源协议提供，如 xihan-ext://localhost/records.html（Windows 上为 http://xihan-ext.localhost/records.html）
    pub url: String,
}

/// 装进 Tauri 的插件：扩展自己的命令与资源协议
pub type PluginInstaller = Box<dyn FnOnce(tauri::Builder<Wry>) -> tauri::Builder<Wry> + Send>;

/// 客户端起来以后调用：扩展从这里取任务队列、服务与路径，加监听、读写自己的设置
pub type StartHook = Box<dyn FnOnce(&Arc<Host>) + Send>;

/// 诊断信息里扩展补充的一段：标题与各行
pub type DiagnosticsSection = Arc<dyn Fn() -> (String, Vec<String>) + Send + Sync>;

/// 扩展登记的能力；开源版全部为空
#[derive(Default)]
pub struct Extensions {
    /// 处理协议之外的消息类型
    pub requests: Vec<Arc<dyn RequestExtension>>,
    /// 任务观察者：受理与每次状态变化时通知
    pub observers: Vec<Arc<dyn JobObserver>>,
    /// 交给打印池之后跟踪作业直到打完
    pub tracker: Option<Arc<dyn CompletionTracker>>,
    /// 握手放行；缺省一律放行
    pub gate: Option<Arc<dyn HandshakeGate>>,
    /// 写进 welcome 的扩展能力名
    pub capabilities: Vec<String>,
    /// 主窗口里的扩展页
    pub pages: Vec<ExtensionPage>,
    /// Tauri 插件
    pub plugins: Vec<PluginInstaller>,
    /// 客户端起来以后调用
    pub on_start: Vec<StartHook>,
    /// 诊断信息的扩展段
    pub diagnostics: Vec<DiagnosticsSection>,
}

/// 启动托盘程序；已有实例在运行时，手动启动的把它的主窗口带到前台，开机自启的直接退出
pub fn run(mut extensions: Extensions) {
    #[cfg(windows)]
    use_fixed_webview2_runtime();
    let quiet = std::env::args().any(|argument| argument.eq_ignore_ascii_case(platform::autostart::ARGUMENT));
    let plugins = std::mem::take(&mut extensions.plugins);
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            if !arguments.iter().any(|argument| argument.eq_ignore_ascii_case(platform::autostart::ARGUMENT)) {
                windows::show_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    for plugin in plugins {
        builder = plugin(builder);
    }
    let app = builder
        .invoke_handler(tauri::generate_handler![
            commands::overview,
            commands::printers,
            commands::test_print,
            commands::origins,
            commands::forget_origin,
            commands::set_autostart,
            commands::set_check_for_updates,
            commands::set_log_level,
            commands::diagnostics_text,
            commands::export_diagnostics,
            commands::open_logs,
            commands::check_updates,
            commands::update_offer,
            commands::install_update,
            commands::open_update_window,
            commands::open_download,
            consent::consent_details,
            consent::consent_answer,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            app.manage(windows::Exiting::default());
            tray::create(&handle)?;
            tauri::async_runtime::spawn(async move {
                let host = Host::start(handle.clone(), extensions).await;
                handle.manage(host.clone());
                tray::refresh(&handle);
                if !quiet || !host.problems().is_empty() {
                    windows::show_main(&handle);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("建不了 Tauri 应用");
    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() && !app.state::<windows::Exiting>().is_set() {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            if let Some(host) = app.try_state::<Arc<Host>>() {
                tauri::async_runtime::block_on(host.stop());
            }
        }
        _ => {}
    });
}

/// 程序目录下装着 WebView2 固定版运行时、且没有另设 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 时，把它设成固定版运行时的目录，主窗口与渲染页都用这份运行时
#[cfg(windows)]
fn use_fixed_webview2_runtime() {
    const VARIABLE: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";
    if std::env::var_os(VARIABLE).is_some_and(|folder| !folder.is_empty()) {
        return;
    }
    if let Some(folder) = platform::fixed_webview2_runtime() {
        // SAFETY: 标准库保证 Windows 上不论单线程还是多线程程序，调用 set_var 都是安全的
        unsafe { std::env::set_var(VARIABLE, folder) };
    }
}
