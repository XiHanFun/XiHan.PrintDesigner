// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 握手放行：核对访问密钥，以及把几道放行串起来

use std::sync::{Arc, RwLock};

use super::{HandshakeGate, Peer};
use crate::protocol::codes::errors;
use crate::protocol::{Details, HelloRequest, ProtocolError};

/// 访问密钥最短的字符数
pub const MIN_ACCESS_KEY_LENGTH: usize = 8;

/// 访问密钥最长的字符数
pub const MAX_ACCESS_KEY_LENGTH: usize = 128;

/// 是否是合法的访问密钥：8–128 个可打印 ASCII 字符，不含空格
pub fn is_access_key(text: &str) -> bool {
    (MIN_ACCESS_KEY_LENGTH..=MAX_ACCESS_KEY_LENGTH).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_graphic())
}

/// 核对握手里的访问密钥：设了密钥时 hello 的 key 必须一致，否则以 ACCESS_DENIED 拒绝；没设时一律放行
#[derive(Default)]
pub struct AccessKeyGate {
    key: RwLock<Option<String>>,
}

impl AccessKeyGate {
    /// 以生效的密钥创建
    pub fn new(key: Option<String>) -> Self {
        AccessKeyGate { key: RwLock::new(key) }
    }

    /// 换成新的密钥；已建立的连接不受影响，之后的握手按新密钥核对
    pub fn set(&self, key: Option<String>) {
        *self.key.write().unwrap() = key;
    }

    /// 是否设了密钥
    pub fn is_set(&self) -> bool {
        self.key.read().unwrap().is_some()
    }
}

/// 逐字节比较，耗时只与长度有关
fn same(given: &str, expected: &str) -> bool {
    given.len() == expected.len() && given.bytes().zip(expected.bytes()).fold(0u8, |difference, (a, b)| difference | (a ^ b)) == 0
}

impl HandshakeGate for AccessKeyGate {
    fn admit(&self, _peer: &Peer, _origin: &str, hello: &HelloRequest) -> Result<(), ProtocolError> {
        let key = self.key.read().unwrap();
        let Some(expected) = key.as_deref() else {
            return Ok(());
        };
        let reason = match hello.key.as_deref() {
            Some(given) if same(given, expected) => return Ok(()),
            Some(_) => "mismatch",
            None => "missing",
        };
        Err(ProtocolError::new(
            errors::ACCESS_DENIED,
            if reason == "missing" {
                "客户端设了访问密钥，握手没有带"
            } else {
                "访问密钥不对"
            },
        )
        .with_details(Details::new().with("reason", reason)))
    }
}

/// 依次过几道放行，都放行才放行，第一道拒绝的给出错误
pub struct GateChain(pub Vec<Arc<dyn HandshakeGate>>);

impl HandshakeGate for GateChain {
    fn admit(&self, peer: &Peer, origin: &str, hello: &HelloRequest) -> Result<(), ProtocolError> {
        self.0.iter().try_for_each(|gate| gate.admit(peer, origin, hello))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::OpenGate;

    fn peer() -> Peer {
        Peer {
            address: "127.0.0.1:50000".parse().unwrap(),
            local: true,
            secure: false,
            listener: "loopback".into(),
        }
    }

    fn hello(key: Option<&str>) -> HelloRequest {
        HelloRequest {
            protocol: 1,
            minor: 1,
            sdk: None,
            resume: None,
            key: key.map(str::to_owned),
        }
    }

    #[test]
    fn checks_the_key_only_when_one_is_set() {
        let gate = AccessKeyGate::new(None);
        assert!(gate.admit(&peer(), "https://a.example", &hello(None)).is_ok());
        gate.set(Some("k3y-for-erp".into()));
        assert!(gate.is_set());
        assert!(gate.admit(&peer(), "https://a.example", &hello(Some("k3y-for-erp"))).is_ok());
        for (key, reason) in [(None, "missing"), (Some("k3y-for-erP"), "mismatch"), (Some("k3y"), "mismatch")] {
            let error = gate.admit(&peer(), "https://a.example", &hello(key)).unwrap_err();
            assert_eq!(error.code, errors::ACCESS_DENIED);
            assert_eq!(error.details.unwrap().get("reason"), Some(&serde_json::json!(reason)));
        }
    }

    #[test]
    fn admits_only_when_every_gate_admits() {
        struct Deny;
        impl HandshakeGate for Deny {
            fn admit(&self, _peer: &Peer, _origin: &str, _hello: &HelloRequest) -> Result<(), ProtocolError> {
                Err(ProtocolError::new(errors::BAD_REQUEST, "拒绝"))
            }
        }
        let key: Arc<dyn HandshakeGate> = Arc::new(AccessKeyGate::new(Some("k3y-for-erp".into())));
        let chain = GateChain(vec![key.clone(), Arc::new(OpenGate)]);
        assert!(chain.admit(&peer(), "o", &hello(Some("k3y-for-erp"))).is_ok());
        assert_eq!(chain.admit(&peer(), "o", &hello(None)).unwrap_err().code, errors::ACCESS_DENIED);
        let chain = GateChain(vec![key, Arc::new(Deny)]);
        assert_eq!(chain.admit(&peer(), "o", &hello(Some("k3y-for-erp"))).unwrap_err().code, errors::BAD_REQUEST);
    }

    #[test]
    fn accepts_printable_ascii_keys_of_the_right_length() {
        assert!(is_access_key("abcdEFGH"));
        assert!(is_access_key(&"x".repeat(128)));
        for bad in ["short", "has space", "密钥密钥密钥", "tab\tkey12", &"x".repeat(129)] {
            assert!(!is_access_key(bad), "{bad}");
        }
    }
}
