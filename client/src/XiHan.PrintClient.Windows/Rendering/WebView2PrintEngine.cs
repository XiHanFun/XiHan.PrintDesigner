// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;
using XiHan.PrintClient.Windows.Printing;

namespace XiHan.PrintClient.Windows.Rendering;

/// <summary>
/// 经 WebView2 渲染 HTML 文档：打印时先按打印机的纸张能力核对各组纸张，再按纸张分组，每组设成核对出的纸张单独交给打印池；
/// 导出 PDF 时按文档里各页的 @page 尺寸一次导出。所有 WebView2 调用都转到创建时的界面线程上执行
/// </summary>
public sealed class WebView2PrintEngine : IHtmlPrintEngine
{
    private const double MillimetersPerInch = 25.4;

    private readonly CoreWebView2Environment _environment;
    private readonly SynchronizationContext _ui;
    private readonly nint _parentWindow;
    private readonly IPrintDialog? _dialog;
    private readonly IPaperCatalog _papers;
    private readonly IClientLog _log;

    private WebView2PrintEngine(CoreWebView2Environment environment, SynchronizationContext ui, nint parentWindow, IPrintDialog? dialog, IPaperCatalog papers, IClientLog log)
    {
        _environment = environment;
        _ui = ui;
        _parentWindow = parentWindow;
        _dialog = dialog;
        _papers = papers;
        _log = log;
        Version = environment.BrowserVersionString;
    }

    /// <inheritdoc />
    public string? Version { get; }

