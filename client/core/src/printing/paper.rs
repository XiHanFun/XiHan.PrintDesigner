// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 下发前按打印机的纸张能力核对每组纸张：驱动报的纸张在容差内、横竖都算，或驱动接受这个尺寸，才照这组的尺寸下发；
//! 有一组不行就整个任务以 PAPER_UNSUPPORTED 失败，除非选项允许改用最接近的纸张

use serde_json::Value;

use super::backends::{JobError, PaperCatalog, PrinterPapers};
use super::pages::PageSelection;
use crate::protocol::codes::{errors, warnings};
use crate::protocol::{Details, PaperInfo, PrintDocument, ProtocolWarning, SheetGroup, number};

/// 纸张宽高的容差，mm
pub const TOLERANCE_MM: f64 = 1.0;

/// 纸张怎么放进打印机：宽高是交给驱动的纸张宽高（mm），横放时版面的宽高与它对调
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PaperFeed {
    /// 纸张宽
    pub width_mm: f64,
    /// 纸张高
    pub height_mm: f64,
    /// 是否横放
    pub landscape: bool,
}

impl PaperFeed {
    /// 以纸张宽高与方向创建
    pub fn new(width_mm: f64, height_mm: f64, landscape: bool) -> Self {
        PaperFeed { width_mm, height_mm, landscape }
    }

    /// 版面的宽，mm
    pub fn page_width_mm(&self) -> f64 {
        if self.landscape { self.height_mm } else { self.width_mm }
    }

    /// 版面的高，mm
    pub fn page_height_mm(&self) -> f64 {
        if self.landscape { self.width_mm } else { self.height_mm }
    }
}

/// 下发前核对纸张的结果
#[derive(Clone, Debug, PartialEq)]
pub struct PaperPlan {
    /// 各组怎么放纸，与文档的纸张分组一一对应；没有选中页的组为 None
    pub groups: Vec<Option<PaperFeed>>,
    /// 各组内容的缩放倍数，与 groups 一一对应；按原大下发时为 1
    pub scales: Vec<f64>,
    /// 提醒
    pub warnings: Vec<ProtocolWarning>,
}

/// 核对文档里有选中页的各组纸张；不行时返回 PAPER_UNSUPPORTED
pub fn plan(catalog: &dyn PaperCatalog, printer: &str, document: &PrintDocument, selection: &PageSelection, fit_to_nearest_paper: bool) -> Result<PaperPlan, JobError> {
    let printer_papers = catalog.open(printer);
    let papers: &[PaperInfo] = printer_papers.as_deref().map(|papers| papers.papers()).unwrap_or(&[]);
    let mut groups = vec![None; document.sheets.len()];
    let mut scales = vec![1.0; document.sheets.len()];
    let mut notes = Vec::new();
    if papers.is_empty() {
        notes.push(ProtocolWarning::new(
            warnings::PAPER_UNCHECKED,
            format!("打印机「{printer}」的驱动没有报纸张，没有核对纸张就照常下发"),
            Details::new().with("printer", printer),
        ));
    }
    let mut start = 0usize;
    for (index, group) in document.sheets.iter().enumerate() {
        if selection.ranges_in(start, group.count as usize).is_some() {
            groups[index] = Some(match printer_papers.as_deref() {
                Some(printer_papers) if !papers.is_empty() => {
                    let (feed, scale) = check(printer_papers, printer, index, group, fit_to_nearest_paper, &mut notes)?;
                    scales[index] = scale;
                    feed
                }
                _ => PaperFeed::new(group.width_mm, group.height_mm, false),
            });
        }
        start += group.count as usize;
    }
    Ok(PaperPlan { groups, scales, warnings: notes })
}

