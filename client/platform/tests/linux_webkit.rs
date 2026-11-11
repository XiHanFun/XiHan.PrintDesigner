// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! Linux 上 HTML 通道与 CUPS 的集成测试：主线程初始化 GTK 并跑主循环，另起线程跑 tokio 与各用例。
//! 打到测试打印机的用例要 CUPS 里有指向文件的打印机，经 XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT（HTML 通道）与
//! XIHAN_PRINT_TEST_RAW_PRINTER / XIHAN_PRINT_TEST_RAW_OUTPUT（原始指令）告知；没配或 CUPS 不可用时跳过

#[cfg(not(target_os = "linux"))]
fn main() {
    println!("这组测试只在 Linux 上跑");
}

#[cfg(target_os = "linux")]
fn main() {
    linux::main();
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashMap;
    use std::future::Future;
    use std::path::PathBuf;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use base64::Engine;
    use xihan_print_client_core::BoxFuture;
    use xihan_print_client_core::cancel::Cancel;
    use xihan_print_client_core::defaults::RENDER_TIMEOUT;
    use xihan_print_client_core::log::{MemoryLog, SharedLog};
    use xihan_print_client_core::printing::{HtmlPrintEngine, JobError, PaperCatalog, PaperFeed, PrintDialog, PrintDialogChoice, PrinterPapers, selftest};
    use xihan_print_client_core::protocol::codes::errors;
    use xihan_print_client_core::protocol::{ClientInfo, ColorMode, DocumentResource, PrintDocument, PrintOptions, ProtocolError, SheetGroup};
    use xihan_print_client_core::time::Timestamp;
    use xihan_print_client_platform::{EngineOptions, Printing, create_engine, printing};

    const A4: (f64, f64) = (210.0, 297.0);
    const A5: (f64, f64) = (148.0, 210.0);
    const A4_LANDSCAPE: (f64, f64) = (297.0, 210.0);
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    /// 用例的结论
    enum Outcome {
        Passed,
        Skipped(String),
        Failed(String),
    }

    type Check = Result<(), String>;

    macro_rules! ensure {
        ($condition:expr, $($message:tt)+) => {
            if !$condition {
                return Err(format!($($message)+));
            }
        };
    }

    macro_rules! skip {
        ($($message:tt)+) => {
            return Ok(Some(format!($($message)+)))
        };
    }

    /// 记下每次询问，一律当作用户取消
    #[derive(Default)]
    struct FakeDialog {
        asked: Mutex<Vec<(String, u32)>>,
    }

    impl PrintDialog for FakeDialog {
        fn ask(&self, printer: String, _options: PrintOptions, sheet_count: u32, _cancel: Cancel) -> BoxFuture<'static, Option<PrintDialogChoice>> {
            self.asked.lock().unwrap().push((printer, sheet_count));
            Box::pin(async { None })
        }
    }

    /// 不报纸张的纸张能力，供本机没有 CUPS 时用
    struct NoPapers;

    impl PaperCatalog for NoPapers {
        fn open(&self, _printer: &str) -> Option<Box<dyn PrinterPapers>> {
            None
        }
    }

    struct Fixture {
        engine: Arc<dyn HtmlPrintEngine>,
        bare: Arc<dyn HtmlPrintEngine>,
        hurried: Arc<dyn HtmlPrintEngine>,
        dialog: Arc<FakeDialog>,
        printing: Result<Printing, String>,
        directory: PathBuf,
    }

    impl Fixture {
        async fn create() -> Result<Fixture, String> {
            let directory = std::env::temp_dir().join(format!("xihan-print-webkit-{}", std::process::id()));
            let printing = printing();
            let papers: Arc<dyn PaperCatalog> = match &printing {
                Ok(printing) => printing.papers.clone(),
                Err(_) => Arc::new(NoPapers),
            };
            let dialog = Arc::new(FakeDialog::default());
            let log: SharedLog = Arc::new(MemoryLog::default());
            let engine = create_engine(EngineOptions {
                data_directory: directory.join("main"),
                papers: papers.clone(),
                dialog: Some(dialog.clone()),
                render_timeout: RENDER_TIMEOUT,
                log: log.clone(),
            })
            .await?;
            let bare = create_engine(EngineOptions {
                data_directory: directory.join("bare"),
                papers: papers.clone(),
                dialog: None,
                render_timeout: RENDER_TIMEOUT,
                log: log.clone(),
            })
            .await?;
            let hurried = create_engine(EngineOptions {
                data_directory: directory.join("hurried"),
                papers,
                dialog: None,
                render_timeout: Duration::from_millis(1),
                log,
            })
            .await?;
            Ok(Fixture {
                engine,
                bare,
                hurried,
                dialog,
                printing,
                directory,
            })
        }

        async fn export(&self, document: PrintDocument, options: PrintOptions) -> Result<Vec<u8>, JobError> {
            self.engine.export_pdf(Arc::new(document), options, Cancel::new()).await
        }

        async fn fails(&self, document: PrintDocument) -> Result<ProtocolError, String> {
            failure(self.export(document, PrintOptions::default()).await)
        }

        /// CUPS 能用且连得上时返回打印能力
        fn cups(&self) -> Result<&Printing, String> {
            let printing = self.printing.as_ref().map_err(Clone::clone)?;
            printing.catalog.list().map_err(|error| format!("CUPS 连不上：{error}"))?;
            Ok(printing)
        }
    }

    fn failure<T>(result: Result<T, JobError>) -> Result<ProtocolError, String> {
        match result {
            Err(JobError::Failure(error)) => Ok(error),
            Err(other) => Err(format!("期望失败，得到 {other:?}")),
            Ok(_) => Err("期望失败，却成功了".to_owned()),
        }
    }

    /// 按输出页的写法拼一份文档：每种尺寸一条具名 @page，每张输出页一个 data-part="sheet"；连续同尺寸的页并成一组
    fn document(sheets: &[(f64, f64)], content: &str, resources: Vec<DocumentResource>, tail: &str) -> PrintDocument {
        let mut sizes: Vec<(f64, f64)> = Vec::new();
        for sheet in sheets {
            if !sizes.contains(sheet) {
                sizes.push(*sheet);
            }
        }
        let mut html = String::from("<!doctype html><html><head><meta charset='utf-8'><style>@page { margin: 0 }");
        for (index, (width, height)) in sizes.iter().enumerate() {
            html.push_str(&format!(" @page s{index} {{ size: {width}mm {height}mm; margin: 0 }}"));
        }
        html.push_str(" body { margin: 0 } [data-part=sheet] { break-after: page; overflow: hidden } [data-part=sheet]:last-child { break-after: auto }</style></head><body>");
        for sheet in sheets {
            let index = sizes.iter().position(|size| size == sheet).unwrap();
            html.push_str(&format!(
                "<div data-part='sheet' style='page: s{index}; width: {}mm; height: {}mm'>{content}</div>",
                sheet.0, sheet.1
            ));
        }
        html.push_str(tail);
        html.push_str("</body></html>");
        let mut groups: Vec<SheetGroup> = Vec::new();
        for (width_mm, height_mm) in sheets.iter().copied() {
            match groups.last_mut() {
                Some(last) if last.width_mm == width_mm && last.height_mm == height_mm => last.count += 1,
                _ => groups.push(SheetGroup { width_mm, height_mm, count: 1 }),
            }
        }
        PrintDocument { html, resources, sheets: groups }
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
        let mut rest: &str = &text;
        while let Some(found) = rest.find("/MediaBox") {
            rest = &rest[found + "/MediaBox".len()..];
            let Some(open) = rest.find('[') else { break };
            let Some(close) = rest[open..].find(']') else { break };
            let numbers: Vec<f64> = rest[open + 1..open + close].split_whitespace().filter_map(|value| value.parse().ok()).collect();
            if numbers.len() == 4 {
                let mm = |points: f64| (points * 25.4 / 72.0).round();
                sizes.push(format!("{}x{}", mm(numbers[2] - numbers[0]), mm(numbers[3] - numbers[1])));
            }
        }
        sizes
    }

    fn sizes(expected: &[&str]) -> Vec<String> {
        expected.iter().map(|size| (*size).to_owned()).collect()
    }

    fn detail<'a>(error: &'a ProtocolError, key: &str) -> Option<&'a serde_json::Value> {
        error.details.as_ref().and_then(|details| details.get(key))
    }

    async fn wait_for_output(path: &str) -> Option<Vec<u8>> {
        for _ in 0..100 {
            if let Ok(data) = std::fs::read(path)
                && !data.is_empty()
            {
                return Some(data);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }

    /// 在测试打印机的 socket 地址上收一次连接的全部字节
    async fn listen(address: &str) -> Result<tokio::sync::oneshot::Receiver<Vec<u8>>, String> {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind(address).await.map_err(|error| format!("监听 {address} 失败：{error}"))?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut data = Vec::new();
                if stream.read_to_end(&mut data).await.is_ok() {
                    let _ = sender.send(data);
                }
            }
        });
        Ok(receiver)
    }

    type CaseResult = Result<Option<String>, String>;
    type Case = fn(&Fixture) -> Pin<Box<dyn Future<Output = CaseResult> + '_>>;

    fn passed(check: Check) -> CaseResult {
        check.map(|_| None)
    }

    async fn reports_the_renderer_version(fixture: &Fixture) -> CaseResult {
        let version = fixture.engine.version().unwrap_or_default();
        let parts: Vec<&str> = version.split('.').collect();
        passed((|| {
            ensure!(parts.len() == 3 && parts.iter().all(|part| part.parse::<u32>().is_ok()), "版本写法不对：{version}");
            ensure!(fixture.engine.name() == "WebKitGTK", "渲染引擎名称不对：{}", fixture.engine.name());
            Ok(())
        })())
    }

    async fn exports_every_paper_size_into_one_pdf(fixture: &Fixture) -> CaseResult {
        let pdf = fixture
            .export(document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""), PrintOptions::default())
            .await
            .map_err(|error| error.to_string())?;
        passed((|| {
            ensure!(pdf.starts_with(b"%PDF-"), "不是 PDF");
            let found = page_sizes(&pdf);
            ensure!(found == sizes(&["210x297", "210x297", "148x210", "297x210"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn renders_the_self_test_page(fixture: &Fixture) -> CaseResult {
        let client = ClientInfo {
            version: "0.1.0".into(),
            os: "linux".into(),
            arch: "x64".into(),
            renderer: fixture.engine.version(),
        };
        let document = selftest::document(&client, fixture.engine.name(), "Office", 100.0, 50.0, Timestamp(0), 8 * 3600);
        let pdf = fixture.export(document, PrintOptions::default()).await.map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found == sizes(&["100x50"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn exports_only_the_selected_pages(fixture: &Fixture) -> CaseResult {
        let options = PrintOptions {
            page_ranges: Some("2-3".into()),
            ..PrintOptions::default()
        };
        let pdf = fixture
            .export(document(&[A4, A4, A5, A4_LANDSCAPE], "", vec![], ""), options)
            .await
            .map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found == sizes(&["210x297", "148x210"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn exports_in_grayscale(fixture: &Fixture) -> CaseResult {
        let options = PrintOptions {
            color: ColorMode::Grayscale,
            ..PrintOptions::default()
        };
        let pdf = fixture
            .export(document(&[A5, A5], "<p style='color: red'>灰度</p>", vec![], ""), options)
            .await
            .map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found == sizes(&["148x210", "148x210"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn exports_several_documents_at_once(fixture: &Fixture) -> CaseResult {
        let (first, second) = tokio::join!(
            fixture.export(document(&[A4, A4], "", vec![], ""), PrintOptions::default()),
            fixture.export(document(&[A5], "", vec![], ""), PrintOptions::default())
        );
        let first = page_sizes(&first.map_err(|error| error.to_string())?);
        let second = page_sizes(&second.map_err(|error| error.to_string())?);
        passed((|| {
            ensure!(first == sizes(&["210x297", "210x297"]), "第一份页尺寸不对：{first:?}");
            ensure!(second == sizes(&["148x210"]), "第二份页尺寸不对：{second:?}");
            Ok(())
        })())
    }

    async fn serves_the_task_resources_and_waits_for_images(fixture: &Fixture) -> CaseResult {
        let document = document(
            &[A5],
            "<img src='r/0' style='width: 20mm'><img src='https://print.local/r/0?v=1' style='width: 10mm'>",
            vec![png("0")],
            "",
        );
        let pdf = fixture.export(document, PrintOptions::default()).await.map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found == sizes(&["148x210"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn loads_lazy_images_before_exporting(fixture: &Fixture) -> CaseResult {
        let document = document(&[A5, A5], "<img src='r/0' loading='lazy' style='width: 20mm'>", vec![png("0")], "");
        let pdf = fixture.export(document, PrintOptions::default()).await.map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found == sizes(&["148x210", "148x210"]), "页尺寸不对：{found:?}");
            Ok(())
        })())
    }

    async fn reports_images_that_fail_to_decode(fixture: &Fixture) -> CaseResult {
        let broken = DocumentResource {
            id: "0".into(),
            mime: "image/png".into(),
            data: Arc::new(vec![0, 1, 2, 3]),
        };
        let error = fixture.fails(document(&[A5], "<img src='r/0'><img src='r/0?v=1'>", vec![broken], "")).await?;
        passed((|| {
            ensure!(error.code == errors::RENDER_FAILED, "错误码不对：{error}");
            ensure!(detail(&error, "images") == Some(&serde_json::json!(2)), "坏图张数不对：{:?}", error.details);
            Ok(())
        })())
    }

    async fn refuses_resources_from_outside_the_task(fixture: &Fixture) -> CaseResult {
        let error = fixture.fails(document(&[A5], "<img src='https://example.com/logo.png?token=secret'>", vec![], "")).await?;
        passed((|| {
            ensure!(error.code == errors::RESOURCE_BLOCKED, "错误码不对：{error}");
            ensure!(
                detail(&error, "url") == Some(&serde_json::json!("https://example.com")),
                "被拦地址不对：{:?}",
                error.details
            );
            Ok(())
        })())
    }

    async fn refuses_stylesheets_and_fonts_from_outside_the_task(fixture: &Fixture) -> CaseResult {
        let head = "<link rel='stylesheet' href='http://cdn.example.org:8080/a.css'>";
        let error = fixture.fails(document(&[A5], head, vec![], "")).await?;
        passed((|| {
            ensure!(error.code == errors::RESOURCE_BLOCKED, "错误码不对：{error}");
            ensure!(
                detail(&error, "url") == Some(&serde_json::json!("http://cdn.example.org:8080")),
                "被拦地址不对：{:?}",
                error.details
            );
            Ok(())
        })())
    }

    async fn reports_resources_the_task_did_not_bring(fixture: &Fixture) -> CaseResult {
        let error = fixture.fails(document(&[A5], "<img src='r/9'>", vec![], "")).await?;
        passed((|| {
            ensure!(error.code == errors::RENDER_FAILED, "错误码不对：{error}");
            ensure!(detail(&error, "resource") == Some(&serde_json::json!("9")), "缺的资源不对：{:?}", error.details);
            Ok(())
        })())
    }

    async fn keeps_page_scripts_from_running(fixture: &Fixture) -> CaseResult {
        let document = document(
            &[A4, A4],
            "",
            vec![],
            "<script>document.querySelector('[data-part=\"sheet\"]').remove()</script><img src='r/0' onerror='this.remove()'>",
        );
        let error = fixture.fails(document).await?;
        passed((|| {
            ensure!(
                error.code == errors::RENDER_FAILED && detail(&error, "resource") == Some(&serde_json::json!("0")),
                "脚本跑了或错误不对：{error}"
            );
            Ok(())
        })())?;
        let document = self::document(&[A4, A4], "", vec![], "<script>document.querySelector('[data-part=\"sheet\"]').remove()</script>");
        let pdf = fixture.export(document, PrintOptions::default()).await.map_err(|error| error.to_string())?;
        let found = page_sizes(&pdf);
        passed((|| {
            ensure!(found.len() == 2, "页面脚本跑了：{found:?}");
            Ok(())
        })())
    }

    async fn rejects_documents_whose_sheets_do_not_match_the_groups(fixture: &Fixture) -> CaseResult {
        let mut document = document(&[A4, A4], "", vec![], "");
        document.sheets = vec![SheetGroup {
            width_mm: 210.0,
            height_mm: 297.0,
            count: 3,
        }];
        let error = fixture.fails(document).await?;
        passed((|| {
            ensure!(error.code == errors::RENDER_FAILED, "错误码不对：{error}");
            ensure!(
                detail(&error, "expected") == Some(&serde_json::json!(3)) && detail(&error, "actual") == Some(&serde_json::json!(2)),
                "张数不对：{:?}",
                error.details
            );
            Ok(())
        })())
    }

    async fn times_out_when_the_document_is_not_ready_in_time(fixture: &Fixture) -> CaseResult {
        let error = failure(
            fixture
                .hurried
                .export_pdf(Arc::new(document(&[A4], "", vec![], "")), PrintOptions::default(), Cancel::new())
                .await,
        )?;
        passed((|| {
            ensure!(error.code == errors::RENDER_TIMEOUT, "错误码不对：{error}");
            ensure!(detail(&error, "timeout") == Some(&serde_json::json!(true)), "没有标出超时：{:?}", error.details);
            Ok(())
        })())
    }

    async fn rejects_page_ranges_that_select_nothing(fixture: &Fixture) -> CaseResult {
        let options = PrintOptions {
            page_ranges: Some("4-9".into()),
            ..PrintOptions::default()
        };
        let error = failure(fixture.export(document(&[A4, A4, A5], "", vec![], ""), options).await)?;
        passed((|| {
            ensure!(
                error.code == errors::BAD_REQUEST && detail(&error, "field") == Some(&serde_json::json!("options.pageRanges")),
                "错误不对：{error}"
            );
            Ok(())
        })())
    }

    async fn asks_the_dialog_and_cancels_when_the_user_does(fixture: &Fixture) -> CaseResult {
        let options = PrintOptions {
            dialog: true,
            ..PrintOptions::default()
        };
        let result = fixture
            .engine
            .print(Arc::new(document(&[A4, A5], "", vec![], "")), "Office".into(), options, Cancel::new())
            .await;
        let asked = fixture.dialog.asked.lock().unwrap().clone();
        passed((|| {
            ensure!(matches!(result, Err(JobError::CancelledByUser)), "期望用户取消，得到 {result:?}");
            ensure!(asked == vec![("Office".to_owned(), 2)], "询问不对：{asked:?}");
            Ok(())
        })())
    }

    async fn refuses_the_dialog_option_without_a_dialog(fixture: &Fixture) -> CaseResult {
        let options = PrintOptions {
            dialog: true,
            ..PrintOptions::default()
        };
        let error = failure(fixture.bare.print(Arc::new(document(&[A4], "", vec![], "")), "Office".into(), options, Cancel::new()).await)?;
        passed((|| {
            ensure!(
                error.code == errors::CAPABILITY_UNSUPPORTED && detail(&error, "capability") == Some(&serde_json::json!("dialog")),
                "错误不对：{error}"
            );
            Ok(())
        })())
    }

    async fn reports_a_missing_printer(fixture: &Fixture) -> CaseResult {
        if let Err(reason) = fixture.cups() {
            skip!("{reason}");
        }
        let error = failure(
            fixture
                .engine
                .print(
                    Arc::new(document(&[A4], "", vec![], "")),
                    "XiHan 不存在的打印机 7f3a".into(),
                    PrintOptions::default(),
                    Cancel::new(),
                )
                .await,
        )?;
        passed((|| {
            ensure!(error.code == errors::PRINTER_NOT_FOUND, "错误码不对：{error}");
            Ok(())
        })())
    }

    async fn lists_the_test_printer_with_its_papers(fixture: &Fixture) -> CaseResult {
        let printing = match fixture.cups() {
            Ok(printing) => printing,
            Err(reason) => skip!("{reason}"),
        };
        let Ok(printer) = std::env::var("XIHAN_PRINT_TEST_PRINTER") else {
            skip!("没有配置测试打印机（XIHAN_PRINT_TEST_PRINTER）");
        };
        let listed = printing.catalog.list().map_err(|error| error.to_string())?;
        let info = printing
            .catalog
            .get(&printer.to_lowercase())
            .map_err(|error| error.to_string())?
            .ok_or("查不到测试打印机")?;
        let capabilities = info.capabilities.clone().ok_or("没有能力明细")?;
        let papers = printing.papers.open(&printer).ok_or("打不开纸张能力")?;
        let a4 = papers
            .papers()
            .iter()
            .find(|paper| (paper.width_mm - 210.0).abs() < 0.5 && (paper.height_mm - 297.0).abs() < 0.5)
            .cloned();
        let resolved = papers.resolve(&PaperFeed::new(210.0, 297.0, true));
        passed((|| {
            ensure!(
                listed.iter().any(|item| item.name == printer && item.capabilities.is_none()),
                "列表里没有测试打印机：{listed:?}"
            );
            ensure!(
                info.name == printer && info.port.as_deref().is_some_and(|port| port.starts_with("file:")),
                "打印机信息不对：{info:?}"
            );
            ensure!(capabilities.max_copies >= 1 && !capabilities.papers.is_empty(), "能力不对：{capabilities:?}");
            ensure!(a4.is_some(), "纸张里没有 A4：{:?}", capabilities.papers);
            ensure!(
                resolved.is_some_and(|feed| feed.landscape && (feed.width_mm - 210.0).abs() < 0.5 && (feed.height_mm - 297.0).abs() < 0.5),
                "A4 横放核对不对：{resolved:?}"
            );
            Ok(())
        })())
    }

    async fn prints_each_paper_group_to_the_test_printer(fixture: &Fixture) -> CaseResult {
        if let Err(reason) = fixture.cups() {
            skip!("{reason}");
        }
        let (Ok(printer), Ok(output)) = (std::env::var("XIHAN_PRINT_TEST_PRINTER"), std::env::var("XIHAN_PRINT_TEST_OUTPUT")) else {
            skip!("没有配置测试打印机（XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT）");
        };
        let _ = std::fs::remove_file(&output);
        let options = PrintOptions {
            page_ranges: Some("2-3".into()),
            ..PrintOptions::default()
        };
        let printed = fixture
            .engine
            .print(Arc::new(document(&[A4, A4, A5], "曦寒打印测试", vec![], "")), printer.clone(), options, Cancel::new())
            .await
            .map_err(|error| error.to_string())?;
        let data = wait_for_output(&output).await;
        passed((|| {
            ensure!(printed.sheets == 2, "页数不对：{}", printed.sheets);
            ensure!(
                printed.spooled.len() == 2 && printed.spooled.iter().all(|ticket| ticket.printer == printer && ticket.system_job_id.is_some()),
                "作业不对：{:?}",
                printed.spooled
            );
            ensure!(data.is_some(), "测试打印机没有写出内容：{output}");
            Ok(())
        })())
    }

    async fn writes_raw_commands_to_the_test_printer(fixture: &Fixture) -> CaseResult {
        let printing = match fixture.cups() {
            Ok(printing) => printing,
            Err(reason) => skip!("{reason}"),
        };
        let Ok(printer) = std::env::var("XIHAN_PRINT_TEST_RAW_PRINTER") else {
            skip!("没有配置原始指令的测试打印机（XIHAN_PRINT_TEST_RAW_PRINTER，另加 XIHAN_PRINT_TEST_RAW_LISTEN 或 XIHAN_PRINT_TEST_RAW_OUTPUT）");
        };
        let receiver = match (std::env::var("XIHAN_PRINT_TEST_RAW_LISTEN"), std::env::var("XIHAN_PRINT_TEST_RAW_OUTPUT")) {
            (Ok(address), _) => Some(listen(&address).await?),
            (_, Ok(output)) => {
                let _ = std::fs::remove_file(&output);
                None
            }
            _ => skip!("原始指令的测试打印机没有说明写到哪里（XIHAN_PRINT_TEST_RAW_LISTEN 或 XIHAN_PRINT_TEST_RAW_OUTPUT）"),
        };
        let raw = printing.raw.clone().ok_or("没有原始指令通道")?;
        let data: Vec<u8> = b"^XA^FO50,50^ADN,36,20^FDXiHan^FS^XZ\r\n"
            .iter()
            .copied()
            .chain((0..=255u8).cycle().take(200_000))
            .collect();
        let written = raw
            .write(printer.clone(), Arc::new(data.clone()), "曦寒原始指令".into(), Cancel::new())
            .await
            .map_err(|error| error.to_string())?;
        let missing = raw.write("XiHan 不存在的打印机 7f3a".into(), Arc::new(vec![1]), "x".into(), Cancel::new()).await;
        let output = match receiver {
            Some(receiver) => tokio::time::timeout(Duration::from_secs(20), receiver).await.ok().and_then(Result::ok),
            None => wait_for_output(&std::env::var("XIHAN_PRINT_TEST_RAW_OUTPUT").unwrap()).await,
        };
        passed((|| {
            ensure!(written.bytes == data.len() as u64, "字节数不对：{}", written.bytes);
            ensure!(
                written.spooled.document_name == "曦寒原始指令" && written.spooled.system_job_id.is_some(),
                "作业不对：{:?}",
                written.spooled
            );
            ensure!(output.as_deref() == Some(data.as_slice()), "写出的内容不对：{:?} 字节", output.map(|output| output.len()));
            let error = failure(missing)?;
            ensure!(error.code == errors::PRINTER_NOT_FOUND, "不存在的打印机错误码不对：{error}");
            Ok(())
        })())
    }

    fn cases() -> Vec<(&'static str, Case)> {
        vec![
            ("reports_the_renderer_version", |fixture| Box::pin(reports_the_renderer_version(fixture))),
            ("exports_every_paper_size_into_one_pdf", |fixture| Box::pin(exports_every_paper_size_into_one_pdf(fixture))),
            ("renders_the_self_test_page", |fixture| Box::pin(renders_the_self_test_page(fixture))),
            ("exports_only_the_selected_pages", |fixture| Box::pin(exports_only_the_selected_pages(fixture))),
            ("exports_in_grayscale", |fixture| Box::pin(exports_in_grayscale(fixture))),
            ("exports_several_documents_at_once", |fixture| Box::pin(exports_several_documents_at_once(fixture))),
            ("serves_the_task_resources_and_waits_for_images", |fixture| {
                Box::pin(serves_the_task_resources_and_waits_for_images(fixture))
            }),
            ("loads_lazy_images_before_exporting", |fixture| Box::pin(loads_lazy_images_before_exporting(fixture))),
            ("reports_images_that_fail_to_decode", |fixture| Box::pin(reports_images_that_fail_to_decode(fixture))),
            ("refuses_resources_from_outside_the_task", |fixture| {
                Box::pin(refuses_resources_from_outside_the_task(fixture))
            }),
            ("refuses_stylesheets_and_fonts_from_outside_the_task", |fixture| {
                Box::pin(refuses_stylesheets_and_fonts_from_outside_the_task(fixture))
            }),
            ("reports_resources_the_task_did_not_bring", |fixture| {
                Box::pin(reports_resources_the_task_did_not_bring(fixture))
            }),
            ("keeps_page_scripts_from_running", |fixture| Box::pin(keeps_page_scripts_from_running(fixture))),
            ("rejects_documents_whose_sheets_do_not_match_the_groups", |fixture| {
                Box::pin(rejects_documents_whose_sheets_do_not_match_the_groups(fixture))
            }),
            ("times_out_when_the_document_is_not_ready_in_time", |fixture| {
                Box::pin(times_out_when_the_document_is_not_ready_in_time(fixture))
            }),
            ("rejects_page_ranges_that_select_nothing", |fixture| {
                Box::pin(rejects_page_ranges_that_select_nothing(fixture))
            }),
            ("asks_the_dialog_and_cancels_when_the_user_does", |fixture| {
                Box::pin(asks_the_dialog_and_cancels_when_the_user_does(fixture))
            }),
            ("refuses_the_dialog_option_without_a_dialog", |fixture| {
                Box::pin(refuses_the_dialog_option_without_a_dialog(fixture))
            }),
            ("reports_a_missing_printer", |fixture| Box::pin(reports_a_missing_printer(fixture))),
            ("lists_the_test_printer_with_its_papers", |fixture| {
                Box::pin(lists_the_test_printer_with_its_papers(fixture))
            }),
            ("prints_each_paper_group_to_the_test_printer", |fixture| {
                Box::pin(prints_each_paper_group_to_the_test_printer(fixture))
            }),
            ("writes_raw_commands_to_the_test_printer", |fixture| {
                Box::pin(writes_raw_commands_to_the_test_printer(fixture))
            }),
        ]
    }

    /// 按名称里含任一参数筛用例；没有参数时全跑
    async fn run(filters: Vec<String>) -> bool {
        let fixture = match Fixture::create().await {
            Ok(fixture) => fixture,
            Err(reason) => {
                println!("建不了渲染引擎：{reason}");
                return false;
            }
        };
        let selected: Vec<_> = cases()
            .into_iter()
            .filter(|(name, _)| filters.is_empty() || filters.iter().any(|filter| name.contains(filter.as_str())))
            .collect();
        println!("\nrunning {} tests", selected.len());
        let started = Instant::now();
        let mut results: HashMap<&'static str, usize> = HashMap::new();
        let mut failures = Vec::new();
        for (name, case) in selected {
            let outcome = match tokio::time::timeout(Duration::from_secs(120), case(&fixture)).await {
                Ok(Ok(None)) => Outcome::Passed,
                Ok(Ok(Some(reason))) => Outcome::Skipped(reason),
                Ok(Err(message)) => Outcome::Failed(message),
                Err(_) => Outcome::Failed("超过 120 秒没有结束".to_owned()),
            };
            match outcome {
                Outcome::Passed => {
                    println!("test {name} ... ok");
                    *results.entry("passed").or_default() += 1;
                }
                Outcome::Skipped(reason) => {
                    println!("test {name} ... ignored, {reason}");
                    *results.entry("ignored").or_default() += 1;
                }
                Outcome::Failed(message) => {
                    println!("test {name} ... FAILED");
                    failures.push((name, message));
                }
            }
        }
        if !failures.is_empty() {
            println!("\nfailures:");
            for (name, message) in &failures {
                println!("    {name}: {message}");
            }
        }
        println!(
            "\ntest result: {}. {} passed; {} failed; {} ignored; 0 measured; 0 filtered out; finished in {:.2}s\n",
            if failures.is_empty() { "ok" } else { "FAILED" },
            results.get("passed").copied().unwrap_or(0),
            failures.len(),
            results.get("ignored").copied().unwrap_or(0),
            started.elapsed().as_secs_f64()
        );
        let _ = std::fs::remove_dir_all(&fixture.directory);
        failures.is_empty()
    }

    pub(super) fn main() {
        let filters: Vec<String> = std::env::args().skip(1).filter(|argument| !argument.starts_with('-')).collect();
        if let Err(error) = gtk::init() {
            println!("GTK 初始化失败，跳过这组测试：{error}");
            return;
        }
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("建 tokio 运行时");
            let passed = runtime.block_on(run(filters));
            let _ = sender.send(passed);
            glib::MainContext::default().invoke(gtk::main_quit);
        });
        gtk::main();
        let passed = receiver.recv().unwrap_or(false);
        std::process::exit(if passed { 0 } else { 1 });
    }
}
