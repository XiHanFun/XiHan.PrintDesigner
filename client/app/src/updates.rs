// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 自动更新：启动 2 分钟后查一次，之后每天一次；发现新版只提示，用户确认后才下载，
//! Windows 上校验 SHA-256 与签名者后静默运行安装包、客户端随后退出；macOS 与 Linux 上用浏览器打开安装包地址。
//! 程序目录下装着 WebView2 固定版运行时的只取清单里的离线安装包，其余只取在线安装包

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::updates::{DEFAULT_MANIFESTS, OFFLINE_VARIANT, SemanticVersion, UpdateChecker, UpdateFailure, UpdateOffer, UpdateScheduler, UpdateTrigger};
use xihan_print_client_platform::{self as platform, SignatureState};

use crate::host::{Host, VERSION};

/// 自动更新只安装这个发布者签名的安装包：填签名证书上的 CN 或 O；为空时只提示新版、不自动安装
pub const UPDATE_PUBLISHER: &str = "";

/// 一次手动检查的结论
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckOutcome {
    /// 有新版时的版本
    pub version: Option<String>,
    /// 取不到任何清单
    pub unreachable: bool,
}

/// 给新版提示窗口看的新版信息
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfferView {
    /// 新版本
    pub version: String,
    /// 当前版本
    pub current: String,
    /// 发布说明
    pub notes: Option<String>,
    /// 安装包字节数
    pub size: u64,
    /// 能否自动安装；不能时只给下载地址
    pub installable: bool,
    /// 安装包下载地址
    pub url: String,
}

/// 下载进度
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Progress {
    /// 已下载字节数
    pub bytes: u64,
    /// 总字节数
    pub total: u64,
}

/// 更新检查
pub(crate) struct UpdateService {
    host: std::sync::Weak<Host>,
    checker: Arc<UpdateChecker>,
    scheduler: Mutex<Option<UpdateScheduler>>,
    offer: Mutex<Option<UpdateOffer>>,
    downloading: Mutex<Option<Cancel>>,
}

