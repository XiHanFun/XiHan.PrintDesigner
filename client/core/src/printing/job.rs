// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 打印任务：属于某个会话或由本机提交，在某条队列里排队执行

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::cancel::Cancel;
use crate::protocol::{JobState, JobStatus, PrintDocument, PrintOptions, ProtocolError, ProtocolWarning};
use crate::server::Session;
use crate::time::Timestamp;

/// 任务的种类
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum JobKind {
    /// 按 HTML 文档打印
    Html,
    /// 写原始指令
    Raw,
    /// 导出 PDF
    Pdf,
}

impl JobKind {
    /// 写进日志与诊断信息的名字
    pub fn name(self) -> &'static str {
        match self {
            JobKind::Html => "html",
            JobKind::Raw => "raw",
            JobKind::Pdf => "pdf",
        }
    }
}

/// 任务归谁：浏览器的会话，或本机直接提交（如从打印记录重打）
#[derive(Clone)]
pub enum JobOwner {
    /// 浏览器的会话，事件发给它的当前连接
    Session(Arc<Session>),
    /// 本机提交，来源写给诊断信息看
    Local {
        /// 来源说明
        origin: String,
    },
}

impl JobOwner {
    /// 来源
    pub fn origin(&self) -> &str {
        match self {
            JobOwner::Session(session) => session.origin(),
            JobOwner::Local { origin } => origin,
        }
    }

    /// 是否属于这个会话
    pub fn is(&self, session: &Arc<Session>) -> bool {
        matches!(self, JobOwner::Session(owner) if Arc::ptr_eq(owner, session))
    }

    /// 会话；本机提交时为 None
    pub fn session(&self) -> Option<&Arc<Session>> {
        match self {
            JobOwner::Session(session) => Some(session),
            JobOwner::Local { .. } => None,
        }
    }
}

/// 任务要打的内容
#[derive(Clone, Debug)]
pub enum JobPayload {
    /// HTML 文档与选项
    Html {
        /// 文档
        document: Arc<PrintDocument>,
        /// 选项
        options: PrintOptions,
    },
    /// 原始指令
    Raw {
        /// 指令字节
        data: Arc<Vec<u8>>,
        /// 打印池里显示的文档名
        document_name: String,
    },
    /// 导出 PDF 的文档与选项
    Pdf {
        /// 文档
        document: Arc<PrintDocument>,
        /// 选项
        options: PrintOptions,
    },
}

#[derive(Clone)]
pub(crate) struct Progress {
    pub state: JobState,
    pub error: Option<ProtocolError>,
    pub sheets: Option<u32>,
    pub bytes: Option<u64>,
    pub warnings: Option<Vec<ProtocolWarning>>,
    pub created_at: Timestamp,
    pub sequence: u64,
    pub finished_at: Option<Timestamp>,
    pub output: Option<Arc<Vec<u8>>>,
}

/// 一个打印任务
pub struct Job {
    id: String,
    owner: JobOwner,
    printer: Option<String>,
    payload: JobPayload,
    lane: String,
    pub(crate) progress: Mutex<Progress>,
    pub(crate) cancel: Mutex<Option<Cancel>>,
    pub(crate) cancel_requested: AtomicBool,
}

impl Job {
    /// 按 HTML 文档打印的任务
    pub fn html(id: impl Into<String>, owner: JobOwner, printer: impl Into<String>, document: Arc<PrintDocument>, options: PrintOptions) -> Arc<Job> {
        let printer = printer.into();
        Job::new(id.into(), owner, Some(printer), JobPayload::Html { document, options })
    }

    /// 写原始指令的任务
    pub fn raw(id: impl Into<String>, owner: JobOwner, printer: impl Into<String>, data: Arc<Vec<u8>>, document_name: impl Into<String>) -> Arc<Job> {
        let printer = printer.into();
        Job::new(
            id.into(),
            owner,
            Some(printer),
            JobPayload::Raw {
                data,
                document_name: document_name.into(),
            },
        )
    }

    /// 导出 PDF 的任务
    pub fn pdf(id: impl Into<String>, owner: JobOwner, document: Arc<PrintDocument>, options: PrintOptions) -> Arc<Job> {
        Job::new(id.into(), owner, None, JobPayload::Pdf { document, options })
    }

