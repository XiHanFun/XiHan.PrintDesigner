// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 业务请求的处理：查打印机、核对能力与目标打印机后把任务交给队列、查与取消任务，扩展登记的请求交给扩展

use std::sync::Arc;

use super::backends::PrinterCatalog;
use super::job::{Job, JobOwner};
use super::pages::PageSelection;
use super::queue::JobQueue;
use crate::BoxFuture;
use crate::protocol::codes::errors;
use crate::protocol::{ClientRequest, CustomRequest, Details, DuplexMode, PrintDocument, PrintOptions, PrinterState, ProtocolError, RequestBody, writer};
use crate::server::{ClientEnvironment, HandlerError, RequestHandler, Session};

/// 扩展处理的请求类型
pub trait RequestExtension: Send + Sync {
    /// 认领的消息类型
    fn kinds(&self) -> Vec<String>;

    /// 处理一条请求，回复经 session 发出
    fn handle<'a>(&'a self, session: &'a Arc<Session>, id: &'a str, request: &'a CustomRequest) -> BoxFuture<'a, Result<(), HandlerError>>;
}

/// 业务请求的缺省处理
pub struct PrintRequestHandler {
    printers: Arc<dyn PrinterCatalog>,
    jobs: JobQueue,
    environment: Arc<dyn ClientEnvironment>,
    extensions: Vec<Arc<dyn RequestExtension>>,
}

impl PrintRequestHandler {
    /// 以打印机查询、任务队列、客户端能力与扩展创建
    pub fn new(printers: Arc<dyn PrinterCatalog>, jobs: JobQueue, environment: Arc<dyn ClientEnvironment>, extensions: Vec<Arc<dyn RequestExtension>>) -> Self {
        PrintRequestHandler {
            printers,
            jobs,
            environment,
            extensions,
        }
    }

    async fn catalog<T: Send + 'static>(&self, query: impl FnOnce(&dyn PrinterCatalog) -> std::io::Result<T> + Send + 'static) -> Result<T, HandlerError> {
        let printers = self.printers.clone();
        Ok(tokio::task::spawn_blocking(move || query(printers.as_ref())).await??)
    }

    async fn submit(&self, session: &Arc<Session>, request_id: &str, prepared: Result<Arc<Job>, ProtocolError>) {
        let error = match prepared {
            Ok(job) => self
                .jobs
                .enqueue(job, |accepted| async move {
                    session.send(&writer::accepted(request_id, &accepted)).await;
                })
                .await
                .err(),
            Err(error) => Some(error),
        };
        if let Some(error) = error {
            session.send(&writer::error(Some(request_id), &error)).await;
        }
    }

    /// 找到目标打印机：没指定时用默认打印机；不存在、脱机、暂停或出错时给出错误
    async fn resolve(&self, requested: Option<String>) -> Result<Result<String, ProtocolError>, HandlerError> {
        let printers = self.catalog(|catalog| catalog.list()).await?;
        if printers.is_empty() {
            return Ok(Err(ProtocolError::new(errors::NO_PRINTERS, "本机没有打印机")));
        }
        let name = match requested.filter(|name| !name.is_empty()) {
            Some(name) => name,
            None => match self.catalog(|catalog| catalog.default_printer_name()).await? {
                Some(name) => name,
                None => return Ok(Err(ProtocolError::new(errors::PRINTER_NOT_FOUND, "没有指定打印机，本机也没有设默认打印机"))),
            },
        };
        let Some(printer) = printers.iter().find(|printer| printer.name.to_lowercase() == name.to_lowercase()) else {
            return Ok(Err(printer_not_found(&name)));
        };
        if matches!(printer.status, PrinterState::Offline | PrinterState::Paused | PrinterState::Error) {
            return Ok(Err(ProtocolError::new(errors::PRINTER_OFFLINE, format!("打印机当前不可用：{}", printer.name))
                .with_details(
                    Details::new()
                        .with("printer", printer.name.clone())
                        .with("status", printer.status.name())
                        .with("statusFlags", printer.status_flags),
                )));
        }
        Ok(Ok(printer.name.clone()))
    }

    fn unsupported(&self, supported: bool, capability: &str) -> Option<ProtocolError> {
        (!supported).then(|| {
            ProtocolError::new(errors::CAPABILITY_UNSUPPORTED, format!("这台机器上的客户端不支持 {capability}")).with_details(Details::new().with("capability", capability))
        })
    }

    fn unsupported_options(&self, options: &PrintOptions) -> Option<ProtocolError> {
        if options.duplex != DuplexMode::Simplex {
            self.unsupported(self.environment.capabilities().duplex, "duplex")
        } else {
            None
        }
    }
}