fn check(printer_papers: &dyn PrinterPapers, printer: &str, index: usize, group: &SheetGroup, fit: bool, notes: &mut Vec<ProtocolWarning>) -> Result<(PaperFeed, f64), JobError> {
    let papers = printer_papers.papers();
    let request = request_for(papers, group);
    let Some(resolved) = printer_papers.resolve(&request) else {
        notes.push(ProtocolWarning::new(
            warnings::PAPER_UNCHECKED,
            format!("读不出打印机「{printer}」的驱动给第 {} 组留下的纸张，没有核对就照常下发", index + 1),
            group_details(printer, index, group),
        ));
        return Ok((request, 1.0));
    };
    if fits(&resolved, group.width_mm, group.height_mm) {
        return Ok((request, 1.0));
    }
    if fit && let Some((paper, feed, scale)) = nearest(printer_papers, group) {
        let mut details = group_details(printer, index, group);
        details.insert("paper", paper_details(&paper));
        details.insert("landscape", feed.landscape);
        details.insert("scale", number(scale));
        notes.push(ProtocolWarning::new(
            warnings::PAPER_FITTED,
            format!(
                "打印机「{printer}」没有第 {} 组要的 {}×{} mm 纸张，改用「{}」{}×{} mm，内容按 {} 倍居中",
                index + 1,
                mm(group.width_mm),
                mm(group.height_mm),
                paper.name,
                mm(feed.page_width_mm()),
                mm(feed.page_height_mm()),
                trim_decimals(scale, 3)
            ),
            details,
        ));
        return Ok((feed, scale));
    }
    let mut details = group_details(printer, index, group);
    details.insert("papers", Value::Array(papers.iter().map(paper_details).collect()));
    Err(JobError::failure(
        errors::PAPER_UNSUPPORTED,
        format!(
            "打印机「{printer}」没有第 {} 组要的 {}×{} mm 纸张，驱动也不接受这个尺寸（会换成 {}×{} mm）",
            index + 1,
            mm(group.width_mm),
            mm(group.height_mm),
            mm(resolved.page_width_mm()),
            mm(resolved.page_height_mm())
        ),
        Some(details),
    ))
}

/// 这组要请求的纸张：驱动报的纸张里同向的优先、其次横放的，取尺寸最近的一种，按那种纸张自己的宽高请求；都不在容差内时按这组的尺寸请求
fn request_for(papers: &[PaperInfo], group: &SheetGroup) -> PaperFeed {
    let closest = |width: f64, height: f64| {
        papers
            .iter()
            .filter(|paper| near(paper.width_mm, width) && near(paper.height_mm, height))
            .min_by(|a, b| distance(a, width, height).total_cmp(&distance(b, width, height)))
    };
    if let Some(upright) = closest(group.width_mm, group.height_mm) {
        return PaperFeed::new(upright.width_mm, upright.height_mm, false);
    }
    if let Some(turned) = closest(group.height_mm, group.width_mm) {
        return PaperFeed::new(turned.width_mm, turned.height_mm, true);
    }
    PaperFeed::new(group.width_mm, group.height_mm, false)
}

/// 最接近的纸张：横竖两种放法里，放得下原大内容的取面积最小的，都放不下时取缩得最少的；按这个次序找第一种驱动照样留下的。
/// 比纸大的内容等比缩小到放得下，比纸小的原大居中，倍数即返回的第三项
fn nearest(printer_papers: &dyn PrinterPapers, group: &SheetGroup) -> Option<(PaperInfo, PaperFeed, f64)> {
    let mut candidates: Vec<(PaperInfo, PaperFeed, f64)> = Vec::new();
    for paper in printer_papers.papers().iter().filter(|paper| paper.width_mm > 0.0 && paper.height_mm > 0.0) {
        for landscape in [false, true] {
            let feed = PaperFeed::new(paper.width_mm, paper.height_mm, landscape);
            if candidates.iter().any(|(_, existing, _)| *existing == feed) {
                continue;
            }
            let scale = (feed.page_width_mm() / group.width_mm).min(feed.page_height_mm() / group.height_mm);
            candidates.push((paper.clone(), feed, scale));
        }
    }
    let area = |feed: &PaperFeed| feed.width_mm * feed.height_mm;
    candidates.sort_by(|(_, a, a_scale), (_, b, b_scale)| {
        let rank = |scale: f64| if scale >= 1.0 { 0 } else { 1 };
        let key = |feed: &PaperFeed, scale: f64| if scale >= 1.0 { area(feed) } else { -scale };
        rank(*a_scale)
            .cmp(&rank(*b_scale))
            .then(key(a, *a_scale).total_cmp(&key(b, *b_scale)))
            .then(area(a).total_cmp(&area(b)))
    });
    candidates.into_iter().find_map(|(paper, feed, scale)| {
        let resolved = printer_papers.resolve(&feed)?;
        fits(&resolved, feed.page_width_mm(), feed.page_height_mm()).then_some((paper, feed, scale.min(1.0)))
    })
}

