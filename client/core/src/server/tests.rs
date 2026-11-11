// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

use super::*;
use crate::log::null_log;
use crate::time::SystemClock;

struct FakeAuthorizer {
    decision: Mutex<Option<oneshot::Receiver<ConsentDecision>>>,
    immediate: Option<ConsentDecision>,
}

impl OriginAuthorizer for FakeAuthorizer {
    fn authorize(&self, _origin: &str) -> Authorization {
        match self.immediate {
            Some(decision) => Authorization::Decided(decision),
            None => {
                let receiver = self.decision.lock().unwrap().take().expect("只等一次授权");
                Authorization::Pending(Box::pin(async move { receiver.await.unwrap_or(ConsentDecision::TimedOut) }))
            }
        }
    }
}

struct FakeEnvironment;

impl ClientEnvironment for FakeEnvironment {
    fn info(&self) -> ClientInfo {
        ClientInfo {
            version: "1.0.0".into(),
            os: "windows".into(),
            arch: "x64".into(),
            renderer: None,
        }
    }

    fn capabilities(&self) -> ClientCapabilities {
        ClientCapabilities {
            raw: true,
            ..ClientCapabilities::default()
        }
    }
}

#[derive(Default)]
struct FakeHandler {
    handled: Mutex<Vec<String>>,
    replayed: AtomicUsize,
}

impl RequestHandler for FakeHandler {
    fn handle<'a>(&'a self, session: &'a Arc<Session>, request: ClientRequest) -> BoxFuture<'a, Result<(), HandlerError>> {
        Box::pin(async move {
            self.handled.lock().unwrap().push(request.body.kind().to_owned());
            if request.body.kind() == "printers.list" {
                session.send(&writer::printers(&request.id, &[])).await;
                Ok(())
            } else {
                Err("坏了".into())
            }
        })
    }

    fn unfinished_jobs(&self, _session: &Arc<Session>) -> Vec<String> {
        vec!["j1".into()]
    }

    fn replay<'a>(&'a self, session: &'a Arc<Session>) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.replayed.fetch_add(1, Ordering::SeqCst);
            session.send(br#"{"type":"job.started","jobId":"j1"}"#).await;
        })
    }
}

struct KeyGate;

impl HandshakeGate for KeyGate {
    fn admit(&self, _peer: &Peer, _origin: &str, hello: &HelloRequest) -> Result<(), ProtocolError> {
        if hello.key.as_deref() == Some("k") {
            Ok(())
        } else {
            Err(ProtocolError::new("KEY_INVALID", "访问密钥不对"))
        }
    }
}

struct Harness {
    server: PrintServer,
    port: u16,
    handler: Arc<FakeHandler>,
}

fn start(authorizer: FakeAuthorizer, gate: Arc<dyn HandshakeGate>, tune: impl FnOnce(&mut ServerOptions)) -> Harness {
    let mut options = ServerOptions {
        ports: vec![0],
        ..ServerOptions::default()
    };
    tune(&mut options);
    let handler = Arc::new(FakeHandler::default());
    let server = PrintServer::new(ServerParts {
        options,
        authorizer: Arc::new(authorizer),
        environment: Arc::new(FakeEnvironment),
        handler: handler.clone(),
        gate,
        clock: Arc::new(SystemClock::utc()),
        log: null_log(),
    });
    let port = server.listen_loopback(bind_default).unwrap();
    Harness { server, port, handler }
}

fn allowing() -> FakeAuthorizer {
    FakeAuthorizer {
        decision: Mutex::new(None),
        immediate: Some(ConsentDecision::Allowed),
    }
}

/// 浏览器一侧的连接：带掩码发帧
struct Client {
    stream: TcpStream,
}

