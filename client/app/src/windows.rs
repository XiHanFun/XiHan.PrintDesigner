// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 主窗口与新版提示窗口：按需建出，关闭主窗口只是藏回托盘

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use xihan_print_client_core::defaults::PRODUCT_NAME;

/// 用户选了退出：之后不再拦退出
#[derive(Default)]
pub(crate) struct Exiting(AtomicBool);

impl Exiting {
    /// 是否已选了退出
    pub(crate) fn is_set(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// 退出客户端
pub(crate) fn exit(app: &AppHandle) {
    app.state::<Exiting>().0.store(true, Ordering::Release);
    app.exit(0);
}

/// 显示主窗口并带到前台；可指定打开哪一页
pub(crate) fn show_main_at(app: &AppHandle, page: Option<&str>) {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let url = match page {
                Some(page) => format!("index.html#{page}"),
                None => "index.html".to_owned(),
            };
            let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
                .title(PRODUCT_NAME)
                .inner_size(920.0, 640.0)
                .min_inner_size(720.0, 480.0)
                .center()
                .build();
            let Ok(window) = built else {
                return;
            };
            let hidden = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
            window
        }
    };
    if let Some(page) = page {
        let _ = window.emit("navigate", page);
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 显示主窗口
pub(crate) fn show_main(app: &AppHandle) {
    show_main_at(app, None);
}

/// 显示新版提示窗口
pub(crate) fn show_update(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("update") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "update", WebviewUrl::App("update.html".into()))
        .title(format!("{PRODUCT_NAME} 新版本"))
        .inner_size(480.0, 400.0)
        .resizable(false)
        .center()
        .build();
}

/// 通知所有窗口某样东西变了
pub(crate) fn notify(app: &AppHandle, event: &str) {
    let _ = app.emit(event, ());
}