fn fits(resolved: &PaperFeed, width_mm: f64, height_mm: f64) -> bool {
    near(resolved.page_width_mm(), width_mm) && near(resolved.page_height_mm(), height_mm)
}

fn near(actual: f64, expected: f64) -> bool {
    (actual - expected).abs() <= TOLERANCE_MM + 1e-9
}

fn distance(paper: &PaperInfo, width: f64, height: f64) -> f64 {
    (paper.width_mm - width).abs() + (paper.height_mm - height).abs()
}

fn group_details(printer: &str, index: usize, group: &SheetGroup) -> Details {
    Details::new()
        .with("printer", printer)
        .with("group", index)
        .with("widthMm", number(group.width_mm))
        .with("heightMm", number(group.height_mm))
}

fn paper_details(paper: &PaperInfo) -> Value {
    serde_json::to_value(paper).expect("纸张总能写成 JSON")
}

/// 毫米数写成最多一位小数
pub fn mm(value: f64) -> String {
    trim_decimals(value, 1)
}

fn trim_decimals(value: f64, digits: usize) -> String {
    let text = format!("{value:.digits$}");
    if text.contains('.') {
        text.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    type Resolver = Arc<dyn Fn(&PaperFeed) -> Option<PaperFeed> + Send + Sync>;

    #[derive(Clone)]
    struct FakePapers {
        papers: Vec<PaperInfo>,
        resolve: Resolver,
    }

    impl PaperCatalog for FakePapers {
        fn open(&self, printer: &str) -> Option<Box<dyn PrinterPapers>> {
            (printer != "missing").then(|| Box::new(self.clone()) as Box<dyn PrinterPapers>)
        }
    }

    impl PrinterPapers for FakePapers {
        fn papers(&self) -> &[PaperInfo] {
            &self.papers
        }

        fn resolve(&self, request: &PaperFeed) -> Option<PaperFeed> {
            (self.resolve)(request)
        }
    }

    fn paper(id: i32, name: &str, width: f64, height: f64) -> PaperInfo {
        PaperInfo {
            id,
            name: name.into(),
            width_mm: width,
            height_mm: height,
        }
    }

    fn standard() -> Vec<PaperInfo> {
        vec![
            paper(9, "A4", 210.0, 297.0),
            paper(11, "A5", 148.0, 210.0),
            paper(70, "A6", 105.0, 148.0),
            paper(131, "Photo 4x4", 101.6, 101.6),
        ]
    }

    /// 只认报出来的纸张，别的尺寸一律换成 A4，方向照请求
    fn pdf_like() -> FakePapers {
        let papers = standard();
        let known = papers.clone();
        FakePapers {
            papers,
            resolve: Arc::new(move |request| {
                Some(
                    match known
                        .iter()
                        .find(|paper| (paper.width_mm - request.width_mm).abs() <= 1.0 && (paper.height_mm - request.height_mm).abs() <= 1.0)
                    {
                        Some(paper) => PaperFeed::new(paper.width_mm, paper.height_mm, request.landscape),
                        None => PaperFeed::new(210.0, 297.0, request.landscape),
                    },
                )
            }),
        }
    }

    fn keeps(papers: Vec<PaperInfo>) -> FakePapers {
        FakePapers {
            papers,
            resolve: Arc::new(|request| Some(*request)),
        }
    }

    fn document(groups: &[(f64, f64, u32)]) -> PrintDocument {
        PrintDocument {
            html: "<!doctype html>".into(),
            resources: vec![],
            sheets: groups.iter().map(|&(width_mm, height_mm, count)| SheetGroup { width_mm, height_mm, count }).collect(),
        }
    }

    fn run(papers: &FakePapers, document: &PrintDocument, ranges: Option<&str>, fit: bool, printer: &str) -> Result<PaperPlan, JobError> {
        plan(papers, printer, document, &PageSelection::parse(ranges, document.sheet_count()).unwrap(), fit)
    }

    fn failure(result: Result<PaperPlan, JobError>) -> crate::protocol::ProtocolError {
        match result {
            Err(JobError::Failure(error)) => error,
            other => panic!("期望失败，得到 {other:?}"),
        }
    }

    #[test]
    fn fails_the_whole_job_when_a_group_has_no_paper_and_the_driver_wont_take_the_size() {
        let error = failure(run(&pdf_like(), &document(&[(210.0, 297.0, 2), (100.0, 70.0, 1)]), None, false, "PDF"));
        assert_eq!(error.code, errors::PAPER_UNSUPPORTED);
        assert!(error.message.contains("第 2 组"));
        assert!(error.message.contains("100×70 mm"));
        let details = error.details.unwrap();
        assert_eq!(details.get("printer"), Some(&json!("PDF")));
        assert_eq!(details.get("group"), Some(&json!(1)));
        assert_eq!(details.get("widthMm"), Some(&json!(100)));
        let papers = details.get("papers").unwrap().as_array().unwrap();
        assert_eq!(
            papers.iter().map(|paper| paper["name"].as_str().unwrap()).collect::<Vec<_>>(),
            vec!["A4", "A5", "A6", "Photo 4x4"]
        );
        assert_eq!(papers[0]["heightMm"], json!(297));
    }

    #[test]
    fn sends_matching_groups_on_the_drivers_own_paper() {
        let plan = run(&pdf_like(), &document(&[(210.0, 297.0, 2), (148.6, 209.4, 1)]), None, false, "PDF").unwrap();
        assert_eq!(plan.groups, vec![Some(PaperFeed::new(210.0, 297.0, false)), Some(PaperFeed::new(148.0, 210.0, false))]);
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn tolerates_one_millimetre_and_no_more() {
        assert_eq!(
            run(&pdf_like(), &document(&[(211.0, 296.0, 1)]), None, false, "PDF").unwrap().groups[0],
            Some(PaperFeed::new(210.0, 297.0, false))
        );
        assert!(run(&pdf_like(), &document(&[(211.2, 297.0, 1)]), None, false, "PDF").is_err());
    }

    #[test]
    fn turns_landscape_groups_onto_the_upright_paper() {
        let feed = run(&pdf_like(), &document(&[(297.0, 210.0, 1)]), None, false, "PDF").unwrap().groups[0].unwrap();
        assert_eq!(feed, PaperFeed::new(210.0, 297.0, true));
        assert_eq!((feed.page_width_mm(), feed.page_height_mm()), (297.0, 210.0));
    }

    #[test]
    fn prefers_a_paper_listed_in_the_same_orientation() {
        let papers = keeps(vec![paper(9, "A4", 210.0, 297.0), paper(77, "A4 旋转", 297.0, 210.0)]);
        assert_eq!(
            run(&papers, &document(&[(297.0, 210.0, 1)]), None, false, "P").unwrap().groups[0],
            Some(PaperFeed::new(297.0, 210.0, false))
        );
    }

    #[test]
    fn sends_custom_sizes_the_driver_keeps() {
        let plan = run(&keeps(vec![paper(256, "100×150", 100.0, 150.0)]), &document(&[(100.0, 70.0, 3)]), None, false, "P").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(100.0, 70.0, false)));
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn rejects_listed_papers_the_driver_swaps_for_another() {
        let stuck = FakePapers {
            papers: vec![paper(9, "A4", 210.0, 297.0), paper(11, "A5", 148.0, 210.0)],
            resolve: Arc::new(|request| Some(PaperFeed::new(210.0, 297.0, request.landscape))),
        };
        let error = failure(run(&stuck, &document(&[(148.0, 210.0, 1)]), None, false, "P"));
        assert!(error.message.contains("会换成 210×297 mm"));
    }

    #[test]
    fn checks_only_groups_with_selected_pages() {
        let plan = run(&pdf_like(), &document(&[(210.0, 297.0, 2), (100.0, 70.0, 1)]), Some("1-2"), false, "PDF").unwrap();
        assert!(plan.groups[0].is_some());
        assert!(plan.groups[1].is_none());
    }

    #[test]
    fn warns_and_sends_as_is_when_the_driver_reports_no_papers() {
        for printer in ["PDF", "missing"] {
            let none = FakePapers {
                papers: vec![],
                resolve: Arc::new(|_| panic!("不该问驱动")),
            };
            let plan = run(&none, &document(&[(100.0, 70.0, 1)]), None, false, printer).unwrap();
            assert_eq!(plan.groups[0], Some(PaperFeed::new(100.0, 70.0, false)));
            assert_eq!(plan.warnings.len(), 1);
            assert_eq!(plan.warnings[0].code, warnings::PAPER_UNCHECKED);
            assert_eq!(plan.warnings[0].details.as_ref().unwrap().get("printer"), Some(&json!(printer)));
        }
    }

    #[test]
    fn warns_when_the_driver_answer_cannot_be_read() {
        let unreadable = FakePapers {
            papers: vec![paper(9, "A4", 210.0, 297.0)],
            resolve: Arc::new(|_| None),
        };
        let plan = run(&unreadable, &document(&[(210.0, 297.0, 1), (100.0, 70.0, 1)]), None, false, "P").unwrap();
        assert_eq!(plan.groups[1], Some(PaperFeed::new(100.0, 70.0, false)));
        let groups: Vec<_> = plan
            .warnings
            .iter()
            .map(|warning| warning.details.as_ref().unwrap().get("group").cloned().unwrap())
            .collect();
        assert_eq!(groups, vec![json!(0), json!(1)]);
    }

    #[test]
    fn fits_onto_the_smallest_paper_that_holds_the_group_when_allowed() {
        let plan = run(&pdf_like(), &document(&[(210.0, 297.0, 2), (100.0, 70.0, 1)]), None, true, "PDF").unwrap();
        assert_eq!(plan.groups[1], Some(PaperFeed::new(101.6, 101.6, false)));
        assert_eq!(plan.scales, vec![1.0, 1.0]);
        let details = plan.warnings[0].details.as_ref().unwrap();
        assert_eq!(plan.warnings[0].code, warnings::PAPER_FITTED);
        assert_eq!(details.get("paper").unwrap()["name"], json!("Photo 4x4"));
        assert_eq!(details.get("scale"), Some(&json!(1)));
    }

    #[test]
    fn shrinks_onto_the_paper_that_needs_the_least_when_none_holds_the_group() {
        let plan = run(&pdf_like(), &document(&[(594.0, 420.0, 1)]), None, true, "PDF").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(210.0, 297.0, true)));
        assert_eq!(plan.scales, vec![0.5]);
        assert_eq!(plan.warnings[0].details.as_ref().unwrap().get("scale"), Some(&json!(0.5)));
    }

    #[test]
    fn skips_nearest_papers_the_driver_will_not_keep() {
        let only_a4 = FakePapers {
            papers: vec![paper(9, "A4", 210.0, 297.0), paper(70, "A6", 105.0, 148.0)],
            resolve: Arc::new(|request| Some(PaperFeed::new(210.0, 297.0, request.landscape))),
        };
        let plan = run(&only_a4, &document(&[(100.0, 70.0, 1)]), None, true, "P").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(210.0, 297.0, false)));
    }
}
