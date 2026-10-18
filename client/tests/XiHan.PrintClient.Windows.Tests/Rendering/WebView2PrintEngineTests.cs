// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Tests.Rendering;

[Collection(TestPrinterCollection.Name)]
public sealed partial class WebView2PrintEngineTests(RenderFixture fixture) : IClassFixture<RenderFixture>
{
    private static readonly (double Width, double Height) A4 = (210, 297);
    private static readonly (double Width, double Height) A5 = (148, 210);
    private static readonly (double Width, double Height) A4Landscape = (297, 210);

    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>
    /// 按输出页的写法拼一份文档：每种尺寸一条具名 @page，每张输出页一个 data-part="sheet"；连续同尺寸的页并成一组
    /// </summary>
    private static PrintDocument Document((double Width, double Height)[] sheets, string content = "", DocumentResource[]? resources = null, string tail = "")
    {
        var sizes = sheets.Distinct().ToList();
        var html = new StringBuilder("<!doctype html><html><head><meta charset='utf-8'><style>@page { margin: 0 }");
        foreach (var (size, index) in sizes.Select((size, index) => (size, index)))
            html.Append(CultureInfo.InvariantCulture, $" @page s{index} {{ size: {size.Width}mm {size.Height}mm; margin: 0 }}");
        html.Append(" body { margin: 0 } [data-part=sheet] { break-after: page; overflow: hidden } [data-part=sheet]:last-child { break-after: auto }</style></head><body>");
        foreach (var sheet in sheets)
            html.Append(CultureInfo.InvariantCulture, $"<div data-part='sheet' style='page: s{sizes.IndexOf(sheet)}; width: {sheet.Width}mm; height: {sheet.Height}mm'>{content}</div>");
        html.Append(tail).Append("</body></html>");

        var groups = new List<SheetGroup>();
        foreach (var sheet in sheets)
        {
            if (groups.Count > 0 && groups[^1].WidthMm == sheet.Width && groups[^1].HeightMm == sheet.Height)
                groups[^1] = groups[^1] with { Count = groups[^1].Count + 1 };
            else
                groups.Add(new SheetGroup(sheet.Width, sheet.Height, 1));
        }
        return new PrintDocument(html.ToString(), resources ?? [], groups);
    }

    /// <summary>
    /// 读出 PDF 每页的尺寸，单位 mm，取整
    /// </summary>
    private static string[] PageSizes(byte[] pdf)
    {
        return [.. MediaBoxPattern().Matches(Encoding.Latin1.GetString(pdf)).Select(match =>
            $"{Math.Round(double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) * 25.4 / 72)}x{Math.Round(double.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) * 25.4 / 72)}")];
    }

    [GeneratedRegex(@"/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]")]
    private static partial Regex MediaBoxPattern();

    private async Task<PrintFailure> FailsAsync(PrintDocument document)
    {
        return await Assert.ThrowsAsync<PrintFailure>(() => fixture.Engine.ExportPdfAsync(document, new PrintOptions(), Token));
    }

    [Fact]
    public void ReportsTheRuntimeVersion()
    {
        Assert.Matches(@"^\d+\.\d+\.\d+\.\d+", fixture.Engine.Version);
    }

