// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 曦寒打印客户端的平台无关部分：协议 `xihan-print.v1`、只绑 127.0.0.1 的 WebSocket 服务、来源授权、
//! 任务队列、纸张核对、更新检查与诊断。各平台的渲染、打印与系统集成经这里定义的接口接入。

pub mod cancel;
pub mod consent;
pub mod defaults;
pub mod diagnostics;
pub mod log;
pub mod paths;
pub mod pdf;
pub mod printing;
pub mod protocol;
pub mod server;
pub mod settings;
pub mod time;
pub mod updates;

use std::future::Future;
use std::pin::Pin;

/// 装箱的异步结果，供接口方法返回
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
