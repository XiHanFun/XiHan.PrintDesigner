// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 任务队列：同一台打印机一条队列，导出 PDF 一条队列，队列内按先后逐个执行，队列之间互不等待；
//! 状态变化以任务事件发给所属会话的当前连接，并通知登记的观察者

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::backends::{HtmlPrintEngine, JobError, RawPrinter, SpoolTicket};
use super::job::{Job, JobOwner, JobPayload, JobRecord};
use crate::BoxFuture;
use crate::cancel::Cancel;
use crate::log::SharedLog;
use crate::protocol::codes::errors;
use crate::protocol::{Details, JobAccepted, JobState, JobStatus, ProtocolError, writer};
use crate::server::Session;
use crate::time::Clock;

/// 任务队列的期限与上限
#[derive(Clone, Debug)]
pub struct JobQueueOptions {
    /// 单个任务从开始执行到交给打印池（或导出完毕）的期限；请求里给了 timeoutMs 时以请求为准
    pub job_timeout: Duration,
    /// 同一会话同时排队与执行的任务上限
    pub max_active_per_session: usize,
    /// 已结束任务最多留多少个供查询
    pub max_finished_retained: usize,
    /// 超时或取消后等渲染与打印收尾的期限
    pub cancel_grace: Duration,
}

impl Default for JobQueueOptions {
    fn default() -> Self {
        JobQueueOptions {
            job_timeout: Duration::from_secs(150),
            max_active_per_session: 100,
            max_finished_retained: 1000,
            cancel_grace: Duration::from_secs(10),
        }
    }
}

/// 任务的观察者：受理与每次状态变化时通知，如把任务写进打印记录
pub trait JobObserver: Send + Sync {
    /// 任务受理之后
    fn accepted(&self, _job: &Arc<Job>) {}

    /// 任务状态变化之后
    fn changed(&self, _job: &Arc<Job>, _status: &JobStatus) {}
}

/// 交给打印池之后跟踪作业，直到打印机打完才算完成
pub trait CompletionTracker: Send + Sync {
    /// 返回 None 时不跟踪，任务照常完成；返回的结果为错误时任务记为失败或取消
    fn track(&self, job: &Arc<Job>, spooled: &[SpoolTicket], cancel: Cancel) -> Option<BoxFuture<'static, Result<(), JobError>>>;
}

struct Lane {
    active: Vec<Arc<Job>>,
    sender: mpsc::UnboundedSender<Arc<Job>>,
}

#[derive(Default)]
struct State {
    jobs: HashMap<String, Arc<Job>>,
    sequence: u64,
    lanes: HashMap<String, Lane>,
    finished: VecDeque<Arc<Job>>,
}

struct Inner {
    html: Option<Arc<dyn HtmlPrintEngine>>,
    raw: Option<Arc<dyn RawPrinter>>,
    options: JobQueueOptions,
    clock: Arc<dyn Clock>,
    log: SharedLog,
    state: Mutex<State>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    stopping: Cancel,
    observers: Mutex<Vec<Arc<dyn JobObserver>>>,
    tracker: Mutex<Option<Arc<dyn CompletionTracker>>>,
}

/// 任务队列；必须在 tokio 运行时里使用
#[derive(Clone)]
pub struct JobQueue {
    inner: Arc<Inner>,
}

enum Outcome {
    Done(Result<Vec<SpoolTicket>, JobError>),
    TimedOut(Duration),
}

impl JobQueue {
    /// 创建队列；平台不提供的通道传 None
    pub fn new(html: Option<Arc<dyn HtmlPrintEngine>>, raw: Option<Arc<dyn RawPrinter>>, options: JobQueueOptions, clock: Arc<dyn Clock>, log: SharedLog) -> Self {
        JobQueue {
            inner: Arc::new(Inner {
                html,
                raw,
                options,
                clock,
                log,
                state: Mutex::new(State::default()),
                workers: Mutex::new(Vec::new()),
                stopping: Cancel::new(),
                observers: Mutex::new(Vec::new()),
                tracker: Mutex::new(None),
            }),
        }
    }

    /// HTML 通道的渲染引擎
    pub fn html_engine(&self) -> Option<&Arc<dyn HtmlPrintEngine>> {
        self.inner.html.as_ref()
    }

    /// 登记观察者
    pub fn add_observer(&self, observer: Arc<dyn JobObserver>) {
        self.inner.observers.lock().unwrap().push(observer);
    }

    /// 设跟踪打印结果的扩展
    pub fn set_completion_tracker(&self, tracker: Arc<dyn CompletionTracker>) {
        *self.inner.tracker.lock().unwrap() = Some(tracker);
    }

