// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 浏览器发来的请求

use std::sync::Arc;

use serde_json::{Map, Value};

/// 一条请求：标识由 SDK 生成，响应原样带回
#[derive(Clone, Debug, PartialEq)]
pub struct ClientRequest {
    /// 请求标识
    pub id: String,
    /// 请求内容
    pub body: RequestBody,
}

/// 请求内容
#[derive(Clone, Debug, PartialEq)]
pub enum RequestBody {
    /// 握手：连接建立后的第一条消息
    Hello(HelloRequest),
    /// 心跳
    Ping,
    /// 列出打印机，不含能力明细
    ListPrinters,
    /// 查一台打印机，含能力明细
    GetPrinter {
        /// 打印机名称
        name: String,
    },
    /// 按 HTML 文档打印
    PrintHtml(PrintHtmlRequest),
    /// 把原始指令原样写给打印机
    PrintRaw(PrintRawRequest),
    /// 把 PDF 直接打到打印机
    PrintPdf(PrintPdfRequest),
    /// 把 HTML 文档导出为 PDF
    ExportPdf(ExportPdfRequest),
    /// 查任务状态
    GetJob {
        /// 任务标识
        job_id: String,
    },
    /// 取消任务
    CancelJob {
        /// 任务标识
        job_id: String,
    },
    /// 协议本身不认识的类型，交给扩展处理；没有扩展认领时回 BAD_REQUEST
    Custom(CustomRequest),
}

impl RequestBody {
    /// 写进日志的类型名
    pub fn kind(&self) -> &str {
        match self {
            RequestBody::Hello(_) => "hello",
            RequestBody::Ping => "ping",
            RequestBody::ListPrinters => "printers.list",
            RequestBody::GetPrinter { .. } => "printers.get",
            RequestBody::PrintHtml(_) => "print.html",
            RequestBody::PrintRaw(_) => "print.raw",
            RequestBody::PrintPdf(_) => "print.pdf",
            RequestBody::ExportPdf(_) => "export.pdf",
            RequestBody::GetJob { .. } => "job.get",
            RequestBody::CancelJob { .. } => "job.cancel",
            RequestBody::Custom(custom) => &custom.kind,
        }
    }
}

/// 握手
#[derive(Clone, Debug, PartialEq)]
pub struct HelloRequest {
    /// 协议主版本
    pub protocol: i64,
    /// 协议次版本
    pub minor: i64,
    /// 发起连接的 SDK
    pub sdk: Option<SdkInfo>,
    /// 断线前拿到的重连令牌
    pub resume: Option<String>,
    /// 访问密钥；客户端设了密钥时必须一致
    pub key: Option<String>,
}

/// 发起连接的 SDK
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SdkInfo {
    /// 包名
    pub name: Option<String>,
    /// 版本
    pub version: Option<String>,
}

/// 扩展处理的请求：类型名与整条消息
#[derive(Clone, Debug, PartialEq)]
pub struct CustomRequest {
    /// 消息类型
    pub kind: String,
    /// 整条消息
    pub message: Map<String, Value>,
}

/// 要打印的 HTML 文档：输出页与随任务带来的资源，以及按出现顺序的纸张分组
#[derive(Clone, Debug, PartialEq)]
pub struct PrintDocument {
    /// 自包含的输出页，资源地址已改写到 https://print.local/r/{id}
    pub html: String,
    /// 资源
    pub resources: Vec<DocumentResource>,
    /// 纸张分组
    pub sheets: Vec<SheetGroup>,
}

impl PrintDocument {
    /// 输出页总数
    pub fn sheet_count(&self) -> u32 {
        self.sheets.iter().map(|group| group.count).sum()
    }

    /// 按编号找资源
    pub fn resource(&self, id: &str) -> Option<&DocumentResource> {
        self.resources.iter().find(|resource| resource.id == id)
    }
}

/// 随任务带来的一份资源
#[derive(Clone, Debug, PartialEq)]
pub struct DocumentResource {
    /// 资源编号，文档里经 r/{id} 引用
    pub id: String,
    /// 媒体类型
    pub mime: String,
    /// 解码后的字节
    pub data: Arc<Vec<u8>>,
}

/// 连续的若干张同尺寸输出页
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SheetGroup {
    /// 宽，毫米
    pub width_mm: f64,
    /// 高，毫米
    pub height_mm: f64,
    /// 张数
    pub count: u32,
}

/// 双面方式
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DuplexMode {
    /// 单面
    #[default]
    Simplex,
    /// 双面，长边翻页
    LongEdge,
    /// 双面，短边翻页
    ShortEdge,
}

impl DuplexMode {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            DuplexMode::Simplex => "simplex",
            DuplexMode::LongEdge => "long-edge",
            DuplexMode::ShortEdge => "short-edge",
        }
    }
}

