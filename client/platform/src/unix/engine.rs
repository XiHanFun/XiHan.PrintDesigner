// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! HTML 通道的流水线：WebKit 把选中的输出页按纸张分组渲染成 PDF；打印时先核对纸张，再逐组经 CUPS 交给打印池，导出时合成一份 PDF。
//! 浏览器给的 PDF 不经渲染：读出的页面尺寸分组核对纸张后，逐组以页码范围交给 CUPS

use std::sync::Arc;
use std::time::Duration;

use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::defaults::PRODUCT_NAME;
use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::printing::{HtmlPrintEngine, HtmlPrintResult, JobError, PageSelection, PaperCatalog, PaperPlan, PdfPrinter, PrintDialog, plan_papers};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{ColorMode, Details, PrintDocument, PrintOptions, SheetGroup};

use super::cups::{Cups, SheetFeed};
use super::{GroupRender, PdfRenderer};

/// 打印池里显示的文档名最长的字数
const MAX_TITLE_CHARS: usize = 128;

/// 渲染成 PDF、经 CUPS 下发的 HTML 通道
#[derive(Clone)]
pub(crate) struct PdfPipelineEngine {
    inner: Arc<Inner>,
}

struct Inner {
    renderer: Arc<dyn PdfRenderer>,
    cups: Option<Arc<Cups>>,
    papers: Arc<dyn PaperCatalog>,
    dialog: Option<Arc<dyn PrintDialog>>,
    render_timeout: Duration,
    log: SharedLog,
}

impl PdfPipelineEngine {
    /// 以渲染器、CUPS（本机没有时为 None，只能导出 PDF）与引擎参数里的纸张能力、打印对话框、渲染期限和日志创建
    pub(crate) fn new(renderer: Arc<dyn PdfRenderer>, cups: Option<Arc<Cups>>, options: crate::EngineOptions) -> Self {
        PdfPipelineEngine {
            inner: Arc::new(Inner {
                renderer,
                cups,
                papers: options.papers,
                dialog: options.dialog,
                render_timeout: options.render_timeout,
                log: options.log,
            }),
        }
    }
}

impl HtmlPrintEngine for PdfPipelineEngine {
    fn name(&self) -> &str {
        self.inner.renderer.name()
    }

