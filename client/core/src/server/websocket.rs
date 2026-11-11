// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 服务端的 WebSocket 连接：按条收文本消息并守住大小上限，发送串行化

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::sync::{Mutex, mpsc};
use tokio::task::JoinHandle;

use super::listener::ByteStream;

/// 正常关闭
pub const CLOSE_NORMAL: u16 = 1000;
/// 协议错误
pub const CLOSE_PROTOCOL_ERROR: u16 = 1002;
/// 收到不接受的消息类型
pub const CLOSE_UNSUPPORTED_DATA: u16 = 1003;
/// 文本消息不是合法的 UTF-8
pub const CLOSE_INVALID_PAYLOAD: u16 = 1007;
/// 消息超过上限
pub const CLOSE_MESSAGE_TOO_BIG: u16 = 1009;

const OP_CONTINUATION: u8 = 0x0;
const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xA;

type Stream = Box<dyn ByteStream>;

/// 一条已经升级好的 WebSocket 连接的发送端；接收由 open 返回的收件箱取
pub struct Connection {
    writer: Mutex<WriteHalf<Stream>>,
    close_sent: AtomicBool,
    broken: AtomicBool,
}

/// 收件箱：按条取浏览器发来的文本消息；对方关闭、出错或消息不合规时取到 None
pub struct Inbox {
    receiver: mpsc::Receiver<Vec<u8>>,
    reader: JoinHandle<()>,
}

impl Inbox {
    /// 取下一条消息
    pub async fn next(&mut self) -> Option<Vec<u8>> {
        self.receiver.recv().await
    }

    /// 等读的一端结束，最多等给定时长
    pub async fn finish(&mut self, limit: std::time::Duration) {
        self.receiver.close();
        let _ = tokio::time::timeout(limit, &mut self.reader).await;
    }
}

impl Drop for Inbox {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

/// 包住一条已经升级好的连接：读的一端在后台按条收消息，单条消息超过上限时以 1009 关闭
pub fn open(stream: Stream, max_message_bytes: usize) -> (Arc<Connection>, Inbox) {
    let (read, write) = tokio::io::split(stream);
    let connection = Arc::new(Connection {
        writer: Mutex::new(write),
        close_sent: AtomicBool::new(false),
        broken: AtomicBool::new(false),
    });
    let (sender, receiver) = mpsc::channel(1);
    let reader = tokio::spawn(read_loop(read, connection.clone(), sender, max_message_bytes));
    (connection, Inbox { receiver, reader })
}

impl Connection {
    /// 连接是否仍可发送
    pub fn is_open(&self) -> bool {
        !self.close_sent.load(Ordering::Acquire) && !self.broken.load(Ordering::Acquire)
    }

    /// 发一条文本消息；连接已断开或已关闭时返回 false
    pub async fn send_text(&self, message: &[u8]) -> bool {
        self.send(OP_TEXT, message).await
    }

    /// 发一条二进制消息；连接已断开或已关闭时返回 false
    pub async fn send_binary(&self, message: &[u8]) -> bool {
        self.send(OP_BINARY, message).await
    }

    /// 以给定关闭码发起关闭；已发过关闭时什么都不做
    pub async fn close(&self, code: u16, reason: &str) {
        let mut writer = self.writer.lock().await;
        if self.close_sent.swap(true, Ordering::AcqRel) || self.broken.load(Ordering::Acquire) {
            return;
        }
        let mut payload = code.to_be_bytes().to_vec();
        payload.extend_from_slice(truncate(reason, 123).as_bytes());
        if write_frame(&mut *writer, OP_CLOSE, &payload).await.is_err() {
            self.broken.store(true, Ordering::Release);
        }
    }

    async fn send(&self, opcode: u8, message: &[u8]) -> bool {
        let mut writer = self.writer.lock().await;
        if !self.is_open() {
            return false;
        }
        if write_frame(&mut *writer, opcode, message).await.is_err() {
            self.broken.store(true, Ordering::Release);
            return false;
        }
        true
    }

    async fn pong(&self, payload: &[u8]) {
        let mut writer = self.writer.lock().await;
        if self.is_open() && write_frame(&mut *writer, OP_PONG, payload).await.is_err() {
            self.broken.store(true, Ordering::Release);
        }
    }

