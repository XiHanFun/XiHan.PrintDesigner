// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::watch;

use super::*;
use crate::BoxFuture;
use crate::cancel::Cancel;
use crate::log::null_log;
use crate::protocol::codes::{errors, warnings};
use crate::protocol::*;
use crate::server::websocket::tests::{Peer, pair};
use crate::server::websocket::{Connection, Inbox};
use crate::server::{ClientEnvironment, RequestHandler, Session, SessionRegistry};
use crate::time::SystemClock;

type Failer = Box<dyn Fn(&str) -> Option<JobError> + Send + Sync>;

#[derive(Default)]
struct FakeBackend {
    calls: Mutex<Vec<String>>,
    holds: Mutex<HashMap<String, watch::Receiver<bool>>>,
    fail: Mutex<Option<Failer>>,
    warnings: Mutex<Vec<ProtocolWarning>>,
    pdf: Mutex<Vec<u8>>,
}

impl FakeBackend {
    fn hold(&self, key: &str) -> watch::Sender<bool> {
        let (sender, receiver) = watch::channel(false);
        self.holds.lock().unwrap().insert(key.to_owned(), receiver);
        sender
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn wait(self: &Arc<Self>, key: &str, call: String, cancel: Cancel) -> BoxFuture<'static, Result<(), JobError>> {
        let backend = self.clone();
        let key = key.to_owned();
        Box::pin(async move {
            backend.calls.lock().unwrap().push(call);
            let hold = backend.holds.lock().unwrap().get(&key).cloned();
            if let Some(mut hold) = hold {
                cancel.run(hold.wait_for(|released| *released)).await?.ok();
            }
            if key == "Label" && backend.fail.lock().unwrap().as_ref().is_some_and(|fail| fail("panic").is_some()) {
                panic!("意外");
            }
            match backend.fail.lock().unwrap().as_ref().and_then(|fail| fail(&key)) {
                Some(error) => Err(error),
                None => Ok(()),
            }
        })
    }
}

#[derive(Clone)]
struct Backend(Arc<FakeBackend>);

impl HtmlPrintEngine for Backend {
    fn name(&self) -> &str {
        "Fake"
    }

    fn version(&self) -> Option<String> {
        None
    }

    fn print(&self, document: Arc<PrintDocument>, printer: String, _options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<HtmlPrintResult, JobError>> {
        let wait = self.0.wait(&printer, format!("html:{printer}"), cancel);
        let warnings = self.0.warnings.lock().unwrap().clone();
        Box::pin(async move {
            wait.await?;
            Ok(HtmlPrintResult {
                sheets: document.sheet_count(),
                warnings,
                spooled: vec![SpoolTicket {
                    printer,
                    document_name: "doc".into(),
                    system_job_id: Some(7),
                }],
            })
        })
    }

    fn export_pdf(&self, _document: Arc<PrintDocument>, _options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<Vec<u8>, JobError>> {
        let wait = self.0.wait("pdf", "pdf".into(), cancel);
        let pdf = self.0.pdf.lock().unwrap().clone();
        Box::pin(async move {
            wait.await?;
            Ok(pdf)
        })
    }
}

impl RawPrinter for Backend {
    fn write(&self, printer: String, data: Arc<Vec<u8>>, document_name: String, cancel: Cancel) -> BoxFuture<'static, Result<RawPrintResult, JobError>> {
        let wait = self.0.wait(&printer, format!("raw:{printer}:{document_name}"), cancel);
        Box::pin(async move {
            wait.await?;
            Ok(RawPrintResult {
                bytes: data.len() as u64,
                spooled: SpoolTicket {
                    printer,
                    document_name,
                    system_job_id: None,
                },
            })
        })
    }
}

#[derive(Default)]
struct FakeCatalog {
    printers: Mutex<Vec<PrinterInfo>>,
    default: Mutex<Option<String>>,
}

impl PrinterCatalog for FakeCatalog {
    fn list(&self) -> std::io::Result<Vec<PrinterInfo>> {
        Ok(self.printers.lock().unwrap().clone())
    }

