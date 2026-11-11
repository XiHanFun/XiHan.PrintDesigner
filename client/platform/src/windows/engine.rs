// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 经 WebView2 渲染 HTML 文档：打印时先按打印机的纸张能力核对各组纸张，再按纸张分组，每组设成核对出的纸张单独交给打印池；
//! 指定了纸盒、或缩放方式不是 shrink 时，每组先导出成 PDF，再按 PDF 打印的方式下发。导出 PDF 时按文档里各页的 @page 尺寸一次导出

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde_json::json;
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::printing::{HtmlPrintEngine, HtmlPrintResult, JobError, PageSelection, PaperCatalog, PrintDialog, SpoolTicket, plan_papers};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{ColorMode, Details, PrintDocument, PrintOptions, ScaleMode};

use super::pdf_print::{PageGroup, print_on_thread};
use super::render::{Page, PrintSettings, PrintStatus, RenderThread};
use crate::EngineOptions;

const MILLIMETRES_PER_INCH: f64 = 25.4;

/// WebView2 渲染引擎
pub(crate) struct WebView2Engine {
    inner: Arc<Inner>,
}

struct Inner {
    thread: Arc<RenderThread>,
    papers: Arc<dyn PaperCatalog>,
    dialog: Option<Arc<dyn PrintDialog>>,
    log: SharedLog,
    render_timeout: Duration,
}

impl WebView2Engine {
    /// 起渲染线程并建 WebView2 环境；没有运行时时给出原因
    pub(crate) async fn create(options: EngineOptions) -> Result<WebView2Engine, String> {
        let log = options.log.clone();
        let thread = RenderThread::start(options.data_directory.clone(), |cleared| {
            if let Err(error) = cleared {
                log.warn(&format!("清空渲染数据目录失败，沿用上次的数据：{error}"));
            }
        })
        .await?;
        options.log.info(&format!("WebView2 运行时 {}", thread.version()));
        Ok(WebView2Engine {
            inner: Arc::new(Inner {
                thread,
                papers: options.papers,
                dialog: options.dialog,
                log: options.log,
                render_timeout: options.render_timeout,
            }),
        })
    }
}

fn select(document: &PrintDocument, options: &PrintOptions) -> Result<PageSelection, JobError> {
    PageSelection::from_options(options, document.sheet_count()).map_err(JobError::Failure)
}

/// WebView2 的打印设置表达不了的选项：纸盒，以及 shrink 以外的缩放方式
fn needs_pdf(options: &PrintOptions) -> bool {
    options.tray.is_some() || options.scale != ScaleMode::Shrink
}

impl Inner {
    async fn open(&self, document: Arc<PrintDocument>, cancel: &Cancel) -> Result<Page, JobError> {
        self.thread.open(document, self.render_timeout, cancel).await
    }

