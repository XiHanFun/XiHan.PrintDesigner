// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 打印服务：经监听接受 WebSocket 连接，检查升级请求，握手与来源授权，之后把业务请求交给 [`RequestHandler`]

mod listener;
pub mod origin;
mod session;
pub mod upgrade;
pub mod websocket;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::task::JoinHandle;

pub use listener::{BindFn, ByteStream, Listener, LoopbackListener, Peer, bind_default};
pub use session::{Session, SessionRegistry, random_hex};

use crate::BoxFuture;
use crate::cancel::Cancel;
use crate::defaults::{MAX_MESSAGE_BYTES, PORTS, PROTOCOL_VERSION};
use crate::log::SharedLog;
use crate::protocol::codes::errors;
use crate::protocol::{self, ClientCapabilities, ClientInfo, ClientRequest, Details, HelloRequest, ProtocolError, RequestBody, WelcomeData, writer};
use crate::time::Clock;
use websocket::{Connection, Inbox};

/// 客户端主动关闭连接时用的关闭码
pub mod close_codes {
    /// 客户端正在退出
    pub const GOING_AWAY: u16 = 1001;
    /// 连接后第一条不是 hello
    pub const HELLO_REQUIRED: u16 = 4400;
    /// 来源不被允许
    pub const ORIGIN_REJECTED: u16 = 4401;
    /// 握手被拒绝，如访问密钥不对
    pub const ACCESS_DENIED: u16 = 4403;
    /// 太久没有收到消息
    pub const IDLE_TIMEOUT: u16 = 4408;
    /// 同一来源的连接数超过上限
    pub const TOO_MANY_CONNECTIONS: u16 = 4409;
    /// 协议主版本不匹配
    pub const PROTOCOL_UNSUPPORTED: u16 = 4426;
}

/// 服务的端口、期限与上限
#[derive(Clone, Debug)]
pub struct ServerOptions {
    /// 本机回环监听依次尝试的端口
    pub ports: Vec<u16>,
    /// 读完升级请求的期限
    pub handshake_timeout: Duration,
    /// 多久收不到任何消息就关闭连接
    pub idle_timeout: Duration,
    /// 断线后多久内可以凭令牌认回会话
    pub resume_window: Duration,
    /// 单条消息上限，字节
    pub max_message_bytes: usize,
    /// 任务资源解码后的总量上限，字节
    pub max_resource_bytes: usize,
    /// 同一来源同时保持的连接数上限
    pub max_connections_per_origin: usize,
}

impl Default for ServerOptions {
    fn default() -> Self {
        ServerOptions {
            ports: PORTS.to_vec(),
            handshake_timeout: Duration::from_secs(5),
            idle_timeout: Duration::from_secs(45),
            resume_window: Duration::from_secs(600),
            max_message_bytes: MAX_MESSAGE_BYTES,
            max_resource_bytes: protocol::MAX_RESOURCE_BYTES,
            max_connections_per_origin: 8,
        }
    }
}

/// 来源授权的结论
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsentDecision {
    /// 允许
    Allowed,
    /// 拒绝，或来源在拒绝名单
    Denied,
    /// 授权窗口在期限内没人处理
    TimedOut,
}

/// 授权的进展：已有结论，或要等用户在授权窗口里决定
pub enum Authorization {
    /// 已有结论
    Decided(ConsentDecision),
    /// 已弹出授权窗口，等结论；丢弃它只是不再等，不影响授权窗口
    Pending(BoxFuture<'static, ConsentDecision>),
}

/// 来源授权
pub trait OriginAuthorizer: Send + Sync {
    /// 给出来源的授权结论，要弹授权窗口时给出等待中的结论
    fn authorize(&self, origin: &str) -> Authorization;
}

/// 客户端自身的信息与能力，写进 welcome
pub trait ClientEnvironment: Send + Sync {
    /// 客户端信息
    fn info(&self) -> ClientInfo;