impl Client {
    async fn upgrade(port: u16, headers: &[(&str, String)]) -> (Client, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let mut request = String::from("GET / HTTP/1.1\r\n");
        for (name, value) in headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            match stream.read_u8().await {
                Ok(byte) => head.push(byte),
                Err(_) => break,
            }
        }
        (Client { stream }, String::from_utf8(head).unwrap())
    }

    async fn connect(port: u16, protocols: &str) -> Client {
        let (client, response) = Client::upgrade(port, &standard_headers(port, protocols)).await;
        assert!(response.starts_with("HTTP/1.1 101"), "{response}");
        client
    }

    async fn send(&mut self, opcode: u8, payload: &[u8]) {
        let mut frame = vec![0x80 | opcode];
        match payload.len() {
            length @ 0..=125 => frame.push(0x80 | length as u8),
            length @ 126..=65_535 => {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&(length as u16).to_be_bytes());
            }
            length => {
                frame.push(0x80 | 127);
                frame.extend_from_slice(&(length as u64).to_be_bytes());
            }
        }
        frame.extend_from_slice(&[7, 7, 7, 7]);
        frame.extend(payload.iter().map(|byte| byte ^ 7));
        let _ = self.stream.write_all(&frame).await;
    }

    async fn json(&mut self, value: Value) {
        self.send(0x1, value.to_string().as_bytes()).await;
    }

    async fn frame(&mut self) -> Option<(u8, Vec<u8>)> {
        let mut head = [0u8; 2];
        self.stream.read_exact(&mut head).await.ok()?;
        let length = match head[1] & 0x7F {
            126 => u64::from(self.stream.read_u16().await.ok()?),
            127 => self.stream.read_u64().await.ok()?,
            length => u64::from(length),
        };
        let mut payload = vec![0u8; length as usize];
        self.stream.read_exact(&mut payload).await.ok()?;
        Some((head[0] & 0x0F, payload))
    }

    async fn message(&mut self) -> Value {
        let (opcode, payload) = self.frame().await.expect("连接已断开");
        assert_eq!(opcode, 0x1, "期望文本，收到 {opcode}：{}", String::from_utf8_lossy(&payload));
        serde_json::from_slice(&payload).unwrap()
    }

    async fn close_code(&mut self) -> u16 {
        loop {
            match self.frame().await {
                Some((0x8, payload)) => return u16::from_be_bytes([payload[0], payload[1]]),
                Some(_) => continue,
                None => panic!("没有收到关闭帧"),
            }
        }
    }

    async fn hello(&mut self, extra: Value) -> Value {
        let mut hello = json!({ "type": "hello", "id": "h", "protocol": 1, "minor": 0 });
        for (key, value) in extra.as_object().unwrap() {
            hello[key] = value.clone();
        }
        self.json(hello).await;
        self.message().await
    }
}

fn standard_headers(port: u16, protocols: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Host", format!("127.0.0.1:{port}")),
        ("Upgrade", "websocket".into()),
        ("Connection", "Upgrade".into()),
        ("Sec-WebSocket-Version", "13".into()),
        ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==".into()),
        ("Origin", "https://erp.example.com".into()),
        ("Sec-WebSocket-Protocol", protocols.into()),
    ]
}

#[tokio::test]
async fn handshakes_then_answers_pings_and_hands_business_requests_to_the_handler() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut client = Client::connect(harness.port, "xihan-print, xihan-print.v1").await;
    let welcome = client.hello(json!({})).await;
    assert_eq!(welcome["ok"], json!(true));
    assert_eq!(welcome["data"]["protocol"], json!(1));
    assert_eq!(welcome["data"]["capabilities"]["raw"], json!(true));
    assert_eq!(welcome["data"]["resumed"], json!([]));
    assert!(welcome["data"]["sessionToken"].as_str().unwrap().len() >= 20);

    client.json(json!({ "type": "ping", "id": "p1" })).await;
    assert_eq!(client.message().await, json!({ "type": "pong", "id": "p1" }));
    client.json(json!({ "type": "printers.list", "id": "l1" })).await;
    assert_eq!(client.message().await, json!({ "type": "result", "id": "l1", "ok": true, "data": [] }));
    client.json(json!({ "type": "job.get", "id": "g1", "jobId": "x" })).await;
    assert_eq!(client.message().await["error"]["code"], json!("INTERNAL"));
    client.json(json!({ "type": "hello", "id": "h2", "protocol": 1 })).await;
    assert_eq!(client.message().await["error"]["message"], json!("已经握过手"));
    client.send(0x1, b"{oops").await;
    assert_eq!(client.message().await["error"]["code"], json!("BAD_REQUEST"));
    assert_eq!(*harness.handler.handled.lock().unwrap(), vec!["printers.list", "job.get"]);
    harness.server.stop().await;
}

