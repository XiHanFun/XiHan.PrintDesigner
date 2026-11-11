// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 检查与下载更新：按顺序取清单，前一个地址取不到或清单不对才取下一个；下载时边写边算 SHA-256，与清单不符就删掉

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use super::scheduler::UpdateTrigger;
use super::{MAX_MANIFEST_BYTES, SemanticVersion, UpdateAsset, UpdateManifest};
use crate::BoxFuture;
use crate::cancel::Cancel;
use crate::log::SharedLog;

/// 缺省的清单地址：先 Gitee 再 GitHub
pub const DEFAULT_MANIFESTS: [&str; 2] = [
    "https://gitee.com/XiHanFun/XiHan.PrintDesigner/raw/main/client/update.json",
    "https://raw.githubusercontent.com/XiHanFun/XiHan.PrintDesigner/main/client/update.json",
];

/// 发 GET 请求
pub trait HttpClient: Send + Sync {
    /// 取一个地址，拿到响应头就返回
    fn get(&self, url: &str) -> BoxFuture<'_, Result<Box<dyn HttpResponse>, String>>;
}

/// 一次响应：状态码与按块读的正文
pub trait HttpResponse: Send {
    /// 状态码
    fn status(&self) -> u16;

    /// 下一块正文；读完时为 None
    fn chunk(&mut self) -> BoxFuture<'_, Result<Option<Vec<u8>>, String>>;
}

/// 一次检查的结果
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateCheckResult {
    /// 有新版时的清单与安装包；已是最新时为 None
    pub offer: Option<UpdateOffer>,
    /// 取到清单的地址；所有地址都取不到时为 None
    pub source: Option<String>,
}

/// 可以安装的新版
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateOffer {
    /// 清单
    pub manifest: UpdateManifest,
    /// 本机平台与架构的安装包
    pub asset: UpdateAsset,
}

/// 下载或校验安装包失败
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateFailure(pub String);

impl std::fmt::Display for UpdateFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UpdateFailure {}

/// 检查与下载更新
pub struct UpdateChecker {
    http: Arc<dyn HttpClient>,
    manifests: Vec<String>,
    current: SemanticVersion,
    os: String,
    arch: String,
    variant: Option<String>,
    log: SharedLog,
    /// 每个清单地址的期限
    pub manifest_timeout: Duration,
}

impl UpdateChecker {
    /// 以 HTTP 客户端、清单地址、当前版本与本机平台、架构、安装包变体创建；变体为 None 时只取在线安装包
    pub fn new(http: Arc<dyn HttpClient>, manifests: Vec<String>, current: SemanticVersion, os: &str, arch: &str, variant: Option<&str>, log: SharedLog) -> Self {
        UpdateChecker {
            http,
            manifests,
            current,
            os: os.to_owned(),
            arch: arch.to_owned(),
            variant: variant.map(str::to_owned),
            log,
            manifest_timeout: Duration::from_secs(15),
        }
    }

    /// 取清单并与当前版本比较；日志里每一行都带上这次检查的来源（自动 / 手动）
    pub async fn check(&self, trigger: UpdateTrigger) -> UpdateCheckResult {
        let label = trigger.label();
        self.log.info(&format!("检查更新（{label}）"));
        for source in &self.manifests {
            let manifest = match tokio::time::timeout(self.manifest_timeout, self.fetch(source)).await {
                Ok(Ok(body)) => match UpdateManifest::parse(&body) {
                    Ok(manifest) => manifest,
                    Err(problem) => {
                        self.log.warn(&format!("更新清单 {source} 不对（{label}）：{problem}"));
                        continue;
                    }
                },
                Ok(Err(error)) => {
                    self.log.info(&format!("取不到更新清单 {source}（{label}）：{error}"));
                    continue;
                }
                Err(_) => {
                    self.log.info(&format!("取不到更新清单 {source}（{label}）：超时"));
                    continue;
                }
            };
            let newer = manifest.version.is_newer_than(&self.current);
            if let Some(asset) = manifest.asset_for(&self.os, &self.arch, self.variant.as_deref()).cloned().filter(|_| newer) {
                self.log.info(&format!("发现新版本 {}（{}，{label}）", manifest.version, host_of(source)));
                return UpdateCheckResult {
                    offer: Some(UpdateOffer { manifest, asset }),
                    source: Some(source.clone()),
                };
            }
            if newer {
                let variant = self.variant.as_deref().map(|variant| format!(" {variant}")).unwrap_or_default();
                self.log
                    .info(&format!("新版本 {} 没有 {} {}{variant} 的安装包（{label}）", manifest.version, self.os, self.arch));
            }
            return UpdateCheckResult {
                offer: None,
                source: Some(source.clone()),
            };
        }
        UpdateCheckResult { offer: None, source: None }
    }