    async fn echo_close(&self, payload: &[u8]) {
        let code = if payload.len() >= 2 {
            u16::from_be_bytes([payload[0], payload[1]])
        } else {
            CLOSE_NORMAL
        };
        let code = if valid_close_code(code) { code } else { CLOSE_NORMAL };
        self.close(code, "").await;
    }
}

fn valid_close_code(code: u16) -> bool {
    matches!(code, 1000..=1003 | 1007..=1011 | 3000..=4999)
}

fn truncate(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut head = Vec::with_capacity(10);
    head.push(0x80 | opcode);
    match payload.len() {
        length @ 0..=125 => head.push(length as u8),
        length @ 126..=65_535 => {
            head.push(126);
            head.extend_from_slice(&(length as u16).to_be_bytes());
        }
        length => {
            head.push(127);
            head.extend_from_slice(&(length as u64).to_be_bytes());
        }
    }
    writer.write_all(&head).await?;
    writer.write_all(payload).await?;
    writer.flush().await
}

struct Frame {
    fin: bool,
    opcode: u8,
    payload: Vec<u8>,
}

enum FrameError {
    Io,
    Protocol,
    TooBig,
}

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R, budget: usize) -> Result<Frame, FrameError> {
    let mut head = [0u8; 2];
    reader.read_exact(&mut head).await.map_err(|_| FrameError::Io)?;
    let fin = head[0] & 0x80 != 0;
    if head[0] & 0x70 != 0 {
        return Err(FrameError::Protocol);
    }
    let opcode = head[0] & 0x0F;
    if head[1] & 0x80 == 0 {
        return Err(FrameError::Protocol);
    }
    let length = match head[1] & 0x7F {
        126 => u64::from(reader.read_u16().await.map_err(|_| FrameError::Io)?),
        127 => reader.read_u64().await.map_err(|_| FrameError::Io)?,
        length => u64::from(length),
    };
    let control = opcode >= 0x8;
    if control && (!fin || length > 125) {
        return Err(FrameError::Protocol);
    }
    if !control && length > budget as u64 {
        return Err(FrameError::TooBig);
    }
    let mut mask = [0u8; 4];
    reader.read_exact(&mut mask).await.map_err(|_| FrameError::Io)?;
    let mut payload = vec![0u8; length as usize];
    reader.read_exact(&mut payload).await.map_err(|_| FrameError::Io)?;
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index % 4];
    }
    Ok(Frame { fin, opcode, payload })
}