    /// 客户端能力
    fn capabilities(&self) -> ClientCapabilities;
}

/// 处理请求时的未预期错误：记日志并回 INTERNAL
pub type HandlerError = Box<dyn std::error::Error + Send + Sync>;

/// 握手之后的业务请求由它处理：查打印机、受理任务、查与取消任务
pub trait RequestHandler: Send + Sync {
    /// 处理一条请求，回复经 session 发出；不等任务执行完
    fn handle<'a>(&'a self, session: &'a Arc<Session>, request: ClientRequest) -> BoxFuture<'a, Result<(), HandlerError>>;

    /// 会话重连后仍未结束的任务
    fn unfinished_jobs(&self, session: &Arc<Session>) -> Vec<String>;

    /// 会话重连、welcome 发出之后，补发这些任务的当前状态
    fn replay<'a>(&'a self, session: &'a Arc<Session>) -> BoxFuture<'a, ()>;
}

/// 握手放行：来源授权之前按连接的另一端与 hello 决定是否放行，如核对访问密钥
pub trait HandshakeGate: Send + Sync {
    /// 放行时返回 Ok；给出错误时回给浏览器并以 4403 关闭
    fn admit(&self, peer: &Peer, origin: &str, hello: &HelloRequest) -> Result<(), ProtocolError>;
}

/// 一律放行
pub struct OpenGate;

impl HandshakeGate for OpenGate {
    fn admit(&self, _peer: &Peer, _origin: &str, _hello: &HelloRequest) -> Result<(), ProtocolError> {
        Ok(())
    }
}

/// 组成服务的各部分
pub struct ServerParts {
    /// 端口、期限与上限
    pub options: ServerOptions,
    /// 来源授权
    pub authorizer: Arc<dyn OriginAuthorizer>,
    /// 客户端信息与能力
    pub environment: Arc<dyn ClientEnvironment>,
    /// 业务请求
    pub handler: Arc<dyn RequestHandler>,
    /// 握手放行
    pub gate: Arc<dyn HandshakeGate>,
    /// 时钟
    pub clock: Arc<dyn Clock>,
    /// 日志
    pub log: SharedLog,
}

struct Inner {
    options: ServerOptions,
    authorizer: Arc<dyn OriginAuthorizer>,
    environment: Arc<dyn ClientEnvironment>,
    handler: Arc<dyn RequestHandler>,
    gate: Arc<dyn HandshakeGate>,
    sessions: Arc<SessionRegistry>,
    log: SharedLog,
    stopping: Cancel,
    listeners: Mutex<Vec<Arc<dyn Listener>>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

/// 打印服务；必须在 tokio 运行时里创建
pub struct PrintServer {
    inner: Arc<Inner>,
}

impl PrintServer {
    /// 创建服务，并开始每分钟清一次过了重连期限的会话；add_listener 之后才接受连接
    pub fn new(parts: ServerParts) -> Self {
        let sessions = Arc::new(SessionRegistry::new(parts.options.resume_window, parts.clock));
        let inner = Arc::new(Inner {
            options: parts.options,
            authorizer: parts.authorizer,
            environment: parts.environment,
            handler: parts.handler,
            gate: parts.gate,
            sessions,
            log: parts.log,
            stopping: Cancel::new(),
            listeners: Mutex::new(Vec::new()),
            tasks: Mutex::new(Vec::new()),
        });
        let sweeper = tokio::spawn({
            let inner = inner.clone();
            async move {
                loop {
                    if inner.stopping.run(tokio::time::sleep(Duration::from_secs(60))).await.is_err() {
                        return;
                    }
                    inner.sessions.sweep();
                }
            }
        });
        inner.tasks.lock().unwrap().push(sweeper);
        PrintServer { inner }
    }

    /// 端口、期限与上限
    pub fn options(&self) -> &ServerOptions {
        &self.inner.options
    }

    /// 会话登记
    pub fn sessions(&self) -> &Arc<SessionRegistry> {
        &self.inner.sessions
    }