    async fn print(&self, document: Arc<PrintDocument>, mut printer: String, mut options: PrintOptions, cancel: Cancel) -> Result<HtmlPrintResult, JobError> {
        if options.dialog {
            let dialog = self.dialog.clone().ok_or_else(|| {
                JobError::failure(
                    errors::CAPABILITY_UNSUPPORTED,
                    "这台机器上的客户端不支持弹打印对话框",
                    Some(Details::new().with("capability", "dialog")),
                )
            })?;
            let choice = cancel
                .run(dialog.ask(printer.clone(), options.clone(), document.sheet_count(), cancel.clone()))
                .await?
                .ok_or(JobError::CancelledByUser)?;
            printer = choice.printer;
            options = choice.options;
        }
        let selection = select(&document, &options)?;
        let plan = {
            let papers = self.papers.clone();
            let printer = printer.clone();
            let document = document.clone();
            let selection = selection.clone();
            let options = options.clone();
            tokio::task::spawn_blocking(move || plan_papers(papers.as_ref(), &printer, &document.sheets, &selection, &options))
                .await
                .map_err(|_| JobError::failure(errors::INTERNAL, "客户端内部错误，详情见日志", None))??
        };
        for warning in &plan.warnings {
            self.log.warn(&warning.message);
        }

        let page = self.open(document.clone(), &cancel).await?;
        if needs_pdf(&options) {
            return self.print_through_pdf(&page, &document, printer, options, &selection, plan, cancel).await;
        }
        let mut start = 0usize;
        let mut printed = 0u32;
        let mut spooled = Vec::new();
        for (index, group) in document.sheets.iter().enumerate() {
            let count = group.count as usize;
            if let Some(ranges) = selection.ranges_in(start, count) {
                let feed = plan.groups[index].expect("选中页的组都有纸张");
                cancel.run(page.evaluate(&show_script(start, count))).await??;
                let settings = PrintSettings {
                    printer: printer.clone(),
                    width_inches: feed.width_mm / MILLIMETRES_PER_INCH,
                    height_inches: feed.height_mm / MILLIMETRES_PER_INCH,
                    landscape: feed.landscape,
                    ranges,
                    copies: options.copies as i32,
                    collate: options.collate,
                    duplex: options.duplex,
                    grayscale: options.color == ColorMode::Grayscale,
                };
                let group_details = || {
                    Details::new()
                        .with("printer", printer.clone())
                        .with("group", index)
                        .with("widthMm", xihan_print_client_core::protocol::number(group.width_mm))
                        .with("heightMm", xihan_print_client_core::protocol::number(group.height_mm))
                };
                match cancel.run(page.print(settings)).await?? {
                    PrintStatus::Succeeded => {}
                    PrintStatus::InvalidSettings => {
                        return Err(JobError::failure(
                            errors::PAPER_UNSUPPORTED,
                            format!("打印机不接受这组纸张或选项：{}×{} mm", group.width_mm, group.height_mm),
                            Some(group_details()),
                        ));
                    }
                    PrintStatus::PrinterUnavailable => {
                        return Err(JobError::failure(
                            errors::PRINTER_OFFLINE,
                            format!("打印机当前不可用：{printer}"),
                            Some(Details::new().with("printer", printer.clone()).with("group", index)),
                        ));
                    }
                    PrintStatus::Other(status) => {
                        return Err(JobError::failure(
                            errors::SPOOL_FAILED,
                            "交给打印池失败",
                            Some(Details::new().with("printer", printer.clone()).with("group", index).with("status", status)),
                        ));
                    }
                }
                printed += selection.count_in(start, count);
                let document_name = if page.title.is_empty() { "doc.html".to_owned() } else { page.title.clone() };
                spooled.push(SpoolTicket {
                    printer: printer.clone(),
                    document_name,
                    system_job_id: None,
                });
            }
            start += count;
        }
        self.log.debug(&format!("已交给 {printer} 共 {printed} 页，分 {} 组", document.sheets.len()));
        Ok(HtmlPrintResult {
            sheets: printed,
            warnings: plan.warnings,
            spooled,
        })
    }

    /// 每组选中的页按这组的尺寸导出成 PDF，再按核对出的纸张、缩放与纸盒逐组打出去
    #[allow(clippy::too_many_arguments)]
    async fn print_through_pdf(
        &self,
        page: &Page,
        document: &PrintDocument,
        printer: String,
        options: PrintOptions,
        selection: &PageSelection,
        plan: xihan_print_client_core::printing::PaperPlan,
        cancel: Cancel,
    ) -> Result<HtmlPrintResult, JobError> {
        let title = if page.title.is_empty() { "doc.html".to_owned() } else { page.title.clone() };
        let mut start = 0usize;
        let mut spooled = Vec::new();
        let selected = document.sheets.iter().enumerate().filter(|(index, _)| plan.groups[*index].is_some()).count();
        for (index, group) in document.sheets.iter().enumerate() {
            let count = group.count as usize;
            if let (Some(ranges), Some(feed)) = (selection.ranges_in(start, count), plan.groups[index]) {
                cancel.run(page.evaluate(&show_script(start, count))).await??;
                let parameters = json!({
                    "printBackground": true,
                    "preferCSSPageSize": true,
                    "paperWidth": group.width_mm / MILLIMETRES_PER_INCH,
                    "paperHeight": group.height_mm / MILLIMETRES_PER_INCH,
                    "marginTop": 0,
                    "marginBottom": 0,
                    "marginLeft": 0,
                    "marginRight": 0,
                    "pageRanges": ranges,
                });
                let pdf = pdf_data(cancel.run(page.devtools("Page.printToPDF", parameters)).await?)?;
                let name = if selected > 1 {
                    format!("{title}（{}/{selected}）", spooled.len() + 1)
                } else {
                    title.clone()
                };
                let group = PageGroup {
                    pages: Vec::new(),
                    feed,
                    scale: plan.scales[index],
                };
                let tickets = print_on_thread(Arc::new(pdf), vec![group], printer.clone(), plan.tray.clone(), options.clone(), name, cancel.clone()).await?;
                spooled.extend(tickets);
            }
            start += count;
        }
        self.log.debug(&format!("已经 PDF 交给 {printer} 共 {} 页，分 {} 组", selection.count(), spooled.len()));
        Ok(HtmlPrintResult {
            sheets: selection.count(),
            warnings: plan.warnings,
            spooled,
        })
    }

