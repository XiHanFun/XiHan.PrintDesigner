// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 会话：握手时建立，断线后在重连期限内可凭令牌认回，任务事件经它发给当前连接

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;

use super::websocket::Connection;
use crate::time::{Clock, Timestamp};

/// 一个来源的会话
pub struct Session {
    id: String,
    origin: String,
    token: String,
    state: Mutex<SessionState>,
}

struct SessionState {
    connection: Option<Arc<Connection>>,
    detached_at: Option<Timestamp>,
}

impl Session {
    /// 会话标识，只在客户端内部用
    pub fn id(&self) -> &str {
        &self.id
    }

    /// 规范写法的来源
    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// 重连令牌
    pub fn token(&self) -> &str {
        &self.token
    }

    /// 断开的时间；连着时为 None
    pub fn detached_at(&self) -> Option<Timestamp> {
        self.state.lock().unwrap().detached_at
    }

    /// 当前是否连着
    pub fn is_attached(&self) -> bool {
        self.state.lock().unwrap().connection.is_some()
    }

    /// 发一条文本消息给当前连接；断开时丢弃并返回 false
    pub async fn send(&self, message: &[u8]) -> bool {
        match self.current() {
            Some(connection) => connection.send_text(message).await,
            None => false,
        }
    }

    /// 发一条二进制消息给当前连接；断开时丢弃并返回 false
    pub async fn send_binary(&self, message: &[u8]) -> bool {
        match self.current() {
            Some(connection) => connection.send_binary(message).await,
            None => false,
        }
    }

    fn current(&self) -> Option<Arc<Connection>> {
        self.state.lock().unwrap().connection.clone()
    }

    fn attach(&self, connection: Arc<Connection>) {
        let mut state = self.state.lock().unwrap();
        state.connection = Some(connection);
        state.detached_at = None;
    }

    fn detach(&self, connection: &Arc<Connection>, now: Timestamp) {
        let mut state = self.state.lock().unwrap();
        if state.connection.as_ref().is_some_and(|current| Arc::ptr_eq(current, connection)) {
            state.connection = None;
            state.detached_at = Some(now);
        }
    }
}

type ExpiredHandler = Box<dyn Fn(&Arc<Session>) + Send + Sync>;

/// 会话与连接数的登记：建会话、凭令牌认回会话、清掉过了重连期限的会话、按来源数连接
pub struct SessionRegistry {
    resume_window: Duration,
    clock: Arc<dyn Clock>,
    state: Mutex<RegistryState>,
    expired: Mutex<Vec<ExpiredHandler>>,
}

#[derive(Default)]
struct RegistryState {
    by_token: HashMap<String, Arc<Session>>,
    connections: HashMap<String, usize>,
}

impl SessionRegistry {
    /// 按重连期限创建
    pub fn new(resume_window: Duration, clock: Arc<dyn Clock>) -> Self {
        SessionRegistry {
            resume_window,
            clock,
            state: Mutex::new(RegistryState::default()),
            expired: Mutex::new(Vec::new()),
        }
    }

    /// 会话过了重连期限被清掉时调用
    pub fn on_expired(&self, handler: impl Fn(&Arc<Session>) + Send + Sync + 'static) {
        self.expired.lock().unwrap().push(Box::new(handler));
    }

    /// 某来源多占一条连接；超过上限时返回 false
    pub fn try_acquire_connection(&self, origin: &str, limit: usize) -> bool {
        let mut state = self.state.lock().unwrap();
        let count = state.connections.entry(origin.to_owned()).or_insert(0);
        if *count >= limit {
            return false;
        }
        *count += 1;
        true
    }

    /// 某来源释放一条连接
    pub fn release_connection(&self, origin: &str) {
        let mut state = self.state.lock().unwrap();
        if let Some(count) = state.connections.get_mut(origin) {
            *count -= 1;
            if *count == 0 {
                state.connections.remove(origin);
            }
        }
    }

