// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 监听：接受连接的一方。开源版只有本机回环监听；局域网或 TLS 的监听由扩展经同一接口接入

use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;

use super::upgrade::is_loopback_host;
use crate::BoxFuture;

/// 可读可写的字节流
pub trait ByteStream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> ByteStream for T {}

/// 连接的另一端
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Peer {
    /// 对方地址
    pub address: SocketAddr,
    /// 是否来自本机
    pub local: bool,
    /// 连接是否经 TLS 加密
    pub secure: bool,
    /// 接受它的监听名，写进日志
    pub listener: String,
}

/// 接受连接的一方
pub trait Listener: Send + Sync {
    /// 监听名，写进日志与诊断信息
    fn name(&self) -> &str;

    /// 实际监听的地址
    fn local_address(&self) -> SocketAddr;

    /// 升级请求里的 Host 是否被接受
    fn accepts_host(&self, host: &str) -> bool;

    /// 接受下一条连接；不接受的对方直接丢弃，不返回
    fn accept(&self) -> BoxFuture<'_, io::Result<(Box<dyn ByteStream>, Peer)>>;

    /// 连接接受后、读升级请求前的处理，如 TLS 握手；缺省原样返回
    fn secure(&self, stream: Box<dyn ByteStream>) -> BoxFuture<'static, io::Result<Box<dyn ByteStream>>> {
        Box::pin(async move { Ok(stream) })
    }
}

/// 建好的 TCP 监听：平台给出，如 Windows 上先设独占地址再绑定
pub type BindFn = fn(SocketAddr) -> io::Result<std::net::TcpListener>;

/// 缺省的绑定方式
pub fn bind_default(address: SocketAddr) -> io::Result<std::net::TcpListener> {
    let listener = std::net::TcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// 只绑 127.0.0.1 的监听：只接受来自本机的连接，Host 只认 127.0.0.1 与 localhost 加监听端口
pub struct LoopbackListener {
    listener: TcpListener,
    address: SocketAddr,
}

impl LoopbackListener {
    /// 依次试端口，绑上第一个可用的；都不可用时返回最后一个错误
    pub fn bind(ports: &[u16], bind: BindFn, mut skipped: impl FnMut(u16, &io::Error)) -> io::Result<LoopbackListener> {
        let mut last = io::Error::new(io::ErrorKind::AddrInUse, "没有可用的端口");
        for &port in ports {
            let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
            match bind(address).and_then(|listener| {
                listener.set_nonblocking(true)?;
                TcpListener::from_std(listener)
            }) {
                Ok(listener) => {
                    let address = listener.local_addr()?;
                    return Ok(LoopbackListener { listener, address });
                }
                Err(error) => {
                    skipped(port, &error);
                    last = error;
                }
            }
        }
        Err(last)
    }
}

impl Listener for LoopbackListener {
    fn name(&self) -> &str {
        "loopback"
    }

    fn local_address(&self) -> SocketAddr {
        self.address
    }

    fn accepts_host(&self, host: &str) -> bool {
        is_loopback_host(host, self.address.port())
    }

    fn accept(&self) -> BoxFuture<'_, io::Result<(Box<dyn ByteStream>, Peer)>> {
        Box::pin(async move {
            loop {
                let (stream, address) = self.listener.accept().await?;
                if !address.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nodelay(true);
                let peer = Peer {
                    address,
                    local: true,
                    secure: false,
                    listener: self.name().to_owned(),
                };
                return Ok((Box::new(stream) as Box<dyn ByteStream>, peer));
            }
        })
    }
}