    [Fact]
    public async Task ExportsEveryPaperSizeIntoOnePdf()
    {
        var pdf = await fixture.Engine.ExportPdfAsync(Document([A4, A4, A5, A4Landscape]), new PrintOptions(), Token);

        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(pdf, 0, 5));
        Assert.Equal(["210x297", "210x297", "148x210", "297x210"], PageSizes(pdf));
    }

    [Fact]
    public async Task RendersTheSelfTestPage()
    {
        var client = new ClientInfo { Version = "0.1.0", Os = "windows", Arch = "x64", Renderer = fixture.Engine.Version };
        var document = SelfTestDocument.Create(client, "Office", 100, 50, DateTimeOffset.Now);

        Assert.Equal(["100x50"], PageSizes(await fixture.Engine.ExportPdfAsync(document, new PrintOptions(), Token)));
    }

    [Fact]
    public async Task ExportsOnlyTheSelectedPages()
    {
        var pdf = await fixture.Engine.ExportPdfAsync(Document([A4, A4, A5, A4Landscape]), new PrintOptions { PageRanges = "2-3" }, Token);

        Assert.Equal(["210x297", "148x210"], PageSizes(pdf));
    }

    [Fact]
    public async Task ExportsSeveralDocumentsAtOnce()
    {
        var first = fixture.Engine.ExportPdfAsync(Document([A4, A4]), new PrintOptions(), Token);
        var second = fixture.Engine.ExportPdfAsync(Document([A5]), new PrintOptions(), Token);

        Assert.Equal(["210x297", "210x297"], PageSizes(await first));
        Assert.Equal(["148x210"], PageSizes(await second));
    }

    [Fact]
    public async Task ServesTheTaskResourcesAndWaitsForImages()
    {
        var document = Document([A5], "<img src='r/0' style='width: 20mm'><img src='https://print.local/r/0?v=1' style='width: 10mm'>", [new DocumentResource("0", "image/png", Png)]);

        Assert.Equal(["148x210"], PageSizes(await fixture.Engine.ExportPdfAsync(document, new PrintOptions(), Token)));
    }

    [Fact]
    public async Task RefusesResourcesFromOutsideTheTask()
    {
        var failure = await FailsAsync(Document([A5], "<img src='https://example.com/logo.png?token=secret'>"));

        Assert.Equal(PrintErrorCodes.ResourceBlocked, failure.Code);
        Assert.Equal("https://example.com", (string?)failure.Details!["url"]);
    }

    [Fact]
    public async Task ReportsResourcesTheTaskDidNotBring()
    {
        var failure = await FailsAsync(Document([A5], "<img src='r/9'>"));

        Assert.Equal(PrintErrorCodes.RenderFailed, failure.Code);
        Assert.Equal("9", (string?)failure.Details!["resource"]);
    }

    [Fact]
    public async Task KeepsPageScriptsFromRunning()
    {
        var document = Document([A4, A4], tail: "<script>document.querySelector('[data-part=\"sheet\"]').remove()</script>");

        Assert.Equal(2, PageSizes(await fixture.Engine.ExportPdfAsync(document, new PrintOptions(), Token)).Length);
    }

    [Fact]
    public async Task RejectsDocumentsWhoseSheetsDoNotMatchTheGroups()
    {
        var document = Document([A4, A4]) with { Sheets = [new SheetGroup(210, 297, 3)] };

        var failure = await FailsAsync(document);

        Assert.Equal(PrintErrorCodes.RenderFailed, failure.Code);
        Assert.Equal(3, (int?)failure.Details!["expected"]);
        Assert.Equal(2, (int?)failure.Details["actual"]);
    }

    [Fact]
    public async Task TimesOutWhenTheDocumentIsNotReadyInTime()
    {
        fixture.Engine.RenderTimeout = TimeSpan.FromMilliseconds(1);
        try
        {
            var failure = await FailsAsync(Document([A4]));

            Assert.Equal(PrintErrorCodes.RenderTimeout, failure.Code);
        }
        finally
        {
            fixture.Engine.RenderTimeout = TimeSpan.FromSeconds(30);
        }
    }

    [Fact]
    public async Task AsksTheDialogOnTheUiThreadAndCancelsWhenTheUserDoes()
    {
        await Assert.ThrowsAsync<PrintCancelledByUser>(() => fixture.Engine.PrintAsync(Document([A4, A5]), "Office", new PrintOptions { Dialog = true }, Token));

        Assert.True(fixture.Dialog.Asked.TryDequeue(out var asked));
        Assert.Equal(("Office", 2, true), asked);
    }

    [Fact]
    public async Task ReportsAMissingPrinterAsUnavailable()
    {
        var failure = await Assert.ThrowsAsync<PrintFailure>(() => fixture.Engine.PrintAsync(Document([A4]), "XiHan 不存在的打印机 7f3a", new PrintOptions(), Token));

        Assert.Equal(PrintErrorCodes.PrinterOffline, failure.Code);
    }

    [Fact]
    public async Task PrintsEachPaperGroupToTheTestPrinter()
    {
        var printer = Environment.GetEnvironmentVariable("XIHAN_PRINT_TEST_PRINTER");
        var output = Environment.GetEnvironmentVariable("XIHAN_PRINT_TEST_OUTPUT");
        Assert.SkipWhen(printer is null || output is null, "没有配置测试打印机（XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT）");
        File.Delete(output!);

        var printed = await fixture.Engine.PrintAsync(Document([A4, A4, A5], "曦寒打印测试"), printer!, new PrintOptions { PageRanges = "2-3" }, Token);

        Assert.Equal(2, printed.Sheets);
        for (var attempt = 0; attempt < 100 && !(File.Exists(output) && new FileInfo(output!).Length > 0); attempt++)
            await Task.Delay(100, Token);
        Assert.True(new FileInfo(output!).Length > 0);
    }
}

/// <summary>
/// 用同一台测试打印机的用例放进同一组，不并行，免得写出的文件互相覆盖
/// </summary>
[CollectionDefinition(Name)]
public sealed class TestPrinterCollection
{
    public const string Name = "测试打印机";
}
