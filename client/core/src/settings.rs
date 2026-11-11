// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 用户自己的设置，存在设置目录的 settings.json；开机自启以系统里的登记为准，不在这里

use std::path::Path;

use serde_json::{Map, Value};

use crate::log::{ClientLog, LogLevel};

/// 用户设置
#[derive(Clone, Debug, PartialEq)]
pub struct ClientSettings {
    /// 日志级别
    pub log_level: LogLevel,
    /// 是否检查更新；策略关掉时不生效
    pub check_for_updates: bool,
    /// 其余的设置项原样保留，扩展从中读写自己的设置
    pub extra: Map<String, Value>,
}

impl Default for ClientSettings {
    fn default() -> Self {
        ClientSettings {
            log_level: LogLevel::Information,
            check_for_updates: true,
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
}
