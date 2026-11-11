// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! Windows 上把 PDF 打到打印机：Windows.Data.Pdf 载入，经 IPdfRendererNative 画进 Direct2D，由 ID2D1PrintControl 写成 XPS 打印作业，
//! 打印池里是矢量内容。每组纸张一个作业，作业的打印设置由驱动的缺省 DEVMODE 改纸张、方向、纸盒、份数、逐份、双面与颜色后转成 PrintTicket；
//! 内容按核对出的倍数缩放并在版面上居中

use std::sync::Arc;

use tokio::sync::oneshot;
use windows::Data::Pdf::PdfDocument;
use windows::Storage::Streams::IRandomAccessStream;
use windows::Win32::Foundation::{HGLOBAL, HMODULE};
use windows::Win32::Graphics::Direct2D::Common::{D2D_COLOR_F, D2D_RECT_F, D2D_SIZE_F};
use windows::Win32::Graphics::Direct2D::{
    D2D1_COLOR_SPACE_SRGB, D2D1_DEVICE_CONTEXT_OPTIONS_NONE, D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_PRINT_CONTROL_PROPERTIES, D2D1_PRINT_FONT_SUBSET_MODE_DEFAULT,
    D2D1CreateFactory, ID2D1Device, ID2D1DeviceContext, ID2D1Factory1, ID2D1Image, ID2D1PrintControl,
};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D11::{D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11CreateDevice, ID3D11Device};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Imaging::{CLSID_WICImagingFactory, IWICImagingFactory};
use windows::Win32::Graphics::Printing::PrintTicket::{PTCloseProvider, PTConvertDevModeToPrintTicket, PTOpenProvider, kPTJobScope};
use windows::Win32::Storage::Xps::Printing::{IPrintDocumentPackageTarget, IPrintDocumentPackageTargetFactory, PrintDocumentPackageTargetFactory};
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, IStream, STREAM_SEEK_SET};
use windows::Win32::System::WinRT::Pdf::{IPdfRendererNative, PDF_RENDER_PARAMS, PdfCreateRenderer};
use windows::Win32::System::WinRT::{BSOS_DEFAULT, CreateRandomAccessStreamOverStream};
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::core::{HSTRING, IUnknown, Interface};
use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::cancel::Cancel;
use xihan_print_client_core::log::SharedLog;
use xihan_print_client_core::printing::{HtmlPrintResult, JobError, PageSelection, PaperCatalog, PaperFeed, PdfPrinter, PrintDialog, SpoolTicket, plan_papers};
use xihan_print_client_core::protocol::codes::errors;
use xihan_print_client_core::protocol::{Details, PrintOptions, SheetGroup, TrayInfo};

use super::winspool;

const MILLIMETRES_PER_INCH: f64 = 25.4;
const DIPS_PER_INCH: f64 = 96.0;

/// 打印池里遇到要栅格化的内容时用的分辨率
const RASTER_DPI: f32 = 300.0;

/// 一组按同一种纸张打的页
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PageGroup {
    /// 要打的页在 PDF 里的序号，从 0 起；为空时打全部页
    pub pages: Vec<u32>,
    /// 纸张与方向
    pub feed: PaperFeed,
    /// 内容的缩放倍数，1 为原大
    pub scale: f64,
}

/// 把浏览器给的 PDF 打到 Windows 的打印机
pub(crate) struct WindowsPdfPrinter {
    papers: Arc<dyn PaperCatalog>,
    dialog: Option<Arc<dyn PrintDialog>>,
    log: SharedLog,
}

impl WindowsPdfPrinter {
    /// 以纸张能力、打印对话框与日志创建
    pub(crate) fn new(papers: Arc<dyn PaperCatalog>, dialog: Option<Arc<dyn PrintDialog>>, log: SharedLog) -> Self {
        WindowsPdfPrinter { papers, dialog, log }
    }
}