    fn version(&self) -> Option<String> {
        self.inner.renderer.version()
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

impl Inner {
    async fn print(&self, document: Arc<PrintDocument>, printer: String, options: PrintOptions, cancel: Cancel) -> Result<HtmlPrintResult, JobError> {
        let (printer, options) = self.ask(&document, printer, options, &cancel).await?;
        let selection = select(&document, &options)?;
        let cups = self.cups.clone().ok_or_else(|| {
            JobError::failure(
                errors::PRINTER_OFFLINE,
                format!("本机没有可用的 CUPS，打印不到「{printer}」；导出 PDF 不受影响"),
                Some(Details::new().with("printer", printer.as_str()).with("cups", false)),
            )
        })?;

        let plan = {
            let (cups, papers, document, selection, printer, options) = (cups.clone(), self.papers.clone(), document.clone(), selection.clone(), printer.clone(), options.clone());
            blocking(&cancel, move || {
                cups.check_printer(&printer)?;
                plan_papers(papers.as_ref(), &printer, &document.sheets, &selection, &options)
            })
            .await?
        };
        for warning in &plan.warnings {
            self.log.warn(&warning.message);
        }

        let groups = selected_groups(&document, &selection);
        let pdfs = self
            .renderer
            .render(
                document.clone(),
                groups.iter().map(|(_, group)| group.clone()).collect(),
                options.color == ColorMode::Grayscale,
                self.render_timeout,
                cancel.clone(),
            )
            .await?;
        if pdfs.len() != groups.len() {
            return Err(JobError::failure(
                errors::INTERNAL,
                format!("渲染器出了 {} 份 PDF，要的是 {} 份", pdfs.len(), groups.len()),
                None,
            ));
        }

        let title = title(&document.html);
        let PaperPlan {
            groups: feeds,
            scales,
            tray,
            warnings,
        } = plan;
        let mut spooled = Vec::with_capacity(groups.len());
        for ((index, _), pdf) in groups.iter().zip(pdfs) {
            let feed = feeds[*index].ok_or_else(|| JobError::failure(errors::INTERNAL, format!("第 {} 组没有核对纸张", index + 1), None))?;
            let sheet = SheetFeed {
                feed,
                scale: scales[*index],
                tray: tray.clone(),
                page_ranges: None,
            };
            let name = if groups.len() > 1 {
                format!("{title}（{}/{}）", spooled.len() + 1, groups.len())
            } else {
                title.clone()
            };
            let (cups, printer, options) = (cups.clone(), printer.clone(), options.clone());
            let ticket = blocking(&cancel, move || cups.submit_pdf(&printer, &pdf, &options, &sheet, &name)).await?;
            spooled.push(ticket);
        }
        self.log.debug(&format!("已交给 {printer} 共 {} 页，分 {} 组", selection.count(), groups.len()));
        Ok(HtmlPrintResult {
            sheets: selection.count(),
            warnings,
            spooled,
        })
    }

    async fn export(&self, document: Arc<PrintDocument>, options: PrintOptions, cancel: Cancel) -> Result<Vec<u8>, JobError> {
        let selection = select(&document, &options)?;
        let groups: Vec<GroupRender> = selected_groups(&document, &selection).into_iter().map(|(_, group)| group).collect();
        let count = groups.len();
        let pdfs = self
            .renderer
            .render(document, groups, options.color == ColorMode::Grayscale, self.render_timeout, cancel.clone())
            .await?;
        if pdfs.len() != count {
            return Err(JobError::failure(errors::INTERNAL, format!("渲染器出了 {} 份 PDF，要的是 {count} 份", pdfs.len()), None));
        }
        let renderer = self.renderer.clone();
        blocking(&cancel, move || renderer.merge(pdfs)).await
    }

    /// 有 dialog 选项时先问打印对话框，以用户选定的打印机与选项为准
    async fn ask(&self, document: &PrintDocument, printer: String, options: PrintOptions, cancel: &Cancel) -> Result<(String, PrintOptions), JobError> {
        if !options.dialog {
            return Ok((printer, options));
        }
        let dialog = self.dialog.clone().ok_or_else(|| {
            JobError::failure(
                errors::CAPABILITY_UNSUPPORTED,
                "这台机器上的客户端不支持弹打印对话框",
                Some(Details::new().with("capability", "dialog")),
            )
        })?;
        let choice = cancel
            .run(dialog.ask(printer, options, document.sheet_count(), cancel.clone()))
            .await?
            .ok_or(JobError::CancelledByUser)?;
        Ok((choice.printer, choice.options))
    }
}

/// 按 pageRanges 与 pageSet 选中的输出页；一页都没选中时 BAD_REQUEST
fn select(document: &PrintDocument, options: &PrintOptions) -> Result<PageSelection, JobError> {
    PageSelection::from_options(options, document.sheet_count()).map_err(JobError::Failure)
}

/// 把浏览器给的 PDF 经 CUPS 打到打印机：不弹打印对话框
pub(crate) struct CupsPdfPrinter {
    cups: Arc<Cups>,
    papers: Arc<dyn PaperCatalog>,
    log: SharedLog,
}

impl CupsPdfPrinter {
    /// 以 CUPS、纸张能力与日志创建
    pub(crate) fn new(cups: Arc<Cups>, papers: Arc<dyn PaperCatalog>, log: SharedLog) -> Self {
        CupsPdfPrinter { cups, papers, log }
    }
}

impl PdfPrinter for CupsPdfPrinter {
    fn print(
        &self,
        pdf: Arc<Vec<u8>>,
        sheets: Arc<Vec<SheetGroup>>,
        printer: String,
        options: PrintOptions,
        document_name: String,
        cancel: Cancel,
    ) -> BoxFuture<'static, Result<HtmlPrintResult, JobError>> {
        let (cups, papers, log) = (self.cups.clone(), self.papers.clone(), self.log.clone());
        Box::pin(async move {
            if options.dialog {
                return Err(JobError::failure(
                    errors::CAPABILITY_UNSUPPORTED,
                    "这台机器上的客户端不支持弹打印对话框",
                    Some(Details::new().with("capability", "dialog")),
                ));
            }
            let total = sheets.iter().map(|group| group.count).sum();
            let selection = PageSelection::from_options(&options, total).map_err(JobError::Failure)?;
            let plan = {
                let (cups, papers, sheets, selection, printer, options) = (cups.clone(), papers.clone(), sheets.clone(), selection.clone(), printer.clone(), options.clone());
                blocking(&cancel, move || {
                    cups.check_printer(&printer)?;
                    plan_papers(papers.as_ref(), &printer, &sheets, &selection, &options)
                })
                .await?
            };
            for warning in &plan.warnings {
                log.warn(&warning.message);
            }
            let jobs = pdf_jobs(&sheets, &selection, &plan);
            let mut spooled = Vec::with_capacity(jobs.len());
            for (position, sheet) in jobs.iter().enumerate() {
                let name = if jobs.len() > 1 {
                    format!("{document_name}（{}/{}）", position + 1, jobs.len())
                } else {
                    document_name.clone()
                };
                let (cups, pdf, printer, options, sheet) = (cups.clone(), pdf.clone(), printer.clone(), options.clone(), sheet.clone());
                spooled.push(blocking(&cancel, move || cups.submit_pdf(&printer, &pdf, &options, &sheet, &name)).await?);
            }
            log.debug(&format!("已把 PDF 交给 {printer} 共 {} 页，分 {} 组", selection.count(), jobs.len()));
            Ok(HtmlPrintResult {
                sheets: selection.count(),
                warnings: plan.warnings,
                spooled,
            })
        })
    }
}

/// PDF 每组一个作业：纸张、缩放与纸盒取核对的结果，页码范围按 PDF 的页码；没有选中页的组不下发
fn pdf_jobs(sheets: &[SheetGroup], selection: &PageSelection, plan: &PaperPlan) -> Vec<SheetFeed> {
    let mut jobs = Vec::new();
    let mut start = 0usize;
    for (index, group) in sheets.iter().enumerate() {
        let count = group.count as usize;
        if let (Some(ranges), Some(feed)) = (selection.absolute_ranges_in(start, count), plan.groups[index]) {
            jobs.push(SheetFeed {
                feed,
                scale: plan.scales[index],
                tray: plan.tray.clone(),
                page_ranges: Some(ranges),
            });
        }
        start += count;
    }
    jobs
}

/// 有选中页的各组：组序号与要渲染的输出页、纸张尺寸
fn selected_groups(document: &PrintDocument, selection: &PageSelection) -> Vec<(usize, GroupRender)> {
    let mut groups = Vec::new();
    let mut start = 0usize;
    for (index, group) in document.sheets.iter().enumerate() {
        let count = group.count as usize;
        let sheets: Vec<usize> = (start..start + count).filter(|sheet| selection.contains(*sheet)).collect();
        if !sheets.is_empty() {
            groups.push((
                index,
                GroupRender {
                    sheets,
                    width_mm: group.width_mm,
                    height_mm: group.height_mm,
                },
            ));
        }
        start += count;
    }
    groups
}

/// 文档 `<title>` 的文字，没有时用产品名；作为打印池里的文档名
fn title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let found = lower.find("<title").and_then(|open| {
        let start = open + lower[open..].find('>')? + 1;
        let end = start + lower[start..].find("</title")?;
        Some(html[start..end].split_whitespace().collect::<Vec<_>>().join(" "))
    });
    match found.filter(|text| !text.is_empty()) {
        Some(text) => text.chars().take(MAX_TITLE_CHARS).collect(),
        None => PRODUCT_NAME.to_owned(),
    }
}

