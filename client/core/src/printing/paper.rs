// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 下发前按打印机的纸张能力核对每组纸张：驱动报的纸张在容差内、横竖都算，或驱动接受这个尺寸，才照这组的尺寸下发；
//! 有一组不行就整个任务以 PAPER_UNSUPPORTED 失败，除非选项允许改用最接近的纸张。选项指定了纸张时每组都打到那种纸上，
//! 指定了版面方向时版面按那个方向放，内容按缩放方式放进版面；指定了纸盒时一并核对打印机有没有这个纸盒

use serde_json::Value;

use super::backends::{JobError, PaperCatalog, PrinterPapers};
use super::pages::PageSelection;
use crate::protocol::codes::{errors, warnings};
use crate::protocol::{Details, Orientation, PaperInfo, PrintOptions, ProtocolWarning, ScaleMode, SheetGroup, TrayInfo, number};

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

    /// 方向换过来的放法：纸张不变，版面宽高对调
    pub fn turned(self) -> PaperFeed {
        PaperFeed {
            landscape: !self.landscape,
            ..self
        }
    }
}

/// 下发前核对纸张的结果
#[derive(Clone, Debug, PartialEq)]
pub struct PaperPlan {
    /// 各组怎么放纸，与纸张分组一一对应；没有选中页的组为 None
    pub groups: Vec<Option<PaperFeed>>,
    /// 各组内容的缩放倍数，与 groups 一一对应；按原大下发时为 1，内容在版面上居中
    pub scales: Vec<f64>,
    /// 选项指定的纸盒；没指定时为 None
    pub tray: Option<TrayInfo>,
    /// 提醒
    pub warnings: Vec<ProtocolWarning>,
}

/// 核对有选中页的各组纸张与选项指定的纸盒；纸张不行时返回 PAPER_UNSUPPORTED，纸盒没有时返回 TRAY_NOT_FOUND
pub fn plan(catalog: &dyn PaperCatalog, printer: &str, sheets: &[SheetGroup], selection: &PageSelection, options: &PrintOptions) -> Result<PaperPlan, JobError> {
    let printer_papers = catalog.open(printer);
    let papers: &[PaperInfo] = printer_papers.as_deref().map(|papers| papers.papers()).unwrap_or(&[]);
    let trays: &[TrayInfo] = printer_papers.as_deref().map(|papers| papers.trays()).unwrap_or(&[]);
    let tray = match options.tray.as_deref() {
        None => None,
        Some(name) => Some(trays.iter().find(|tray| tray.name.to_lowercase() == name.to_lowercase()).cloned().ok_or_else(|| {
            JobError::failure(
                errors::TRAY_NOT_FOUND,
                format!("打印机「{printer}」没有纸盒「{name}」"),
                Some(
                    Details::new()
                        .with("printer", printer)
                        .with("tray", name)
                        .with("trays", Value::Array(trays.iter().map(tray_details).collect())),
                ),
            )
        })?),
    };
    let forced = match options.paper.as_deref() {
        None => None,
        Some(name) => Some(papers.iter().find(|paper| paper.name.to_lowercase() == name.to_lowercase()).cloned().ok_or_else(|| {
            JobError::failure(
                errors::PAPER_UNSUPPORTED,
                format!("打印机「{printer}」没有纸张「{name}」"),
                Some(
                    Details::new()
                        .with("printer", printer)
                        .with("paper", name)
                        .with("papers", Value::Array(papers.iter().map(paper_details).collect())),
                ),
            )
        })?),
    };
    let mut groups = vec![None; sheets.len()];
    let mut scales = vec![1.0; sheets.len()];
    let mut notes = Vec::new();
    if papers.is_empty() {
        notes.push(ProtocolWarning::new(
            warnings::PAPER_UNCHECKED,
            format!("打印机「{printer}」的驱动没有报纸张，没有核对纸张就照常下发"),
            Details::new().with("printer", printer),
        ));
    }
    let mut start = 0usize;
    for (index, group) in sheets.iter().enumerate() {
        if selection.ranges_in(start, group.count as usize).is_some() {
            let (feed, scale) = match (printer_papers.as_deref(), &forced) {
                (Some(printer_papers), Some(paper)) => onto(printer_papers, printer, index, group, paper, options, &mut notes)?,
                (Some(printer_papers), None) if !papers.is_empty() => check(printer_papers, printer, index, group, options, &mut notes)?,
                _ => {
                    let feed = orient(PaperFeed::new(group.width_mm, group.height_mm, false), wanted(options.orientation, group));
                    (feed, scale_for(options.scale, group, &feed))
                }
            };
            groups[index] = Some(feed);
            scales[index] = scale;
        }
        start += group.count as usize;
    }
    Ok(PaperPlan {
        groups,
        scales,
        tray,
        warnings: notes,
    })
}

