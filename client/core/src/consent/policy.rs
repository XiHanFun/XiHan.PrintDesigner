// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 管理员下发的策略，读自策略文件，优先于用户设置；没有策略文件时取缺省值

use std::path::Path;

use serde_json::{Map, Value};

use super::jsonc;
use crate::log::ClientLog;
use crate::server::origin;

/// 管理员下发的策略
#[derive(Clone, Debug, PartialEq)]
pub struct ClientPolicy {
    /// 预先放行的来源，不弹授权窗口
    pub allowed_origins: Vec<String>,
    /// 是否为不认识的来源弹授权窗口；关掉后只认预先放行的来源与用户名单里已允许的来源
    pub prompt_for_unknown_origins: bool,
    /// 固定的监听端口；为空时用缺省的端口
    pub ports: Vec<u16>,
    /// 是否检查更新
    pub check_for_updates: bool,
    /// 更新清单地址，依次尝试；为空时用缺省的地址
    pub update_manifest_urls: Vec<String>,
    /// 策略文件的原样内容，扩展从中读自己的设置；没有策略文件时为空
    pub raw: Map<String, Value>,
}

impl Default for ClientPolicy {
    fn default() -> Self {
        ClientPolicy {
            allowed_origins: Vec::new(),
            prompt_for_unknown_origins: true,
            ports: Vec::new(),
            check_for_updates: true,
            update_manifest_urls: Vec::new(),
            raw: Map::new(),
        }
    }
}

impl ClientPolicy {
    /// 读策略文件：不存在时取缺省值；读不出时记错误日志并取缺省值；不合法的来源、端口与地址记警告日志后跳过
    pub fn load(path: &Path, log: &dyn ClientLog) -> ClientPolicy {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ClientPolicy::default(),
            Err(error) => {
                log.error(&format!("读不出策略文件 {}，按没有策略处理", path.display()), Some(&error));
                return ClientPolicy::default();
            }
        };
        match jsonc::parse(&text) {
            Ok(Value::Object(raw)) => ClientPolicy::from_json(raw, log),
            Ok(Value::Null) => ClientPolicy::default(),
            Ok(_) => {
                log.error(&format!("策略文件 {} 不是 JSON 对象，按没有策略处理", path.display()), None);
                ClientPolicy::default()
            }
            Err(error) => {
                log.error(&format!("读不出策略文件 {}，按没有策略处理", path.display()), Some(&error));
                ClientPolicy::default()
            }
        }
    }

    /// 由策略文件的内容得出策略
    pub fn from_json(raw: Map<String, Value>, log: &dyn ClientLog) -> ClientPolicy {
        let mut policy = ClientPolicy::default();
        for item in array(&raw, "allowedOrigins") {
            match item.as_str().and_then(|text| origin::normalize(Some(text))) {
                Some(normalized) => policy.allowed_origins.push(normalized),
                None => log.warn(&format!("策略里的来源不合法，已跳过：{item}")),
            }
        }
        if let Some(prompt) = raw.get("promptForUnknownOrigins").and_then(Value::as_bool) {
            policy.prompt_for_unknown_origins = prompt;
        }
        for item in array(&raw, "ports") {
            match item.as_u64().filter(|port| (1..=65_535).contains(port)) {
                Some(port) => policy.ports.push(port as u16),
                None => log.warn(&format!("策略里的端口不合法，已跳过：{item}")),
            }
        }
        if let Some(Value::Object(updates)) = raw.get("updates") {
            if let Some(check) = updates.get("check").and_then(Value::as_bool) {
                policy.check_for_updates = check;
            }
            for item in array(updates, "manifestUrls") {
                match item.as_str().filter(|url| is_https_url(url)) {
                    Some(url) => policy.update_manifest_urls.push(url.to_owned()),
                    None => log.warn(&format!("策略里的更新清单地址不是 https，已跳过：{item}")),
                }
            }
        }
        policy.raw = raw;
        policy
    }
}

fn array<'a>(owner: &'a Map<String, Value>, name: &str) -> &'a [Value] {
    owner.get(name).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// 是否是带主机的 https 地址
pub fn is_https_url(url: &str) -> bool {
    let Some(rest) = url.get(..8).filter(|scheme| scheme.eq_ignore_ascii_case("https://")).map(|_| &url[8..]) else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    !host.is_empty() && !host.contains('@') && !url.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::MemoryLog;
    use serde_json::json;

    #[test]
    fn reads_the_policy_and_skips_invalid_items() {
        let log = MemoryLog::default();
        let Value::Object(raw) = json!({
            "allowedOrigins": ["https://ERP.example.com", "ftp://x", 3],
            "promptForUnknownOrigins": false,
            "ports": [17620, 0, 70000],
            "updates": { "check": false, "manifestUrls": ["https://intranet.example/u.json", "http://x/u.json"] },
            "history": { "keepContent": false },
        }) else {
            panic!()
        };
        let policy = ClientPolicy::from_json(raw, &log);
        assert_eq!(policy.allowed_origins, vec!["https://erp.example.com"]);
        assert!(!policy.prompt_for_unknown_origins);
        assert_eq!(policy.ports, vec![17620]);
        assert!(!policy.check_for_updates);
        assert_eq!(policy.update_manifest_urls, vec!["https://intranet.example/u.json"]);
        assert_eq!(policy.raw.get("history"), Some(&json!({ "keepContent": false })));
        assert_eq!(log.lines().len(), 5);
    }

    #[test]
    fn falls_back_to_defaults_without_a_readable_file() {
        let log = MemoryLog::default();
        assert_eq!(ClientPolicy::load(Path::new("/nonexistent/xihan/policy.json"), &log), ClientPolicy::default());
        assert!(log.lines().is_empty());
    }
}
