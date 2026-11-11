// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 来源的规范写法：协议加主机加非缺省端口，如 https://erp.example.com、http://localhost:5173

/// 把浏览器带的 Origin 头换成规范写法；只收 http 与 https，带路径、查询、用户信息或写成 null 的一律不收
pub fn normalize(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.ends_with('/') {
        return None;
    }
    let (scheme, rest) = value.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" => 80,
        "https" => 443,
        _ => return None,
    };
    if rest.is_empty() || rest.contains(['/', '?', '#', '@', '\\']) || rest.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let (host, port) = split_host_port(rest)?;
    if host.is_empty() {
        return None;
    }
    let host = host.to_ascii_lowercase();
    let valid = if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        !inner.is_empty() && inner.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
    } else {
        host.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '.' | '_')) && !host.starts_with('.') && !host.contains("..")
    };
    if !valid {
        return None;
    }
    Some(match port {
        Some(port) if port != default_port => format!("{scheme}://{host}:{port}"),
        _ => format!("{scheme}://{host}"),
    })
}

fn split_host_port(authority: &str) -> Option<(&str, Option<u16>)> {
    if authority.starts_with('[') {
        let end = authority.find(']')?;
        let host = &authority[..=end];
        let rest = &authority[end + 1..];
        return match rest.strip_prefix(':') {
            Some(port) => Some((host, Some(parse_port(port)?))),
            None if rest.is_empty() => Some((host, None)),
            None => None,
        };
    }
    match authority.rsplit_once(':') {
        Some((host, port)) => Some((host, Some(parse_port(port)?))),
        None => Some((authority, None)),
    }
}

fn parse_port(text: &str) -> Option<u16> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn normalizes_http_and_https_origins() {
        assert_eq!(normalize(Some("https://ERP.example.com")).as_deref(), Some("https://erp.example.com"));
        assert_eq!(normalize(Some("http://localhost:5173")).as_deref(), Some("http://localhost:5173"));
        assert_eq!(normalize(Some("https://a.example:443")).as_deref(), Some("https://a.example"));
        assert_eq!(normalize(Some("http://[::1]:8080")).as_deref(), Some("http://[::1]:8080"));
        assert_eq!(normalize(Some(" http://127.0.0.1 ")).as_deref(), Some("http://127.0.0.1"));
    }

    #[test]
    fn rejects_everything_else() {
        for value in [
            None,
            Some(""),
            Some("null"),
            Some("file://x"),
            Some("chrome-extension://abc"),
            Some("https://a.example/"),
            Some("https://a.example/path"),
            Some("https://a.example?x=1"),
            Some("https://user@a.example"),
            Some("https://a.example:99999"),
            Some("https://"),
        ] {
            assert_eq!(normalize(value), None, "{value:?}");
        }
    }
}