/// 在阻塞线程上执行，令牌取消时不再等它
async fn blocking<T: Send + 'static>(cancel: &Cancel, work: impl FnOnce() -> Result<T, JobError> + Send + 'static) -> Result<T, JobError> {
    match cancel.run(tokio::task::spawn_blocking(work)).await? {
        Ok(result) => result,
        Err(error) => Err(JobError::failure(errors::INTERNAL, format!("后台线程出错：{error}"), None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xihan_print_client_core::protocol::SheetGroup;

    fn document(groups: &[(f64, f64, u32)], html: &str) -> PrintDocument {
        PrintDocument {
            html: html.into(),
            resources: vec![],
            sheets: groups.iter().map(|&(width_mm, height_mm, count)| SheetGroup { width_mm, height_mm, count }).collect(),
        }
    }

    #[test]
    fn keeps_only_the_selected_sheets_of_each_group() {
        let document = document(&[(210.0, 297.0, 2), (148.0, 210.0, 1), (297.0, 210.0, 1)], "");
        let selection = PageSelection::parse(Some("2-3"), document.sheet_count()).unwrap();
        let groups = selected_groups(&document, &selection);
        assert_eq!(
            groups,
            vec![
                (
                    0,
                    GroupRender {
                        sheets: vec![1],
                        width_mm: 210.0,
                        height_mm: 297.0
                    }
                ),
                (
                    1,
                    GroupRender {
                        sheets: vec![2],
                        width_mm: 148.0,
                        height_mm: 210.0
                    }
                )
            ]
        );
    }

    #[test]
    fn splits_a_pdf_into_one_job_per_selected_group_with_absolute_page_ranges() {
        use xihan_print_client_core::printing::PaperFeed;
        use xihan_print_client_core::protocol::TrayInfo;
        let group = |width_mm: f64, height_mm: f64, count: u32| SheetGroup { width_mm, height_mm, count };
        let sheets = vec![group(210.0, 297.0, 3), group(100.0, 60.0, 2), group(210.0, 297.0, 1)];
        let selection = PageSelection::parse(Some("2-5"), 6).unwrap();
        let a4 = PaperFeed::new(210.0, 297.0, false);
        let label = PaperFeed::new(60.0, 100.0, true);
        let tray = TrayInfo { id: 1, name: "Manual".into() };
        let plan = PaperPlan {
            groups: vec![Some(a4), Some(label), None],
            scales: vec![1.0, 0.5, 1.0],
            tray: Some(tray.clone()),
            warnings: vec![],
        };
        let jobs = pdf_jobs(&sheets, &selection, &plan);
        let ranges: Vec<_> = jobs.iter().map(|job| (job.feed, job.scale, job.page_ranges.clone())).collect();
        assert_eq!(ranges, vec![(a4, 1.0, Some("2-3".into())), (label, 0.5, Some("4-5".into()))]);
        assert!(jobs.iter().all(|job| job.tray.as_ref() == Some(&tray)));
    }

    #[test]
    fn names_the_job_after_the_document_title() {
        assert_eq!(title("<html><head><TITLE> 送货单\n 2026 </title></head>"), "送货单 2026");
        assert_eq!(title("<html><title></title>"), PRODUCT_NAME);
        assert_eq!(title("<!doctype html>"), PRODUCT_NAME);
    }
}
