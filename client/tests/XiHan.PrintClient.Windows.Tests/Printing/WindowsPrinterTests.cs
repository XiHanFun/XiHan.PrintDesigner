// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Windows.Printing;
using XiHan.PrintClient.Windows.Tests.Rendering;

namespace XiHan.PrintClient.Windows.Tests.Printing;

[Collection(TestPrinterCollection.Name)]
public sealed class WindowsPrinterTests
{
    /// <summary>
    /// 原始通道的测试打印机：通用文本驱动、端口指向文件，CI 里装好后经这两个环境变量告知
    /// </summary>
    private static readonly string? TestPrinter = Environment.GetEnvironmentVariable("XIHAN_PRINT_TEST_PRINTER");

    private static readonly string? TestOutput = Environment.GetEnvironmentVariable("XIHAN_PRINT_TEST_OUTPUT");

    private const string MissingPrinter = "XiHan 不存在的打印机 7f3a";

    [Theory]
    [InlineData(0x0u, 0x0u, PrinterState.Ready)]
    [InlineData(0x1000000u, 0x0u, PrinterState.Ready)]
    [InlineData(0x80u, 0x0u, PrinterState.Offline)]
    [InlineData(0x2000000u, 0x0u, PrinterState.Offline)]
    [InlineData(0x0u, 0x400u, PrinterState.Offline)]
    [InlineData(0x81u, 0x0u, PrinterState.Offline)]
    [InlineData(0x1u, 0x0u, PrinterState.Paused)]
    [InlineData(0xAu, 0x0u, PrinterState.PaperJam)]
    [InlineData(0x12u, 0x0u, PrinterState.PaperOut)]
    [InlineData(0x2u, 0x0u, PrinterState.Error)]
    [InlineData(0x400000u, 0x0u, PrinterState.Error)]
    [InlineData(0x402u, 0x0u, PrinterState.Error)]
    [InlineData(0x400u, 0x0u, PrinterState.Busy)]
    [InlineData(0x10000u, 0x0u, PrinterState.Busy)]
    [InlineData(0x800000u, 0x0u, PrinterState.Unknown)]
    public void MapsStatusBitsToOneState(uint status, uint attributes, PrinterState expected)
    {
        Assert.Equal(expected, WindowsPrinterCatalog.StateOf(status, attributes));
    }

    [Fact]
    public void ReadsPaperNamesFromFixedWidthSlots()
    {
        var names = new char[64 * 2];
        "A4".CopyTo(names);
        new string('长', 64).CopyTo(names.AsSpan(64));

        var papers = WindowsPrinterCatalog.PapersOf([9, 256], [2100, 2970, 1000, 1500], names);

        Assert.Equal([new PaperInfo(9, "A4", 210, 297), new PaperInfo(256, new string('长', 64), 100, 150)], papers);
        Assert.Single(WindowsPrinterCatalog.PapersOf([9, 256], [2100, 2970], names));
    }

    [Fact]
    public void ReadsThePaperTheDriverKeptFromTheMergedDevMode()
    {
        IReadOnlyList<PaperInfo> papers = [new PaperInfo(9, "A4", 210, 297), new PaperInfo(11, "A5", 148, 210)];

        Assert.Equal(new PaperFeed(100, 70, false), WindowsPrinterPapers.ResolvedOf(0x1 | 0x2 | 0x4 | 0x8, 1, 9, 1000, 700, papers));
        Assert.Equal(new PaperFeed(148, 210, true), WindowsPrinterPapers.ResolvedOf(0x1 | 0x2, 2, 11, 2100, 2970, papers));
        Assert.Equal(new PaperFeed(148, 210, false), WindowsPrinterPapers.ResolvedOf(0x2, 2, 11, 0, 0, papers));
        Assert.Equal(new PaperFeed(100, 70, false), WindowsPrinterPapers.ResolvedOf(0x2, 1, 256, 1000, 700, papers));
        Assert.Null(WindowsPrinterPapers.ResolvedOf(0x2, 1, 70, 0, 0, papers));
    }