    fn new(id: String, owner: JobOwner, printer: Option<String>, payload: JobPayload) -> Arc<Job> {
        let lane = match &printer {
            Some(printer) => format!("printer:{}", printer.to_uppercase()),
            None => "pdf".to_owned(),
        };
        Arc::new(Job {
            id,
            owner,
            printer,
            payload,
            lane,
            progress: Mutex::new(Progress {
                state: JobState::Queued,
                error: None,
                sheets: None,
                bytes: None,
                warnings: None,
                created_at: Timestamp(0),
                sequence: 0,
                finished_at: None,
                output: None,
            }),
            cancel: Mutex::new(None),
            cancel_requested: AtomicBool::new(false),
        })
    }

    /// 任务标识
    pub fn id(&self) -> &str {
        &self.id
    }

    /// 归谁
    pub fn owner(&self) -> &JobOwner {
        &self.owner
    }

    /// 种类
    pub fn kind(&self) -> JobKind {
        match self.payload {
            JobPayload::Html { .. } => JobKind::Html,
            JobPayload::Raw { .. } => JobKind::Raw,
            JobPayload::Pdf { .. } => JobKind::Pdf,
        }
    }

    /// 目标打印机；导出 PDF 时为 None
    pub fn printer(&self) -> Option<&str> {
        self.printer.as_deref()
    }

    /// 要打的内容
    pub fn payload(&self) -> &JobPayload {
        &self.payload
    }

    /// 所在队列：同一台打印机一条，导出 PDF 一条
    pub fn lane(&self) -> &str {
        &self.lane
    }

    /// 当前状态
    pub fn state(&self) -> JobState {
        self.progress.lock().unwrap().state
    }

    /// 是否已经结束
    pub fn is_finished(&self) -> bool {
        self.state().is_finished()
    }

    /// 受理的时间
    pub fn created_at(&self) -> Timestamp {
        self.progress.lock().unwrap().created_at
    }

    /// 受理的先后：受理时间相同的按它排
    pub fn order(&self) -> (Timestamp, u64) {
        let progress = self.progress.lock().unwrap();
        (progress.created_at, progress.sequence)
    }

    /// 是否已请求取消
    pub fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::Acquire)
    }

    /// 本机提交的导出任务的产出；其余为 None
    pub fn output(&self) -> Option<Arc<Vec<u8>>> {
        self.progress.lock().unwrap().output.clone()
    }

    /// 当前状态的快照；position 为排队中时前面还有几个任务
    pub fn snapshot(&self, position: Option<usize>) -> JobStatus {
        let progress = self.progress.lock().unwrap();
        JobStatus {
            job_id: self.id.clone(),
            state: progress.state,
            position: if progress.state == JobState::Queued { position } else { None },
            sheets: progress.sheets,
            bytes: progress.bytes,
            error: progress.error.clone(),
            warnings: progress.warnings.clone(),
        }
    }

    /// 供诊断用的元数据，不含文档与指令内容
    pub fn record(&self) -> JobRecord {
        let progress = self.progress.lock().unwrap();
        JobRecord {
            id: self.id.clone(),
            origin: self.owner.origin().to_owned(),
            kind: self.kind(),
            printer: self.printer.clone(),
            state: progress.state,
            error_code: progress.error.as_ref().map(|error| error.code.clone()),
            sheets: progress.sheets,
            bytes: progress.bytes,
            created_at: progress.created_at,
            finished_at: progress.finished_at,
        }
    }
}

/// 一个任务的元数据
#[derive(Clone, Debug, PartialEq)]
pub struct JobRecord {
    /// 任务标识
    pub id: String,
    /// 来源
    pub origin: String,
    /// 种类
    pub kind: JobKind,
    /// 打印机；导出 PDF 时为 None
    pub printer: Option<String>,
    /// 状态
    pub state: JobState,
    /// 失败时的错误码
    pub error_code: Option<String>,
    /// 输出页数
    pub sheets: Option<u32>,
    /// 写出或导出的字节数
    pub bytes: Option<u64>,
    /// 受理时间
    pub created_at: Timestamp,
    /// 结束时间
    pub finished_at: Option<Timestamp>,
}
