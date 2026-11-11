// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 窗口经 invoke 调用的命令

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use xihan_print_client_core::defaults::SUB_PROTOCOL;
use xihan_print_client_core::log::LogLevel;
use xihan_print_client_core::protocol::PrinterInfo;
use xihan_print_client_core::updates::UpdateTrigger;
use xihan_print_client_platform as platform;

use crate::ExtensionPage;
use crate::host::{Host, VERSION};
use crate::updates::{CheckOutcome, OfferView};

type HostState<'a> = State<'a, Arc<Host>>;

/// 主窗口概览：版本、渲染引擎、监听、问题、目录与设置
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Overview {
    version: String,
    os: String,
    arch: String,
    renderer: Option<String>,
    renderer_problem: Option<String>,
    port: Option<u16>,
    listening: Vec<String>,
    protocol: String,
    problems: Vec<String>,
    settings_directory: String,
    log_directory: String,
    policy_file: String,
    policy_file_exists: bool,
    autostart: bool,
    check_for_updates: bool,
    updates_allowed: bool,
    log_level: String,
    pages: Vec<ExtensionPage>,
    update: Option<String>,
    ports: Vec<u16>,
    user_port: Option<u16>,
    ports_locked: bool,
    access_key: Option<String>,
    access_key_locked: bool,
}

/// 主窗口概览
#[tauri::command]
pub(crate) fn overview(host: HostState<'_>) -> Overview {
    let renderer = host.renderer();
    let settings = host.settings();
    Overview {
        version: VERSION.to_owned(),
        os: platform::os().to_owned(),
        arch: platform::arch().to_owned(),
        renderer: renderer.clone().ok(),
        renderer_problem: renderer.err(),
        port: host.port(),
        listening: host
            .with_server(|server| server.listening())
            .unwrap_or_default()
            .into_iter()
            .map(|(_, address)| address.to_string())
            .collect(),
        protocol: SUB_PROTOCOL.to_owned(),
        problems: host.problems(),
        settings_directory: host.paths().settings_directory.display().to_string(),
        log_directory: host.paths().log_directory.display().to_string(),
        policy_file: host.paths().policy_file.display().to_string(),
        policy_file_exists: host.paths().policy_file.exists(),
        autostart: platform::autostart::is_enabled(),
        check_for_updates: host.checks_for_updates(),
        updates_allowed: host.policy().check_for_updates,
        log_level: settings.log_level.name().to_owned(),
        pages: host.pages().to_vec(),
        update: host.updates().and_then(|updates| updates.offer()).map(|offer| offer.version),
        ports: host.ports(),
        user_port: settings.port,
        ports_locked: host.ports_locked(),
        access_key: host.access_key(),
        access_key_locked: host.access_key_locked(),
    }
}

/// 改本机端口：None 恢复缺省的端口；返回换成的端口
#[tauri::command]
pub(crate) fn set_port(app: AppHandle, host: HostState<'_>, port: Option<u16>) -> Result<Option<u16>, String> {
    let listening = host.set_port(port)?;
    crate::tray::refresh(&app);
    Ok(listening)
}

/// 改访问密钥：None 为不要密钥
#[tauri::command]
pub(crate) fn set_access_key(host: HostState<'_>, key: Option<String>) -> Result<(), String> {
    host.set_access_key(key.filter(|key| !key.is_empty()))
}

