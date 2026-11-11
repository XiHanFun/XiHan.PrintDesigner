// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

use std::fmt::Write as _;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde_json::json;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::null_log;
use xihan_print_client_core::printing::{HtmlPrintEngine, JobError, PaperCatalog, PrinterPapers};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{ClientInfo, DocumentResource, PrintDocument, PrintOptions, ProtocolError, SheetGroup};

use super::engine::WebView2Engine;
use crate::EngineOptions;

const A4: (f64, f64) = (210.0, 297.0);
const A5: (f64, f64) = (148.0, 210.0);
const A4_LANDSCAPE: (f64, f64) = (297.0, 210.0);
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

struct NoPapers;

impl PaperCatalog for NoPapers {
    fn open(&self, _printer: &str) -> Option<Box<dyn PrinterPapers>> {
        None
    }
}

async fn engine() -> WebView2Engine {
    engine_with(xihan_print_client_core::defaults::RENDER_TIMEOUT).await
}

async fn engine_with(render_timeout: Duration) -> WebView2Engine {
    let directory = std::env::temp_dir().join(format!("xihan-print-webview-{}", xihan_print_client_core::server::random_hex(8)));
    WebView2Engine::create(EngineOptions {
        data_directory: directory,
        papers: Arc::new(NoPapers),
        dialog: None,
        render_timeout,
        log: null_log(),
    })
    .await
    .expect("要装好 WebView2 运行时")
}

/// 按输出页的写法拼一份文档：每种尺寸一条具名 @page，每张输出页一个 data-part="sheet"；连续同尺寸的页并成一组
fn document(sheets: &[(f64, f64)], content: &str, resources: Vec<DocumentResource>, tail: &str) -> Arc<PrintDocument> {
    let mut sizes: Vec<(f64, f64)> = Vec::new();
    for sheet in sheets {
        if !sizes.contains(sheet) {
            sizes.push(*sheet);
        }
    }
    let mut html = String::from("<!doctype html><html><head><meta charset='utf-8'><style>@page { margin: 0 }");
    for (index, (width, height)) in sizes.iter().enumerate() {
        let _ = write!(html, " @page s{index} {{ size: {width}mm {height}mm; margin: 0 }}");
    }
    html.push_str(" body { margin: 0 } [data-part=sheet] { break-after: page; overflow: hidden } [data-part=sheet]:last-child { break-after: auto }</style></head><body>");
    for sheet in sheets {
        let index = sizes.iter().position(|size| size == sheet).unwrap();
        let _ = write!(
            html,
            "<div data-part='sheet' style='page: s{index}; width: {}mm; height: {}mm'>{content}</div>",
            sheet.0, sheet.1
        );
    }
    html.push_str(tail);
    html.push_str("</body></html>");
    let mut groups: Vec<SheetGroup> = Vec::new();
    for (width_mm, height_mm) in sheets {
        match groups.last_mut() {
            Some(last) if last.width_mm == *width_mm && last.height_mm == *height_mm => last.count += 1,
            _ => groups.push(SheetGroup {
                width_mm: *width_mm,
                height_mm: *height_mm,
                count: 1,
            }),
        }
    }
    Arc::new(PrintDocument { html, resources, sheets: groups })
}

fn png(id: &str) -> DocumentResource {
    DocumentResource {
        id: id.into(),
        mime: "image/png".into(),
        data: Arc::new(base64::engine::general_purpose::STANDARD.decode(PNG).unwrap()),
    }
}

/// 读出 PDF 每页的尺寸，单位 mm，取整
fn page_sizes(pdf: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(pdf);
    let mut sizes = Vec::new();
    let mut rest = text.as_ref();
    while let Some(index) = rest.find("/MediaBox") {
        rest = &rest[index + 9..];
        let inner = rest.trim_start().trim_start_matches('[');
        let numbers: Vec<f64> = inner.split(']').next().unwrap_or("").split_whitespace().filter_map(|item| item.parse().ok()).collect();
        if numbers.len() == 4 {
            sizes.push(format!("{}x{}", (numbers[2] * 25.4 / 72.0).round(), (numbers[3] * 25.4 / 72.0).round()));
        }
    }
    sizes
}

async fn export(engine: &WebView2Engine, document: Arc<PrintDocument>, options: PrintOptions) -> Vec<u8> {
    engine.export_pdf(document, options, Cancel::new()).await.unwrap()
}

async fn fails(engine: &WebView2Engine, document: Arc<PrintDocument>) -> ProtocolError {
    match engine.export_pdf(document, PrintOptions::default(), Cancel::new()).await {
        Err(JobError::Failure(error)) => error,
        other => panic!("期望失败，得到 {:?}", other.map(|pdf| pdf.len())),
    }
}

#[tokio::test]
async fn reports_the_runtime_version_and_exports_every_paper_size_into_one_pdf() {
    let engine = engine().await;
    assert!(engine.version().unwrap().split('.').count() >= 4);
    let pdf = export(&engine, document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""), PrintOptions::default()).await;
    assert!(pdf.starts_with(b"%PDF-"));
    assert_eq!(page_sizes(&pdf), vec!["210x297", "210x297", "148x210", "297x210"]);
    let selected = export(
        &engine,
        document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""),
        PrintOptions {
            page_ranges: Some("2-3".into()),
            ..PrintOptions::default()
        },
    )
    .await;
    assert_eq!(page_sizes(&selected), vec!["210x297", "148x210"]);
}