    async fn fetch(&self, url: &str) -> Result<Vec<u8>, String> {
        let mut response = self.http.get(url).await?;
        if !(200..300).contains(&response.status()) {
            return Err(format!("HTTP {}", response.status()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > MAX_MANIFEST_BYTES {
                return Err("更新清单太大".into());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    /// 把安装包下载到目录里，校验大小与 SHA-256 后返回文件路径；不符时删掉并返回失败
    pub async fn download(&self, offer: &UpdateOffer, directory: &Path, progress: &(dyn Fn(u64) + Send + Sync), cancel: &Cancel) -> Result<PathBuf, UpdateFailure> {
        tokio::fs::create_dir_all(directory)
            .await
            .map_err(|error| UpdateFailure(format!("下载安装包失败：{error}")))?;
        let path = directory.join(file_name(offer));
        let mut partial = path.as_os_str().to_owned();
        partial.push(".partial");
        let partial = PathBuf::from(partial);
        let result = self.download_to(offer, &partial, progress, cancel).await;
        if result.is_ok() {
            tokio::fs::rename(&partial, &path)
                .await
                .map_err(|error| UpdateFailure(format!("下载安装包失败：{error}")))?;
            self.log.info(&format!("安装包已下载并校验：{}", path.display()));
            return Ok(path);
        }
        let _ = tokio::fs::remove_file(&partial).await;
        result.map(|_| path)
    }

    async fn download_to(&self, offer: &UpdateOffer, partial: &Path, progress: &(dyn Fn(u64) + Send + Sync), cancel: &Cancel) -> Result<(), UpdateFailure> {
        let failed = |error: String| UpdateFailure(format!("下载安装包失败：{error}"));
        let mut response = cancel.run(self.http.get(&offer.asset.url)).await.map_err(|_| failed("已取消".into()))?.map_err(failed)?;
        if !(200..300).contains(&response.status()) {
            return Err(failed(format!("HTTP {}", response.status())));
        }
        let mut file = tokio::fs::File::create(partial).await.map_err(|error| failed(error.to_string()))?;
        let mut hash = Sha256::new();
        let mut total = 0u64;
        while let Some(chunk) = cancel.run(response.chunk()).await.map_err(|_| failed("已取消".into()))?.map_err(failed)? {
            total += chunk.len() as u64;
            if total > offer.asset.size {
                return Err(UpdateFailure("下载的安装包比清单写的大".into()));
            }
            hash.update(&chunk);
            file.write_all(&chunk).await.map_err(|error| failed(error.to_string()))?;
            progress(total);
        }
        file.flush().await.map_err(|error| failed(error.to_string()))?;
        drop(file);
        if total != offer.asset.size {
            return Err(UpdateFailure(format!("下载的安装包大小不对：{total} 字节，清单写的是 {}", offer.asset.size)));
        }
        let actual: String = hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
        if actual != offer.asset.sha256 {
            return Err(UpdateFailure("下载的安装包 SHA-256 与清单不符".into()));
        }
        Ok(())
    }
}

/// 存下来的安装包文件名：取下载地址的最后一段，只留字母、数字、点、短横线与下划线
fn file_name(offer: &UpdateOffer) -> String {
    let last = offer.asset.url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("");
    let cleaned: String = last.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).collect();
    if cleaned.is_empty() || cleaned.starts_with('.') {
        format!("XiHanPrint-{}-{}-{}-setup", offer.manifest.version, offer.asset.os, offer.asset.arch)
    } else {
        cleaned
    }
}

fn host_of(url: &str) -> &str {
    url.split("://").nth(1).and_then(|rest| rest.split('/').next()).unwrap_or(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::null_log;
    use crate::updates::OFFLINE_VARIANT;
    use std::collections::HashMap;
    use std::sync::Mutex;

    struct FakeHttp {
        responses: Mutex<HashMap<String, (u16, Vec<u8>)>>,
    }

    struct FakeResponse {
        status: u16,
        body: Vec<Vec<u8>>,
    }

    impl HttpResponse for FakeResponse {
        fn status(&self) -> u16 {
            self.status
        }

        fn chunk(&mut self) -> BoxFuture<'_, Result<Option<Vec<u8>>, String>> {
            Box::pin(async move { Ok(if self.body.is_empty() { None } else { Some(self.body.remove(0)) }) })
        }
    }

    impl HttpClient for FakeHttp {
        fn get(&self, url: &str) -> BoxFuture<'_, Result<Box<dyn HttpResponse>, String>> {
            let found = self.responses.lock().unwrap().get(url).cloned();
            Box::pin(async move {
                let (status, body) = found.ok_or("连不上")?;
                Ok(Box::new(FakeResponse {
                    status,
                    body: body.chunks(3).map(<[u8]>::to_vec).collect(),
                }) as Box<dyn HttpResponse>)
            })
        }
    }

    fn sha256(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn manifest(version: &str, installer: &[u8]) -> Vec<u8> {
        format!(
            r#"{{ "version": "{version}", "notes": "n", "assets": [{{ "arch": "x64", "url": "https://dl.example/XiHanPrint-{version}-x64-setup.exe", "sha256": "{}", "size": {} }}] }}"#,
            sha256(installer),
            installer.len()
        )
        .into_bytes()
    }

    fn checker(responses: Vec<(&str, u16, Vec<u8>)>, current: &str) -> UpdateChecker {
        checker_for(responses, current, None)
    }

    fn checker_for(responses: Vec<(&str, u16, Vec<u8>)>, current: &str, variant: Option<&str>) -> UpdateChecker {
        let http = FakeHttp {
            responses: Mutex::new(responses.into_iter().map(|(url, status, body)| (url.to_owned(), (status, body))).collect()),
        };
        UpdateChecker::new(
            Arc::new(http),
            vec!["https://a.example/u.json".into(), "https://b.example/u.json".into()],
            SemanticVersion::parse(current).unwrap(),
            "windows",
            "x64",
            variant,
            null_log(),
        )
    }

    fn manifest_with_offline(version: &str) -> Vec<u8> {
        let hash = sha256(b"x");
        format!(
            r#"{{ "version": "{version}", "assets": [
                {{ "os": "windows", "arch": "x64", "url": "https://dl.example/XiHanPrint-{version}-x64-setup.exe", "sha256": "{hash}", "size": 1 }},
                {{ "os": "windows", "arch": "x64", "variant": "offline", "url": "https://dl.example/XiHanPrint-{version}-x64-offline-setup.exe", "sha256": "{hash}", "size": 2 }}
            ] }}"#
        )
        .into_bytes()
    }

    #[tokio::test]
    async fn offers_the_installer_of_the_installed_variant() {
        let responses = || vec![("https://a.example/u.json", 200, manifest_with_offline("1.2.0"))];
        let online = checker_for(responses(), "1.1.0", None).check(UpdateTrigger::Manual).await.offer.unwrap();
        assert_eq!(online.asset.url, "https://dl.example/XiHanPrint-1.2.0-x64-setup.exe");
        assert_eq!(online.asset.variant, None);
        let offline = checker_for(responses(), "1.1.0", Some(OFFLINE_VARIANT)).check(UpdateTrigger::Manual).await.offer.unwrap();
        assert_eq!(offline.asset.url, "https://dl.example/XiHanPrint-1.2.0-x64-offline-setup.exe");
        assert_eq!(offline.asset.size, 2);
    }

    #[tokio::test]
    async fn offline_installs_skip_manifests_without_an_offline_installer() {
        let result = checker_for(vec![("https://a.example/u.json", 200, manifest("1.2.0", b"x"))], "1.1.0", Some(OFFLINE_VARIANT))
            .check(UpdateTrigger::Automatic)
            .await;
        assert_eq!(
            result,
            UpdateCheckResult {
                offer: None,
                source: Some("https://a.example/u.json".into())
            }
        );
    }

    #[tokio::test]
    async fn falls_through_to_the_next_manifest_and_offers_a_newer_version() {
        let checker = checker(
            vec![
                ("https://a.example/u.json", 404, vec![]),
                ("https://b.example/u.json", 200, manifest("1.2.0", b"installer")),
            ],
            "1.1.0",
        );
        let result = checker.check(UpdateTrigger::Manual).await;
        assert_eq!(result.source.as_deref(), Some("https://b.example/u.json"));
        assert_eq!(result.offer.unwrap().manifest.version.to_string(), "1.2.0");
    }

    #[tokio::test]
    async fn reports_up_to_date_and_unreachable() {
        let up_to_date = checker(vec![("https://a.example/u.json", 200, manifest("1.1.0", b"x"))], "1.1.0")
            .check(UpdateTrigger::Automatic)
            .await;
        assert_eq!(
            up_to_date,
            UpdateCheckResult {
                offer: None,
                source: Some("https://a.example/u.json".into())
            }
        );
        let unreachable = checker(vec![], "1.1.0").check(UpdateTrigger::Automatic).await;
        assert_eq!(unreachable, UpdateCheckResult { offer: None, source: None });
    }

    #[tokio::test]
    async fn downloads_and_verifies_the_installer() {
        let installer = b"installer bytes".to_vec();
        let mut responses = vec![("https://a.example/u.json", 200, manifest("1.2.0", &installer))];
        responses.push(("https://dl.example/XiHanPrint-1.2.0-x64-setup.exe", 200, installer.clone()));
        let checker = checker(responses, "1.0.0");
        let offer = checker.check(UpdateTrigger::Manual).await.offer.unwrap();
        let directory = std::env::temp_dir().join(format!("xihan-print-update-{}", crate::server::random_hex(8)));
        let seen = Arc::new(Mutex::new(0u64));
        let progress = {
            let seen = seen.clone();
            move |bytes: u64| *seen.lock().unwrap() = bytes
        };
        let path = checker.download(&offer, &directory, &progress, &Cancel::new()).await.unwrap();
        assert_eq!(path.file_name().unwrap(), "XiHanPrint-1.2.0-x64-setup.exe");
        assert_eq!(std::fs::read(&path).unwrap(), installer);
        assert_eq!(*seen.lock().unwrap(), installer.len() as u64);

        let mut tampered = offer.clone();
        tampered.asset.sha256 = sha256(b"other");
        let error = checker.download(&tampered, &directory, &|_| {}, &Cancel::new()).await.unwrap_err();
        assert_eq!(error.0, "下载的安装包 SHA-256 与清单不符");
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(directory);
    }
}