impl PdfPrinter for WindowsPdfPrinter {
    fn print(
        &self,
        pdf: Arc<Vec<u8>>,
        sheets: Arc<Vec<SheetGroup>>,
        printer: String,
        options: PrintOptions,
        document_name: String,
        cancel: Cancel,
    ) -> BoxFuture<'static, Result<HtmlPrintResult, JobError>> {
        let (papers, dialog, log) = (self.papers.clone(), self.dialog.clone(), self.log.clone());
        Box::pin(async move {
            let total: u32 = sheets.iter().map(|group| group.count).sum();
            let (printer, options) = if options.dialog {
                let dialog = dialog.ok_or_else(|| {
                    JobError::failure(
                        errors::CAPABILITY_UNSUPPORTED,
                        "这台机器上的客户端不支持弹打印对话框",
                        Some(Details::new().with("capability", "dialog")),
                    )
                })?;
                let choice = cancel.run(dialog.ask(printer, options, total, cancel.clone())).await?.ok_or(JobError::CancelledByUser)?;
                (choice.printer, choice.options)
            } else {
                (printer, options)
            };
            let selection = PageSelection::from_options(&options, total).map_err(JobError::Failure)?;
            let plan = {
                let (papers, sheets, selection, printer, options) = (papers.clone(), sheets.clone(), selection.clone(), printer.clone(), options.clone());
                blocking(&cancel, move || plan_papers(papers.as_ref(), &printer, &sheets, &selection, &options)).await?
            };
            for warning in &plan.warnings {
                log.warn(&warning.message);
            }
            let mut groups = Vec::new();
            let mut start = 0usize;
            for (index, group) in sheets.iter().enumerate() {
                let count = group.count as usize;
                let pages: Vec<u32> = (start..start + count).filter(|page| selection.contains(*page)).map(|page| page as u32).collect();
                if let (false, Some(feed)) = (pages.is_empty(), plan.groups[index]) {
                    groups.push(PageGroup {
                        pages,
                        feed,
                        scale: plan.scales[index],
                    });
                }
                start += count;
            }
            let spooled = print_on_thread(pdf, groups, printer.clone(), plan.tray.clone(), options, document_name, cancel).await?;
            log.debug(&format!("已把 PDF 交给 {printer} 共 {} 页，分 {} 组", selection.count(), spooled.len()));
            Ok(HtmlPrintResult {
                sheets: selection.count(),
                warnings: plan.warnings,
                spooled,
            })
        })
    }
}

/// 在阻塞线程上执行，令牌取消时不再等它
async fn blocking<T: Send + 'static>(cancel: &Cancel, work: impl FnOnce() -> Result<T, JobError> + Send + 'static) -> Result<T, JobError> {
    match cancel.run(tokio::task::spawn_blocking(work)).await? {
        Ok(result) => result,
        Err(error) => Err(JobError::failure(errors::INTERNAL, format!("后台线程出错：{error}"), None)),
    }
}

/// 在自己的线程（COM 多线程套间）上逐组下发，返回各组的作业；令牌取消时在页与页之间撤下当前作业
pub(crate) async fn print_on_thread(
    pdf: Arc<Vec<u8>>,
    groups: Vec<PageGroup>,
    printer: String,
    tray: Option<TrayInfo>,
    options: PrintOptions,
    title: String,
    cancel: Cancel,
) -> Result<Vec<SpoolTicket>, JobError> {
    let (reply, answer) = oneshot::channel();
    let token = cancel.clone();
    std::thread::Builder::new()
        .name("pdf-print".into())
        .spawn(move || {
            let _ = reply.send(print_groups(&pdf, &groups, &printer, tray.as_ref(), &options, &title, &token));
        })
        .map_err(|error| JobError::failure(errors::INTERNAL, format!("起不了打印线程：{error}"), None))?;
    match cancel.run(answer).await? {
        Ok(result) => result,
        Err(_) => Err(JobError::failure(errors::INTERNAL, "打印线程意外退出", None)),
    }
}

/// 本线程进入 COM 多线程套间，离开时退出
struct Apartment;

impl Apartment {
    fn enter() -> Result<Apartment, JobError> {
        // SAFETY: 只在本线程上调用，与 Drop 里的 CoUninitialize 成对
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| failure(errors::INTERNAL, "初始化 COM 失败", &error))?;
        Ok(Apartment)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: 与 enter 里的 CoInitializeEx 成对
        unsafe { CoUninitialize() };
    }
}

fn failure(code: &str, message: &str, error: &windows::core::Error) -> JobError {
    JobError::failure(
        code,
        format!("{message}：{}", error.message()),
        Some(Details::new().with("hresult", format!("0x{:08X}", error.code().0 as u32))),
    )
}

/// Direct2D 设备、PDF 渲染器与 WIC：一份 PDF 的各组共用
struct Drawing {
    device: ID2D1Device,
    context: ID2D1DeviceContext,
    renderer: IPdfRendererNative,
    imaging: IWICImagingFactory,
}

impl Drawing {
    fn create() -> windows::core::Result<Drawing> {
        let d3d = create_d3d(D3D_DRIVER_TYPE_HARDWARE).or_else(|_| create_d3d(D3D_DRIVER_TYPE_WARP))?;
        let dxgi: IDXGIDevice = d3d.cast()?;
        // SAFETY: 参数都是有效的接口或常量；返回的接口归本结构所有
        unsafe {
            let factory: ID2D1Factory1 = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let device = factory.CreateDevice(&dxgi)?;
            let context = device.CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE)?;
            let renderer = PdfCreateRenderer(&dxgi)?;
            let imaging: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            Ok(Drawing {
                device,
                context,
                renderer,
                imaging,
            })
        }
    }
}