    fn get(&self, name: &str) -> std::io::Result<Option<PrinterInfo>> {
        Ok(self
            .printers
            .lock()
            .unwrap()
            .iter()
            .find(|printer| printer.name.eq_ignore_ascii_case(name))
            .cloned()
            .map(|mut printer| {
                printer.capabilities = Some(PrinterCapabilities {
                    color: true,
                    duplex: true,
                    max_copies: 99,
                    papers: vec![],
                });
                printer
            }))
    }

    fn default_printer_name(&self) -> std::io::Result<Option<String>> {
        Ok(self.default.lock().unwrap().clone())
    }
}

struct Environment(ClientCapabilities);

impl ClientEnvironment for Environment {
    fn info(&self) -> ClientInfo {
        ClientInfo {
            version: "1.0.0".into(),
            os: "windows".into(),
            arch: "x64".into(),
            renderer: None,
        }
    }

    fn capabilities(&self) -> ClientCapabilities {
        self.0.clone()
    }
}

fn all_capabilities() -> ClientCapabilities {
    ClientCapabilities {
        html: true,
        raw: true,
        pdf: true,
        duplex: true,
        printer_status: true,
        extensions: vec![],
    }
}

struct TestPeer {
    registry: Arc<SessionRegistry>,
    session: Arc<Session>,
    connection: Arc<Connection>,
    _inbox: Inbox,
    peer: Peer,
}

impl TestPeer {
    fn open(registry: &Arc<SessionRegistry>, origin: &str) -> TestPeer {
        let (connection, inbox, peer) = pair(1 << 20);
        let (session, _) = registry.open(origin, None, connection.clone());
        TestPeer {
            registry: registry.clone(),
            session,
            connection,
            _inbox: inbox,
            peer,
        }
    }

    fn detach(&self) {
        self.registry.detach(&self.session, &self.connection);
    }

    fn attach(&mut self) {
        let (connection, inbox, peer) = pair(1 << 20);
        let (session, resumed) = self.registry.open(self.session.origin(), Some(self.session.token()), connection.clone());
        assert!(resumed);
        assert!(Arc::ptr_eq(&session, &self.session));
        self.connection = connection;
        self._inbox = inbox;
        self.peer = peer;
    }

    async fn next(&mut self) -> Value {
        let (opcode, payload) = tokio::time::timeout(Duration::from_secs(5), self.peer.receive())
            .await
            .expect("5 秒内没有消息")
            .expect("连接已断开");
        assert_eq!(opcode, 1, "期望文本消息");
        serde_json::from_slice(&payload).unwrap()
    }

    async fn next_binary(&mut self) -> Vec<u8> {
        let (opcode, payload) = tokio::time::timeout(Duration::from_secs(5), self.peer.receive()).await.unwrap().unwrap();
        assert_eq!(opcode, 2);
        payload
    }

    async fn expect(&mut self, kind: &str) -> Value {
        let message = self.next().await;
        assert_eq!(message["type"], json!(kind), "{message}");
        message
    }

    async fn result(&mut self, id: &str) -> Value {
        let message = self.expect("result").await;
        assert_eq!(message["id"], json!(id));
        assert_eq!(message["ok"], json!(true), "{message}");
        message["data"].clone()
    }

    async fn error(&mut self, id: &str, code: &str) -> Value {
        let message = self.expect("result").await;
        assert_eq!(message["id"], json!(id));
        assert_eq!(message["error"]["code"], json!(code), "{message}");
        message["error"].clone()
    }

