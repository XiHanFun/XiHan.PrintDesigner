// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 发给浏览器的数据：错误、提醒、握手回复、打印机与任务状态

use serde::Serialize;

use super::{Details, serialize_number};
use crate::defaults::{PROTOCOL_MINOR_VERSION, PROTOCOL_VERSION};

/// 响应或任务事件里的错误
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProtocolError {
    /// 错误码，取 codes::errors
    pub code: String,
    /// 给开发者看的说明
    pub message: String,
    /// 附加信息，如打印机名、系统错误码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Details>,
}

impl ProtocolError {
    /// 以错误码与说明创建
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        ProtocolError {
            code: code.to_owned(),
            message: message.into(),
            details: None,
        }
    }

    /// 带上附加信息
    pub fn with_details(mut self, details: Details) -> Self {
        self.details = Some(details);
        self
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}（{}）", self.message, self.code)
    }
}

impl std::error::Error for ProtocolError {}

/// 任务照常完成、但宿主应当知道的情况
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProtocolWarning {
    /// 提醒码，取 codes::warnings
    pub code: String,
    /// 给开发者看的说明
    pub message: String,
    /// 附加信息，如打印机名、分组序号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Details>,
}

impl ProtocolWarning {
    /// 以提醒码、说明与附加信息创建
    pub fn new(code: &str, message: impl Into<String>, details: Details) -> Self {
        ProtocolWarning {
            code: code.to_owned(),
            message: message.into(),
            details: Some(details),
        }
    }
}

/// 客户端信息
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClientInfo {
    /// 客户端版本
    pub version: String,
    /// 操作系统：windows、macos、linux
    pub os: String,
    /// 处理器架构：x64、arm64
    pub arch: String,
    /// 渲染引擎版本；没有渲染引擎时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renderer: Option<String>,
}

/// 客户端具备的能力，次版本只加不减
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    /// HTML 通道
    pub html: bool,
    /// 原始指令通道
    pub raw: bool,
    /// 导出 PDF
    pub pdf: bool,
    /// 双面
    pub duplex: bool,
    /// 打印机状态
    pub printer_status: bool,
    /// 扩展登记的能力名；没有扩展时不写
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<String>,
}

/// 握手成功后的回复
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeData {
    /// 协议主版本
    pub protocol: i64,
    /// 协议次版本
    pub minor: i64,
    /// 客户端信息
    pub client: ClientInfo,
    /// 断线重连时认回任务用的令牌
    pub session_token: String,
    /// 客户端具备的能力
    pub capabilities: ClientCapabilities,
    /// 重连后挂回这个会话、仍未结束的任务
    pub resumed: Vec<String>,
}

impl WelcomeData {
    /// 以当前协议版本创建
    pub fn new(client: ClientInfo, session_token: String, capabilities: ClientCapabilities, resumed: Vec<String>) -> Self {
        WelcomeData {
            protocol: PROTOCOL_VERSION,
            minor: PROTOCOL_MINOR_VERSION,
            client,
            session_token,
            capabilities,
            resumed,
        }
    }
}

/// 打印机状态
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrinterState {
    /// 就绪
    Ready,
    /// 暂停
    Paused,
    /// 脱机
    Offline,
    /// 出错
    Error,
    /// 缺纸
    PaperOut,
    /// 卡纸
    PaperJam,
    /// 忙
    Busy,
    /// 无法判断
    Unknown,
}

impl PrinterState {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            PrinterState::Ready => "ready",
            PrinterState::Paused => "paused",
            PrinterState::Offline => "offline",
            PrinterState::Error => "error",
            PrinterState::PaperOut => "paperOut",
            PrinterState::PaperJam => "paperJam",
            PrinterState::Busy => "busy",
            PrinterState::Unknown => "unknown",
        }
    }
}

/// 一种纸张
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperInfo {
    /// 驱动的纸张编号
    pub id: i32,
    /// 名称
    pub name: String,
    /// 宽，毫米
    #[serde(serialize_with = "serialize_number")]
    pub width_mm: f64,
    /// 高，毫米
    #[serde(serialize_with = "serialize_number")]
    pub height_mm: f64,
}

/// 打印机能力
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCapabilities {
    /// 支持彩色
    pub color: bool,
    /// 支持双面
    pub duplex: bool,
    /// 最多份数
    pub max_copies: u32,
    /// 驱动提供的纸张
    pub papers: Vec<PaperInfo>,
}

/// 一台打印机
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    /// 名称
    pub name: String,
    /// 是否默认打印机
    pub is_default: bool,
    /// 状态
    pub status: PrinterState,
    /// 平台给出的原始状态位
    pub status_flags: i64,
    /// 位置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// 注释
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// 驱动名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver: Option<String>,
    /// 端口名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
    /// 是否网络打印机
    pub is_network: bool,
    /// 能力，只在查单台打印机时给出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<PrinterCapabilities>,
}

impl PrinterInfo {
    /// 只有名称与状态的打印机，其余为缺省值
    pub fn named(name: &str, status: PrinterState) -> Self {
        PrinterInfo {
            name: name.to_owned(),
            is_default: false,
            status,
            status_flags: 0,
            location: None,
            comment: None,
            driver: None,
            port: None,
            is_network: false,
            capabilities: None,
        }
    }
}

/// 任务状态
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    /// 排队中
    Queued,
    /// 执行中
    Started,
    /// 已交给打印池或导出完毕
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

impl JobState {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Started => "started",
            JobState::Completed => "completed",
            JobState::Failed => "failed",
            JobState::Cancelled => "cancelled",
        }
    }

    /// 是否已经结束
    pub fn is_finished(self) -> bool {
        matches!(self, JobState::Completed | JobState::Failed | JobState::Cancelled)
    }
}

/// 任务受理后的回复
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobAccepted {
    /// 任务标识
    pub job_id: String,
    /// 同一台打印机前面还有几个任务
    pub position: usize,
}

/// 任务的当前状态
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    /// 任务标识
    pub job_id: String,
    /// 状态
    pub state: JobState,
    /// 排队中时前面还有几个任务
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<usize>,
    /// HTML 通道完成时的输出页数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheets: Option<u32>,
    /// 原始通道写出的字节数，或导出的 PDF 大小
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    /// 失败时的错误
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProtocolError>,
    /// HTML 通道完成时的提醒；没有时不写
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<ProtocolWarning>>,
}

/// 取消任务的结果
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JobCancelled {
    /// 是否已取消
    pub cancelled: bool,
}