    /// 凭令牌认回同一来源、仍在重连期限内、没连着的会话并接上连接；认不回时新建会话。第二项表示是否认回
    pub fn open(&self, origin: &str, token: Option<&str>, connection: Arc<Connection>) -> (Arc<Session>, bool) {
        let (session, resumed, expired) = {
            let mut state = self.state.lock().unwrap();
            let expired = self.sweep_locked(&mut state);
            let existing = token
                .and_then(|token| state.by_token.get(token))
                .filter(|session| session.origin == origin && !session.is_attached())
                .cloned();
            let (session, resumed) = match existing {
                Some(session) => (session, true),
                None => {
                    let session = Arc::new(Session {
                        id: random_hex(16),
                        origin: origin.to_owned(),
                        token: new_token(),
                        state: Mutex::new(SessionState {
                            connection: None,
                            detached_at: None,
                        }),
                    });
                    state.by_token.insert(session.token.clone(), session.clone());
                    (session, false)
                }
            };
            session.attach(connection);
            (session, resumed, expired)
        };
        self.notify(&expired);
        (session, resumed)
    }

    /// 连接断开：会话进入重连期限
    pub fn detach(&self, session: &Session, connection: &Arc<Connection>) {
        session.detach(connection, self.clock.now());
    }

    /// 清掉过了重连期限的会话
    pub fn sweep(&self) {
        let expired = {
            let mut state = self.state.lock().unwrap();
            self.sweep_locked(&mut state)
        };
        self.notify(&expired);
    }

    /// 登记着的会话数
    pub fn len(&self) -> usize {
        self.state.lock().unwrap().by_token.len()
    }

    /// 没有登记着的会话
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn sweep_locked(&self, state: &mut RegistryState) -> Vec<Arc<Session>> {
        let now = self.clock.now();
        let expired: Vec<Arc<Session>> = state
            .by_token
            .values()
            .filter(|session| session.detached_at().is_some_and(|at| now.since(at) > self.resume_window))
            .cloned()
            .collect();
        for session in &expired {
            state.by_token.remove(&session.token);
        }
        expired
    }

    fn notify(&self, expired: &[Arc<Session>]) {
        if expired.is_empty() {
            return;
        }
        let handlers = self.expired.lock().unwrap();
        for session in expired {
            for handler in handlers.iter() {
                handler(session);
            }
        }
    }
}

/// 随机字节写成小写十六进制
pub fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("系统随机数可用");
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn new_token() -> String {
    let mut buffer = [0u8; 16];
    getrandom::fill(&mut buffer).expect("系统随机数可用");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::websocket::tests::pair;
    use crate::time::ManualClock;

    fn registry() -> (SessionRegistry, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock::new(Timestamp(0), 0));
        (SessionRegistry::new(Duration::from_secs(600), clock.clone()), clock)
    }

    #[tokio::test]
    async fn resumes_only_the_same_origin_within_the_window() {
        let (registry, clock) = registry();
        let (first, _inbox, _peer) = pair(1024);
        let (session, resumed) = registry.open("https://a.example", None, first.clone());
        assert!(!resumed);
        assert!(session.is_attached());

        let (second, _inbox2, _peer2) = pair(1024);
        let (other, resumed) = registry.open("https://a.example", Some(session.token()), second.clone());
        assert!(!resumed, "连着的会话不能被认走");
        assert!(!Arc::ptr_eq(&other, &session));

        registry.detach(&session, &first);
        assert!(!session.is_attached());
        let (third, _inbox3, _peer3) = pair(1024);
        let (wrong, resumed) = registry.open("https://b.example", Some(session.token()), third.clone());
        assert!(!resumed);
        assert!(!Arc::ptr_eq(&wrong, &session));

        clock.advance(Duration::from_secs(599));
        let (again, resumed) = registry.open("https://a.example", Some(session.token()), third);
        assert!(resumed);
        assert!(Arc::ptr_eq(&again, &session));
    }

    #[tokio::test]
    async fn expires_detached_sessions_after_the_window() {
        let (registry, clock) = registry();
        let expired = Arc::new(Mutex::new(Vec::new()));
        registry.on_expired({
            let expired = expired.clone();
            move |session| expired.lock().unwrap().push(session.origin().to_owned())
        });
        let (connection, _inbox, _peer) = pair(1024);
        let (session, _) = registry.open("https://a.example", None, connection.clone());
        registry.detach(&session, &connection);
        clock.advance(Duration::from_secs(601));
        registry.sweep();
        assert_eq!(*expired.lock().unwrap(), vec!["https://a.example".to_owned()]);
        assert!(registry.is_empty());
    }

    #[test]
    fn counts_connections_per_origin() {
        let (registry, _) = registry();
        assert!(registry.try_acquire_connection("o", 2));
        assert!(registry.try_acquire_connection("o", 2));
        assert!(!registry.try_acquire_connection("o", 2));
        registry.release_connection("o");
        assert!(registry.try_acquire_connection("o", 2));
    }
}