    async fn quiet(&mut self) {
        assert!(tokio::time::timeout(Duration::from_millis(200), self.peer.receive()).await.is_err(), "不该再有消息");
    }
}

struct Harness {
    backend: Arc<FakeBackend>,
    catalog: Arc<FakeCatalog>,
    queue: JobQueue,
    handler: PrintRequestHandler,
    registry: Arc<SessionRegistry>,
}

impl Harness {
    fn new(options: JobQueueOptions, capabilities: ClientCapabilities, raw: bool) -> Harness {
        let backend = Arc::new(FakeBackend::default());
        let catalog = Arc::new(FakeCatalog::default());
        {
            let mut printers = catalog.printers.lock().unwrap();
            let mut office = PrinterInfo::named("Office", PrinterState::Ready);
            office.is_default = true;
            printers.push(office);
            printers.push(PrinterInfo::named("Label", PrinterState::Ready));
        }
        *catalog.default.lock().unwrap() = Some("Office".into());
        let engine = Backend(backend.clone());
        let queue = JobQueue::new(
            Some(Arc::new(engine.clone())),
            raw.then(|| Arc::new(engine) as Arc<dyn RawPrinter>),
            options,
            Arc::new(SystemClock::utc()),
            null_log(),
        );
        let handler = PrintRequestHandler::new(catalog.clone(), queue.clone(), Arc::new(Environment(capabilities)), vec![]);
        let registry = Arc::new(SessionRegistry::new(Duration::from_secs(600), Arc::new(SystemClock::utc())));
        Harness {
            backend,
            catalog,
            queue,
            handler,
            registry,
        }
    }

    fn standard() -> Harness {
        Harness::new(JobQueueOptions::default(), all_capabilities(), true)
    }

    fn peer(&self, origin: &str) -> TestPeer {
        TestPeer::open(&self.registry, origin)
    }

    async fn send(&self, peer: &TestPeer, id: &str, body: RequestBody) {
        self.handler.handle(&peer.session, ClientRequest { id: id.into(), body }).await.unwrap();
    }

    async fn html(&self, peer: &TestPeer, job: &str, printer: Option<&str>, options: PrintOptions) {
        self.send(
            peer,
            &format!("r-{job}"),
            RequestBody::PrintHtml(PrintHtmlRequest {
                job_id: job.into(),
                document: document(),
                printer: printer.map(str::to_owned),
                options,
            }),
        )
        .await;
    }
}

fn document() -> Arc<PrintDocument> {
    Arc::new(PrintDocument {
        html: "<!doctype html><p>送货单</p>".into(),
        resources: vec![],
        sheets: vec![
            SheetGroup {
                width_mm: 210.0,
                height_mm: 297.0,
                count: 2,
            },
            SheetGroup {
                width_mm: 297.0,
                height_mm: 210.0,
                count: 1,
            },
        ],
    })
}

/// 收下受理响应与 queued 事件，返回排队位置
async fn accepted(peer: &mut TestPeer, job: &str) -> u64 {
    let data = peer.result(&format!("r-{job}")).await;
    assert_eq!(data["jobId"], json!(job));
    let queued = peer.expect("job.queued").await;
    assert_eq!(queued["jobId"], json!(job));
    assert_eq!(queued["position"], data["position"]);
    data["position"].as_u64().unwrap()
}

async fn event(peer: &mut TestPeer, kind: &str, job: &str) -> Value {
    let message = peer.expect(kind).await;
    assert_eq!(message["jobId"], json!(job));
    message
}

#[tokio::test]
async fn lists_printers_and_reports_missing_ones() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    harness.send(&peer, "l", RequestBody::ListPrinters).await;
    let names: Vec<_> = peer.result("l").await.as_array().unwrap().iter().map(|item| item["name"].clone()).collect();
    assert_eq!(names, vec![json!("Office"), json!("Label")]);
    harness.send(&peer, "g", RequestBody::GetPrinter { name: "label".into() }).await;
    assert_eq!(peer.result("g").await["capabilities"]["maxCopies"], json!(99));
    harness.send(&peer, "m", RequestBody::GetPrinter { name: "Missing".into() }).await;
    assert_eq!(peer.error("m", errors::PRINTER_NOT_FOUND).await["details"]["printer"], json!("Missing"));
}

#[tokio::test]
async fn prints_on_the_default_printer_and_reports_each_state() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    harness.html(&peer, "j1", None, PrintOptions::default()).await;
    assert_eq!(accepted(&mut peer, "j1").await, 0);
    event(&mut peer, "job.started", "j1").await;
    let completed = event(&mut peer, "job.completed", "j1").await;
    assert_eq!(completed["sheets"], json!(3));
    assert!(completed["at"].as_str().unwrap().ends_with('Z'));
    assert_eq!(harness.backend.calls(), vec!["html:Office"]);
    harness.send(&peer, "s", RequestBody::GetJob { job_id: "j1".into() }).await;
    let status = peer.result("s").await;
    assert_eq!(status["state"], json!("completed"));
    assert!(status.get("position").is_none());
}

