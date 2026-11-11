// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! WebSocket 升级握手：解析请求、按约定检查、写出回复

use base64::Engine;
use sha1::{Digest, Sha1};

use super::origin;
use crate::defaults::{SUB_PROTOCOL, UNVERSIONED_SUB_PROTOCOL};

/// 请求头的长度上限，字节
pub const MAX_HEADER_BYTES: usize = 8 * 1024;

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// 一条 HTTP/1.1 升级请求：方法、目标与请求头（名不区分大小写）
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeRequest {
    /// 方法
    pub method: String,
    /// 请求目标
    pub target: String,
    headers: Vec<(String, String)>,
}

impl UpgradeRequest {
    /// 取请求头；同名的多行以逗号连起来，没有时为 None
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

/// 接受升级时的结论
#[derive(Clone, Debug, PartialEq)]
pub struct Accepted {
    /// 规范写法的来源
    pub origin: String,
    /// 选中的子协议
    pub sub_protocol: &'static str,
    /// Sec-WebSocket-Accept 的值
    pub accept_key: String,
    /// 浏览器只给了不带版本的子协议：升级后立即回错并关闭
    pub version_mismatch: bool,
}

/// 拒绝升级：回给浏览器的 HTTP 状态码与写进日志的原因
#[derive(Clone, Debug, PartialEq)]
pub struct Rejected {
    /// HTTP 状态码
    pub status: u16,
    /// 原因
    pub reason: String,
}

fn reject(status: u16, reason: impl Into<String>) -> Rejected {
    Rejected { status, reason: reason.into() }
}

/// 解析请求行与请求头；格式不对时为 None
pub fn parse(head: &[u8]) -> Option<UpgradeRequest> {
    if !head.is_ascii() {
        return None;
    }
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let start: Vec<&str> = lines.next()?.split(' ').collect();
    if start.len() != 3 || !start[2].starts_with("HTTP/1.") {
        return None;
    }
    let mut headers: Vec<(String, String)> = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let colon = line.find(':').filter(|index| *index > 0)?;
        let name = line[..colon].trim();
        let value = line[colon + 1..].trim();
        match headers.iter_mut().find(|(key, _)| key.eq_ignore_ascii_case(name)) {
            Some(existing) => {
                existing.1.push_str(", ");
                existing.1.push_str(value);
            }
            None => headers.push((name.to_owned(), value.to_owned())),
        }
    }
    Some(UpgradeRequest {
        method: start[0].to_owned(),
        target: start[1].to_owned(),
        headers,
    })
}

/// 按约定检查升级请求：GET、websocket 升级、版本 13、合法的 Key、Host 由监听方认可、Origin 合法、带上我们的子协议
pub fn evaluate(request: &UpgradeRequest, accepts_host: impl Fn(&str) -> bool) -> Result<Accepted, Rejected> {
    if request.method != "GET" {
        return Err(reject(405, "方法不是 GET"));
    }
    if !contains(request.header("Upgrade"), "websocket") || !contains(request.header("Connection"), "upgrade") {
        return Err(reject(400, "不是 WebSocket 升级请求"));
    }
    if request.header("Sec-WebSocket-Version") != Some("13") {
        return Err(reject(426, "WebSocket 版本不是 13"));
    }
    let key = match request.header("Sec-WebSocket-Key") {
        Some(key) if is_valid_key(key) => key,
        _ => return Err(reject(400, "Sec-WebSocket-Key 不合法")),
    };
    let host = request.header("Host").unwrap_or("");
    if !accepts_host(host) {
        return Err(reject(403, format!("Host 不被接受：{host}")));
    }
    let Some(origin) = origin::normalize(request.header("Origin")) else {
        return Err(reject(403, format!("Origin 缺失或不合法：{}", request.header("Origin").unwrap_or(""))));
    };
    let offered: Vec<&str> = request
        .header("Sec-WebSocket-Protocol")
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect();
    let accept_key = compute_accept(key);
    if offered.contains(&SUB_PROTOCOL) {
        return Ok(Accepted {
            origin,
            sub_protocol: SUB_PROTOCOL,
            accept_key,
            version_mismatch: false,
        });
    }
    if offered.contains(&UNVERSIONED_SUB_PROTOCOL) {
        return Ok(Accepted {
            origin,
            sub_protocol: UNVERSIONED_SUB_PROTOCOL,
            accept_key,
            version_mismatch: true,
        });
    }
    Err(reject(400, "没有带上 xihan-print 子协议"))
}

/// 计算 Sec-WebSocket-Accept
pub fn compute_accept(key: &str) -> String {
    let mut hash = Sha1::new();
    hash.update(key.as_bytes());
    hash.update(GUID.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(hash.finalize())
}

/// 接受升级的回复
pub fn accept_response(accepted: &Accepted) -> Vec<u8> {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\nSec-WebSocket-Protocol: {}\r\n\r\n",
        accepted.accept_key, accepted.sub_protocol
    )
    .into_bytes()
}