/// 颜色方式
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ColorMode {
    /// 彩色
    #[default]
    Color,
    /// 灰度
    Grayscale,
}

/// 奇偶页
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PageSet {
    /// 全部
    #[default]
    All,
    /// 只打奇数页
    Odd,
    /// 只打偶数页
    Even,
}

impl PageSet {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            PageSet::All => "all",
            PageSet::Odd => "odd",
            PageSet::Even => "even",
        }
    }
}

/// 版面方向
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Orientation {
    /// 按每组内容的宽高定
    #[default]
    Auto,
    /// 版面竖放
    Portrait,
    /// 版面横放
    Landscape,
}

impl Orientation {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            Orientation::Auto => "auto",
            Orientation::Portrait => "portrait",
            Orientation::Landscape => "landscape",
        }
    }
}

/// 内容怎么放进版面
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ScaleMode {
    /// 比版面大时等比缩小，否则原大居中
    #[default]
    Shrink,
    /// 原大居中，放不下的部分裁掉
    None,
    /// 等比放大或缩小到正好放进版面，居中
    Fit,
}

impl ScaleMode {
    /// 协议里的写法
    pub fn name(self) -> &'static str {
        match self {
            ScaleMode::Shrink => "shrink",
            ScaleMode::None => "none",
            ScaleMode::Fit => "fit",
        }
    }
}

/// 打印选项
#[derive(Clone, Debug, PartialEq)]
pub struct PrintOptions {
    /// 份数，1–999
    pub copies: u32,
    /// 多份时逐份打印
    pub collate: bool,
    /// 双面方式
    pub duplex: DuplexMode,
    /// 颜色方式
    pub color: ColorMode,
    /// 页码范围，如 1-3,5；缺省全部
    pub page_ranges: Option<String>,
    /// 在页码范围选中的页里只留奇数页或偶数页，按全文页码算
    pub page_set: PageSet,
    /// 版面方向；强制方向时内容不旋转，按 scale 放进版面
    pub orientation: Orientation,
    /// 内容怎么放进版面
    pub scale: ScaleMode,
    /// 纸张名，取打印机能力里纸张的名称，不分大小写；设了以后每组都打到这种纸上，fit_to_nearest_paper 不起作用
    pub paper: Option<String>,
    /// 纸盒名，取打印机能力里纸盒的名称，不分大小写；缺省为驱动的缺省纸盒
    pub tray: Option<String>,
    /// 弹系统打印对话框，缺省静默
    pub dialog: bool,
    /// 交给打印池的期限，毫秒；缺省用客户端的期限
    pub timeout_ms: Option<u32>,
    /// 打印机没有某组的纸张、也不接受这个尺寸时，改用最接近的纸张；缺省不换纸，整个任务以 PAPER_UNSUPPORTED 失败
    pub fit_to_nearest_paper: bool,
}

impl Default for PrintOptions {
    fn default() -> Self {
        PrintOptions {
            copies: 1,
            collate: true,
            duplex: DuplexMode::Simplex,
            color: ColorMode::Color,
            page_ranges: None,
            page_set: PageSet::All,
            orientation: Orientation::Auto,
            scale: ScaleMode::Shrink,
            paper: None,
            tray: None,
            dialog: false,
            timeout_ms: None,
            fit_to_nearest_paper: false,
        }
    }
}

/// 按 HTML 文档打印
#[derive(Clone, Debug, PartialEq)]
pub struct PrintHtmlRequest {
    /// 任务标识
    pub job_id: String,
    /// 文档
    pub document: Arc<PrintDocument>,
    /// 打印机；缺省为默认打印机
    pub printer: Option<String>,
    /// 选项
    pub options: PrintOptions,
}

/// 把原始指令原样写给打印机
#[derive(Clone, Debug, PartialEq)]
pub struct PrintRawRequest {
    /// 任务标识
    pub job_id: String,
    /// 打印机
    pub printer: String,
    /// 指令字节
    pub data: Arc<Vec<u8>>,
    /// 打印池里显示的文档名
    pub doc_name: Option<String>,
}

/// 把 PDF 直接打到打印机，按每页的尺寸匹配纸张
#[derive(Clone, Debug, PartialEq)]
pub struct PrintPdfRequest {
    /// 任务标识
    pub job_id: String,
    /// 打印机；缺省为默认打印机
    pub printer: Option<String>,
    /// PDF 的字节
    pub data: Arc<Vec<u8>>,
    /// 打印池里显示的文档名
    pub doc_name: Option<String>,
    /// 选项
    pub options: PrintOptions,
}

/// 把 HTML 文档导出为 PDF
#[derive(Clone, Debug, PartialEq)]
pub struct ExportPdfRequest {
    /// 任务标识
    pub job_id: String,
    /// 文档
    pub document: Arc<PrintDocument>,
    /// 选项
    pub options: PrintOptions,
}