#[tokio::test]
async fn rejects_upgrades_without_origin_or_with_a_foreign_host() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut headers = standard_headers(harness.port, "xihan-print.v1");
    headers.retain(|(name, _)| *name != "Origin");
    let (_, response) = Client::upgrade(harness.port, &headers).await;
    assert!(response.starts_with("HTTP/1.1 403"), "{response}");

    let mut headers = standard_headers(harness.port, "xihan-print.v1");
    headers[0].1 = format!("evil.example:{}", harness.port);
    let (_, response) = Client::upgrade(harness.port, &headers).await;
    assert!(response.starts_with("HTTP/1.1 403"), "{response}");

    let mut headers = standard_headers(harness.port, "xihan-print.v1");
    headers[0].1 = format!("localhost:{}", harness.port);
    let (_, response) = Client::upgrade(harness.port, &headers).await;
    assert!(response.starts_with("HTTP/1.1 101"), "{response}");
}

#[tokio::test]
async fn reports_protocol_unsupported_when_only_the_unversioned_sub_protocol_is_offered() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut client = Client::connect(harness.port, "xihan-print, xihan-print.v2").await;
    let error = client.message().await;
    assert_eq!(error["error"]["code"], json!("PROTOCOL_UNSUPPORTED"));
    assert_eq!(error["error"]["details"]["supported"], json!([1]));
    assert_eq!(client.close_code().await, close_codes::PROTOCOL_UNSUPPORTED);

    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    let error = client.hello(json!({ "protocol": 2 })).await;
    assert_eq!(error["error"]["code"], json!("PROTOCOL_UNSUPPORTED"));
    assert_eq!(client.close_code().await, close_codes::PROTOCOL_UNSUPPORTED);
}

#[tokio::test]
async fn closes_when_the_first_message_is_not_hello() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    client.json(json!({ "type": "ping", "id": "p" })).await;
    let error = client.message().await;
    assert_eq!((error["id"].clone(), error["error"]["code"].clone()), (json!("p"), json!("BAD_REQUEST")));
    assert_eq!(client.close_code().await, close_codes::HELLO_REQUIRED);
}

#[tokio::test]
async fn refuses_the_handshake_when_the_gate_says_no() {
    let harness = start(allowing(), Arc::new(KeyGate), |_| {});
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    assert_eq!(client.hello(json!({ "key": "wrong" })).await["error"]["code"], json!("KEY_INVALID"));
    assert_eq!(client.close_code().await, close_codes::ACCESS_DENIED);
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    assert_eq!(client.hello(json!({ "key": "k" })).await["ok"], json!(true));
}