fn create_d3d(driver: D3D_DRIVER_TYPE) -> windows::core::Result<ID3D11Device> {
    let mut device = None;
    // SAFETY: 输出参数是本函数里的有效内存
    unsafe {
        D3D11CreateDevice(
            None,
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )?
    };
    device.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
}

/// 由内存里的字节载入 PDF
fn load(pdf: &[u8]) -> windows::core::Result<PdfDocument> {
    // SAFETY: SHCreateMemStream 复制一份字节，返回的流自己持有内存
    let stream = unsafe { SHCreateMemStream(Some(pdf)) }.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_OUTOFMEMORY))?;
    // SAFETY: stream 是有效的 IStream
    let random: IRandomAccessStream = unsafe { CreateRandomAccessStreamOverStream(&stream, BSOS_DEFAULT)? };
    PdfDocument::LoadFromStreamAsync(&random)?.join()
}

/// 依次下发各组：每组一个作业
fn print_groups(
    pdf: &[u8],
    groups: &[PageGroup],
    printer: &str,
    tray: Option<&TrayInfo>,
    options: &PrintOptions,
    title: &str,
    cancel: &Cancel,
) -> Result<Vec<SpoolTicket>, JobError> {
    let _apartment = Apartment::enter()?;
    let document = load(pdf).map_err(|error| failure(errors::RENDER_FAILED, "Windows 读不了这份 PDF", &error))?;
    let drawing = Drawing::create().map_err(|error| failure(errors::RENDER_FAILED, "建不了 Direct2D 绘图设备", &error))?;
    let count = document.PageCount().map_err(|error| failure(errors::RENDER_FAILED, "读不出 PDF 的页数", &error))?;
    let papers = winspool::printer_papers(printer);
    let mut spooled = Vec::with_capacity(groups.len());
    for (position, group) in groups.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(JobError::Cancelled);
        }
        let pages: Vec<u32> = if group.pages.is_empty() { (0..count).collect() } else { group.pages.clone() };
        if let Some(page) = pages.iter().find(|page| **page >= count) {
            return Err(JobError::failure(
                errors::RENDER_FAILED,
                format!("PDF 只有 {count} 页，读不到第 {} 页", page + 1),
                Some(Details::new().with("pages", count)),
            ));
        }
        let name = if groups.len() > 1 {
            format!("{title}（{}/{}）", position + 1, groups.len())
        } else {
            title.to_owned()
        };
        let devmode = winspool::job_devmode(printer, &group.feed, tray, options, &papers)?;
        let ticket = print_ticket(printer, &devmode).map_err(|error| failure(errors::SPOOL_FAILED, "打印设置转不成 PrintTicket", &error))?;
        let target = job_target(printer, &name, &ticket).map_err(|error| failure(errors::SPOOL_FAILED, "建不了打印作业", &error))?;
        if let Err(error) = print_pages(&drawing, &document, &target, &pages, group, cancel) {
            // SAFETY: target 是本函数建的打印作业，撤下它
            let _ = unsafe { target.Cancel() };
            return Err(error);
        }
        spooled.push(SpoolTicket {
            printer: printer.to_owned(),
            document_name: name,
            system_job_id: None,
        });
    }
    Ok(spooled)
}

fn job_target(printer: &str, name: &str, ticket: &IStream) -> windows::core::Result<IPrintDocumentPackageTarget> {
    // SAFETY: 参数都在调用期间有效
    unsafe {
        let factory: IPrintDocumentPackageTargetFactory = CoCreateInstance(&PrintDocumentPackageTargetFactory, None, CLSCTX_INPROC_SERVER)?;
        factory.CreateDocumentPackageTargetForPrintJob(&HSTRING::from(printer), &HSTRING::from(name), None::<&IStream>, ticket)
    }
}

/// 把 DEVMODE 转成作业的 PrintTicket，写进内存流并回到开头
fn print_ticket(printer: &str, devmode: &[u64]) -> windows::core::Result<IStream> {
    // SAFETY: devmode 是驱动合并过的完整 DEVMODE；流由 COM 管理内存
    unsafe {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
        let provider = PTOpenProvider(&HSTRING::from(printer), 1)?;
        let mode = devmode.as_ptr().cast::<windows::Win32::Graphics::Gdi::DEVMODEW>();
        let size = u32::from((*mode).dmSize) + u32::from((*mode).dmDriverExtra);
        let converted = PTConvertDevModeToPrintTicket(provider, size, mode.cast(), kPTJobScope, &stream);
        let _ = PTCloseProvider(provider);
        converted?;
        stream.Seek(0, STREAM_SEEK_SET, None)?;
        Ok(stream)
    }
}