#[tokio::test]
async fn carries_engine_warnings_and_reports_failures() {
    let harness = Harness::standard();
    *harness.backend.warnings.lock().unwrap() = vec![ProtocolWarning::new(warnings::PAPER_UNCHECKED, "没有核对纸张", Details::new().with("printer", "Office"))];
    let mut peer = harness.peer("https://erp.example.com");
    harness.html(&peer, "w1", None, PrintOptions::default()).await;
    accepted(&mut peer, "w1").await;
    event(&mut peer, "job.started", "w1").await;
    let warning = event(&mut peer, "job.completed", "w1").await["warnings"][0].clone();
    assert_eq!(
        (warning["code"].clone(), warning["details"]["printer"].clone()),
        (json!("PAPER_UNCHECKED"), json!("Office"))
    );

    *harness.backend.fail.lock().unwrap() = Some(Box::new(|key: &str| match key {
        "Office" => Some(JobError::failure(errors::RENDER_FAILED, "渲染失败", Some(Details::new().with("sheet", 2)))),
        _ => Some(JobError::Cancelled),
    }));
    harness.html(&peer, "f1", None, PrintOptions::default()).await;
    accepted(&mut peer, "f1").await;
    event(&mut peer, "job.started", "f1").await;
    let rendered = event(&mut peer, "job.failed", "f1").await["error"].clone();
    assert_eq!((rendered["code"].clone(), rendered["details"]["sheet"].clone()), (json!("RENDER_FAILED"), json!(2)));

    harness.html(&peer, "f2", Some("Label"), PrintOptions::default()).await;
    accepted(&mut peer, "f2").await;
    event(&mut peer, "job.started", "f2").await;
    assert_eq!(event(&mut peer, "job.failed", "f2").await["error"]["code"], json!("INTERNAL"));

    let recent = harness.queue.recent(5);
    assert_eq!(recent.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(), vec!["f2", "f1", "w1"]);
    assert_eq!(
        (
            recent[0].origin.as_str(),
            recent[0].kind,
            recent[0].printer.as_deref(),
            recent[0].state,
            recent[0].error_code.as_deref()
        ),
        ("https://erp.example.com", JobKind::Html, Some("Label"), JobState::Failed, Some("INTERNAL"))
    );
    assert!(recent[0].finished_at.unwrap() >= recent[0].created_at);
}

#[tokio::test]
async fn reports_panicking_backends_as_internal_errors() {
    let harness = Harness::standard();
    *harness.backend.fail.lock().unwrap() = Some(Box::new(|key: &str| (key == "panic").then_some(JobError::Cancelled)));
    let mut peer = harness.peer("https://erp.example.com");
    harness.html(&peer, "p1", Some("Label"), PrintOptions::default()).await;
    accepted(&mut peer, "p1").await;
    event(&mut peer, "job.started", "p1").await;
    assert_eq!(event(&mut peer, "job.failed", "p1").await["error"]["code"], json!("INTERNAL"));
    harness.html(&peer, "p2", Some("Label"), PrintOptions::default()).await;
    accepted(&mut peer, "p2").await;
    event(&mut peer, "job.started", "p2").await;
}

#[tokio::test]
async fn runs_jobs_on_one_printer_in_order_without_blocking_other_printers() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let hold = harness.backend.hold("Office");
    harness.html(&peer, "a1", None, PrintOptions::default()).await;
    assert_eq!(accepted(&mut peer, "a1").await, 0);
    event(&mut peer, "job.started", "a1").await;
    harness.html(&peer, "a2", Some("office"), PrintOptions::default()).await;
    assert_eq!(accepted(&mut peer, "a2").await, 1);

    harness
        .send(
            &peer,
            "r-b1",
            RequestBody::PrintRaw(PrintRawRequest {
                job_id: "b1".into(),
                printer: "Label".into(),
                data: Arc::new(vec![1, 2, 3]),
                doc_name: Some("发货标签".into()),
            }),
        )
        .await;
    assert_eq!(accepted(&mut peer, "b1").await, 0);
    event(&mut peer, "job.started", "b1").await;
    assert_eq!(event(&mut peer, "job.completed", "b1").await["bytes"], json!(3));

    harness.send(&peer, "s", RequestBody::GetJob { job_id: "a2".into() }).await;
    assert_eq!(peer.result("s").await["position"], json!(1));

    hold.send(true).unwrap();
    event(&mut peer, "job.completed", "a1").await;
    event(&mut peer, "job.started", "a2").await;
    event(&mut peer, "job.completed", "a2").await;
    assert_eq!(harness.backend.calls(), vec!["html:Office", "raw:Label:发货标签", "html:Office"]);
}

