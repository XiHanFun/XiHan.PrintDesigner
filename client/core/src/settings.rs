// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 用户自己的设置，存在设置目录的 settings.json；开机自启以系统里的登记为准，不在这里

use std::path::Path;

use serde_json::{Map, Value};

use crate::log::{ClientLog, LogLevel};
use crate::server::is_access_key;

/// 用户能设的最小端口：再小的端口在一些系统上要管理员权限
pub const MIN_USER_PORT: u16 = 1024;

/// 用户设置
#[derive(Clone, Debug, PartialEq)]
pub struct ClientSettings {
    /// 日志级别
    pub log_level: LogLevel,
    /// 是否检查更新；策略关掉时不生效
    pub check_for_updates: bool,
    /// 只监听这一个端口；None 时依次试缺省的端口。策略固定了端口时不生效
    pub port: Option<u16>,
    /// 访问密钥：设了以后握手必须带同样的密钥。策略设了密钥时不生效
    pub access_key: Option<String>,
    /// 其余的设置项原样保留，扩展从中读写自己的设置
    pub extra: Map<String, Value>,
}

impl Default for ClientSettings {
    fn default() -> Self {
        ClientSettings {
            log_level: LogLevel::Information,
            check_for_updates: true,
            port: None,
            access_key: None,
            extra: Map::new(),
        }
    }
}

impl ClientSettings {
    /// 读设置；文件不存在或读不出来时用缺省值
    pub fn load(path: &Path, log: &dyn ClientLog) -> ClientSettings {
        let mut settings = ClientSettings::default();
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return settings,
            Err(error) => {
                log.warn(&format!("读不出设置 {}，用缺省值：{error}", path.display()));
                return settings;
            }
        };
        let text = String::from_utf8_lossy(&bytes);
        match crate::consent::jsonc::parse(&text) {
            Ok(Value::Object(mut map)) => {
                if let Some(level) = map.remove("logLevel").as_ref().and_then(Value::as_str).and_then(LogLevel::parse) {
                    settings.log_level = level;
                }
                if let Some(check) = map.remove("checkForUpdates").as_ref().and_then(Value::as_bool) {
                    settings.check_for_updates = check;
                }
                match map.remove("port") {
                    None | Some(Value::Null) => {}
                    Some(value) => match value.as_u64().filter(|port| (u64::from(MIN_USER_PORT)..=65_535).contains(port)) {
                        Some(port) => settings.port = Some(port as u16),
                        None => log.warn(&format!("设置里的端口不合法，按缺省端口：{value}")),
                    },
                }
                match map.remove("accessKey") {
                    None | Some(Value::Null) => {}
                    Some(Value::String(key)) if is_access_key(&key) => settings.access_key = Some(key),
                    Some(_) => log.warn("设置里的访问密钥不合法，按没有密钥处理"),
                }
                settings.extra = map;
            }
            _ => log.warn(&format!("读不出设置 {}，用缺省值", path.display())),
        }
        settings
    }

    /// 存设置：先写临时文件再替换
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut map = Map::new();
        map.insert("logLevel".into(), Value::from(self.log_level.name()));
        map.insert("checkForUpdates".into(), Value::from(self.check_for_updates));
        if let Some(port) = self.port {
            map.insert("port".into(), Value::from(port));
        }
        if let Some(key) = &self.access_key {
            map.insert("accessKey".into(), Value::from(key.as_str()));
        }
        for (key, value) in &self.extra {
            map.insert(key.clone(), value.clone());
        }
        write_atomically(path, &serde_json::to_vec_pretty(&Value::Object(map)).expect("设置总能写成 JSON"))
    }
}

/// 写文件：先写同目录的临时文件再替换，目录不存在时先建出来
pub fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::NullLog;
    use crate::server::random_hex;
    use serde_json::json;

    #[test]
    fn round_trips_and_keeps_unknown_items() {
        let path = std::env::temp_dir().join(format!("xihan-print-settings-{}", random_hex(8))).join("settings.json");
        assert_eq!(ClientSettings::load(&path, &NullLog), ClientSettings::default());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{ "logLevel": "Debug", "checkForUpdates": false, "history": { "days": 7 }, }"#).unwrap();
        let mut settings = ClientSettings::load(&path, &NullLog);
        assert_eq!(settings.log_level, LogLevel::Debug);
        assert!(!settings.check_for_updates);
        assert_eq!(settings.extra.get("history"), Some(&json!({ "days": 7 })));
        settings.log_level = LogLevel::Warning;
        settings.save(&path).unwrap();
        let reloaded = ClientSettings::load(&path, &NullLog);
        assert_eq!(reloaded.log_level, LogLevel::Warning);
        assert_eq!(reloaded.extra.get("history"), Some(&json!({ "days": 7 })));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn keeps_the_port_and_access_key_and_skips_invalid_ones() {
        let path = std::env::temp_dir().join(format!("xihan-print-settings-{}", random_hex(8))).join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{ "port": 18000, "accessKey": "k3y-for-erp" }"#).unwrap();
        let mut settings = ClientSettings::load(&path, &NullLog);
        assert_eq!((settings.port, settings.access_key.as_deref()), (Some(18000), Some("k3y-for-erp")));
        settings.port = None;
        settings.save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("port") && text.contains("accessKey"));

        let log = crate::log::MemoryLog::default();
        std::fs::write(&path, r#"{ "port": 80, "accessKey": "short" }"#).unwrap();
        let settings = ClientSettings::load(&path, &log);
        assert_eq!((settings.port, settings.access_key), (None, None));
        assert_eq!(log.lines().len(), 2);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