    /// 按选项里的端口建本机回环监听并开始接受连接，返回实际监听的端口；都不可用时返回最后一个错误
    pub fn listen_loopback(&self, bind: BindFn) -> std::io::Result<u16> {
        let log = self.inner.log.clone();
        let listener = LoopbackListener::bind(&self.inner.options.ports, bind, |port, error| log.info(&format!("端口 {port} 不可用：{error}")))?;
        let port = listener.local_address().port();
        self.add_listener(Arc::new(listener));
        Ok(port)
    }

    /// 加一个监听并开始接受连接
    pub fn add_listener(&self, listener: Arc<dyn Listener>) {
        self.inner.log.info(&format!("开始监听 {}（{}）", listener.local_address(), listener.name()));
        self.inner.listeners.lock().unwrap().push(listener.clone());
        let task = tokio::spawn(accept_loop(self.inner.clone(), listener));
        self.inner.track(task);
    }

    /// 在监听的地址与监听名
    pub fn listening(&self) -> Vec<(String, SocketAddr)> {
        self.inner
            .listeners
            .lock()
            .unwrap()
            .iter()
            .map(|listener| (listener.name().to_owned(), listener.local_address()))
            .collect()
    }

    /// 本机回环监听的端口；没在监听时为 None
    pub fn loopback_port(&self) -> Option<u16> {
        self.inner
            .listeners
            .lock()
            .unwrap()
            .iter()
            .find(|listener| listener.name() == "loopback")
            .map(|listener| listener.local_address().port())
    }