    /// 受理任务：先经 acknowledge 回复受理结果，再推送 queued 事件并排进队列；不能受理时返回错误，什么都不发
    pub async fn enqueue<F, Fut>(&self, job: Arc<Job>, acknowledge: F) -> Result<(), ProtocolError>
    where
        F: FnOnce(JobAccepted) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let (sender, position) = {
            let mut state = self.inner.state.lock().unwrap();
            if state.jobs.contains_key(job.id()) {
                return Err(ProtocolError::new(errors::JOB_DUPLICATE, format!("任务标识重复：{}", job.id())).with_details(Details::new().with("jobId", job.id())));
            }
            if let Some(session) = job.owner().session() {
                let active = state.jobs.values().filter(|item| item.owner().is(session) && !item.is_finished()).count();
                if active >= self.inner.options.max_active_per_session {
                    return Err(ProtocolError::new(
                        errors::QUEUE_FULL,
                        format!("同一会话最多同时排 {} 个任务", self.inner.options.max_active_per_session),
                    ));
                }
            }
            if !state.lanes.contains_key(job.lane()) {
                let (sender, receiver) = mpsc::unbounded_channel();
                let worker = tokio::spawn(drain(self.inner.clone(), receiver));
                self.inner.workers.lock().unwrap().push(worker);
                state.lanes.insert(job.lane().to_owned(), Lane { active: Vec::new(), sender });
            }
            let lane = state.lanes.get_mut(job.lane()).unwrap();
            let position = lane.active.len();
            lane.active.push(job.clone());
            let sender = lane.sender.clone();
            state.sequence += 1;
            {
                let mut progress = job.progress.lock().unwrap();
                progress.created_at = self.inner.clock.now();
                progress.sequence = state.sequence;
            }
            *job.cancel.lock().unwrap() = Some(self.inner.stopping.child());
            state.jobs.insert(job.id().to_owned(), job.clone());
            (sender, position)
        };
        self.inner.log.info(&format!(
            "受理任务 {}：{} {}，来源 {}",
            job.id(),
            job.kind().name(),
            job.printer().unwrap_or("pdf"),
            job.owner().origin()
        ));
        acknowledge(JobAccepted {
            job_id: job.id().to_owned(),
            position,
        })
        .await;
        for observer in self.inner.observers() {
            observer.accepted(&job);
        }
        self.inner.publish(&job, Some(position)).await;
        let _ = sender.send(job);
        Ok(())
    }

    /// 查同一会话的任务状态；查不到时为 None
    pub fn status(&self, session: &Arc<Session>, job_id: &str) -> Option<JobStatus> {
        let state = self.inner.state.lock().unwrap();
        let job = state.jobs.get(job_id).filter(|job| job.owner().is(session))?;
        Some(job.snapshot(position_of(&state, job)))
    }

    /// 取消同一会话的任务：排队中的直接取消并返回 true；执行中的尽力取消并返回 false，结果以任务事件为准；
    /// 已结束的返回 false；查不到时为 None
    pub async fn cancel(&self, session: &Arc<Session>, job_id: &str) -> Option<bool> {
        let job = {
            let state = self.inner.state.lock().unwrap();
            state.jobs.get(job_id).filter(|job| job.owner().is(session)).cloned()?
        };
        Some(self.cancel_job(&job).await)
    }

    /// 取消任务：排队中的直接取消并返回 true；执行中的尽力取消并返回 false；已结束的返回 false
    pub async fn cancel_job(&self, job: &Arc<Job>) -> bool {
        let state = {
            let mut state = self.inner.state.lock().unwrap();
            let current = job.state();
            if current == JobState::Queued {
                self.inner.finish_locked(&mut state, job, JobState::Cancelled);
            }
            current
        };
        match state {
            JobState::Queued => {
                self.inner.log.info(&format!("任务 {} cancelled（排队中取消）", job.id()));
                self.inner.publish(job, None).await;
                true
            }
            JobState::Started => {
                job.cancel_requested.store(true, Ordering::Release);
                if let Some(cancel) = job.cancel.lock().unwrap().as_ref() {
                    cancel.cancel();
                }
                false
            }
            _ => false,
        }
    }

    /// 按标识找任务
    pub fn job(&self, job_id: &str) -> Option<Arc<Job>> {
        self.inner.state.lock().unwrap().jobs.get(job_id).cloned()
    }

    /// 最近受理的若干个任务，新的在前
    pub fn recent(&self, count: usize) -> Vec<JobRecord> {
        let state = self.inner.state.lock().unwrap();
        let mut jobs: Vec<&Arc<Job>> = state.jobs.values().collect();
        jobs.sort_by_key(|job| std::cmp::Reverse(job.order()));
        jobs.into_iter().take(count).map(|job| job.record()).collect()
    }

    /// 会话名下仍未结束的任务
    pub fn unfinished(&self, session: &Arc<Session>) -> Vec<Arc<Job>> {
        let state = self.inner.state.lock().unwrap();
        let mut jobs: Vec<Arc<Job>> = state.jobs.values().filter(|job| job.owner().is(session) && !job.is_finished()).cloned().collect();
        jobs.sort_by_key(|job| job.order());
        jobs
    }

    /// 补发会话名下未结束任务的当前状态
    pub async fn replay(&self, session: &Arc<Session>) {
        let statuses: Vec<JobStatus> = {
            let state = self.inner.state.lock().unwrap();
            let mut jobs: Vec<&Arc<Job>> = state.jobs.values().filter(|job| job.owner().is(session) && !job.is_finished()).collect();
            jobs.sort_by_key(|job| job.order());
            jobs.into_iter().map(|job| job.snapshot(position_of(&state, job))).collect()
        };
        for status in statuses {
            session.send(&writer::job_event(&status, self.inner.clock.now())).await;
        }
    }

    /// 会话过了重连期限：丢掉它名下已结束的任务，未结束的照常执行完
    pub fn forget(&self, session: &Arc<Session>) {
        let mut state = self.inner.state.lock().unwrap();
        state.jobs.retain(|_, job| !(job.owner().is(session) && job.is_finished()));
    }

    /// 停止：不再执行排队中的任务，正在执行的任务以「客户端正在退出」失败
    pub async fn stop(&self) {
        self.inner.stopping.cancel();
        let workers: Vec<_> = self.inner.workers.lock().unwrap().drain(..).collect();
        for worker in workers {
            let _ = tokio::time::timeout(self.inner.options.cancel_grace + Duration::from_secs(1), worker).await;
        }
    }
}

