// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.IO.Compression;
using XiHan.PrintClient.Core.Consent;
using XiHan.PrintClient.Core.Diagnostics;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Tests;

public sealed class DiagnosticsTests : IDisposable
{
    private static readonly ClientInfo Client = new() { Version = "0.1.0", Os = "windows", Arch = "x64", Renderer = "155.0.4283.45" };
    private static readonly DateTimeOffset At = new(2026, 10, 16, 8, 30, 0, TimeSpan.Zero);
    private readonly string _directory = Directory.CreateTempSubdirectory("xihan-print-diagnostics-").FullName;

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private static DiagnosticsInput Input(int? port = 17620) => new()
    {
        Client = Client,
        Port = port,
        Policy = new ClientPolicy { AllowedOrigins = ["https://erp.example.com"], PromptForUnknownOrigins = false, Ports = [17630] },
        PolicyFileExists = true,
        Allowed = ["http://localhost:5173"],
        RecentJobs =
        [
            new JobRecord("j2", "https://erp.example.com", JobKind.Raw, "Label", JobState.Failed, PrintErrorCodes.SpoolFailed, null, null, At.AddSeconds(5), At.AddSeconds(6)),
            new JobRecord("j1", "https://erp.example.com", JobKind.Html, "Office", JobState.Completed, null, 3, null, At, At.AddSeconds(1.5)),
            new JobRecord("j0", "http://localhost:5173", JobKind.Pdf, null, JobState.Started, null, null, null, At, null),
        ],
    };

    [Fact]
    public void DescribesTheClientPolicyOriginsAndRecentJobs()
    {
        var text = DiagnosticsReport.Format(Input(), TimeZoneInfo.Utc);

        Assert.Contains("曦寒打印客户端 0.1.0", text);
        Assert.Contains("渲染：WebView2 155.0.4283.45", text);
        Assert.Contains("监听：127.0.0.1:17620", text);
        Assert.Contains("未授权来源弹窗询问：否", text);
        Assert.Contains("端口：17630", text);
        Assert.Contains("  https://erp.example.com（策略）", text);
        Assert.Contains("  http://localhost:5173", text);
        Assert.Contains("拒绝的来源：" + Environment.NewLine + "  （无）", text);
        Assert.Contains("2026-10-16 08:30:05  raw  Label  failed SPOOL_FAILED  -  1.0 秒  https://erp.example.com  j2", text);
        Assert.Contains("2026-10-16 08:30:00  html  Office  completed  3 页  1.5 秒  https://erp.example.com  j1", text);
        Assert.Contains("pdf  -  started  -  进行中  http://localhost:5173  j0", text);
    }

    [Fact]
    public void SaysWhenTheRendererOrPortIsMissing()
    {
        var input = Input(port: null);
        var text = DiagnosticsReport.Format(new DiagnosticsInput { Client = new ClientInfo { Version = "0.1.0", Os = "windows", Arch = "arm64" }, Policy = input.Policy }, TimeZoneInfo.Utc);

        Assert.Contains("没有 WebView2 运行时", text);
        Assert.Contains("未在监听", text);
        Assert.Contains("策略：没有 policy.json", text);
    }

    [Theory]
    [InlineData("""{"sessionToken":"abc123def456"}""", """{"sessionToken":"***"}""")]
    [InlineData("hello resume=QWERTY12 done", "hello resume=*** done")]
    [InlineData("Token: s3cr3t-value", "Token: ***")]
    [InlineData("受理任务 j1：Html Office", "受理任务 j1：Html Office")]
    public void MasksTokenLikeValues(string text, string masked)
    {
        Assert.Equal(masked, DiagnosticsReport.Mask(text));
    }

    [Fact]
    public void PacksLogsSettingsAndPolicyIntoOneZip()
    {
        var logs = Directory.CreateDirectory(Path.Combine(_directory, "logs")).FullName;
        File.WriteAllText(Path.Combine(logs, "print-client-20261016.log"), "2026-10-16 [INF] token=abcdef123");
        var settings = Path.Combine(_directory, "settings.json");
        File.WriteAllText(settings, """{ "logLevel": "debug" }""");
        var policy = Path.Combine(_directory, "policy.json");
        File.WriteAllText(policy, """{ "promptForUnknownOrigins": false }""");
        var zipPath = Path.Combine(_directory, "diagnostics.zip");

        using (var open = new FileStream(Path.Combine(logs, "print-client-20261016.log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
            DiagnosticsReport.Export(zipPath, "报告", logs, [settings, Path.Combine(_directory, "origins.json")], policy);

        using var zip = ZipFile.OpenRead(zipPath);
        Assert.Equal(["diagnostics.txt", "logs/print-client-20261016.log", "policy.json", "settings/settings.json"], zip.Entries.Select(entry => entry.FullName).Order(StringComparer.Ordinal));
        using var reader = new StreamReader(zip.GetEntry("logs/print-client-20261016.log")!.Open());
        Assert.Equal("2026-10-16 [INF] token=***", reader.ReadToEnd());
    }

    [Fact]
    public void BuildsASelfTestPageOnPaperThePrinterHas()
    {
        PrinterInfo Printer(params PaperInfo[] papers) => new() { Name = "P", Capabilities = new PrinterCapabilities { Papers = papers } };

        Assert.Equal((210, 297), SelfTestDocument.PaperFor(Printer(new PaperInfo(1, "Letter", 215.9, 279.4), new PaperInfo(9, "A4", 210, 297))));
        Assert.Equal((100, 50), SelfTestDocument.PaperFor(Printer(new PaperInfo(256, "标签", 100, 50))));
        Assert.Equal((100, 150), SelfTestDocument.PaperFor(Printer()));

        var document = SelfTestDocument.Create(Client, "<b>Label</b>", 100, 50, At);
        Assert.Equal([new SheetGroup(100, 50, 1)], document.Sheets);
        Assert.Contains("size: 100mm 50mm", document.Html);
        Assert.Contains("&lt;b&gt;Label&lt;/b&gt;", document.Html);
        Assert.DoesNotContain("<b>Label", document.Html);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(document.Html, "<div data-part=\"sheet\""));
    }
}