#[tokio::test]
async fn cancels_queued_jobs_at_once_and_running_jobs_best_effort() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let _hold = harness.backend.hold("Office");
    harness.html(&peer, "a1", None, PrintOptions::default()).await;
    accepted(&mut peer, "a1").await;
    event(&mut peer, "job.started", "a1").await;
    harness.html(&peer, "a2", None, PrintOptions::default()).await;
    accepted(&mut peer, "a2").await;

    harness.send(&peer, "c2", RequestBody::CancelJob { job_id: "a2".into() }).await;
    event(&mut peer, "job.cancelled", "a2").await;
    assert_eq!(peer.result("c2").await["cancelled"], json!(true));

    harness.send(&peer, "c1", RequestBody::CancelJob { job_id: "a1".into() }).await;
    let replies = [peer.next().await, peer.next().await];
    let result = replies.iter().find(|item| item["type"] == json!("result")).unwrap();
    let cancelled = replies.iter().find(|item| item["type"] == json!("job.cancelled")).unwrap();
    assert_eq!(result["data"]["cancelled"], json!(false));
    assert_eq!(cancelled["jobId"], json!("a1"));

    harness.send(&peer, "c3", RequestBody::CancelJob { job_id: "missing".into() }).await;
    peer.error("c3", errors::JOB_NOT_FOUND).await;
    peer.quiet().await;
    assert_eq!(harness.backend.calls(), vec!["html:Office"]);
}

#[tokio::test]
async fn fails_jobs_that_outlive_their_timeout() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let _hold = harness.backend.hold("Office");
    harness
        .html(
            &peer,
            "t1",
            None,
            PrintOptions {
                timeout_ms: Some(1000),
                ..PrintOptions::default()
            },
        )
        .await;
    accepted(&mut peer, "t1").await;
    event(&mut peer, "job.started", "t1").await;
    let error = event(&mut peer, "job.failed", "t1").await["error"].clone();
    assert_eq!(error["code"], json!("SPOOL_FAILED"));
    assert_eq!(error["details"]["timeout"], json!(true));
    assert_eq!(error["message"], json!("任务超过 1 秒没有完成"));
}

#[tokio::test]
async fn rejects_page_ranges_that_select_nothing() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    harness
        .html(
            &peer,
            "g1",
            None,
            PrintOptions {
                page_ranges: Some("4-9".into()),
                ..PrintOptions::default()
            },
        )
        .await;
    assert_eq!(peer.error("r-g1", errors::BAD_REQUEST).await["details"]["field"], json!("options.pageRanges"));
    harness
        .send(
            &peer,
            "r-g2",
            RequestBody::ExportPdf(ExportPdfRequest {
                job_id: "g2".into(),
                document: document(),
                options: PrintOptions {
                    page_ranges: Some("4".into()),
                    ..PrintOptions::default()
                },
            }),
        )
        .await;
    peer.error("r-g2", errors::BAD_REQUEST).await;
    peer.quiet().await;
    assert!(harness.backend.calls().is_empty());
}

#[tokio::test]
async fn cancels_the_job_when_the_user_cancels_the_print_dialog() {
    let harness = Harness::standard();
    *harness.backend.fail.lock().unwrap() = Some(Box::new(|_: &str| Some(JobError::CancelledByUser)));
    let mut peer = harness.peer("https://erp.example.com");
    harness
        .html(
            &peer,
            "u1",
            None,
            PrintOptions {
                dialog: true,
                ..PrintOptions::default()
            },
        )
        .await;
    accepted(&mut peer, "u1").await;
    event(&mut peer, "job.started", "u1").await;
    assert!(event(&mut peer, "job.cancelled", "u1").await.get("error").is_none());
}

