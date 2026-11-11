// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 各平台要实现的接口：查打印机、渲染与打印 HTML 文档、写原始指令、打印对话框

use std::sync::Arc;

use super::paper::PaperFeed;
use crate::BoxFuture;
use crate::cancel::{Cancel, Cancelled};
use crate::protocol::{Details, PaperInfo, PrintDocument, PrintOptions, PrinterInfo, ProtocolError, ProtocolWarning};

/// 任务执行没有完成的原因
#[derive(Clone, Debug, PartialEq)]
pub enum JobError {
    /// 失败，带协议错误码
    Failure(ProtocolError),
    /// 用户在系统打印对话框里取消了打印，任务记为已取消
    CancelledByUser,
    /// 取消令牌取消了
    Cancelled,
}

impl JobError {
    /// 以错误码、说明与附加信息创建失败
    pub fn failure(code: &str, message: impl Into<String>, details: Option<Details>) -> JobError {
        let error = ProtocolError::new(code, message);
        JobError::Failure(match details {
            Some(details) => error.with_details(details),
            None => error,
        })
    }
}

impl From<Cancelled> for JobError {
    fn from(_: Cancelled) -> Self {
        JobError::Cancelled
    }
}

impl From<ProtocolError> for JobError {
    fn from(error: ProtocolError) -> Self {
        JobError::Failure(error)
    }
}

impl std::fmt::Display for JobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobError::Failure(error) => error.fmt(f),
            JobError::CancelledByUser => f.write_str("用户取消了打印"),
            JobError::Cancelled => f.write_str("任务已取消"),
        }
    }
}

impl std::error::Error for JobError {}

/// 交给打印池的一份作业，供跟踪打印结果的扩展找到它
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpoolTicket {
    /// 打印机
    pub printer: String,
    /// 打印池里显示的文档名
    pub document_name: String,
    /// 系统给的作业号；拿不到时为 None
    pub system_job_id: Option<u32>,
}

/// HTML 通道打印的结果
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HtmlPrintResult {
    /// 交给打印池的输出页数
    pub sheets: u32,
    /// 提醒，如没能核对纸张
    pub warnings: Vec<ProtocolWarning>,
    /// 交给打印池的作业
    pub spooled: Vec<SpoolTicket>,
}

/// 原始通道写出的结果
#[derive(Clone, Debug, PartialEq)]
pub struct RawPrintResult {
    /// 写出的字节数
    pub bytes: u64,
    /// 交给打印池的作业
    pub spooled: SpoolTicket,
}

/// 本机打印机的查询；可能阻塞，调用方在后台线程上调
pub trait PrinterCatalog: Send + Sync {
    /// 列出打印机，不含能力明细
    fn list(&self) -> std::io::Result<Vec<PrinterInfo>>;

    /// 查一台打印机，含能力明细；没有这台时为 None
    fn get(&self, name: &str) -> std::io::Result<Option<PrinterInfo>>;

    /// 默认打印机的名称；没有时为 None
    fn default_printer_name(&self) -> std::io::Result<Option<String>>;
}

/// 下发前核对纸张用的打印机纸张能力
pub trait PaperCatalog: Send + Sync {
    /// 打开一台打印机的纸张能力；没有这台打印机或查不了时为 None
    fn open(&self, printer: &str) -> Option<Box<dyn PrinterPapers>>;
}

/// 一台打印机的纸张能力
pub trait PrinterPapers: Send {
    /// 驱动报的纸张；驱动不报时为空
    fn papers(&self) -> &[PaperInfo];

    /// 照渲染引擎下发的写法请求这样放的纸张，驱动实际留下的纸张；读不出驱动的结果时为 None
    fn resolve(&self, request: &PaperFeed) -> Option<PaperFeed>;
}

/// HTML 通道：渲染输出页，交给打印池或导出 PDF
pub trait HtmlPrintEngine: Send + Sync {
    /// 渲染引擎的名称，如 WebView2、WebKit
    fn name(&self) -> &str;

    /// 渲染引擎的版本，写进 welcome
    fn version(&self) -> Option<String>;

    /// 打印到指定打印机
    fn print(&self, document: Arc<PrintDocument>, printer: String, options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<HtmlPrintResult, JobError>>;

    /// 导出为 PDF
    fn export_pdf(&self, document: Arc<PrintDocument>, options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<Vec<u8>, JobError>>;
}

/// 原始指令通道：把字节原样写给打印机
pub trait RawPrinter: Send + Sync {
    /// 写给指定打印机
    fn write(&self, printer: String, data: Arc<Vec<u8>>, document_name: String, cancel: Cancel) -> BoxFuture<'static, Result<RawPrintResult, JobError>>;
}

/// 用户在打印对话框里选定的打印机与选项
#[derive(Clone, Debug, PartialEq)]
pub struct PrintDialogChoice {
    /// 打印机名称
    pub printer: String,
    /// 打印选项，dialog 不再生效
    pub options: PrintOptions,
}

/// 系统打印对话框
pub trait PrintDialog: Send + Sync {
    /// 以请求里的打印机与选项为初值弹出对话框；用户取消时为 None，令牌取消时关掉对话框
    fn ask(&self, printer: String, options: PrintOptions, sheet_count: u32, cancel: Cancel) -> BoxFuture<'static, Option<PrintDialogChoice>>;
}