/// 选项要的版面方向：横放为 Some(true)，竖放为 Some(false)；按内容定且内容是正方形时为 None
fn wanted(orientation: Orientation, group: &SheetGroup) -> Option<bool> {
    match orientation {
        Orientation::Portrait => Some(false),
        Orientation::Landscape => Some(true),
        Orientation::Auto if (group.width_mm - group.height_mm).abs() <= 1e-9 => None,
        Orientation::Auto => Some(group.width_mm > group.height_mm),
    }
}

/// 让版面朝要的方向：版面形状不对时把方向换过来；正方形的版面不动
fn orient(feed: PaperFeed, wide: Option<bool>) -> PaperFeed {
    match wide {
        Some(true) if feed.page_width_mm() < feed.page_height_mm() => feed.turned(),
        Some(false) if feed.page_width_mm() > feed.page_height_mm() => feed.turned(),
        _ => feed,
    }
}

/// 内容在版面上的缩放倍数：版面与内容一样大（容差内）时为 1，否则按缩放方式
fn scale_for(mode: ScaleMode, group: &SheetGroup, feed: &PaperFeed) -> f64 {
    if near(feed.page_width_mm(), group.width_mm) && near(feed.page_height_mm(), group.height_mm) {
        return 1.0;
    }
    let ratio = (feed.page_width_mm() / group.width_mm).min(feed.page_height_mm() / group.height_mm);
    match mode {
        ScaleMode::Shrink => ratio.min(1.0),
        ScaleMode::None => 1.0,
        ScaleMode::Fit => ratio,
    }
}

/// 打到选项指定的纸上：版面朝内容或选项要的方向；驱动换成别的纸时 PAPER_UNSUPPORTED，读不出驱动的结果时提醒后照常下发
fn onto(
    printer_papers: &dyn PrinterPapers,
    printer: &str,
    index: usize,
    group: &SheetGroup,
    paper: &PaperInfo,
    options: &PrintOptions,
    notes: &mut Vec<ProtocolWarning>,
) -> Result<(PaperFeed, f64), JobError> {
    let feed = orient(PaperFeed::new(paper.width_mm, paper.height_mm, false), wanted(options.orientation, group));
    let scale = scale_for(options.scale, group, &feed);
    match printer_papers.resolve(&feed) {
        None => notes.push(ProtocolWarning::new(
            warnings::PAPER_UNCHECKED,
            format!("读不出打印机「{printer}」的驱动给第 {} 组留下的纸张，没有核对就照常下发", index + 1),
            group_details(printer, index, group),
        )),
        Some(resolved) if !fits(&resolved, feed.page_width_mm(), feed.page_height_mm()) => {
            let mut details = group_details(printer, index, group);
            details.insert("paper", paper_details(paper));
            return Err(JobError::failure(
                errors::PAPER_UNSUPPORTED,
                format!(
                    "打印机「{printer}」的驱动不接受指定的纸张「{}」（会换成 {}×{} mm）",
                    paper.name,
                    mm(resolved.page_width_mm()),
                    mm(resolved.page_height_mm())
                ),
                Some(details),
            ));
        }
        Some(_) => {}
    }
    if !same_size(&feed, group) || scale != 1.0 {
        notes.push(fitted(
            format!(
                "打印机「{printer}」第 {} 组 {}×{} mm 按指定的纸张打到「{}」{}×{} mm 上，内容按 {} 倍居中",
                index + 1,
                mm(group.width_mm),
                mm(group.height_mm),
                paper.name,
                mm(feed.page_width_mm()),
                mm(feed.page_height_mm()),
                trim_decimals(scale, 3)
            ),
            printer,
            index,
            group,
            Some(paper),
            &feed,
            scale,
        ));
    }
    Ok((feed, scale))
}