    async fn export(&self, document: Arc<PrintDocument>, options: PrintOptions, cancel: Cancel) -> Result<Vec<u8>, JobError> {
        let selection = select(&document, &options)?;
        let page = self.open(document.clone(), &cancel).await?;
        if options.color == ColorMode::Grayscale {
            cancel.run(page.evaluate("document.documentElement.style.filter = 'grayscale(1)'")).await??;
        }
        let first = document.sheets[0];
        let parameters = json!({
            "printBackground": true,
            "preferCSSPageSize": true,
            "paperWidth": first.width_mm / MILLIMETRES_PER_INCH,
            "paperHeight": first.height_mm / MILLIMETRES_PER_INCH,
            "marginTop": 0,
            "marginBottom": 0,
            "marginLeft": 0,
            "marginRight": 0,
            "pageRanges": selection.ranges_in(0, document.sheet_count() as usize).unwrap_or_default(),
        });
        pdf_data(cancel.run(page.devtools("Page.printToPDF", parameters)).await?)
    }
}

/// Page.printToPDF 的结果里取出 PDF 的字节；失败时报 PDF_FAILED
fn pdf_data(result: Result<serde_json::Value, JobError>) -> Result<Vec<u8>, JobError> {
    let result = result.map_err(|error| match error {
        JobError::Failure(failure) => JobError::failure(errors::PDF_FAILED, "导出 PDF 失败", Some(Details::new().with("reason", failure.message))),
        other => other,
    })?;
    let data = result["data"]
        .as_str()
        .ok_or_else(|| JobError::failure(errors::PDF_FAILED, "导出 PDF 失败：没有数据", None))?;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| JobError::failure(errors::PDF_FAILED, "导出 PDF 失败：数据不是 base64", None))
}

/// 只显示 [start, start + count) 这一段输出页，最后一页之后不再分页
fn show_script(start: usize, count: usize) -> String {
    let end = start + count;
    format!(
        r#"(() => {{
  const sheets = document.querySelectorAll('[data-part="sheet"]');
  sheets.forEach((sheet, index) => {{
    sheet.style.display = index >= {start} && index < {end} ? '' : 'none';
    sheet.style.breakAfter = index === {last} ? 'auto' : '';
  }});
  return sheets.length;
}})()"#,
        last = end.saturating_sub(1)
    )
}

impl HtmlPrintEngine for WebView2Engine {
    fn name(&self) -> &str {
        "WebView2"
    }

    fn version(&self) -> Option<String> {
        Some(self.inner.thread.version().to_owned())
    }

    fn print(&self, document: Arc<PrintDocument>, printer: String, options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<HtmlPrintResult, JobError>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.print(document, printer, options, cancel).await })
    }

    fn export_pdf(&self, document: Arc<PrintDocument>, options: PrintOptions, cancel: Cancel) -> BoxFuture<'static, Result<Vec<u8>, JobError>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.export(document, options, cancel).await })
    }
}