fn position_of(state: &State, job: &Arc<Job>) -> Option<usize> {
    if job.state() != JobState::Queued {
        return None;
    }
    state.lanes.get(job.lane())?.active.iter().position(|item| Arc::ptr_eq(item, job))
}

impl Inner {
    fn observers(&self) -> Vec<Arc<dyn JobObserver>> {
        self.observers.lock().unwrap().clone()
    }

    fn finish_locked(&self, state: &mut State, job: &Arc<Job>, finished: JobState) {
        {
            let mut progress = job.progress.lock().unwrap();
            progress.state = finished;
            progress.finished_at = Some(self.clock.now());
        }
        if let Some(lane) = state.lanes.get_mut(job.lane()) {
            lane.active.retain(|item| !Arc::ptr_eq(item, job));
        }
        state.finished.push_back(job.clone());
        while state.finished.len() > self.options.max_finished_retained {
            let oldest = state.finished.pop_front().unwrap();
            if state.jobs.get(oldest.id()).is_some_and(|current| Arc::ptr_eq(current, &oldest)) {
                state.jobs.remove(oldest.id());
            }
        }
    }

    /// 发任务事件给所属会话，并通知观察者
    async fn publish(&self, job: &Arc<Job>, position: Option<usize>) {
        let status = {
            let state = self.state.lock().unwrap();
            job.snapshot(position.or_else(|| position_of(&state, job)))
        };
        for observer in self.observers() {
            observer.changed(job, &status);
        }
        if let JobOwner::Session(session) = job.owner() {
            session.send(&writer::job_event(&status, self.clock.now())).await;
        }
    }

    fn engine(&self) -> Result<Arc<dyn HtmlPrintEngine>, JobError> {
        self.html.clone().ok_or_else(unsupported)
    }
}

fn unsupported() -> JobError {
    JobError::failure(errors::CAPABILITY_UNSUPPORTED, "这台机器上的客户端没有这项能力", None)
}

async fn drain(inner: Arc<Inner>, mut receiver: mpsc::UnboundedReceiver<Arc<Job>>) {
    loop {
        let job = tokio::select! {
            _ = inner.stopping.cancelled() => return,
            job = receiver.recv() => match job {
                Some(job) => job,
                None => return,
            },
        };
        run(&inner, job).await;
    }
}