/// Direct2D 的 3×2 变换矩阵，与 SetTransform 要的 Matrix3x2 布局相同
#[repr(C)]
struct Transform {
    m11: f32,
    m12: f32,
    m21: f32,
    m22: f32,
    m31: f32,
    m32: f32,
}

fn dips(millimetres: f64) -> f64 {
    millimetres / MILLIMETRES_PER_INCH * DIPS_PER_INCH
}

/// 把各页画进打印控制：每页按倍数缩放并在版面上居中，版面是核对出的纸张按方向放好的宽高
fn print_pages(drawing: &Drawing, document: &PdfDocument, target: &IPrintDocumentPackageTarget, pages: &[u32], group: &PageGroup, cancel: &Cancel) -> Result<(), JobError> {
    let render = |error: windows::core::Error| failure(errors::RENDER_FAILED, "画 PDF 页失败", &error);
    let properties = D2D1_PRINT_CONTROL_PROPERTIES {
        fontSubset: D2D1_PRINT_FONT_SUBSET_MODE_DEFAULT,
        rasterDPI: RASTER_DPI,
        colorSpace: D2D1_COLOR_SPACE_SRGB,
    };
    // SAFETY: 设备、WIC 与作业都是有效的接口
    let control: ID2D1PrintControl = unsafe { drawing.device.CreatePrintControl(&drawing.imaging, target, Some(&properties)) }
        .map_err(|error| failure(errors::SPOOL_FAILED, "建不了 Direct2D 打印控制", &error))?;
    let (page_width, page_height) = (dips(group.feed.page_width_mm()), dips(group.feed.page_height_mm()));
    for &index in pages {
        if cancel.is_cancelled() {
            return Err(JobError::Cancelled);
        }
        let page = document.GetPage(index).map_err(render)?;
        let size = page.Size().map_err(render)?;
        let (width, height) = (f64::from(size.Width), f64::from(size.Height));
        let transform = Transform {
            m11: group.scale as f32,
            m12: 0.0,
            m21: 0.0,
            m22: group.scale as f32,
            m31: ((page_width - width * group.scale) / 2.0) as f32,
            m32: ((page_height - height * group.scale) / 2.0) as f32,
        };
        let parameters = PDF_RENDER_PARAMS {
            SourceRect: D2D_RECT_F {
                left: 0.0,
                top: 0.0,
                right: size.Width,
                bottom: size.Height,
            },
            DestinationWidth: size.Width.round() as u32,
            DestinationHeight: size.Height.round() as u32,
            BackgroundColor: D2D_COLOR_F { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
            IgnoreHighContrast: true,
        };
        let unknown: IUnknown = page.cast().map_err(render)?;
        // SAFETY: 都在本线程上调用 Direct2D；transform 与 Matrix3x2 布局相同，在调用期间有效
        unsafe {
            let list = drawing.context.CreateCommandList().map_err(render)?;
            drawing.context.SetTarget(&list);
            drawing.context.BeginDraw();
            drawing.context.SetTransform(std::ptr::from_ref(&transform).cast());
            let drawn = drawing.renderer.RenderPageToDeviceContext(&unknown, &drawing.context, Some(&parameters));
            let ended = drawing.context.EndDraw(None, None);
            drawing.context.SetTarget(None::<&ID2D1Image>);
            drawn.map_err(render)?;
            ended.map_err(render)?;
            list.Close().map_err(render)?;
            control
                .AddPage(
                    &list,
                    D2D_SIZE_F {
                        width: page_width as f32,
                        height: page_height as f32,
                    },
                    None::<&IStream>,
                    None,
                    None,
                )
                .map_err(|error| failure(errors::SPOOL_FAILED, "交给打印池失败", &error))?;
        }
    }
    // SAFETY: control 是本函数建的打印控制
    unsafe { control.Close() }.map_err(|error| failure(errors::SPOOL_FAILED, "交给打印池失败", &error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_millimetres_to_device_independent_pixels() {
        assert!((dips(25.4) - 96.0).abs() < 1e-9);
        assert!((dips(210.0) - 793.700_787).abs() < 1e-5);
    }

    #[test]
    fn lays_the_transform_out_like_matrix3x2() {
        assert_eq!(std::mem::size_of::<Transform>(), 24);
        assert_eq!(std::mem::align_of::<Transform>(), 4);
    }
}