/// 拒绝升级的回复，没有正文
pub fn reject_response(status: u16) -> Vec<u8> {
    let version = if status == 426 { "Sec-WebSocket-Version: 13\r\n" } else { "" };
    let phrase = match status {
        400 => "Bad Request",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        426 => "Upgrade Required",
        _ => "Error",
    };
    format!("HTTP/1.1 {status} {phrase}\r\n{version}Connection: close\r\nContent-Length: 0\r\n\r\n").into_bytes()
}

/// 本机回环地址加端口写成的 Host：127.0.0.1:端口 或 localhost:端口
pub fn is_loopback_host(host: &str, port: u16) -> bool {
    host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}")) || host.eq_ignore_ascii_case(&format!("localhost:{port}"))
}

fn is_valid_key(key: &str) -> bool {
    base64::engine::general_purpose::STANDARD.decode(key).is_ok_and(|bytes| bytes.len() == 16)
}

fn contains(header: Option<&str>, token: &str) -> bool {
    header.is_some_and(|value| value.split(',').any(|part| part.trim().eq_ignore_ascii_case(token)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";

    fn head(lines: &[&str]) -> Vec<u8> {
        let mut text = String::from("GET / HTTP/1.1\r\n");
        for line in lines {
            text.push_str(line);
            text.push_str("\r\n");
        }
        text.push_str("\r\n");
        text.into_bytes()
    }

    fn standard(extra: &[&str]) -> UpgradeRequest {
        let mut lines = vec![
            "Host: 127.0.0.1:17620",
            "Upgrade: websocket",
            "Connection: keep-alive, Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Origin: https://erp.example.com",
        ];
        lines.extend_from_slice(extra);
        parse(&head(&lines)).unwrap()
    }

    fn loopback(host: &str) -> bool {
        is_loopback_host(host, 17620)
    }

    #[test]
    fn computes_the_accept_key_from_the_rfc_example() {
        assert_eq!(compute_accept(KEY), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn accepts_the_versioned_sub_protocol() {
        let accepted = evaluate(&standard(&["Sec-WebSocket-Protocol: xihan-print, xihan-print.v1"]), loopback).unwrap();
        assert_eq!(accepted.origin, "https://erp.example.com");
        assert_eq!(accepted.sub_protocol, "xihan-print.v1");
        assert!(!accepted.version_mismatch);
        let response = String::from_utf8(accept_response(&accepted)).unwrap();
        assert!(response.contains("Sec-WebSocket-Protocol: xihan-print.v1\r\n"));
    }

    #[test]
    fn falls_back_to_the_unversioned_sub_protocol() {
        let accepted = evaluate(&standard(&["Sec-WebSocket-Protocol: xihan-print, xihan-print.v2"]), loopback).unwrap();
        assert!(accepted.version_mismatch);
        assert_eq!(accepted.sub_protocol, "xihan-print");
    }

    #[test]
    fn rejects_requests_that_break_the_rules() {
        let protocol = "Sec-WebSocket-Protocol: xihan-print.v1";
        assert_eq!(evaluate(&standard(&[]), loopback).unwrap_err().status, 400);
        let wrong_host = parse(&head(&[
            "Host: evil.example:17620",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Origin: https://a.example",
            protocol,
        ]))
        .unwrap();
        assert_eq!(evaluate(&wrong_host, loopback).unwrap_err().status, 403);
        let no_origin = parse(&head(&[
            "Host: localhost:17620",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            protocol,
        ]))
        .unwrap();
        assert_eq!(evaluate(&no_origin, loopback).unwrap_err().status, 403);
        let old = parse(&head(&[
            "Host: localhost:17620",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 8",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            protocol,
        ]))
        .unwrap();
        assert_eq!(evaluate(&old, loopback).unwrap_err().status, 426);
        assert!(String::from_utf8(reject_response(426)).unwrap().contains("Sec-WebSocket-Version: 13"));
        let bad_key = parse(&head(&[
            "Host: localhost:17620",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: c2hvcnQ=",
            protocol,
        ]))
        .unwrap();
        assert_eq!(evaluate(&bad_key, loopback).unwrap_err().status, 400);
    }

    #[test]
    fn parses_headers_without_case_and_joins_repeats() {
        let request = parse(b"GET /x HTTP/1.1\r\nX-A: 1\r\nx-a: 2\r\n\r\n").unwrap();
        assert_eq!(request.target, "/x");
        assert_eq!(request.header("X-a"), Some("1, 2"));
        assert!(parse(b"GET /x\r\n\r\n").is_none());
        assert!(parse(b"GET / HTTP/1.1\r\nbroken\r\n\r\n").is_none());
    }
}
