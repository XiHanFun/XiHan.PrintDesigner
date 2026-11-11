// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! macOS 与 Linux 共用的部分：本地时区、CUPS 打印，以及「WebKit 把各组输出页渲染成 PDF、再经 CUPS 下发」的 HTML 通道

mod cups;
mod engine;

use std::sync::Arc;
use std::time::Duration;

use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::PrintDocument;
use xihan_print_client_core::time::Timestamp;

use engine::CupsPdfPrinter;
pub(crate) use engine::PdfPipelineEngine;

use crate::Printing;

/// 某一时刻本地时间相对 UTC 的偏移，秒
pub(crate) fn local_offset(at: Timestamp) -> i32 {
    let seconds = at.0.div_euclid(1000) as libc::time_t;
    let mut local: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: seconds 与 local 都是本函数里的有效内存，localtime_r 只写 local
    let converted = unsafe { libc::localtime_r(&seconds, &mut local) };
    if converted.is_null() { 0 } else { local.tm_gmtoff as i32 }
}

/// 经 CUPS 查打印机、核对纸张、写原始指令、打 PDF；本机没有 CUPS 时给出原因
pub(crate) fn printing(log: SharedLog) -> Result<Printing, String> {
    let cups = Arc::new(cups::Cups::open()?);
    Ok(Printing {
        catalog: cups.clone(),
        papers: cups.clone(),
        raw: Some(cups.clone()),
        pdf: Some(Arc::new(CupsPdfPrinter::new(cups.clone(), cups, log))),
    })
}

/// 打开 CUPS，供 HTML 通道下发 PDF
pub(crate) fn open_cups() -> Result<Arc<cups::Cups>, String> {
    cups::Cups::open().map(Arc::new)
}

/// 要渲染成一份 PDF 的一组输出页
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GroupRender {
    /// 要显示的输出页在全文里的序号（从 0 起）；其余输出页隐藏
    pub sheets: Vec<usize>,
    /// 纸张宽，毫米：PDF 每页都是这个尺寸
    pub width_mm: f64,
    /// 纸张高，毫米
    pub height_mm: f64,
}

/// 把任务文档渲染成 PDF 的 WebKit 页面：页面脚本不跑、不联网，资源只从任务里取
pub(crate) trait PdfRenderer: Send + Sync {
    /// 渲染引擎名称，如 WebKit
    fn name(&self) -> &str;

    /// 渲染引擎版本
    fn version(&self) -> Option<String>;

    /// 载入文档并等到字体与图片就绪，按 groups 逐组出 PDF，与 groups 一一对应；grayscale 时整页转灰度。
    /// 载入失败与核对不过时的错误码与 WebView2 一致：RESOURCE_BLOCKED、RENDER_FAILED、RENDER_TIMEOUT
    fn render(
        &self,
        document: Arc<PrintDocument>,
        groups: Vec<GroupRender>,
        grayscale: bool,
        timeout: Duration,
        cancel: Cancel,
    ) -> BoxFuture<'static, Result<Vec<Vec<u8>>, JobError>>;

    /// 把几份 PDF 依次合成一份，每页保持自己的尺寸
    fn merge(&self, pdfs: Vec<Vec<u8>>) -> Result<Vec<u8>, JobError>;
}