async fn read_loop(mut reader: ReadHalf<Stream>, connection: Arc<Connection>, sender: mpsc::Sender<Vec<u8>>, max_message_bytes: usize) {
    let mut message: Option<Vec<u8>> = None;
    loop {
        let budget = max_message_bytes - message.as_ref().map_or(0, Vec::len);
        let frame = match read_frame(&mut reader, budget).await {
            Ok(frame) => frame,
            Err(FrameError::Io) => return,
            Err(FrameError::Protocol) => return connection.close(CLOSE_PROTOCOL_ERROR, "帧格式不对").await,
            Err(FrameError::TooBig) => return connection.close(CLOSE_MESSAGE_TOO_BIG, "消息超过上限").await,
        };
        match frame.opcode {
            OP_PING => connection.pong(&frame.payload).await,
            OP_PONG => {}
            OP_CLOSE => return connection.echo_close(&frame.payload).await,
            OP_BINARY => return connection.close(CLOSE_UNSUPPORTED_DATA, "只收文本消息").await,
            OP_TEXT if message.is_none() => message = Some(frame.payload),
            OP_CONTINUATION if message.is_some() => message.as_mut().unwrap().extend_from_slice(&frame.payload),
            _ => return connection.close(CLOSE_PROTOCOL_ERROR, "帧次序不对").await,
        }
        if frame.fin
            && frame.opcode <= OP_TEXT
            && let Some(complete) = message.take()
        {
            if std::str::from_utf8(&complete).is_err() {
                return connection.close(CLOSE_INVALID_PAYLOAD, "文本消息不是合法的 UTF-8").await;
            }
            if sender.send(complete).await.is_err() {
                return;
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tokio::io::DuplexStream;

    /// 浏览器一侧：发带掩码的帧，收不带掩码的帧
    pub(crate) struct Peer {
        pub stream: DuplexStream,
    }

    impl Peer {
        pub async fn send(&mut self, fin: bool, opcode: u8, payload: &[u8]) {
            let mut frame = vec![(if fin { 0x80 } else { 0 }) | opcode];
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
            let mask = [1u8, 2, 3, 4];
            frame.extend_from_slice(&mask);
            frame.extend(payload.iter().enumerate().map(|(index, byte)| byte ^ mask[index % 4]));
            self.stream.write_all(&frame).await.unwrap();
        }

        pub async fn text(&mut self, text: &str) {
            self.send(true, OP_TEXT, text.as_bytes()).await;
        }

        /// 读一帧：操作码与内容；连接已断开时为 None
        pub async fn receive(&mut self) -> Option<(u8, Vec<u8>)> {
            let mut head = [0u8; 2];
            self.stream.read_exact(&mut head).await.ok()?;
            assert_eq!(head[1] & 0x80, 0, "服务端的帧不能带掩码");
            let length = match head[1] & 0x7F {
                126 => u64::from(self.stream.read_u16().await.ok()?),
                127 => self.stream.read_u64().await.ok()?,
                length => u64::from(length),
            };
            let mut payload = vec![0u8; length as usize];
            self.stream.read_exact(&mut payload).await.ok()?;
            Some((head[0] & 0x0F, payload))
        }

        /// 读一条文本消息
        pub async fn receive_text(&mut self) -> String {
            let (opcode, payload) = self.receive().await.expect("连接已断开");
            assert_eq!(opcode, OP_TEXT, "期望文本消息，收到 {opcode}：{:?}", String::from_utf8_lossy(&payload));
            String::from_utf8(payload).unwrap()
        }

        /// 读一个关闭帧的关闭码
        pub async fn receive_close(&mut self) -> u16 {
            loop {
                match self.receive().await {
                    Some((OP_CLOSE, payload)) => return u16::from_be_bytes([payload[0], payload[1]]),
                    Some(_) => continue,
                    None => panic!("没有收到关闭帧"),
                }
            }
        }
    }

    pub(crate) fn pair(max: usize) -> (Arc<Connection>, Inbox, Peer) {
        let (server, client) = tokio::io::duplex(1 << 20);
        let (connection, inbox) = open(Box::new(server), max);
        (connection, inbox, Peer { stream: client })
    }

    #[tokio::test]
    async fn assembles_fragmented_text_and_answers_pings() {
        let (connection, mut inbox, mut peer) = pair(1024);
        peer.send(false, OP_TEXT, b"he").await;
        peer.send(true, OP_PING, b"p").await;
        peer.send(true, OP_CONTINUATION, b"llo").await;
        assert_eq!(peer.receive().await, Some((OP_PONG, b"p".to_vec())));
        assert_eq!(inbox.next().await.unwrap(), b"hello");
        assert!(connection.send_text(b"hi").await);
        assert_eq!(peer.receive_text().await, "hi");
        let large = vec![b'x'; 70_000];
        assert!(connection.send_binary(&large).await);
        assert_eq!(peer.receive().await, Some((OP_BINARY, large)));
    }

    #[tokio::test]
    async fn closes_on_oversized_binary_or_invalid_messages() {
        let (_connection, mut inbox, mut peer) = pair(8);
        peer.text("123456789").await;
        assert_eq!(peer.receive_close().await, CLOSE_MESSAGE_TOO_BIG);
        assert_eq!(inbox.next().await, None);

        let (_connection, mut inbox, mut peer) = pair(1024);
        peer.send(true, OP_BINARY, b"x").await;
        assert_eq!(peer.receive_close().await, CLOSE_UNSUPPORTED_DATA);
        assert_eq!(inbox.next().await, None);

        let (_connection, mut inbox, mut peer) = pair(1024);
        peer.send(true, OP_TEXT, &[0xFF, 0xFE]).await;
        assert_eq!(peer.receive_close().await, CLOSE_INVALID_PAYLOAD);
        assert_eq!(inbox.next().await, None);
    }

    #[tokio::test]
    async fn echoes_the_close_and_stops_sending() {
        let (connection, mut inbox, mut peer) = pair(1024);
        peer.send(true, OP_CLOSE, &4000u16.to_be_bytes()).await;
        assert_eq!(peer.receive_close().await, 4000);
        assert_eq!(inbox.next().await, None);
        assert!(!connection.send_text(b"late").await);
    }
}
