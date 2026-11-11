// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! macOS 上 HTML 通道的集成测试：主线程跑 NSApplication 的主运行循环，另起线程跑 tokio 与各用例，经 WKWebView 导出 PDF 后用 PDFKit 读回每页尺寸。
//! 其他平台上是空的

#[cfg(target_os = "macos")]
fn main() {
    macos::main();
}

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
mod macos {
    use std::fmt::Write as _;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Arc;

    use base64::Engine as _;
    use dispatch2::DispatchQueue;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::NSData;
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
    use xihan_print_client_core::cancel::Cancel;
    use xihan_print_client_core::log::null_log;
    use xihan_print_client_core::printing::{HtmlPrintEngine, JobError, PaperCatalog, PrinterPapers};
    use xihan_print_client_core::protocol::codes::errors;
    use xihan_print_client_core::protocol::{DocumentResource, PrintDocument, PrintOptions, ProtocolError, SheetGroup};
    use xihan_print_client_platform::{EngineOptions, create_engine};

    type Size = (f64, f64);
    type Case = fn(Arc<dyn HtmlPrintEngine>) -> Pin<Box<dyn Future<Output = ()> + Send>>;

    const A4: Size = (210.0, 297.0);
    const A5: Size = (148.0, 210.0);
    const A4_LANDSCAPE: Size = (297.0, 210.0);
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    /// 主线程跑主运行循环；用例跑完后在主线程上以结果退出进程
    pub(super) fn main() {
        let mtm = MainThreadMarker::new().expect("测试要在主线程上启动");
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        std::thread::spawn(|| {
            let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("建不了 tokio 运行时");
            let failed = runtime.block_on(run());
            DispatchQueue::main().exec_async(move || std::process::exit(if failed == 0 { 0 } else { 1 }));
        });
        app.run();
    }

    /// 逐个跑用例，返回失败的个数
    async fn run() -> usize {
        let data_directory = std::env::temp_dir().join(format!("xihan-print-webkit-{}", std::process::id()));
        let options = EngineOptions {
            data_directory: data_directory.clone(),
            papers: Arc::new(NoPapers),
            dialog: None,
            render_timeout: xihan_print_client_core::defaults::RENDER_TIMEOUT,
            log: null_log(),
        };
        let engine = match create_engine(options).await {
            Ok(engine) => engine,
            Err(reason) => {
                eprintln!("建不了渲染引擎：{reason}");
                return 1;
            }
        };
        let cases: [(&str, Case); 11] = [
            ("reports_the_webkit_version", |engine| Box::pin(reports_the_webkit_version(engine))),
            ("exports_every_paper_size_into_one_pdf", |engine| Box::pin(exports_every_paper_size_into_one_pdf(engine))),
            ("exports_only_the_selected_pages", |engine| Box::pin(exports_only_the_selected_pages(engine))),
            ("exports_several_documents_at_once", |engine| Box::pin(exports_several_documents_at_once(engine))),
            ("serves_the_task_resources", |engine| Box::pin(serves_the_task_resources(engine))),
            ("loads_lazy_images_before_exporting", |engine| Box::pin(loads_lazy_images_before_exporting(engine))),
            ("reports_images_that_fail_to_decode", |engine| Box::pin(reports_images_that_fail_to_decode(engine))),
            ("refuses_resources_from_outside_the_task", |engine| {
                Box::pin(refuses_resources_from_outside_the_task(engine))
            }),
            ("reports_resources_the_task_did_not_bring", |engine| {
                Box::pin(reports_resources_the_task_did_not_bring(engine))
            }),
            ("keeps_page_scripts_from_running", |engine| Box::pin(keeps_page_scripts_from_running(engine))),
            ("rejects_documents_whose_sheets_do_not_match_the_groups", |engine| {
                Box::pin(rejects_documents_whose_sheets_do_not_match_the_groups(engine))
            }),
        ];
        let mut failed = 0;
        for (name, case) in cases {
            match tokio::spawn(case(engine.clone())).await {
                Ok(()) => println!("test {name} ... ok"),
                Err(error) => {
                    failed += 1;
                    println!("test {name} ... FAILED：{error}");
                }
            }
        }
        println!("\n{} passed; {failed} failed", cases.len() - failed);
        let _ = std::fs::remove_dir_all(data_directory);
        failed
    }