    [Fact]
    public void AsksMicrosoftPrintToPdfWhichPapersItKeepsWithoutPrinting()
    {
        using var printer = new WindowsPrinterCatalog().Open("Microsoft Print to PDF");
        Assert.SkipWhen(printer is null, "这台机器上没有 Microsoft Print to PDF");

        Assert.Contains(printer.Papers, paper => paper.Id == 9);
        Assert.Equal(new PaperFeed(148, 210, false), printer.Resolve(new PaperFeed(148, 210, false)));
        Assert.Equal(new PaperFeed(210, 297, true), printer.Resolve(new PaperFeed(210, 297, true)));
        var label = printer.Resolve(new PaperFeed(100, 70, false));
        Assert.NotNull(label);
        Assert.False(Math.Abs(label.PageWidthMm - 100) <= 1 && Math.Abs(label.PageHeightMm - 70) <= 1);
    }

    [Fact]
    public void ListsLocalPrintersAndDescribesEachOne()
    {
        var catalog = new WindowsPrinterCatalog();
        var printers = catalog.List();
        var defaultName = catalog.DefaultPrinterName();

        Assert.All(printers, printer => Assert.Null(printer.Capabilities));
        Assert.True(printers.Count(printer => printer.IsDefault) == (defaultName is null ? 0 : 1));
        foreach (var listed in printers)
        {
            var printer = catalog.Get(listed.Name.ToUpperInvariant());
            Assert.NotNull(printer);
            Assert.Equal(listed.Name, printer.Name);
            Assert.Equal(listed.IsDefault, printer.IsDefault);
            Assert.Equal(listed.Driver, printer.Driver);
            Assert.NotNull(printer.Capabilities);
            Assert.True(printer.Capabilities.MaxCopies >= 1);
            Assert.All(printer.Capabilities.Papers, paper => Assert.True(paper.WidthMm > 0 && paper.HeightMm > 0 && paper.Name.Length > 0));
        }
        Assert.Null(catalog.Get(MissingPrinter));
    }

    [Fact]
    public async Task RejectsRawWritesToAMissingPrinter()
    {
        var failure = await Assert.ThrowsAsync<PrintFailure>(() => new WindowsRawPrinter().WriteAsync(MissingPrinter, [0x1B, 0x40], "测试", TestContext.Current.CancellationToken));

        Assert.Equal(PrintErrorCodes.PrinterNotFound, failure.Code);
        Assert.Equal(MissingPrinter, (string?)failure.Details!["printer"]);
    }

    [Fact]
    public void DescribesSpoolerFailuresWithTheCallAndWin32Code()
    {
        var failure = WindowsRawPrinter.Failure("StartDocPrinter", 1804);

        Assert.Equal(PrintErrorCodes.SpoolFailed, failure.Code);
        Assert.Equal("StartDocPrinter", (string?)failure.Details!["call"]);
        Assert.Equal(1804, (int?)failure.Details["win32Error"]);
    }

    [Fact]
    public async Task WritesRawBytesUnchangedToTheTestPrinter()
    {
        Assert.SkipWhen(TestPrinter is null || TestOutput is null, "没有配置原始通道的测试打印机（XIHAN_PRINT_TEST_PRINTER / XIHAN_PRINT_TEST_OUTPUT）");
        File.Delete(TestOutput!);
        var data = new byte[200_000];
        new Random(17).NextBytes(data);
        data[0] = 0x1B;
        data[1] = 0x40;

        var written = await new WindowsRawPrinter().WriteAsync(TestPrinter!, data, "曦寒打印测试", TestContext.Current.CancellationToken);

        Assert.Equal(data.Length, written);
        byte[]? output = null;
        for (var attempt = 0; attempt < 100 && output?.Length != data.Length; attempt++)
        {
            await Task.Delay(100, TestContext.Current.CancellationToken);
            try
            {
                output = File.Exists(TestOutput) ? await File.ReadAllBytesAsync(TestOutput!, TestContext.Current.CancellationToken) : null;
            }
            catch (IOException)
            {
            }
        }
        Assert.Equal(data, output);
    }
}