#[tokio::test]
async fn rejects_duplicate_job_ids_and_full_queues() {
    let harness = Harness::new(
        JobQueueOptions {
            max_active_per_session: 2,
            ..JobQueueOptions::default()
        },
        all_capabilities(),
        true,
    );
    let mut peer = harness.peer("https://erp.example.com");
    let _hold = harness.backend.hold("Office");
    harness.html(&peer, "d1", None, PrintOptions::default()).await;
    accepted(&mut peer, "d1").await;
    event(&mut peer, "job.started", "d1").await;
    harness.html(&peer, "d1", None, PrintOptions::default()).await;
    peer.error("r-d1", errors::JOB_DUPLICATE).await;
    harness.html(&peer, "d2", None, PrintOptions::default()).await;
    accepted(&mut peer, "d2").await;
    harness.html(&peer, "d3", None, PrintOptions::default()).await;
    peer.error("r-d3", errors::QUEUE_FULL).await;
    let mut other = harness.peer("https://wms.example.com");
    harness.html(&other, "e1", Some("Label"), PrintOptions::default()).await;
    accepted(&mut other, "e1").await;
}

#[tokio::test]
async fn checks_the_target_printer_before_queueing() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let mut paused = PrinterInfo::named("Paused", PrinterState::Paused);
    paused.status_flags = 1;
    harness.catalog.printers.lock().unwrap().push(paused);

    harness.html(&peer, "p1", Some("Missing"), PrintOptions::default()).await;
    peer.error("r-p1", errors::PRINTER_NOT_FOUND).await;
    harness.html(&peer, "p2", Some("paused"), PrintOptions::default()).await;
    let offline = peer.error("r-p2", errors::PRINTER_OFFLINE).await["details"].clone();
    assert_eq!(offline, json!({ "printer": "Paused", "status": "paused", "statusFlags": 1 }));
    *harness.catalog.default.lock().unwrap() = None;
    harness.html(&peer, "p3", None, PrintOptions::default()).await;
    peer.error("r-p3", errors::PRINTER_NOT_FOUND).await;
    harness.catalog.printers.lock().unwrap().clear();
    harness
        .send(
            &peer,
            "r-p4",
            RequestBody::PrintRaw(PrintRawRequest {
                job_id: "p4".into(),
                printer: "Label".into(),
                data: Arc::new(vec![1]),
                doc_name: None,
            }),
        )
        .await;
    peer.error("r-p4", errors::NO_PRINTERS).await;
    peer.quiet().await;
    assert!(harness.backend.calls().is_empty());
}

#[tokio::test]
async fn rejects_capabilities_the_client_does_not_have() {
    let harness = Harness::new(
        JobQueueOptions::default(),
        ClientCapabilities {
            html: true,
            ..ClientCapabilities::default()
        },
        false,
    );
    let mut peer = harness.peer("https://erp.example.com");
    harness
        .send(
            &peer,
            "r-x1",
            RequestBody::PrintRaw(PrintRawRequest {
                job_id: "x1".into(),
                printer: "Label".into(),
                data: Arc::new(vec![1]),
                doc_name: None,
            }),
        )
        .await;
    assert_eq!(peer.error("r-x1", errors::CAPABILITY_UNSUPPORTED).await["details"]["capability"], json!("raw"));
    harness
        .send(
            &peer,
            "r-x2",
            RequestBody::ExportPdf(ExportPdfRequest {
                job_id: "x2".into(),
                document: document(),
                options: PrintOptions::default(),
            }),
        )
        .await;
    assert_eq!(peer.error("r-x2", errors::CAPABILITY_UNSUPPORTED).await["details"]["capability"], json!("pdf"));
    harness
        .html(
            &peer,
            "x3",
            None,
            PrintOptions {
                duplex: DuplexMode::LongEdge,
                ..PrintOptions::default()
            },
        )
        .await;
    assert_eq!(peer.error("r-x3", errors::CAPABILITY_UNSUPPORTED).await["details"]["capability"], json!("duplex"));
    harness
        .send(
            &peer,
            "u",
            RequestBody::Custom(CustomRequest {
                kind: "label.print".into(),
                message: Default::default(),
            }),
        )
        .await;
    assert_eq!(peer.error("u", errors::BAD_REQUEST).await["details"]["field"], json!("type"));
}