fn check(
    printer_papers: &dyn PrinterPapers,
    printer: &str,
    index: usize,
    group: &SheetGroup,
    options: &PrintOptions,
    notes: &mut Vec<ProtocolWarning>,
) -> Result<(PaperFeed, f64), JobError> {
    let papers = printer_papers.papers();
    let wide = match options.orientation {
        Orientation::Auto => None,
        orientation => wanted(orientation, group),
    };
    let request = orient(request_for(papers, group), wide);
    let scale = scale_for(options.scale, group, &request);
    let Some(resolved) = printer_papers.resolve(&request) else {
        notes.push(ProtocolWarning::new(
            warnings::PAPER_UNCHECKED,
            format!("读不出打印机「{printer}」的驱动给第 {} 组留下的纸张，没有核对就照常下发", index + 1),
            group_details(printer, index, group),
        ));
        return Ok((request, scale));
    };
    if fits(&resolved, request.page_width_mm(), request.page_height_mm()) {
        if !same_size(&request, group) {
            let paper = listed(papers, &request);
            notes.push(fitted(
                format!(
                    "打印机「{printer}」第 {} 组 {}×{} mm 按指定的版面方向改为 {}×{} mm，内容按 {} 倍居中",
                    index + 1,
                    mm(group.width_mm),
                    mm(group.height_mm),
                    mm(request.page_width_mm()),
                    mm(request.page_height_mm()),
                    trim_decimals(scale, 3)
                ),
                printer,
                index,
                group,
                paper,
                &request,
                scale,
            ));
        }
        return Ok((request, scale));
    }
    if options.fit_to_nearest_paper
        && let Some((paper, feed)) = nearest(printer_papers, group, wide)
    {
        let scale = scale_for(options.scale, group, &feed);
        notes.push(fitted(
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
            printer,
            index,
            group,
            Some(&paper),
            &feed,
            scale,
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
            mm(request.page_width_mm()),
            mm(request.page_height_mm()),
            mm(resolved.page_width_mm()),
            mm(resolved.page_height_mm())
        ),
        Some(details),
    ))
}

/// PAPER_FITTED 提醒：details 带分组、换成的纸张（驱动报过时）、版面宽高、是否横放与缩放倍数
fn fitted(message: String, printer: &str, index: usize, group: &SheetGroup, paper: Option<&PaperInfo>, feed: &PaperFeed, scale: f64) -> ProtocolWarning {
    let mut details = group_details(printer, index, group);
    if let Some(paper) = paper {
        details.insert("paper", paper_details(paper));
    }
    details.insert("pageWidthMm", number(feed.page_width_mm()));
    details.insert("pageHeightMm", number(feed.page_height_mm()));
    details.insert("landscape", feed.landscape);
    details.insert("scale", number(scale));
    ProtocolWarning::new(warnings::PAPER_FITTED, message, details)
}

/// 版面与这组内容是否一样大（容差内）
fn same_size(feed: &PaperFeed, group: &SheetGroup) -> bool {
    near(feed.page_width_mm(), group.width_mm) && near(feed.page_height_mm(), group.height_mm)
}

/// 驱动报的纸张里与这种放法同尺寸的一种
fn listed<'a>(papers: &'a [PaperInfo], feed: &PaperFeed) -> Option<&'a PaperInfo> {
    papers.iter().find(|paper| near(paper.width_mm, feed.width_mm) && near(paper.height_mm, feed.height_mm))
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

/// 最接近的纸张：横竖两种放法里（选项要了方向时只看那个方向），放得下原大内容的取面积最小的，都放不下时取缩得最少的；
/// 按这个次序找第一种驱动照样留下的
fn nearest(printer_papers: &dyn PrinterPapers, group: &SheetGroup, wide: Option<bool>) -> Option<(PaperInfo, PaperFeed)> {
    let mut candidates: Vec<(PaperInfo, PaperFeed, f64)> = Vec::new();
    for paper in printer_papers.papers().iter().filter(|paper| paper.width_mm > 0.0 && paper.height_mm > 0.0) {
        for landscape in [false, true] {
            let feed = PaperFeed::new(paper.width_mm, paper.height_mm, landscape);
            let shaped = match wide {
                Some(true) => feed.page_width_mm() >= feed.page_height_mm(),
                Some(false) => feed.page_height_mm() >= feed.page_width_mm(),
                None => true,
            };
            if !shaped || candidates.iter().any(|(_, existing, _)| *existing == feed) {
                continue;
            }
            let ratio = (feed.page_width_mm() / group.width_mm).min(feed.page_height_mm() / group.height_mm);
            candidates.push((paper.clone(), feed, ratio));
        }
    }
    let area = |feed: &PaperFeed| feed.width_mm * feed.height_mm;
    candidates.sort_by(|(_, a, a_ratio), (_, b, b_ratio)| {
        let rank = |ratio: f64| if ratio >= 1.0 { 0 } else { 1 };
        let key = |feed: &PaperFeed, ratio: f64| if ratio >= 1.0 { area(feed) } else { -ratio };
        rank(*a_ratio)
            .cmp(&rank(*b_ratio))
            .then(key(a, *a_ratio).total_cmp(&key(b, *b_ratio)))
            .then(area(a).total_cmp(&area(b)))
    });
    candidates.into_iter().find_map(|(paper, feed, _)| {
        let resolved = printer_papers.resolve(&feed)?;
        fits(&resolved, feed.page_width_mm(), feed.page_height_mm()).then_some((paper, feed))
    })
}