async fn run(inner: &Arc<Inner>, job: Arc<Job>) {
    {
        let mut progress = job.progress.lock().unwrap();
        if progress.state != JobState::Queued {
            return;
        }
        progress.state = JobState::Started;
    }
    inner.publish(&job, None).await;

    let cancel = job.cancel.lock().unwrap().clone().unwrap_or_default();
    let timeout = match job.payload() {
        JobPayload::Html { options, .. } | JobPayload::Pdf { options, .. } => options.timeout_ms.map(|ms| Duration::from_millis(u64::from(ms))),
        JobPayload::Raw { .. } => None,
    }
    .unwrap_or(inner.options.job_timeout);
    let mut work = tokio::spawn(execute(inner.clone(), job.clone(), cancel.clone()));
    let outcome = tokio::select! {
        result = &mut work => Outcome::Done(result.unwrap_or_else(|error| {
            inner.log.error(&format!("任务 {} 出错", job.id()), Some(&error));
            Err(JobError::failure(errors::INTERNAL, "客户端内部错误，详情见日志", None))
        })),
        _ = tokio::time::sleep(timeout) => Outcome::TimedOut(timeout),
    };
    if matches!(outcome, Outcome::TimedOut(_)) {
        cancel.cancel();
        if tokio::time::timeout(inner.options.cancel_grace, &mut work).await.is_err() {
            work.abort();
        }
    }

    let mut result = match outcome {
        Outcome::Done(result) => result.map(Some),
        Outcome::TimedOut(_) if job.is_cancel_requested() => Err(JobError::Cancelled),
        Outcome::TimedOut(limit) => {
            let code = if job.kind() == super::JobKind::Pdf { errors::PDF_FAILED } else { errors::SPOOL_FAILED };
            Err(JobError::failure(
                code,
                format!("任务超过 {:.0} 秒没有完成", limit.as_secs_f64()),
                Some(Details::new().with("timeout", true)),
            ))
        }
    };
    if let Ok(Some(spooled)) = &result {
        let tracker = inner.tracker.lock().unwrap().clone();
        if let Some(tracking) = tracker.and_then(|tracker| tracker.track(&job, spooled, cancel.clone())) {
            result = tracking.await.map(|_| None);
        }
    }

    let finished = match result {
        Ok(_) => JobState::Completed,
        Err(JobError::Failure(error)) => {
            job.progress.lock().unwrap().error = Some(error);
            JobState::Failed
        }
        Err(JobError::CancelledByUser) => JobState::Cancelled,
        Err(JobError::Cancelled) if job.is_cancel_requested() => JobState::Cancelled,
        Err(JobError::Cancelled) => {
            job.progress.lock().unwrap().error = Some(ProtocolError::new(errors::INTERNAL, "客户端正在退出"));
            JobState::Failed
        }
    };
    {
        let mut state = inner.state.lock().unwrap();
        inner.finish_locked(&mut state, &job, finished);
    }
    let code = job.progress.lock().unwrap().error.as_ref().map(|error| format!("：{}", error.code)).unwrap_or_default();
    let message = format!("任务 {} {}{code}", job.id(), finished.name());
    if finished == JobState::Completed {
        inner.log.info(&message)
    } else {
        inner.log.warn(&message)
    }
    inner.publish(&job, None).await;
}

async fn execute(inner: Arc<Inner>, job: Arc<Job>, cancel: Cancel) -> Result<Vec<SpoolTicket>, JobError> {
    match job.payload() {
        JobPayload::Html { document, options } => {
            let printed = inner
                .engine()?
                .print(document.clone(), job.printer().unwrap_or_default().to_owned(), options.clone(), cancel)
                .await?;
            let mut progress = job.progress.lock().unwrap();
            progress.sheets = Some(printed.sheets);
            progress.warnings = (!printed.warnings.is_empty()).then_some(printed.warnings);
            Ok(printed.spooled)
        }
        JobPayload::Raw { data, document_name } => {
            let raw = inner.raw.clone().ok_or_else(unsupported)?;
            let written = raw.write(job.printer().unwrap_or_default().to_owned(), data.clone(), document_name.clone(), cancel).await?;
            job.progress.lock().unwrap().bytes = Some(written.bytes);
            Ok(vec![written.spooled])
        }
        JobPayload::Pdf { document, options } => {
            let pdf = inner.engine()?.export_pdf(document.clone(), options.clone(), cancel.clone()).await?;
            job.progress.lock().unwrap().bytes = Some(pdf.len() as u64);
            match job.owner() {
                JobOwner::Session(session) => {
                    let delivered = cancel.run(async { session.send(&writer::job_output(job.id(), "application/pdf", pdf.len() as u64)).await && session.send_binary(&pdf).await });
                    if !delivered.await? {
                        return Err(JobError::failure(
                            errors::PDF_FAILED,
                            "导出完成时连接已断开，结果没有送到",
                            Some(Details::new().with("delivered", false)),
                        ));
                    }
                }
                JobOwner::Local { .. } => job.progress.lock().unwrap().output = Some(Arc::new(pdf)),
            }
            Ok(Vec::new())
        }
    }
}