fn unselectable(document: &PrintDocument, options: &PrintOptions) -> Option<ProtocolError> {
    PageSelection::parse(options.page_ranges.as_deref(), document.sheet_count()).is_none().then(|| {
        ProtocolError::new(errors::BAD_REQUEST, format!("页码范围在 {} 页里一页都没选中", document.sheet_count())).with_details(Details::new().with("field", "options.pageRanges"))
    })
}

fn printer_not_found(name: &str) -> ProtocolError {
    ProtocolError::new(errors::PRINTER_NOT_FOUND, format!("没有这台打印机：{name}")).with_details(Details::new().with("printer", name))
}

fn job_not_found(job_id: &str) -> ProtocolError {
    ProtocolError::new(errors::JOB_NOT_FOUND, format!("没有这个任务：{job_id}")).with_details(Details::new().with("jobId", job_id))
}

impl RequestHandler for PrintRequestHandler {
    fn handle<'a>(&'a self, session: &'a Arc<Session>, request: ClientRequest) -> BoxFuture<'a, Result<(), HandlerError>> {
        Box::pin(async move {
            let id = request.id;
            let capabilities = self.environment.capabilities();
            match request.body {
                RequestBody::ListPrinters => {
                    let printers = self.catalog(|catalog| catalog.list()).await?;
                    session.send(&writer::printers(&id, &printers)).await;
                }
                RequestBody::GetPrinter { name } => {
                    let lookup = name.clone();
                    let reply = match self.catalog(move |catalog| catalog.get(&lookup)).await? {
                        Some(printer) => writer::printer(&id, &printer),
                        None => writer::error(Some(&id), &printer_not_found(&name)),
                    };
                    session.send(&reply).await;
                }
                RequestBody::PrintHtml(print) => {
                    let prepared = match self
                        .unsupported(capabilities.html, "html")
                        .or_else(|| self.unsupported_options(&print.options))
                        .or_else(|| unselectable(&print.document, &print.options))
                    {
                        Some(error) => Err(error),
                        None => self
                            .resolve(print.printer)
                            .await?
                            .map(|printer| Job::html(print.job_id, JobOwner::Session(session.clone()), printer, print.document, print.options)),
                    };
                    self.submit(session, &id, prepared).await;
                }
                RequestBody::PrintRaw(raw) => {
                    let prepared = match self.unsupported(capabilities.raw, "raw") {
                        Some(error) => Err(error),
                        None => {
                            let name = raw.doc_name.unwrap_or_else(|| raw.job_id.clone());
                            self.resolve(Some(raw.printer))
                                .await?
                                .map(|printer| Job::raw(raw.job_id, JobOwner::Session(session.clone()), printer, raw.data, name))
                        }
                    };
                    self.submit(session, &id, prepared).await;
                }
                RequestBody::ExportPdf(pdf) => {
                    let prepared = match self.unsupported(capabilities.pdf, "pdf").or_else(|| unselectable(&pdf.document, &pdf.options)) {
                        Some(error) => Err(error),
                        None => Ok(Job::pdf(pdf.job_id, JobOwner::Session(session.clone()), pdf.document, pdf.options)),
                    };
                    self.submit(session, &id, prepared).await;
                }
                RequestBody::GetJob { job_id } => {
                    let reply = match self.jobs.status(session, &job_id) {
                        Some(status) => writer::status(&id, &status),
                        None => writer::error(Some(&id), &job_not_found(&job_id)),
                    };
                    session.send(&reply).await;
                }
                RequestBody::CancelJob { job_id } => {
                    let reply = match self.jobs.cancel(session, &job_id).await {
                        Some(cancelled) => writer::cancelled(&id, cancelled),
                        None => writer::error(Some(&id), &job_not_found(&job_id)),
                    };
                    session.send(&reply).await;
                }
                RequestBody::Custom(custom) => match self.extensions.iter().find(|extension| extension.kinds().iter().any(|kind| kind == &custom.kind)) {
                    Some(extension) => extension.handle(session, &id, &custom).await?,
                    None => {
                        let error = ProtocolError::new(errors::BAD_REQUEST, format!("不认识的消息类型：{}", custom.kind)).with_details(Details::new().with("field", "type"));
                        session.send(&writer::error(Some(&id), &error)).await;
                    }
                },
                RequestBody::Hello(_) | RequestBody::Ping => {
                    session.send(&writer::error(Some(&id), &ProtocolError::new(errors::BAD_REQUEST, "不认识的请求"))).await;
                }
            }
            Ok(())
        })
    }

    fn unfinished_jobs(&self, session: &Arc<Session>) -> Vec<String> {
        self.jobs.unfinished(session).iter().map(|job| job.id().to_owned()).collect()
    }

    fn replay<'a>(&'a self, session: &'a Arc<Session>) -> BoxFuture<'a, ()> {
        Box::pin(self.jobs.replay(session))
    }
}