/// 本机打印机
#[tauri::command]
pub(crate) async fn printers(host: HostState<'_>) -> Result<Vec<PrinterInfo>, String> {
    let catalog = host.catalog().clone();
    tokio::task::spawn_blocking(move || catalog.list())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// 给打印机印一张自检页
#[tauri::command]
pub(crate) async fn test_print(host: HostState<'_>, printer: String) -> Result<String, String> {
    let host = host.inner().clone();
    Ok(host.test_print(&printer).await)
}

/// 名单里的一个来源
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OriginItem {
    origin: String,
    from_policy: bool,
}

/// 允许与拒绝的来源
#[derive(Serialize)]
pub(crate) struct Origins {
    allowed: Vec<OriginItem>,
    denied: Vec<OriginItem>,
}

/// 允许与拒绝的来源；策略预先放行的标出来，不能删
#[tauri::command]
pub(crate) fn origins(host: HostState<'_>) -> Origins {
    let policy = host.policy().allowed_origins.iter().map(|origin| OriginItem {
        origin: origin.clone(),
        from_policy: true,
    });
    let allowed = host.lists().allowed().into_iter().map(|origin| OriginItem { origin, from_policy: false });
    Origins {
        allowed: policy.chain(allowed).collect(),
        denied: host.lists().denied().into_iter().map(|origin| OriginItem { origin, from_policy: false }).collect(),
    }
}

/// 从两张名单里删掉一个来源，下次连接时重新询问
#[tauri::command]
pub(crate) fn forget_origin(host: HostState<'_>, origin: String) -> Result<(), String> {
    host.lists().forget(&origin).map_err(|error| error.to_string())
}

/// 打开或关掉开机自启
#[tauri::command]
pub(crate) fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    platform::autostart::set(enabled).map_err(|error| error.to_string())?;
    crate::tray::refresh(&app);
    Ok(platform::autostart::is_enabled())
}

/// 改是否检查更新
#[tauri::command]
pub(crate) fn set_check_for_updates(host: HostState<'_>, enabled: bool) -> Result<(), String> {
    host.update_settings(|settings| settings.check_for_updates = enabled).map_err(|error| error.to_string())
}

/// 改日志级别：debug、information、warning、error
#[tauri::command]
pub(crate) fn set_log_level(host: HostState<'_>, level: String) -> Result<(), String> {
    let level = LogLevel::parse(&level).ok_or_else(|| format!("不认识的日志级别：{level}"))?;
    host.set_log_level(level).map_err(|error| error.to_string())
}

/// 当前的诊断信息
#[tauri::command]
pub(crate) fn diagnostics_text(host: HostState<'_>) -> String {
    host.diagnostics_text()
}

/// 选位置后导出诊断包
#[tauri::command]
pub(crate) fn export_diagnostics(app: AppHandle) {
    crate::tray::export_diagnostics(&app);
}

/// 打开日志目录
#[tauri::command]
pub(crate) fn open_logs(app: AppHandle, host: HostState<'_>) -> Result<(), String> {
    crate::tray::open_logs(&app, &host)
}

/// 立即检查更新
#[tauri::command]
pub(crate) async fn check_updates(host: HostState<'_>) -> Result<CheckOutcome, String> {
    let updates = host.updates().ok_or("检查更新不可用")?;
    if !updates.allowed() {
        return Err("管理员已用策略关闭检查更新".into());
    }
    Ok(updates.check(UpdateTrigger::Manual).await)
}

/// 已发现的新版
#[tauri::command]
pub(crate) fn update_offer(host: HostState<'_>) -> Option<OfferView> {
    host.updates().and_then(|updates| updates.offer())
}

/// 下载、校验并运行安装包
#[tauri::command]
pub(crate) async fn install_update(host: HostState<'_>) -> Result<(), String> {
    let updates = host.updates().ok_or("检查更新不可用")?;
    updates.install().await
}

/// 打开新版提示窗口
#[tauri::command]
pub(crate) fn open_update_window(app: AppHandle) {
    crate::windows::show_update(&app);
}

/// 用浏览器打开新版安装包的下载地址
#[tauri::command]
pub(crate) fn open_download(app: AppHandle) -> Result<(), String> {
    let host = app.try_state::<Arc<Host>>().ok_or("客户端还没起来")?;
    let offer = host.updates().and_then(|updates| updates.offer()).ok_or("没有新版本")?;
    app.opener().open_url(offer.url, None::<&str>).map_err(|error| error.to_string())
}