#[tokio::test]
async fn sends_the_exported_pdf_as_a_header_followed_by_a_binary_message() {
    let harness = Harness::standard();
    let pdf: Vec<u8> = (0..300_000u32).map(|index| index as u8).collect();
    *harness.backend.pdf.lock().unwrap() = pdf.clone();
    let mut peer = harness.peer("https://erp.example.com");
    harness
        .send(
            &peer,
            "r-x",
            RequestBody::ExportPdf(ExportPdfRequest {
                job_id: "x".into(),
                document: document(),
                options: PrintOptions::default(),
            }),
        )
        .await;
    accepted(&mut peer, "x").await;
    event(&mut peer, "job.started", "x").await;
    let output = event(&mut peer, "job.output", "x").await;
    assert_eq!((output["mime"].clone(), output["bytes"].clone()), (json!("application/pdf"), json!(300_000)));
    assert_eq!(peer.next_binary().await, pdf);
    assert_eq!(event(&mut peer, "job.completed", "x").await["bytes"], json!(300_000));
}

#[tokio::test]
async fn fails_an_export_whose_result_cannot_be_delivered() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let hold = harness.backend.hold("pdf");
    harness
        .send(
            &peer,
            "r-x",
            RequestBody::ExportPdf(ExportPdfRequest {
                job_id: "x".into(),
                document: document(),
                options: PrintOptions::default(),
            }),
        )
        .await;
    accepted(&mut peer, "x").await;
    event(&mut peer, "job.started", "x").await;
    peer.detach();
    hold.send(true).unwrap();
    for _ in 0..250 {
        if harness.handler.unfinished_jobs(&peer.session).is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    peer.attach();
    harness.send(&peer, "s", RequestBody::GetJob { job_id: "x".into() }).await;
    let status = peer.result("s").await;
    assert_eq!(status["state"], json!("failed"));
    assert_eq!(status["error"]["code"], json!("PDF_FAILED"));
    assert_eq!(status["error"]["details"]["delivered"], json!(false));
}

#[tokio::test]
async fn replays_unfinished_jobs_after_the_session_resumes() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let hold = harness.backend.hold("Office");
    harness.html(&peer, "u1", None, PrintOptions::default()).await;
    accepted(&mut peer, "u1").await;
    event(&mut peer, "job.started", "u1").await;
    harness.html(&peer, "u2", None, PrintOptions::default()).await;
    accepted(&mut peer, "u2").await;
    harness.html(&peer, "u3", Some("Label"), PrintOptions::default()).await;
    accepted(&mut peer, "u3").await;
    event(&mut peer, "job.started", "u3").await;
    event(&mut peer, "job.completed", "u3").await;

    peer.detach();
    peer.attach();
    assert_eq!(harness.handler.unfinished_jobs(&peer.session), vec!["u1", "u2"]);
    harness.handler.replay(&peer.session).await;
    let first = peer.next().await;
    let second = peer.next().await;
    assert_eq!((first["jobId"].clone(), first["type"].clone()), (json!("u1"), json!("job.started")));
    assert_eq!(
        (second["jobId"].clone(), second["type"].clone(), second["position"].clone()),
        (json!("u2"), json!("job.queued"), json!(1))
    );
    hold.send(true).unwrap();
    event(&mut peer, "job.completed", "u1").await;
}

#[tokio::test]
async fn keeps_jobs_private_to_their_session() {
    let harness = Harness::standard();
    let mut peer = harness.peer("https://erp.example.com");
    let mut other = harness.peer("https://wms.example.com");
    let _hold = harness.backend.hold("Office");
    harness.html(&peer, "k1", None, PrintOptions::default()).await;
    accepted(&mut peer, "k1").await;
    harness.send(&other, "s", RequestBody::GetJob { job_id: "k1".into() }).await;
    other.error("s", errors::JOB_NOT_FOUND).await;
    harness.send(&other, "c", RequestBody::CancelJob { job_id: "k1".into() }).await;
    other.error("c", errors::JOB_NOT_FOUND).await;
    assert!(harness.handler.unfinished_jobs(&other.session).is_empty());
}

