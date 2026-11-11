// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 更新清单：最新版本、发布说明与各平台各架构的安装包

use serde_json::Value;

use super::SemanticVersion;
use crate::consent::is_https_url;

/// 清单最大字节数
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

/// 安装包最大字节数
pub const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

/// 一个平台一个架构的安装包
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateAsset {
    /// 操作系统：windows、macos、linux；清单里不写时为 windows
    pub os: String,
    /// 架构：x64、arm64
    pub arch: String,
    /// 下载地址，只认 https
    pub url: String,
    /// 安装包的 SHA-256，小写十六进制
    pub sha256: String,
    /// 字节数
    pub size: u64,
}

/// 更新清单
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateManifest {
    /// 版本
    pub version: SemanticVersion,
    /// 发布说明
    pub notes: Option<String>,
    /// 安装包
    pub assets: Vec<UpdateAsset>,
}

impl UpdateManifest {
    /// 某个平台某个架构的安装包；没有时为 None
    pub fn asset_for(&self, os: &str, arch: &str) -> Option<&UpdateAsset> {
        self.assets.iter().find(|asset| asset.os.eq_ignore_ascii_case(os) && asset.arch.eq_ignore_ascii_case(arch))
    }

    /// 解析清单；形状不对时给出原因
    pub fn parse(json: &[u8]) -> Result<UpdateManifest, String> {
        let text = String::from_utf8_lossy(json);
        let root = crate::consent::jsonc::parse(&text).map_err(|error| format!("清单不是有效的 JSON：{error}"))?;
        let Value::Object(root) = root else {
            return Err("清单必须是对象".into());
        };
        let version = root
            .get("version")
            .and_then(Value::as_str)
            .and_then(SemanticVersion::parse)
            .ok_or("version 不是有效的版本号")?;
        let notes = root.get("notes").and_then(Value::as_str).map(str::to_owned);
        let items = root.get("assets").and_then(Value::as_array).ok_or("assets 必须是数组")?;
        let mut assets = Vec::new();
        for item in items {
            let text = |name: &str| item.get(name).and_then(Value::as_str);
            let asset = (|| {
                let os = match item.get("os") {
                    None | Some(Value::Null) => "windows",
                    Some(value) => value.as_str().filter(|os| !os.is_empty())?,
                };
                let arch = text("arch").filter(|arch| !arch.is_empty())?;
                let url = text("url").filter(|url| is_https_url(url))?;
                let sha256 = text("sha256").filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))?;
                let size = item.get("size").and_then(Value::as_u64).filter(|size| *size > 0 && *size <= MAX_ASSET_BYTES)?;
                Some(UpdateAsset {
                    os: os.to_owned(),
                    arch: arch.to_owned(),
                    url: url.to_owned(),
                    sha256: sha256.to_ascii_lowercase(),
                    size,
                })
            })();
            match asset {
                Some(asset) => assets.push(asset),
                None => return Err("assets 里有一项不完整：要有 arch、https 的 url、64 位十六进制的 sha256 与正数 size".into()),
            }
        }
        Ok(UpdateManifest { version, notes, assets })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "982660585e237f4935916c6ba60174ca773fab0ab9c49413f60b1f48662309e7";

    #[test]
    fn reads_the_published_manifest_shape() {
        let json = format!(
            r#"{{ "version": "1.1.0", "notes": "说明", "assets": [
                {{ "arch": "x64", "url": "https://example.com/a.exe", "sha256": "{HASH}", "size": 10 }},
                {{ "os": "macos", "arch": "arm64", "url": "https://example.com/a.dmg", "sha256": "{}", "size": 20 }},
            ] }}"#,
            HASH.to_uppercase()
        );
        let manifest = UpdateManifest::parse(json.as_bytes()).unwrap();
        assert_eq!(manifest.version.to_string(), "1.1.0");
        assert_eq!(manifest.asset_for("windows", "X64").unwrap().size, 10);
        assert_eq!(manifest.asset_for("macos", "arm64").unwrap().sha256, HASH);
        assert!(manifest.asset_for("windows", "arm64").is_none());
    }

    #[test]
    fn rejects_incomplete_assets() {
        for asset in [
            format!(r#"{{ "arch": "x64", "url": "http://example.com/a.exe", "sha256": "{HASH}", "size": 10 }}"#),
            r#"{ "arch": "x64", "url": "https://example.com/a.exe", "sha256": "abc", "size": 10 }"#.to_owned(),
            format!(r#"{{ "arch": "x64", "url": "https://example.com/a.exe", "sha256": "{HASH}", "size": 0 }}"#),
            format!(r#"{{ "url": "https://example.com/a.exe", "sha256": "{HASH}", "size": 1 }}"#),
        ] {
            let json = format!(r#"{{ "version": "1.0.0", "assets": [{asset}] }}"#);
            assert!(UpdateManifest::parse(json.as_bytes()).is_err(), "{asset}");
        }
        assert!(UpdateManifest::parse(br#"{ "version": "x", "assets": [] }"#).is_err());
    }
}