    /// <summary>
    /// 载入文档到就绪（字体、图片）的期限
    /// </summary>
    internal TimeSpan RenderTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// 在界面线程上创建：先清空上次留下的渲染数据，再建 WebView2 环境；没装 WebView2 运行时时抛出 WebView2RuntimeNotFoundException
    /// </summary>
    /// <param name="parentWindow">承载隐藏渲染页的窗口</param>
    /// <param name="userDataFolder">渲染数据目录</param>
    /// <param name="dialog">系统打印对话框；为 null 时不支持 dialog 选项</param>
    /// <param name="log">日志</param>
    /// <param name="papers">下发前核对纸张用的纸张能力，缺省经 winspool 查</param>
    public static async Task<WebView2PrintEngine> CreateAsync(nint parentWindow, string userDataFolder, IPrintDialog? dialog = null, IClientLog? log = null, IPaperCatalog? papers = null)
    {
        var ui = SynchronizationContext.Current ?? throw new InvalidOperationException("要在界面线程上创建渲染引擎");
        log ??= NullClientLog.Instance;
        try
        {
            if (Directory.Exists(userDataFolder))
                Directory.Delete(userDataFolder, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            log.Write(LogLevel.Warning, "清空渲染数据目录失败，沿用上次的数据", error);
        }
        var options = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments = "--disable-background-networking --disable-component-update --no-pings",
            AreBrowserExtensionsEnabled = false,
        };
        var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder, options);
        log.Write(LogLevel.Information, $"WebView2 运行时 {environment.BrowserVersionString}");
        return new WebView2PrintEngine(environment, ui, parentWindow, dialog, papers ?? new WindowsPrinterCatalog(), log);
    }

    /// <inheritdoc />
    public Task<HtmlPrintResult> PrintAsync(PrintDocument document, string printer, PrintOptions options, CancellationToken cancellationToken)
    {
        return OnUiAsync(() => PrintOnUiAsync(document, printer, options, cancellationToken));
    }

    /// <inheritdoc />
    public Task<byte[]> ExportPdfAsync(PrintDocument document, PrintOptions options, CancellationToken cancellationToken)
    {
        return OnUiAsync(() => ExportOnUiAsync(document, options, cancellationToken));
    }

    private async Task<HtmlPrintResult> PrintOnUiAsync(PrintDocument document, string printer, PrintOptions options, CancellationToken cancellationToken)
    {
        if (options.Dialog)
        {
            if (_dialog is null)
                throw new PrintFailure(PrintErrorCodes.CapabilityUnsupported, "这台机器上的客户端不支持弹打印对话框", new JsonObject { ["capability"] = "dialog" });
            var choice = await _dialog.AskAsync(printer, options, document.SheetCount, cancellationToken) ?? throw new PrintCancelledByUser();
            printer = choice.Printer;
            options = choice.Options;
        }
        var selection = Select(document, options);
        var plan = await Task.Run(() => PaperCheck.Plan(_papers, printer, document, selection, options.FitToNearestPaper), cancellationToken);
        foreach (var warning in plan.Warnings)
            _log.Write(LogLevel.Warning, warning.Message);

        await using var page = await PrintPage.OpenAsync(_environment, _parentWindow, document, RenderTimeout, cancellationToken);
        var start = 0;
        var printed = 0;
        for (var index = 0; index < document.Sheets.Count; index++)
        {
            var group = document.Sheets[index];
            var ranges = selection.RangesIn(start, group.Count);
            if (ranges is not null)
            {
                await page.ShowAsync(start, group.Count, cancellationToken);
                var settings = Settings(page.CreatePrintSettings(), printer, options, plan.Groups[index]!, ranges);
                CoreWebView2PrintStatus status;
                try
                {
                    status = await page.PrintAsync(settings, cancellationToken);
                }
                catch (ArgumentException error)
                {
                    throw new PrintFailure(PrintErrorCodes.PaperUnsupported, $"打印机不接受这组纸张或选项：{group.WidthMm}×{group.HeightMm} mm", new JsonObject
                    {
                        ["printer"] = printer,
                        ["group"] = index,
                        ["widthMm"] = group.WidthMm,
                        ["heightMm"] = group.HeightMm,
                    }, error);
                }
                switch (status)
                {
                    case CoreWebView2PrintStatus.Succeeded:
                        break;
                    case CoreWebView2PrintStatus.PrinterUnavailable:
                        throw new PrintFailure(PrintErrorCodes.PrinterOffline, $"打印机当前不可用：{printer}", new JsonObject { ["printer"] = printer, ["group"] = index });
                    default:
                        throw new PrintFailure(PrintErrorCodes.SpoolFailed, "交给打印池失败", new JsonObject { ["printer"] = printer, ["group"] = index, ["status"] = status.ToString() });
                }
                printed += selection.CountIn(start, group.Count);
            }
            start += group.Count;
        }
        _log.Write(LogLevel.Debug, $"已交给 {printer} 共 {printed} 页，分 {document.Sheets.Count} 组");
        return new HtmlPrintResult(printed, plan.Warnings);
    }

    private async Task<byte[]> ExportOnUiAsync(PrintDocument document, PrintOptions options, CancellationToken cancellationToken)
    {
        var selection = Select(document, options);
        await using var page = await PrintPage.OpenAsync(_environment, _parentWindow, document, RenderTimeout, cancellationToken);
        if (options.Color == ColorMode.Grayscale)
            await page.GrayscaleAsync(cancellationToken);

        var first = document.Sheets[0];
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("printBackground", true);
            writer.WriteBoolean("preferCSSPageSize", true);
            writer.WriteNumber("paperWidth", first.WidthMm / MillimetersPerInch);
            writer.WriteNumber("paperHeight", first.HeightMm / MillimetersPerInch);
            writer.WriteNumber("marginTop", 0);
            writer.WriteNumber("marginBottom", 0);
            writer.WriteNumber("marginLeft", 0);
            writer.WriteNumber("marginRight", 0);
            writer.WriteString("pageRanges", selection.RangesIn(0, document.SheetCount));
            writer.WriteEndObject();
        }
        string json;
        try
        {
            json = await page.DevToolsAsync("Page.printToPDF", Encoding.UTF8.GetString(buffer.WrittenSpan), cancellationToken);
        }
        catch (Exception error) when (error is not (OperationCanceledException or PrintFailure))
        {
            throw new PrintFailure(PrintErrorCodes.PdfFailed, "导出 PDF 失败", inner: error);
        }
        return Convert.FromBase64String(JsonDocument.Parse(json).RootElement.GetProperty("data").GetString()!);
    }

    private static PageSelection Select(PrintDocument document, PrintOptions options)
    {
        return PageSelection.Parse(options.PageRanges, document.SheetCount)
            ?? throw new PrintFailure(PrintErrorCodes.BadRequest, $"页码范围在 {document.SheetCount} 页里一页都没选中", new JsonObject { ["field"] = "options.pageRanges" });
    }

    /// <summary>
    /// 一组纸张的打印设置：纸张宽高与方向按核对的结果，页边距为 0，原大，打印背景，不加页眉页脚
    /// </summary>
    private static CoreWebView2PrintSettings Settings(CoreWebView2PrintSettings settings, string printer, PrintOptions options, PaperFeed paper, string ranges)
    {
        settings.PrinterName = printer;
        settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
        settings.Orientation = paper.Landscape ? CoreWebView2PrintOrientation.Landscape : CoreWebView2PrintOrientation.Portrait;
        settings.PageWidth = paper.WidthMm / MillimetersPerInch;
        settings.PageHeight = paper.HeightMm / MillimetersPerInch;
        settings.MarginTop = 0;
        settings.MarginBottom = 0;
        settings.MarginLeft = 0;
        settings.MarginRight = 0;
        settings.ScaleFactor = 1;
        settings.PagesPerSide = 1;
        settings.ShouldPrintBackgrounds = true;
        settings.ShouldPrintHeaderAndFooter = false;
        settings.PageRanges = ranges;
        settings.Copies = options.Copies;
        settings.Collation = options.Collate ? CoreWebView2PrintCollation.Collated : CoreWebView2PrintCollation.Uncollated;
        settings.Duplex = options.Duplex switch
        {
            DuplexMode.LongEdge => CoreWebView2PrintDuplex.TwoSidedLongEdge,
            DuplexMode.ShortEdge => CoreWebView2PrintDuplex.TwoSidedShortEdge,
            _ => CoreWebView2PrintDuplex.OneSided,
        };
        settings.ColorMode = options.Color == ColorMode.Grayscale ? CoreWebView2PrintColorMode.Grayscale : CoreWebView2PrintColorMode.Color;
        return settings;
    }

    private Task<T> OnUiAsync<T>(Func<Task<T>> work)
    {
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ui.Post(async _ =>
        {
            try
            {
                done.TrySetResult(await work());
            }
            catch (Exception error)
            {
                done.TrySetException(error);
            }
        }, null);
        return done.Task;
    }
}