#[tokio::test]
async fn forgets_finished_jobs_of_expired_sessions_and_caps_the_history() {
    let harness = Harness::new(
        JobQueueOptions {
            max_finished_retained: 2,
            ..JobQueueOptions::default()
        },
        all_capabilities(),
        true,
    );
    let mut peer = harness.peer("https://erp.example.com");
    for id in ["h1", "h2", "h3"] {
        harness.html(&peer, id, None, PrintOptions::default()).await;
        accepted(&mut peer, id).await;
        event(&mut peer, "job.started", id).await;
        event(&mut peer, "job.completed", id).await;
    }
    harness.send(&peer, "s1", RequestBody::GetJob { job_id: "h1".into() }).await;
    peer.error("s1", errors::JOB_NOT_FOUND).await;
    harness.send(&peer, "s2", RequestBody::GetJob { job_id: "h2".into() }).await;
    peer.result("s2").await;
    harness.queue.forget(&peer.session);
    harness.send(&peer, "s3", RequestBody::GetJob { job_id: "h3".into() }).await;
    peer.error("s3", errors::JOB_NOT_FOUND).await;
    harness.html(&peer, "h3", None, PrintOptions::default()).await;
    accepted(&mut peer, "h3").await;
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<String>>,
}

impl JobObserver for Recorder {
    fn accepted(&self, job: &Arc<Job>) {
        self.events.lock().unwrap().push(format!("accepted:{}:{}", job.id(), job.owner().origin()));
    }

    fn changed(&self, job: &Arc<Job>, status: &JobStatus) {
        self.events.lock().unwrap().push(format!("{}:{}", job.id(), status.state.name()));
    }
}

struct Receipt;

impl CompletionTracker for Receipt {
    fn track(&self, job: &Arc<Job>, spooled: &[SpoolTicket], _cancel: Cancel) -> Option<BoxFuture<'static, Result<(), JobError>>> {
        let failed = job.id() == "late";
        let ticket = spooled.first().and_then(|ticket| ticket.system_job_id);
        Some(Box::pin(async move {
            assert_eq!(ticket, Some(7));
            if failed { Err(JobError::failure("PRINTER_ERROR", "卡纸", None)) } else { Ok(()) }
        }))
    }
}

#[tokio::test]
async fn runs_local_jobs_and_tells_observers_and_trackers() {
    let harness = Harness::standard();
    let recorder = Arc::new(Recorder::default());
    harness.queue.add_observer(recorder.clone());
    harness.queue.set_completion_tracker(Arc::new(Receipt));
    let job = Job::html("again", JobOwner::Local { origin: "打印记录".into() }, "Office", document(), PrintOptions::default());
    harness.queue.enqueue(job.clone(), |_| async {}).await.unwrap();
    let late = Job::html("late", JobOwner::Local { origin: "打印记录".into() }, "Office", document(), PrintOptions::default());
    harness.queue.enqueue(late.clone(), |_| async {}).await.unwrap();
    let pdf = Job::pdf("local-pdf", JobOwner::Local { origin: "打印记录".into() }, document(), PrintOptions::default());
    *harness.backend.pdf.lock().unwrap() = b"%PDF-1.7".to_vec();
    harness.queue.enqueue(pdf.clone(), |_| async {}).await.unwrap();
    for _ in 0..250 {
        if job.is_finished() && late.is_finished() && pdf.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(job.state(), JobState::Completed);
    assert_eq!(late.state(), JobState::Failed);
    assert_eq!(late.snapshot(None).error.unwrap().code, "PRINTER_ERROR");
    assert_eq!(pdf.output().unwrap().as_slice(), b"%PDF-1.7");
    let events = recorder.events.lock().unwrap().clone();
    assert_eq!(&events[..3], &["accepted:again:打印记录", "again:queued", "accepted:late:打印记录"]);
    assert!(events.contains(&"again:completed".to_owned()));
    assert!(events.contains(&"late:failed".to_owned()));
}