#[tokio::test]
async fn refuses_a_missing_or_wrong_access_key_with_access_denied() {
    let gate = Arc::new(AccessKeyGate::new(Some("k3y-for-erp".into())));
    let harness = start(allowing(), gate.clone(), |_| {});
    for (extra, reason) in [(json!({}), "missing"), (json!({ "key": "k3y-for-erP" }), "mismatch")] {
        let mut client = Client::connect(harness.port, "xihan-print.v1").await;
        let error = client.hello(extra).await["error"].clone();
        assert_eq!((error["code"].clone(), error["details"]["reason"].clone()), (json!("ACCESS_DENIED"), json!(reason)));
        assert_eq!(client.close_code().await, close_codes::ACCESS_DENIED);
    }
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    assert_eq!(client.hello(json!({ "key": "k3y-for-erp" })).await["ok"], json!(true));
    gate.set(None);
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    assert_eq!(client.hello(json!({})).await["ok"], json!(true));
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

#[tokio::test]
async fn moves_the_loopback_listener_and_keeps_existing_connections() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let old = harness.port;
    let mut kept = Client::connect(old, "xihan-print.v1").await;
    assert_eq!(kept.hello(json!({})).await["ok"], json!(true));
    assert_eq!(harness.server.rebind_loopback(&[old], bind_default).unwrap(), old);

    let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let busy = occupied.local_addr().unwrap().port();
    assert!(harness.server.rebind_loopback(&[busy], bind_default).is_err());
    assert_eq!(harness.server.loopback_port(), Some(old));

    let new = free_port();
    assert_eq!(harness.server.rebind_loopback(&[busy, new], bind_default).unwrap(), new);
    assert_eq!(harness.server.loopback_port(), Some(new));
    assert_eq!(harness.server.listening().len(), 1);
    let mut fresh = Client::connect(new, "xihan-print.v1").await;
    assert_eq!(fresh.hello(json!({})).await["ok"], json!(true));
    kept.json(json!({ "type": "ping", "id": "p" })).await;
    assert_eq!(kept.message().await, json!({ "type": "pong", "id": "p" }));
    let mut closed = false;
    for _ in 0..50 {
        if TcpStream::connect(("127.0.0.1", old)).await.is_err() {
            closed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(closed, "旧端口应当不再接受连接");
    harness.server.stop().await;
}

#[tokio::test]
async fn answers_pings_and_refuses_business_while_waiting_for_consent() {
    let (decide, receiver) = oneshot::channel();
    let harness = start(
        FakeAuthorizer {
            decision: Mutex::new(Some(receiver)),
            immediate: None,
        },
        Arc::new(OpenGate),
        |_| {},
    );
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    client.json(json!({ "type": "hello", "id": "h", "protocol": 1 })).await;
    assert_eq!(client.message().await, json!({ "type": "consent.pending", "origin": "https://erp.example.com" }));
    client.json(json!({ "type": "ping", "id": "p" })).await;
    assert_eq!(client.message().await["type"], json!("pong"));
    client.json(json!({ "type": "printers.list", "id": "l" })).await;
    assert_eq!(client.message().await["error"]["code"], json!("CONSENT_PENDING"));
    decide.send(ConsentDecision::Allowed).unwrap();
    assert_eq!(client.message().await["ok"], json!(true));
}

#[tokio::test]
async fn closes_when_the_origin_is_not_authorized() {
    for (decision, code) in [(ConsentDecision::Denied, "CONSENT_DENIED"), (ConsentDecision::TimedOut, "CONSENT_TIMEOUT")] {
        let harness = start(
            FakeAuthorizer {
                decision: Mutex::new(None),
                immediate: Some(decision),
            },
            Arc::new(OpenGate),
            |_| {},
        );
        let mut client = Client::connect(harness.port, "xihan-print.v1").await;
        assert_eq!(client.hello(json!({})).await["error"]["code"], json!(code));
        assert_eq!(client.close_code().await, close_codes::ORIGIN_REJECTED);
    }
}

#[tokio::test]
async fn resumes_the_session_with_its_token_and_replays_unfinished_jobs() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut first = Client::connect(harness.port, "xihan-print.v1").await;
    let token = first.hello(json!({})).await["data"]["sessionToken"].as_str().unwrap().to_owned();
    first.send(0x8, &1000u16.to_be_bytes()).await;
    assert_eq!(first.close_code().await, 1000);
    drop(first);
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut second = Client::connect(harness.port, "xihan-print.v1").await;
    let welcome = second.hello(json!({ "resume": token })).await;
    assert_eq!(welcome["data"]["sessionToken"], json!(token));
    assert_eq!(welcome["data"]["resumed"], json!(["j1"]));
    assert_eq!(second.message().await["type"], json!("job.started"));
    assert_eq!(harness.handler.replayed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn closes_idle_connections() {
    let harness = start(allowing(), Arc::new(OpenGate), |options| {
        options.idle_timeout = Duration::from_millis(200);
        options.handshake_timeout = Duration::from_millis(500);
    });
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    client.hello(json!({})).await;
    assert_eq!(client.close_code().await, close_codes::IDLE_TIMEOUT);
}

#[tokio::test]
async fn limits_connections_per_origin() {
    let harness = start(allowing(), Arc::new(OpenGate), |options| options.max_connections_per_origin = 1);
    let mut first = Client::connect(harness.port, "xihan-print.v1").await;
    first.hello(json!({})).await;
    let mut second = Client::connect(harness.port, "xihan-print.v1").await;
    assert_eq!(second.close_code().await, close_codes::TOO_MANY_CONNECTIONS);
}

#[tokio::test]
async fn closes_on_oversized_messages() {
    let harness = start(allowing(), Arc::new(OpenGate), |options| options.max_message_bytes = 1024);
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    client.hello(json!({})).await;
    client.send(0x1, &vec![b' '; 2048]).await;
    assert_eq!(client.close_code().await, websocket::CLOSE_MESSAGE_TOO_BIG);
}

#[tokio::test]
async fn closes_connections_with_going_away_when_stopped() {
    let harness = start(allowing(), Arc::new(OpenGate), |_| {});
    let mut client = Client::connect(harness.port, "xihan-print.v1").await;
    client.hello(json!({})).await;
    let stopping = tokio::spawn(async move { harness.server.stop().await });
    assert_eq!(client.close_code().await, close_codes::GOING_AWAY);
    stopping.await.unwrap();
}