fn tray_details(tray: &TrayInfo) -> Value {
    serde_json::to_value(tray).expect("纸盒总能写成 JSON")
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
    use crate::protocol::PrintDocument;
    use serde_json::json;
    use std::sync::Arc;

    type Resolver = Arc<dyn Fn(&PaperFeed) -> Option<PaperFeed> + Send + Sync>;

    #[derive(Clone)]
    struct FakePapers {
        papers: Vec<PaperInfo>,
        trays: Vec<TrayInfo>,
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

        fn trays(&self) -> &[TrayInfo] {
            &self.trays
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
            trays: vec![],
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
            trays: vec![],
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
        let options = PrintOptions {
            fit_to_nearest_paper: fit,
            ..PrintOptions::default()
        };
        run_with(papers, document, ranges, &options, printer)
    }

    fn run_with(papers: &FakePapers, document: &PrintDocument, ranges: Option<&str>, options: &PrintOptions, printer: &str) -> Result<PaperPlan, JobError> {
        plan(papers, printer, &document.sheets, &PageSelection::parse(ranges, document.sheet_count()).unwrap(), options)
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
            trays: vec![],
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
                trays: vec![],
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
            trays: vec![],
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
            trays: vec![],
            papers: vec![paper(9, "A4", 210.0, 297.0), paper(70, "A6", 105.0, 148.0)],
            resolve: Arc::new(|request| Some(PaperFeed::new(210.0, 297.0, request.landscape))),
        };
        let plan = run(&only_a4, &document(&[(100.0, 70.0, 1)]), None, true, "P").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(210.0, 297.0, false)));
    }

    fn with(change: impl FnOnce(&mut PrintOptions)) -> PrintOptions {
        let mut options = PrintOptions::default();
        change(&mut options);
        options
    }

    #[test]
    fn prints_every_group_onto_the_named_paper() {
        let options = with(|options| options.paper = Some("a5".into()));
        let plan = run_with(&pdf_like(), &document(&[(210.0, 297.0, 1), (100.0, 70.0, 1), (148.0, 210.0, 1)]), None, &options, "PDF").unwrap();
        assert_eq!(
            plan.groups,
            vec![
                Some(PaperFeed::new(148.0, 210.0, false)),
                Some(PaperFeed::new(148.0, 210.0, true)),
                Some(PaperFeed::new(148.0, 210.0, false))
            ]
        );
        assert_eq!(plan.scales[0], 148.0 / 210.0);
        assert_eq!(plan.scales[1], 1.0);
        assert_eq!(plan.scales[2], 1.0);
        let fitted: Vec<_> = plan
            .warnings
            .iter()
            .map(|warning| warning.details.as_ref().unwrap().get("group").cloned().unwrap())
            .collect();
        assert_eq!(fitted, vec![json!(0), json!(1)]);
        assert_eq!(plan.warnings[0].code, warnings::PAPER_FITTED);
        assert_eq!(plan.warnings[1].details.as_ref().unwrap().get("pageWidthMm"), Some(&json!(210)));
    }

    #[test]
    fn rejects_a_paper_or_tray_the_printer_does_not_have() {
        let error = failure(run_with(
            &pdf_like(),
            &document(&[(210.0, 297.0, 1)]),
            None,
            &with(|options| options.paper = Some("B5".into())),
            "PDF",
        ));
        assert_eq!(error.code, errors::PAPER_UNSUPPORTED);
        assert_eq!(error.details.as_ref().unwrap().get("paper"), Some(&json!("B5")));
        assert_eq!(error.details.unwrap().get("papers").unwrap().as_array().unwrap().len(), 4);

        let error = failure(run_with(
            &pdf_like(),
            &document(&[(210.0, 297.0, 1)]),
            None,
            &with(|options| options.tray = Some("Manual".into())),
            "PDF",
        ));
        assert_eq!(error.code, errors::TRAY_NOT_FOUND);
        assert_eq!(error.details.unwrap().get("trays"), Some(&json!([])));
    }

    #[test]
    fn finds_the_named_tray_ignoring_case() {
        let mut papers = pdf_like();
        papers.trays = vec![TrayInfo { id: 15, name: "Auto".into() }, TrayInfo { id: 260, name: "Tray 2".into() }];
        let plan = run_with(&papers, &document(&[(210.0, 297.0, 1)]), None, &with(|options| options.tray = Some("tray 2".into())), "PDF").unwrap();
        assert_eq!(plan.tray, Some(TrayInfo { id: 260, name: "Tray 2".into() }));
        assert_eq!(run(&papers, &document(&[(210.0, 297.0, 1)]), None, false, "PDF").unwrap().tray, None);
    }

    #[test]
    fn turns_the_page_to_the_requested_orientation_and_scales_the_content() {
        let options = with(|options| options.orientation = Orientation::Landscape);
        let plan = run_with(&pdf_like(), &document(&[(210.0, 297.0, 1), (297.0, 210.0, 1)]), None, &options, "PDF").unwrap();
        assert_eq!(plan.groups, vec![Some(PaperFeed::new(210.0, 297.0, true)), Some(PaperFeed::new(210.0, 297.0, true))]);
        assert_eq!(plan.scales, vec![210.0 / 297.0, 1.0]);
        assert_eq!(plan.warnings.len(), 1);
        assert_eq!(plan.warnings[0].details.as_ref().unwrap().get("paper").unwrap()["name"], json!("A4"));
    }

    #[test]
    fn scales_by_the_requested_mode() {
        let group = SheetGroup {
            width_mm: 100.0,
            height_mm: 100.0,
            count: 1,
        };
        let a4 = PaperFeed::new(210.0, 297.0, false);
        assert_eq!(scale_for(ScaleMode::Shrink, &group, &a4), 1.0);
        assert_eq!(scale_for(ScaleMode::None, &group, &a4), 1.0);
        assert_eq!(scale_for(ScaleMode::Fit, &group, &a4), 2.1);
        let big = SheetGroup {
            width_mm: 420.0,
            height_mm: 594.0,
            count: 1,
        };
        assert_eq!(scale_for(ScaleMode::Shrink, &big, &a4), 0.5);
        assert_eq!(scale_for(ScaleMode::None, &big, &a4), 1.0);
        assert_eq!(scale_for(ScaleMode::Fit, &big, &a4), 0.5);
        let close = SheetGroup {
            width_mm: 211.0,
            height_mm: 296.0,
            count: 1,
        };
        assert_eq!(scale_for(ScaleMode::Fit, &close, &a4), 1.0);
    }

    #[test]
    fn enlarges_onto_the_nearest_paper_when_asked_to_fit() {
        let options = with(|options| {
            options.fit_to_nearest_paper = true;
            options.scale = ScaleMode::Fit;
        });
        let plan = run_with(&pdf_like(), &document(&[(100.0, 70.0, 1)]), None, &options, "PDF").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(101.6, 101.6, false)));
        assert!((plan.scales[0] - 1.016).abs() < 1e-9);
        let scale = plan.warnings[0].details.as_ref().unwrap().get("scale").and_then(Value::as_f64).unwrap();
        assert!((scale - 1.016).abs() < 1e-9);
    }

    #[test]
    fn looks_for_the_nearest_paper_only_in_the_requested_orientation() {
        let options = with(|options| {
            options.fit_to_nearest_paper = true;
            options.orientation = Orientation::Portrait;
        });
        let plan = run_with(&pdf_like(), &document(&[(100.0, 70.0, 1)]), None, &options, "PDF").unwrap();
        let feed = plan.groups[0].unwrap();
        assert!(feed.page_height_mm() >= feed.page_width_mm());
        assert_eq!(feed, PaperFeed::new(101.6, 101.6, false));
    }

    #[test]
    fn orients_unchecked_groups_too() {
        let none = FakePapers {
            trays: vec![],
            papers: vec![],
            resolve: Arc::new(|_| panic!("不该问驱动")),
        };
        let options = with(|options| {
            options.orientation = Orientation::Portrait;
            options.scale = ScaleMode::Fit;
        });
        let plan = run_with(&none, &document(&[(100.0, 50.0, 1)]), None, &options, "P").unwrap();
        assert_eq!(plan.groups[0], Some(PaperFeed::new(100.0, 50.0, true)));
        assert_eq!(plan.scales[0], 0.5);
    }
}
