// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 托盘图标与菜单：首行写版本与端口，其下是主窗口、诊断、日志、测试打印、检查更新、开机自启与退出

use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use xihan_print_client_core::defaults::PRODUCT_NAME;
use xihan_print_client_core::protocol::PrinterInfo;
use xihan_print_client_core::updates::UpdateTrigger;
use xihan_print_client_platform as platform;

use crate::host::{Host, VERSION};

const TRAY: &str = "main";

/// 上次刷新托盘菜单的时间，悬停时最多每 5 秒刷新一次
#[derive(Default)]
struct LastRefresh(Mutex<Option<Instant>>);

/// 建托盘图标；菜单在客户端起来后由 refresh 填满
pub(crate) fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(LastRefresh::default());
    let menu = build(app, &[], None)?;
    let mut builder = TrayIconBuilder::with_id(TRAY)
        .tooltip(PRODUCT_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                crate::windows::show_main(tray.app_handle());
            }
            TrayIconEvent::Enter { .. } => {
                let app = tray.app_handle();
                let due = {
                    let last = app.state::<LastRefresh>();
                    let mut last = last.0.lock().unwrap();
                    let due = last.is_none_or(|at| at.elapsed() > Duration::from_secs(5));
                    if due {
                        *last = Some(Instant::now());
                    }
                    due
                };
                if due {
                    refresh(app);
                }
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 重建托盘菜单与提示：打印机列表在后台查
pub(crate) fn refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let host = app.try_state::<Arc<Host>>().map(|host| host.inner().clone());
        let printers = match &host {
            Some(host) => {
                let catalog = host.catalog().clone();
                tokio::task::spawn_blocking(move || catalog.list().unwrap_or_default()).await.unwrap_or_default()
            }
            None => Vec::new(),
        };
        let menu = build(&app, &printers, host.as_deref());
        if let (Ok(menu), Some(tray)) = (menu, app.tray_by_id(TRAY)) {
            let _ = tray.set_menu(Some(menu));
            let listening = host.as_ref().and_then(|host| host.port()).is_some();
            let _ = tray.set_tooltip(Some(if listening || host.is_none() {
                PRODUCT_NAME.to_owned()
            } else {
                format!("{PRODUCT_NAME}（未在监听）")
            }));
        }
    });
}

fn build(app: &AppHandle, printers: &[PrinterInfo], host: Option<&Host>) -> tauri::Result<Menu<Wry>> {
    let status = match host {
        None => format!("{PRODUCT_NAME} {VERSION} · 正在启动"),
        Some(host) => match host.port() {
            Some(port) => format!("{PRODUCT_NAME} {VERSION} · 端口 {port}"),
            None => format!("{PRODUCT_NAME} {VERSION} · 未在监听"),
        },
    };
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "status", status, false, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "main", "打开主窗口", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "diagnostics", "诊断信息…", host.is_some(), None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "logs", "打开日志目录", host.is_some(), None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "export", "导出诊断包…", host.is_some(), None::<&str>)?)?;
    let tests = Submenu::new(app, "测试打印", host.is_some())?;
    if printers.is_empty() {
        tests.append(&MenuItem::with_id(app, "no-printers", "本机没有打印机", false, None::<&str>)?)?;
    }
    for printer in printers {
        let label = if printer.is_default {
            format!("{}（默认）", printer.name)
        } else {
            printer.name.clone()
        };
        tests.append(&MenuItem::with_id(app, format!("test:{}", printer.name), label, true, None::<&str>)?)?;
    }
    menu.append(&tests)?;
    if let Some(updates) = host.and_then(|host| host.updates()).filter(|updates| updates.allowed()) {
        match updates.offer() {
            Some(offer) => menu.append(&MenuItem::with_id(app, "update", format!("安装新版本 {}…", offer.version), true, None::<&str>)?)?,
            None => menu.append(&MenuItem::with_id(app, "check", "检查更新…", true, None::<&str>)?)?,
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&CheckMenuItem::with_id(
        app,
        "autostart",
        "开机自启",
        true,
        platform::autostart::is_enabled(),
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?)?;
    Ok(menu)
}

fn message(app: &AppHandle, text: impl Into<String>, kind: MessageDialogKind) {
    app.dialog().message(text).title(PRODUCT_NAME).kind(kind).show(|_| {});
}

/// 打开日志目录，目录不存在时先建出来
pub(crate) fn open_logs(app: &AppHandle, host: &Host) -> Result<(), String> {
    let directory = &host.paths().log_directory;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    app.opener().open_path(directory.display().to_string(), None::<&str>).map_err(|error| error.to_string())
}

/// 选位置后导出诊断包，结果以对话框告知
pub(crate) fn export_diagnostics(app: &AppHandle) {
    let Some(host) = app.try_state::<Arc<Host>>().map(|host| host.inner().clone()) else {
        return;
    };
    let now = host.clock().now();
    let civil = now.civil(host.clock().local_offset(now));
    let name = format!(
        "曦寒打印客户端诊断包-{:04}{:02}{:02}-{:02}{:02}{:02}.zip",
        civil.year, civil.month, civil.day, civil.hour, civil.minute, civil.second
    );
    let reporter = app.clone();
    app.dialog()
        .file()
        .set_title("导出诊断包")
        .set_file_name(name)
        .add_filter("zip 压缩包", &["zip"])
        .save_file(move |path| {
            let Some(path) = path.and_then(|path| path.into_path().ok()) else {
                return;
            };
            match host.export_diagnostics(&path) {
                Ok(()) => message(&reporter, format!("诊断包已存到\n{}", path.display()), MessageDialogKind::Info),
                Err(error) => message(&reporter, format!("诊断包没存成：{error}"), MessageDialogKind::Warning),
            }
        });
}

fn handle(app: &AppHandle, id: &str) {
    let host = app.try_state::<Arc<Host>>().map(|host| host.inner().clone());
    match id {
        "main" => crate::windows::show_main(app),
        "diagnostics" => crate::windows::show_main_at(app, Some("diagnostics")),
        "logs" => {
            if let Some(host) = host
                && let Err(error) = open_logs(app, &host)
            {
                message(app, error, MessageDialogKind::Warning);
            }
        }
        "export" => export_diagnostics(app),
        "check" => {
            let Some(updates) = host.and_then(|host| host.updates()) else {
                return;
            };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let outcome = updates.check(UpdateTrigger::Manual).await;
                match (outcome.version, outcome.unreachable) {
                    (Some(_), _) => crate::windows::show_update(&app),
                    (None, true) => message(&app, "取不到更新信息，请稍后再试。", MessageDialogKind::Info),
                    (None, false) => message(&app, format!("已是最新版本 {VERSION}。"), MessageDialogKind::Info),
                }
            });
        }
        "update" => crate::windows::show_update(app),
        "autostart" => {
            let enabled = !platform::autostart::is_enabled();
            if let Err(error) = platform::autostart::set(enabled) {
                message(app, format!("开机自启没改成：{error}"), MessageDialogKind::Warning);
            }
            refresh(app);
        }
        "exit" => crate::windows::exit(app),
        other => {
            if let (Some(printer), Some(host)) = (other.strip_prefix("test:"), host) {
                let app = app.clone();
                let printer = printer.to_owned();
                tauri::async_runtime::spawn(async move {
                    let result = host.test_print(&printer).await;
                    message(&app, result, MessageDialogKind::Info);
                });
            }
        }
    }
}