#[tokio::test]
async fn renders_the_self_test_page_and_several_documents_at_once() {
    let engine = engine().await;
    let client = ClientInfo {
        version: "0.1.0".into(),
        os: "windows".into(),
        arch: "x64".into(),
        renderer: engine.version(),
    };
    let selftest = xihan_print_client_core::printing::selftest::document(&client, "WebView2", "Office", 100.0, 50.0, xihan_print_client_core::time::Timestamp(0), 0);
    let first = engine.export_pdf(Arc::new(selftest), PrintOptions::default(), Cancel::new());
    let second = engine.export_pdf(document(&[A5], "", vec![], ""), PrintOptions::default(), Cancel::new());
    let (first, second) = tokio::join!(first, second);
    assert_eq!(page_sizes(&first.unwrap()), vec!["100x50"]);
    assert_eq!(page_sizes(&second.unwrap()), vec!["148x210"]);
}

#[tokio::test]
async fn serves_task_resources_and_waits_for_lazy_images() {
    let engine = engine().await;
    let images = "<img src='r/0' style='width: 20mm'><img src='https://print.local/r/0?v=1' style='width: 10mm'>";
    assert_eq!(
        page_sizes(&export(&engine, document(&[A5], images, vec![png("0")], ""), PrintOptions::default()).await),
        vec!["148x210"]
    );
    let lazy = "<img src='r/0' loading='lazy' style='width: 20mm'>";
    assert_eq!(
        page_sizes(&export(&engine, document(&[A5, A5], lazy, vec![png("0")], ""), PrintOptions::default()).await).len(),
        2
    );
}

#[tokio::test]
async fn reports_broken_blocked_and_missing_resources() {
    let engine = engine().await;
    let broken = DocumentResource {
        id: "0".into(),
        mime: "image/png".into(),
        data: Arc::new(vec![0, 1, 2, 3]),
    };
    let error = fails(&engine, document(&[A5], "<img src='r/0'><img src='r/0?v=1'>", vec![broken], "")).await;
    assert_eq!(
        (error.code.as_str(), error.details.unwrap().get("images").cloned()),
        (errors::RENDER_FAILED, Some(json!(2)))
    );
    let error = fails(&engine, document(&[A5], "<img src='https://example.com/logo.png?token=secret'>", vec![], "")).await;
    assert_eq!(
        (error.code.as_str(), error.details.unwrap().get("url").cloned()),
        (errors::RESOURCE_BLOCKED, Some(json!("https://example.com")))
    );
    let error = fails(&engine, document(&[A5], "<img src='r/9'>", vec![], "")).await;
    assert_eq!(
        (error.code.as_str(), error.details.unwrap().get("resource").cloned()),
        (errors::RENDER_FAILED, Some(json!("9")))
    );
}

#[tokio::test]
async fn keeps_page_scripts_from_running_and_checks_the_sheet_count() {
    let engine = engine().await;
    let script = "<script>document.querySelector('[data-part=\"sheet\"]').remove()</script>";
    assert_eq!(
        page_sizes(&export(&engine, document(&[A4, A4], "", vec![], script), PrintOptions::default()).await).len(),
        2
    );
    let mut mismatched = (*document(&[A4, A4], "", vec![], "")).clone();
    mismatched.sheets = vec![SheetGroup {
        width_mm: 210.0,
        height_mm: 297.0,
        count: 3,
    }];
    let details = fails(&engine, Arc::new(mismatched)).await.details.unwrap();
    assert_eq!((details.get("expected").cloned(), details.get("actual").cloned()), (Some(json!(3)), Some(json!(2))));
}

#[tokio::test]
async fn times_out_when_the_document_is_not_ready_in_time() {
    let engine = engine_with(Duration::from_millis(1)).await;
    assert_eq!(fails(&engine, document(&[A4], "", vec![], "")).await.code, errors::RENDER_TIMEOUT);
}

#[tokio::test]
async fn reports_a_missing_printer_as_unavailable() {
    let engine = engine().await;
    match engine
        .print(document(&[A4], "", vec![], ""), "XiHan 不存在的打印机 7f3a".into(), PrintOptions::default(), Cancel::new())
        .await
    {
        Err(JobError::Failure(error)) => assert_eq!(error.code, errors::PRINTER_OFFLINE),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn prints_each_paper_group_to_the_test_printer() {
    let (Ok(printer), Ok(output)) = (std::env::var("XIHAN_PRINT_TEST_PRINTER"), std::env::var("XIHAN_PRINT_TEST_OUTPUT")) else {
        eprintln!("没有配置测试打印机（XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT），跳过");
        return;
    };
    let _ = std::fs::remove_file(&output);
    let engine = engine().await;
    let options = PrintOptions {
        page_ranges: Some("2-3".into()),
        ..PrintOptions::default()
    };
    let printed = engine
        .print(document(&[A4, A4, A5], "曦寒打印测试", vec![], ""), printer, options, Cancel::new())
        .await
        .unwrap();
    assert_eq!(printed.sheets, 2);
    for _ in 0..100 {
        if std::fs::metadata(&output).is_ok_and(|meta| meta.len() > 0) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(std::fs::metadata(&output).unwrap().len() > 0);
}