impl UpdateService {
    /// 建检查器，策略允许时开始计划检查
    pub(crate) fn start(host: Arc<Host>) -> Arc<UpdateService> {
        let manifests = if host.policy().update_manifest_urls.is_empty() {
            DEFAULT_MANIFESTS.iter().map(|url| (*url).to_owned()).collect()
        } else {
            host.policy().update_manifest_urls.clone()
        };
        let current = SemanticVersion::parse(VERSION).unwrap_or(SemanticVersion {
            major: 0,
            minor: 0,
            patch: 0,
            prerelease: None,
        });
        let http: Arc<dyn xihan_print_client_core::updates::HttpClient> = match crate::http::ReqwestClient::new(VERSION) {
            Ok(client) => Arc::new(client),
            Err(error) => {
                host.log().warn(&format!("建不了 HTTP 客户端，检查不了更新：{error}"));
                Arc::new(Unreachable)
            }
        };
        let variant = platform::fixed_webview2_runtime().map(|_| OFFLINE_VARIANT);
        let checker = Arc::new(UpdateChecker::new(http, manifests, current, platform::os(), platform::arch(), variant, host.log()));
        let service = Arc::new(UpdateService {
            host: Arc::downgrade(&host),
            checker,
            scheduler: Mutex::new(None),
            offer: Mutex::new(None),
            downloading: Mutex::new(None),
        });
        if host.policy().check_for_updates {
            let check = {
                let service = Arc::downgrade(&service);
                Arc::new(move |_cancel: Cancel| -> xihan_print_client_core::BoxFuture<'static, ()> {
                    let service = service.clone();
                    Box::pin(async move {
                        if let Some(service) = service.upgrade() {
                            service.check(UpdateTrigger::Automatic).await;
                        }
                    })
                })
            };
            let enabled = {
                let host = Arc::downgrade(&host);
                Arc::new(move || host.upgrade().is_some_and(|host| host.checks_for_updates()))
            };
            *service.scheduler.lock().unwrap() = Some(UpdateScheduler::start(check, enabled));
        }
        service
    }

    /// 停止计划检查与下载
    pub(crate) fn stop(&self) {
        if let Some(scheduler) = self.scheduler.lock().unwrap().take() {
            scheduler.stop();
        }
        if let Some(cancel) = self.downloading.lock().unwrap().take() {
            cancel.cancel();
        }
    }

    /// 策略是否允许检查更新
    pub(crate) fn allowed(&self) -> bool {
        self.host.upgrade().is_some_and(|host| host.policy().check_for_updates)
    }

    /// 检查一次；发现新版时记下并刷新托盘、通知窗口
    pub(crate) async fn check(&self, trigger: UpdateTrigger) -> CheckOutcome {
        let result = tokio::time::timeout(Duration::from_secs(60), self.checker.check(trigger))
            .await
            .unwrap_or(xihan_print_client_core::updates::UpdateCheckResult { offer: None, source: None });
        let version = result.offer.as_ref().map(|offer| offer.manifest.version.to_string());
        if let Some(offer) = result.offer {
            *self.offer.lock().unwrap() = Some(offer);
            if let Some(host) = self.host.upgrade() {
                crate::tray::refresh(host.app());
                let _ = host.app().emit("update-found", version.clone());
            }
        }
        CheckOutcome {
            version,
            unreachable: result.source.is_none(),
        }
    }

    /// 已发现的新版
    pub(crate) fn offer(&self) -> Option<OfferView> {
        let offer = self.offer.lock().unwrap().clone()?;
        Some(OfferView {
            version: offer.manifest.version.to_string(),
            current: VERSION.to_owned(),
            notes: offer.manifest.notes.clone(),
            size: offer.asset.size,
            installable: cfg!(windows) && !UPDATE_PUBLISHER.is_empty(),
            url: offer.asset.url.clone(),
        })
    }

    /// 下载、校验并运行安装包；成功时客户端随后退出，失败时给出写给用户看的原因
    pub(crate) async fn install(&self) -> Result<(), String> {
        let host = self.host.upgrade().ok_or("客户端正在退出")?;
        let offer = self.offer.lock().unwrap().clone().ok_or("没有可以安装的新版本")?;
        if !cfg!(windows) || UPDATE_PUBLISHER.is_empty() {
            return Err("这个版本没有配置安装包的签名者，不能自动安装，请到发布页手动下载新版。".into());
        }
        let cancel = Cancel::new();
        *self.downloading.lock().unwrap() = Some(cancel.clone());
        let app = host.app().clone();
        let total = offer.asset.size;
        let progress = move |bytes: u64| {
            let _ = app.emit("update-progress", Progress { bytes, total });
        };
        let path = self
            .checker
            .download(&offer, &host.paths().update_directory, &progress, &cancel)
            .await
            .map_err(|UpdateFailure(message)| message)?;
        let check = {
            let path = path.clone();
            tokio::task::spawn_blocking(move || platform::verify_installer(&path, UPDATE_PUBLISHER))
                .await
                .map_err(|_| "校验安装包签名时出错".to_owned())?
        };
        host.log().info(&format!("安装包签名：{check:?}"));
        if check != SignatureState::Trusted {
            let _ = std::fs::remove_file(&path);
            return Err(match check {
                SignatureState::Unsigned => "安装包没有签名，已删除。".into(),
                SignatureState::WrongPublisher(name) => format!("安装包的签名者是「{name}」，不是本客户端的发布者，已删除。"),
                SignatureState::Untrusted(code) => format!("安装包的签名不可信（0x{code:08X}），已删除。"),
                _ => "这个平台不自动安装新版。".into(),
            });
        }
        host.log().info(&format!("运行安装包 {}", path.display()));
        platform::launch_installer(&path).map_err(|error| format!("安装包没能启动：{error}"))?;
        crate::windows::exit(host.app());
        Ok(())
    }
}

/// 建不了 HTTP 客户端时：所有地址都取不到
struct Unreachable;

impl xihan_print_client_core::updates::HttpClient for Unreachable {
    fn get(&self, _url: &str) -> xihan_print_client_core::BoxFuture<'_, Result<Box<dyn xihan_print_client_core::updates::HttpResponse>, String>> {
        Box::pin(async { Err("没有 HTTP 客户端".to_owned()) })
    }
}
