// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 授权窗口：靠屏幕右下角弹出，写明来源与静默打印，多个窗口依次往上错开；关掉窗口视为这次拒绝，到期时窗口自动关闭

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::consent::{ConsentChoice, ConsentPrompt};

const WIDTH: f64 = 420.0;
const HEIGHT: f64 = 236.0;
const GAP: f64 = 12.0;

pub(crate) struct Pending {
    origin: String,
    reply: Option<oneshot::Sender<ConsentChoice>>,
}

pub(crate) type Prompts = Arc<Mutex<HashMap<String, Pending>>>;

/// 授权窗口
pub(crate) struct WindowConsent {
    app: AppHandle,
    prompts: Prompts,
    next: AtomicU64,
}

impl WindowConsent {
    /// 以 Tauri 应用创建
    pub(crate) fn new(app: AppHandle) -> WindowConsent {
        let prompts: Prompts = Arc::default();
        app.manage(prompts.clone());
        WindowConsent {
            app,
            prompts,
            next: AtomicU64::new(1),
        }
    }

    fn open(&self, label: &str, stack: usize) -> tauri::Result<WebviewWindow> {
        let mut builder = WebviewWindowBuilder::new(&self.app, label, WebviewUrl::App("consent.html".into()))
            .title(xihan_print_client_core::defaults::PRODUCT_NAME)
            .inner_size(WIDTH, HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .focused(true);
        if let Some(monitor) = self.app.primary_monitor()? {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let right = f64::from(area.position.x) / scale + f64::from(area.size.width) / scale;
            let bottom = f64::from(area.position.y) / scale + f64::from(area.size.height) / scale;
            let top = f64::from(area.position.y) / scale;
            let y = (bottom - (HEIGHT + GAP + 32.0) * (stack as f64 + 1.0)).max(top);
            builder = builder.position(right - WIDTH - GAP, y);
        }
        builder.build()
    }
}

impl ConsentPrompt for WindowConsent {
    fn ask(&self, origin: &str, cancel: Cancel) -> BoxFuture<'static, Option<ConsentChoice>> {
        let label = format!("consent-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let (reply, answer) = oneshot::channel();
        let stack = {
            let mut prompts = self.prompts.lock().unwrap();
            prompts.insert(
                label.clone(),
                Pending {
                    origin: origin.to_owned(),
                    reply: Some(reply),
                },
            );
            prompts.len() - 1
        };
        let window = self.open(&label, stack);
        let prompts = self.prompts.clone();
        Box::pin(async move {
            let window = match window {
                Ok(window) => window,
                Err(_) => {
                    prompts.lock().unwrap().remove(&label);
                    return None;
                }
            };
            {
                let prompts = prompts.clone();
                let label = label.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed) {
                        answer_prompt(&prompts, &label, ConsentChoice::Deny);
                    }
                });
            }
            let choice = tokio::select! {
                choice = answer => choice.ok(),
                _ = cancel.cancelled() => None,
            };
            prompts.lock().unwrap().remove(&label);
            let _ = window.destroy();
            choice
        })
    }
}

fn answer_prompt(prompts: &Prompts, label: &str, choice: ConsentChoice) {
    if let Some(reply) = prompts.lock().unwrap().get_mut(label).and_then(|pending| pending.reply.take()) {
        let _ = reply.send(choice);
    }
}

/// 授权窗口要显示的内容
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConsentDetails {
    origin: String,
    timeout_seconds: u32,
}

/// 授权窗口取自己要问的来源
#[tauri::command]
pub(crate) fn consent_details(window: WebviewWindow, prompts: tauri::State<'_, Prompts>) -> Option<ConsentDetails> {
    prompts.lock().unwrap().get(window.label()).map(|pending| ConsentDetails {
        origin: pending.origin.clone(),
        timeout_seconds: 60,
    })
}

/// 授权窗口交回用户的选择：allow、once、deny、deny-always
#[tauri::command]
pub(crate) fn consent_answer(window: WebviewWindow, prompts: tauri::State<'_, Prompts>, choice: String) {
    let choice = match choice.as_str() {
        "allow" => ConsentChoice::Allow,
        "once" => ConsentChoice::AllowOnce,
        "deny-always" => ConsentChoice::DenyAlways,
        _ => ConsentChoice::Deny,
    };
    answer_prompt(&prompts, window.label(), choice);
}