    /// 停止：不再接受连接，现有连接以 1001 关闭，等它们结束
    pub async fn stop(&self) {
        self.inner.stopping.cancel();
        let tasks: Vec<_> = self.inner.tasks.lock().unwrap().drain(..).collect();
        for task in tasks {
            let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
        }
        self.inner.listeners.lock().unwrap().clear();
    }
}

impl Inner {
    fn track(&self, task: JoinHandle<()>) {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.retain(|task| !task.is_finished());
        tasks.push(task);
    }
}

async fn accept_loop(inner: Arc<Inner>, listener: Arc<dyn Listener>) {
    loop {
        let accepted = match inner.stopping.run(listener.accept()).await {
            Err(_) => return,
            Ok(accepted) => accepted,
        };
        match accepted {
            Ok((stream, peer)) => {
                let task = tokio::spawn(serve(inner.clone(), listener.clone(), stream, peer));
                inner.track(task);
            }
            Err(error) => {
                inner.log.warn(&format!("接受连接出错（{}）：{error}", listener.name()));
                if inner.stopping.run(tokio::time::sleep(Duration::from_millis(200))).await.is_err() {
                    return;
                }
            }
        }
    }
}

async fn serve(inner: Arc<Inner>, listener: Arc<dyn Listener>, stream: Box<dyn ByteStream>, peer: Peer) {
    let handshake = inner.options.handshake_timeout;
    let stream = match tokio::time::timeout(handshake, listener.secure(stream)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(error)) => return inner.log.debug(&format!("连接没能建立（{}）：{error}", peer.address)),
        Err(_) => return inner.log.debug(&format!("连接没能在期限内建立：{}", peer.address)),
    };
    let mut stream = BufReader::new(stream);
    let head = match tokio::time::timeout(handshake, read_head(&mut stream)).await {
        Ok(Some(head)) => head,
        _ => return inner.log.debug(&format!("没有读到完整的升级请求：{}", peer.address)),
    };
    let decision = match upgrade::parse(&head) {
        Some(request) => upgrade::evaluate(&request, |host| listener.accepts_host(host)),
        None => Err(upgrade::Rejected {
            status: 400,
            reason: "升级请求格式不对".to_owned(),
        }),
    };
    let accepted = match decision {
        Ok(accepted) => accepted,
        Err(rejected) => {
            inner.log.warn(&format!("拒绝升级（{}）：{}", rejected.status, rejected.reason));
            let _ = tokio::time::timeout(handshake, stream.write_all(&upgrade::reject_response(rejected.status))).await;
            return;
        }
    };
    if !matches!(tokio::time::timeout(handshake, stream.write_all(&upgrade::accept_response(&accepted))).await, Ok(Ok(()))) {
        return;
    }
    let (connection, mut inbox) = websocket::open(Box::new(stream), inner.options.max_message_bytes);
    let origin = accepted.origin;
    if accepted.version_mismatch {
        connection.send_text(&writer::error(None, &unsupported())).await;
        connection.close(close_codes::PROTOCOL_UNSUPPORTED, "协议主版本不匹配").await;
        return inbox.finish(handshake).await;
    }
    if !inner.sessions.try_acquire_connection(&origin, inner.options.max_connections_per_origin) {
        connection.close(close_codes::TOO_MANY_CONNECTIONS, "连接数超过上限").await;
        return inbox.finish(handshake).await;
    }
    converse(&inner, &connection, &mut inbox, &origin, &peer).await;
    inner.sessions.release_connection(&origin);
}

/// 读升级请求：从开头到空行（含）的字节；超过上限或连接断开时为 None
async fn read_head(stream: &mut BufReader<Box<dyn ByteStream>>) -> Option<Vec<u8>> {
    let mut head = Vec::with_capacity(1024);
    while head.len() < upgrade::MAX_HEADER_BYTES {
        head.push(stream.read_u8().await.ok()?);
        if head.ends_with(b"\r\n\r\n") {
            return Some(head);
        }
    }
    None
}

fn unsupported() -> ProtocolError {
    ProtocolError::new(errors::PROTOCOL_UNSUPPORTED, "协议主版本不匹配").with_details(Details::new().with("supported", vec![PROTOCOL_VERSION]))
}

/// 收一条消息；超过空闲期限时以 4408 发起关闭，等对方回关闭帧（最多等一个握手期限）后返回 None；服务停止时以 1001 关闭
async fn receive(inner: &Inner, connection: &Connection, inbox: &mut Inbox) -> Option<Vec<u8>> {
    let received = tokio::select! {
        _ = inner.stopping.cancelled() => {
            connection.close(close_codes::GOING_AWAY, "客户端正在退出").await;
            return None;
        }
        received = tokio::time::timeout(inner.options.idle_timeout, inbox.next()) => received,
    };
    match received {
        Ok(message) => message,
        Err(_) => {
            connection.close(close_codes::IDLE_TIMEOUT, "太久没有收到消息").await;
            inbox.finish(inner.options.handshake_timeout).await;
            None
        }
    }
}

async fn converse(inner: &Inner, connection: &Arc<Connection>, inbox: &mut Inbox, origin: &str, peer: &Peer) {
    let Some(first) = receive(inner, connection, inbox).await else {
        return;
    };
    let hello = match protocol::read(&first, inner.options.max_resource_bytes) {
        Ok(ClientRequest {
            id,
            body: RequestBody::Hello(hello),
        }) => (id, hello),
        result => {
            let (id, error) = match result {
                Ok(request) => (Some(request.id), ProtocolError::new(errors::BAD_REQUEST, "第一条消息必须是 hello")),
                Err(failure) => (failure.id, failure.error),
            };
            connection.send_text(&writer::error(id.as_deref(), &error)).await;
            connection.close(close_codes::HELLO_REQUIRED, "第一条消息必须是 hello").await;
            return inbox.finish(inner.options.handshake_timeout).await;
        }
    };
    let (hello_id, hello) = hello;
    if hello.protocol != PROTOCOL_VERSION {
        connection.send_text(&writer::error(Some(&hello_id), &unsupported())).await;
        connection.close(close_codes::PROTOCOL_UNSUPPORTED, "协议主版本不匹配").await;
        return inbox.finish(inner.options.handshake_timeout).await;
    }
    if let Err(error) = inner.gate.admit(peer, origin, &hello) {
        inner.log.info(&format!("握手被拒绝（{}）：{origin}，{}", error.code, peer.address));
        connection.send_text(&writer::error(Some(&hello_id), &error)).await;
        connection.close(close_codes::ACCESS_DENIED, "握手被拒绝").await;
        return inbox.finish(inner.options.handshake_timeout).await;
    }

    let decision = match inner.authorizer.authorize(origin) {
        Authorization::Decided(decision) => decision,
        Authorization::Pending(pending) => {
            connection.send_text(&writer::consent_pending(origin)).await;
            match wait_for_consent(inner, connection, inbox, pending).await {
                Some(decision) => decision,
                None => return,
            }
        }
    };
    if decision != ConsentDecision::Allowed {
        let code = if decision == ConsentDecision::TimedOut {
            errors::CONSENT_TIMEOUT
        } else {
            errors::CONSENT_DENIED
        };
        inner.log.info(&format!("来源未获授权（{code}）：{origin}"));
        connection.send_text(&writer::error(Some(&hello_id), &ProtocolError::new(code, "来源未获授权"))).await;
        connection.close(close_codes::ORIGIN_REJECTED, "来源未获授权").await;
        return inbox.finish(inner.options.handshake_timeout).await;
    }

    let (session, resumed) = inner.sessions.open(origin, hello.resume.as_deref(), connection.clone());
    let resumed_jobs = if resumed { inner.handler.unfinished_jobs(&session) } else { Vec::new() };
    let welcome = WelcomeData::new(inner.environment.info(), session.token().to_owned(), inner.environment.capabilities(), resumed_jobs);
    connection.send_text(&writer::welcome(&hello_id, &welcome)).await;
    inner.log.info(&format!("会话{}：{origin}（{}）", if resumed { "已认回" } else { "已建立" }, peer.listener));
    if resumed {
        inner.handler.replay(&session).await;
    }
    serve_requests(inner, connection, inbox, &session).await;
    inner.sessions.detach(&session, connection);
}

/// 等授权结论，期间照常回心跳、其余请求回 CONSENT_PENDING；连接在此期间断开时返回 None
async fn wait_for_consent(inner: &Inner, connection: &Connection, inbox: &mut Inbox, mut pending: BoxFuture<'static, ConsentDecision>) -> Option<ConsentDecision> {
    loop {
        let message = tokio::select! {
            decision = &mut pending => return Some(decision),
            message = receive(inner, connection, inbox) => message,
        };
        let message = message?;
        let reply = match protocol::read(&message, inner.options.max_resource_bytes) {
            Ok(ClientRequest { id, body: RequestBody::Ping }) => writer::pong(&id),
            Ok(request) => writer::error(Some(&request.id), &ProtocolError::new(errors::CONSENT_PENDING, "正在等用户授权")),
            Err(failure) => writer::error(failure.id.as_deref(), &failure.error),
        };
        connection.send_text(&reply).await;
    }
}

async fn serve_requests(inner: &Inner, connection: &Connection, inbox: &mut Inbox, session: &Arc<Session>) {
    while let Some(message) = receive(inner, connection, inbox).await {
        let request = match protocol::read(&message, inner.options.max_resource_bytes) {
            Ok(request) => request,
            Err(failure) => {
                connection.send_text(&writer::error(failure.id.as_deref(), &failure.error)).await;
                continue;
            }
        };
        match &request.body {
            RequestBody::Ping => {
                connection.send_text(&writer::pong(&request.id)).await;
            }
            RequestBody::Hello(_) => {
                connection
                    .send_text(&writer::error(Some(&request.id), &ProtocolError::new(errors::BAD_REQUEST, "已经握过手")))
                    .await;
            }
            _ => {
                let id = request.id.clone();
                let kind = request.body.kind().to_owned();
                if let Err(error) = inner.handler.handle(session, request).await {
                    inner.log.error(&format!("处理 {kind} 时出错"), Some(error.as_ref()));
                    connection
                        .send_text(&writer::error(Some(&id), &ProtocolError::new(errors::INTERNAL, "客户端内部错误，详情见日志")))
                        .await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
