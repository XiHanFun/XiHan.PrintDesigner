// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 客户端的缺省约定：协议名、主版本、监听端口、消息上限与渲染期限

use std::time::Duration;

/// WebSocket 子协议名，带主版本
pub const SUB_PROTOCOL: &str = "xihan-print.v1";

/// 不带版本的子协议：浏览器同时给出它，主版本不匹配时客户端选它，升级后再回 PROTOCOL_UNSUPPORTED
pub const UNVERSIONED_SUB_PROTOCOL: &str = "xihan-print";

/// 协议主版本
pub const PROTOCOL_VERSION: i64 = 1;

/// 协议次版本，只加字段不删字段
pub const PROTOCOL_MINOR_VERSION: i64 = 1;

/// 依次尝试的监听端口：第一个被占用时试下一个
pub const PORTS: [u16; 4] = [17620, 17621, 17622, 17623];

/// 单条消息的上限，字节：要装得下 base64 编码后的全部任务资源加输出页
pub const MAX_MESSAGE_BYTES: usize = 96 * 1024 * 1024;

/// 产品名，写进日志、诊断信息与自检页
pub const PRODUCT_NAME: &str = "曦寒打印客户端";

/// HTML 通道载入文档到就绪（字体、图片）的期限
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(30);