    /// 不报纸张能力的打印机目录；导出 PDF 用不到
    struct NoPapers;

    impl PaperCatalog for NoPapers {
        fn open(&self, _printer: &str) -> Option<Box<dyn PrinterPapers>> {
            None
        }
    }

    /// 按输出页的写法拼一份文档：每种尺寸一条具名 @page，每张输出页一个 data-part="sheet"；连续同尺寸的页并成一组
    fn document(sheets: &[Size], content: &str, resources: Vec<DocumentResource>, tail: &str) -> PrintDocument {
        let mut sizes: Vec<Size> = Vec::new();
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
            let index = sizes.iter().position(|size| size == sheet).unwrap_or_default();
            let _ = write!(
                html,
                "<div data-part='sheet' style='page: s{index}; width: {}mm; height: {}mm'>{content}</div>",
                sheet.0, sheet.1
            );
        }
        html.push_str(tail);
        html.push_str("</body></html>");

        let mut groups: Vec<SheetGroup> = Vec::new();
        for &(width_mm, height_mm) in sheets {
            match groups.last_mut() {
                Some(last) if last.width_mm == width_mm && last.height_mm == height_mm => last.count += 1,
                _ => groups.push(SheetGroup { width_mm, height_mm, count: 1 }),
            }
        }
        PrintDocument { html, resources, sheets: groups }
    }

    fn png(id: &str) -> DocumentResource {
        let data = base64::engine::general_purpose::STANDARD.decode(PNG).expect("测试图片的 base64 不对");
        DocumentResource {
            id: id.to_owned(),
            mime: "image/png".to_owned(),
            data: Arc::new(data),
        }
    }

    async fn export(engine: &Arc<dyn HtmlPrintEngine>, document: PrintDocument, options: PrintOptions) -> Result<Vec<u8>, JobError> {
        engine.export_pdf(Arc::new(document), options, Cancel::new()).await
    }

    async fn fails(engine: &Arc<dyn HtmlPrintEngine>, document: PrintDocument) -> ProtocolError {
        match export(engine, document, PrintOptions::default()).await {
            Err(JobError::Failure(error)) => error,
            other => panic!("应当失败，实际是 {:?}", other.map(|pdf| pdf.len())),
        }
    }

    /// 用 PDFKit 读出每页的媒体框尺寸，单位 mm，取整
    fn page_sizes(pdf: &[u8]) -> Vec<String> {
        assert!(pdf.starts_with(b"%PDF-"), "不是 PDF");
        // SAFETY: 数据是本函数里复制出的有效 NSData；页序号都在页数之内
        unsafe {
            let document = PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(pdf)).expect("PDFKit 读不出 PDF");
            (0..document.pageCount())
                .map(|index| {
                    let page = document.pageAtIndex(index).expect("读不出页");
                    let bounds = page.boundsForBox(PDFDisplayBox::MediaBox);
                    let millimeters = |points: f64| (points * 25.4 / 72.0).round();
                    format!("{}x{}", millimeters(bounds.size.width), millimeters(bounds.size.height))
                })
                .collect()
        }
    }

    async fn reports_the_webkit_version(engine: Arc<dyn HtmlPrintEngine>) {
        assert_eq!(engine.name(), "WebKit");
        let version = engine.version().expect("没有读到 WebKit 的版本");
        assert!(version.split('.').all(|part| part.parse::<u32>().is_ok()), "版本号不对：{version}");
    }

    async fn exports_every_paper_size_into_one_pdf(engine: Arc<dyn HtmlPrintEngine>) {
        let pdf = export(&engine, document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""), PrintOptions::default())
            .await
            .expect("导出失败");
        assert_eq!(page_sizes(&pdf), ["210x297", "210x297", "148x210", "297x210"]);
    }

    async fn exports_only_the_selected_pages(engine: Arc<dyn HtmlPrintEngine>) {
        let options = PrintOptions {
            page_ranges: Some("2-3".to_owned()),
            ..PrintOptions::default()
        };
        let pdf = export(&engine, document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""), options).await.expect("导出失败");
        assert_eq!(page_sizes(&pdf), ["210x297", "148x210"]);
    }

    async fn exports_several_documents_at_once(engine: Arc<dyn HtmlPrintEngine>) {
        let first = export(&engine, document(&[A4, A4], "", vec![], ""), PrintOptions::default());
        let second = export(&engine, document(&[A5], "", vec![], ""), PrintOptions::default());
        let (first, second) = tokio::join!(first, second);
        assert_eq!(page_sizes(&first.expect("第一份导出失败")), ["210x297", "210x297"]);
        assert_eq!(page_sizes(&second.expect("第二份导出失败")), ["148x210"]);
    }

    async fn serves_the_task_resources(engine: Arc<dyn HtmlPrintEngine>) {
        let content = "<img src='r/0' style='width: 20mm'><img src='https://print.local/r/0?v=1' style='width: 10mm'>";
        let pdf = export(&engine, document(&[A5], content, vec![png("0")], ""), PrintOptions::default())
            .await
            .expect("导出失败");
        assert_eq!(page_sizes(&pdf), ["148x210"]);
    }

    async fn loads_lazy_images_before_exporting(engine: Arc<dyn HtmlPrintEngine>) {
        let content = "<img src='r/0' loading='lazy' style='width: 20mm'>";
        let pdf = export(&engine, document(&[A5, A5], content, vec![png("0")], ""), PrintOptions::default())
            .await
            .expect("导出失败");
        assert_eq!(page_sizes(&pdf), ["148x210", "148x210"]);
    }

    async fn reports_images_that_fail_to_decode(engine: Arc<dyn HtmlPrintEngine>) {
        let broken = DocumentResource {
            id: "0".to_owned(),
            mime: "image/png".to_owned(),
            data: Arc::new(vec![0, 1, 2, 3]),
        };
        let failure = fails(&engine, document(&[A5], "<img src='r/0'><img src='r/0?v=1'>", vec![broken], "")).await;
        assert_eq!(failure.code, errors::RENDER_FAILED);
        assert_eq!(detail(&failure, "images"), serde_json::json!(2));
    }

    async fn refuses_resources_from_outside_the_task(engine: Arc<dyn HtmlPrintEngine>) {
        let failure = fails(&engine, document(&[A5], "<img src='https://example.com/logo.png?token=secret'>", vec![], "")).await;
        assert_eq!(failure.code, errors::RESOURCE_BLOCKED);
        assert_eq!(detail(&failure, "url"), serde_json::json!("https://example.com"));
    }

    async fn reports_resources_the_task_did_not_bring(engine: Arc<dyn HtmlPrintEngine>) {
        let failure = fails(&engine, document(&[A5], "<img src='r/9'>", vec![], "")).await;
        assert_eq!(failure.code, errors::RENDER_FAILED);
        assert_eq!(detail(&failure, "resource"), serde_json::json!("9"));
    }

    async fn keeps_page_scripts_from_running(engine: Arc<dyn HtmlPrintEngine>) {
        let tail = "<script>document.querySelector('[data-part=\"sheet\"]').remove()</script>";
        let pdf = export(&engine, document(&[A4, A4], "", vec![], tail), PrintOptions::default()).await.expect("导出失败");
        assert_eq!(page_sizes(&pdf).len(), 2);
    }

    async fn rejects_documents_whose_sheets_do_not_match_the_groups(engine: Arc<dyn HtmlPrintEngine>) {
        let mut mismatched = document(&[A4, A4], "", vec![], "");
        mismatched.sheets = vec![SheetGroup {
            width_mm: 210.0,
            height_mm: 297.0,
            count: 3,
        }];
        let failure = fails(&engine, mismatched).await;
        assert_eq!(failure.code, errors::RENDER_FAILED);
        assert_eq!(detail(&failure, "expected"), serde_json::json!(3));
        assert_eq!(detail(&failure, "actual"), serde_json::json!(2));
    }

    fn detail(error: &ProtocolError, key: &str) -> serde_json::Value {
        error
            .details
            .as_ref()
            .and_then(|details| details.get(key))
            .cloned()
            .unwrap_or_else(|| panic!("错误里没有 {key}：{error:?}"))
    }
}
