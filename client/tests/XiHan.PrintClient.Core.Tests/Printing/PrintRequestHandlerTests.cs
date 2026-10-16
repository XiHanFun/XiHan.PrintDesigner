// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Tests.Printing;

public sealed class PrintRequestHandlerTests : IAsyncLifetime
{
    private static readonly PrintDocument Document = new("<!doctype html><p>送货单</p>", [], [new SheetGroup(210, 297, 2), new SheetGroup(297, 210, 1)]);
    private readonly FakeCatalog _catalog = new();
    private readonly FakeBackend _backend = new();
    private readonly List<TestPeer> _peers = [];
    private JobQueue _queue = null!;
    private PrintRequestHandler _handler = null!;

    public ValueTask InitializeAsync()
    {
        _catalog.Printers.Add(new PrinterInfo { Name = "Office", IsDefault = true, Status = PrinterState.Ready });
        _catalog.Printers.Add(new PrinterInfo { Name = "Label", Status = PrinterState.Ready });
        _catalog.Default = "Office";
        Create();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        await _queue.DisposeAsync();
        foreach (var peer in _peers)
            await peer.DisposeAsync();
    }

    private void Create(JobQueueOptions? options = null, ClientCapabilities? capabilities = null, bool raw = true)
    {
        _queue = new JobQueue(_backend, raw ? _backend : null, options);
        _handler = new PrintRequestHandler(_catalog, _queue, capabilities ?? new ClientCapabilities { Html = true, Raw = true, Pdf = true, Duplex = true, PrinterStatus = true });
    }

    private async Task<TestPeer> PeerAsync(string origin = "https://erp.example.com")
    {
        var peer = await TestPeer.OpenAsync(origin);
        _peers.Add(peer);
        return peer;
    }

    private Task SendAsync(TestPeer peer, ClientRequest request) => _handler.HandleAsync(peer.Session, request, TestPeer.Timeout);

    private static PrintHtmlRequest Html(string jobId, string? printer = null, PrintOptions? options = null) => new("r-" + jobId, jobId, Document, printer, options ?? new PrintOptions());

    /// <summary>
    /// 收下受理响应与 queued 事件，返回排队位置
    /// </summary>
    private static async Task<int> AcceptedAsync(TestPeer peer, string jobId)
    {
        var data = (await peer.ResultAsync("r-" + jobId))["data"]!;
        Assert.Equal(jobId, (string?)data["jobId"]);
        var queued = await peer.ExpectAsync("job.queued");
        Assert.Equal(jobId, (string?)queued["jobId"]);
        Assert.Equal((int?)data["position"], (int?)queued["position"]);
        return (int)data["position"]!;
    }

    private static async Task<JsonNode> EventAsync(TestPeer peer, string type, string jobId)
    {
        var message = await peer.ExpectAsync(type);
        Assert.Equal(jobId, (string?)message["jobId"]);
        return message;
    }

    [Fact]
    public async Task ListsPrintersAndReportsMissingOnes()
    {
        var peer = await PeerAsync();

        await SendAsync(peer, new ListPrintersRequest("l"));
        var list = (await peer.ResultAsync("l"))["data"]!.AsArray();
        Assert.Equal(["Office", "Label"], list.Select(item => (string?)item!["name"]));

        await SendAsync(peer, new GetPrinterRequest("g", "label"));
        Assert.Equal(99, (int?)(await peer.ResultAsync("g"))["data"]!["capabilities"]!["maxCopies"]);

        await SendAsync(peer, new GetPrinterRequest("m", "Missing"));
        Assert.Equal("Missing", (string?)(await peer.ErrorAsync("m", PrintErrorCodes.PrinterNotFound))["details"]!["printer"]);
    }

    [Fact]
    public async Task PrintsOnTheDefaultPrinterAndReportsEachState()
    {
        var peer = await PeerAsync();

        await SendAsync(peer, Html("j1"));

        Assert.Equal(0, await AcceptedAsync(peer, "j1"));
        await EventAsync(peer, "job.started", "j1");
        var completed = await EventAsync(peer, "job.completed", "j1");
        Assert.Equal(3, (int?)completed["sheets"]);
        Assert.NotNull((string?)completed["at"]);
        Assert.Equal(["html:Office"], _backend.Calls);

        await SendAsync(peer, new GetJobRequest("s", "j1"));
        var status = (await peer.ResultAsync("s"))["data"]!;
        Assert.Equal("completed", (string?)status["state"]);
        Assert.Null(status["position"]);
    }

    [Fact]
    public async Task RunsJobsOnOnePrinterInOrderWithoutBlockingOtherPrinters()
    {
        var peer = await PeerAsync();
        var hold = _backend.Hold("Office");

        await SendAsync(peer, Html("a1"));
        Assert.Equal(0, await AcceptedAsync(peer, "a1"));
        await EventAsync(peer, "job.started", "a1");
        await SendAsync(peer, Html("a2", "office"));
        Assert.Equal(1, await AcceptedAsync(peer, "a2"));

        await SendAsync(peer, new PrintRawRequest("r-b1", "b1", "Label", [1, 2, 3], "发货标签"));
        Assert.Equal(0, await AcceptedAsync(peer, "b1"));
        await EventAsync(peer, "job.started", "b1");
        Assert.Equal(3, (long?)(await EventAsync(peer, "job.completed", "b1"))["bytes"]);

        await SendAsync(peer, new GetJobRequest("s", "a2"));
        Assert.Equal(1, (int?)(await peer.ResultAsync("s"))["data"]!["position"]);

        hold.SetResult();
        await EventAsync(peer, "job.completed", "a1");
        await EventAsync(peer, "job.started", "a2");
        await EventAsync(peer, "job.completed", "a2");
        Assert.Equal(["html:Office", "raw:Label:发货标签", "html:Office"], _backend.Calls);
    }

    [Fact]
    public async Task CancelsQueuedJobsAtOnceAndRunningJobsBestEffort()
    {
        var peer = await PeerAsync();
        _backend.Hold("Office");
        await SendAsync(peer, Html("a1"));
        await AcceptedAsync(peer, "a1");
        await EventAsync(peer, "job.started", "a1");
        await SendAsync(peer, Html("a2"));
        await AcceptedAsync(peer, "a2");

        await SendAsync(peer, new CancelJobRequest("c2", "a2"));
        await EventAsync(peer, "job.cancelled", "a2");
        Assert.True((bool?)(await peer.ResultAsync("c2"))["data"]!["cancelled"]);

        await SendAsync(peer, new CancelJobRequest("c1", "a1"));
        var replies = new[] { await peer.NextAsync(), await peer.NextAsync() }.ToDictionary(item => (string)item["type"]!);
        Assert.False((bool?)replies["result"]["data"]!["cancelled"]);
        Assert.Equal("a1", (string?)replies["job.cancelled"]["jobId"]);

        await SendAsync(peer, new CancelJobRequest("c3", "missing"));
        await peer.ErrorAsync("c3", PrintErrorCodes.JobNotFound);
        await peer.QuietAsync();
        Assert.Equal(["html:Office"], _backend.Calls);
    }

    [Fact]
    public async Task FailsJobsThatOutliveTheirTimeout()
    {
        var peer = await PeerAsync();
        _backend.Hold("Office");

        await SendAsync(peer, Html("t1", options: new PrintOptions { TimeoutMs = 50 }));
        await AcceptedAsync(peer, "t1");
        await EventAsync(peer, "job.started", "t1");

        var error = (await EventAsync(peer, "job.failed", "t1"))["error"]!;
        Assert.Equal(PrintErrorCodes.SpoolFailed, (string?)error["code"]);
        Assert.True((bool?)error["details"]!["timeout"]);
    }

    [Fact]
    public async Task ReportsBackendFailuresAsJobErrors()
    {
        var peer = await PeerAsync();
        _backend.Fail = key => key == "Office"
            ? new PrintFailure(PrintErrorCodes.RenderFailed, "渲染失败", new JsonObject { ["sheet"] = 2 })
            : new InvalidOperationException("意外");

        await SendAsync(peer, Html("f1"));
        await AcceptedAsync(peer, "f1");
        await EventAsync(peer, "job.started", "f1");
        var rendered = (await EventAsync(peer, "job.failed", "f1"))["error"]!;
        Assert.Equal(PrintErrorCodes.RenderFailed, (string?)rendered["code"]);
        Assert.Equal(2, (int?)rendered["details"]!["sheet"]);

        await SendAsync(peer, Html("f2", "Label"));
        await AcceptedAsync(peer, "f2");
        await EventAsync(peer, "job.started", "f2");
        Assert.Equal(PrintErrorCodes.Internal, (string?)(await EventAsync(peer, "job.failed", "f2"))["error"]!["code"]);
    }

    [Fact]
    public async Task RejectsPageRangesThatSelectNothing()
    {
        var peer = await PeerAsync();

        await SendAsync(peer, Html("g1", options: new PrintOptions { PageRanges = "4-9" }));
        Assert.Equal("options.pageRanges", (string?)(await peer.ErrorAsync("r-g1", PrintErrorCodes.BadRequest))["details"]!["field"]);
        await SendAsync(peer, new ExportPdfRequest("r-g2", "g2", Document, new PrintOptions { PageRanges = "4" }));
        await peer.ErrorAsync("r-g2", PrintErrorCodes.BadRequest);

        await peer.QuietAsync();
        Assert.Empty(_backend.Calls);
    }

    [Fact]
    public async Task CancelsTheJobWhenTheUserCancelsThePrintDialog()
    {
        var peer = await PeerAsync();
        _backend.Fail = _ => new PrintCancelledByUser();

        await SendAsync(peer, Html("u1", options: new PrintOptions { Dialog = true }));
        await AcceptedAsync(peer, "u1");
        await EventAsync(peer, "job.started", "u1");

        var cancelled = await EventAsync(peer, "job.cancelled", "u1");
        Assert.Null(cancelled["error"]);
    }

    [Fact]
    public async Task RejectsDuplicateJobIdsAndFullQueues()
    {
        Create(new JobQueueOptions { MaxActivePerSession = 2 });
        var peer = await PeerAsync();
        _backend.Hold("Office");
        await SendAsync(peer, Html("d1"));
        await AcceptedAsync(peer, "d1");
        await EventAsync(peer, "job.started", "d1");

        await SendAsync(peer, Html("d1"));
        await peer.ErrorAsync("r-d1", PrintErrorCodes.JobDuplicate);

        await SendAsync(peer, Html("d2"));
        await AcceptedAsync(peer, "d2");
        await SendAsync(peer, Html("d3"));
        await peer.ErrorAsync("r-d3", PrintErrorCodes.QueueFull);

        var other = await PeerAsync("https://wms.example.com");
        await SendAsync(other, Html("e1", "Label"));
        await AcceptedAsync(other, "e1");
    }

    [Fact]
    public async Task ChecksTheTargetPrinterBeforeQueueing()
    {
        var peer = await PeerAsync();
        _catalog.Printers.Add(new PrinterInfo { Name = "Paused", Status = PrinterState.Paused, StatusFlags = 1 });

        await SendAsync(peer, Html("p1", "Missing"));
        await peer.ErrorAsync("r-p1", PrintErrorCodes.PrinterNotFound);

        await SendAsync(peer, Html("p2", "paused"));
        var offline = (await peer.ErrorAsync("r-p2", PrintErrorCodes.PrinterOffline))["details"]!;
        Assert.Equal("Paused", (string?)offline["printer"]);
        Assert.Equal("paused", (string?)offline["status"]);
        Assert.Equal(1, (long?)offline["statusFlags"]);

        _catalog.Default = null;
        await SendAsync(peer, Html("p3"));
        await peer.ErrorAsync("r-p3", PrintErrorCodes.PrinterNotFound);

        _catalog.Printers.Clear();
        await SendAsync(peer, new PrintRawRequest("r-p4", "p4", "Label", [1], null));
        await peer.ErrorAsync("r-p4", PrintErrorCodes.NoPrinters);

        await peer.QuietAsync();
        Assert.Empty(_backend.Calls);
    }

    [Fact]
    public async Task RejectsCapabilitiesTheClientDoesNotHave()
    {
        Create(capabilities: new ClientCapabilities { Html = true }, raw: false);
        var peer = await PeerAsync();

        await SendAsync(peer, new PrintRawRequest("r-x1", "x1", "Label", [1], null));
        Assert.Equal("raw", (string?)(await peer.ErrorAsync("r-x1", PrintErrorCodes.CapabilityUnsupported))["details"]!["capability"]);

        await SendAsync(peer, new ExportPdfRequest("r-x2", "x2", Document, new PrintOptions()));
        Assert.Equal("pdf", (string?)(await peer.ErrorAsync("r-x2", PrintErrorCodes.CapabilityUnsupported))["details"]!["capability"]);

        await SendAsync(peer, Html("x3", options: new PrintOptions { Duplex = DuplexMode.LongEdge }));
        Assert.Equal("duplex", (string?)(await peer.ErrorAsync("r-x3", PrintErrorCodes.CapabilityUnsupported))["details"]!["capability"]);
    }

    [Fact]
    public async Task SendsTheExportedPdfAsAHeaderFollowedByABinaryMessage()
    {
        var peer = await PeerAsync();
        _backend.Pdf = [.. Enumerable.Range(0, 300_000).Select(index => (byte)index)];

        await SendAsync(peer, new ExportPdfRequest("r-x", "x", Document, new PrintOptions()));
        await AcceptedAsync(peer, "x");
        await EventAsync(peer, "job.started", "x");

        var output = await EventAsync(peer, "job.output", "x");
        Assert.Equal("application/pdf", (string?)output["mime"]);
        Assert.Equal(300_000, (long?)output["bytes"]);
        Assert.Equal(_backend.Pdf, await peer.NextBinaryAsync());
        Assert.Equal(300_000, (long?)(await EventAsync(peer, "job.completed", "x"))["bytes"]);
    }

    [Fact]
    public async Task FailsAnExportWhoseResultCannotBeDelivered()
    {
        var peer = await PeerAsync();
        var hold = _backend.Hold("pdf");
        await SendAsync(peer, new ExportPdfRequest("r-x", "x", Document, new PrintOptions()));
        await AcceptedAsync(peer, "x");
        await EventAsync(peer, "job.started", "x");

        peer.Detach();
        hold.SetResult();
        for (var attempt = 0; attempt < 250 && _handler.UnfinishedJobs(peer.Session).Count > 0; attempt++)
            await Task.Delay(20, TestContext.Current.CancellationToken);
        await peer.AttachAsync();

        await SendAsync(peer, new GetJobRequest("s", "x"));
        var status = (await peer.ResultAsync("s"))["data"]!;
        Assert.Equal("failed", (string?)status["state"]);
        Assert.Equal(PrintErrorCodes.PdfFailed, (string?)status["error"]!["code"]);
        Assert.False((bool?)status["error"]!["details"]!["delivered"]);
    }

    [Fact]
    public async Task ReplaysUnfinishedJobsAfterTheSessionResumes()
    {
        var peer = await PeerAsync();
        var hold = _backend.Hold("Office");
        await SendAsync(peer, Html("u1"));
        await AcceptedAsync(peer, "u1");
        await EventAsync(peer, "job.started", "u1");
        await SendAsync(peer, Html("u2"));
        await AcceptedAsync(peer, "u2");
        await SendAsync(peer, Html("u3", "Label"));
        await AcceptedAsync(peer, "u3");
        await EventAsync(peer, "job.started", "u3");
        await EventAsync(peer, "job.completed", "u3");

        peer.Detach();
        await peer.AttachAsync();
        Assert.Equal(["u1", "u2"], _handler.UnfinishedJobs(peer.Session).Order());

        await _handler.ReplayAsync(peer.Session, TestPeer.Timeout);
        var replayed = new[] { await peer.NextAsync(), await peer.NextAsync() }.ToDictionary(item => (string)item["jobId"]!);
        Assert.Equal("job.started", (string?)replayed["u1"]["type"]);
        Assert.Equal("job.queued", (string?)replayed["u2"]["type"]);
        Assert.Equal(1, (int?)replayed["u2"]["position"]);

        hold.SetResult();
        await EventAsync(peer, "job.completed", "u1");
    }

    [Fact]
    public async Task KeepsJobsPrivateToTheirSession()
    {
        var peer = await PeerAsync();
        var other = await PeerAsync("https://wms.example.com");
        _backend.Hold("Office");
        await SendAsync(peer, Html("k1"));
        await AcceptedAsync(peer, "k1");

        await SendAsync(other, new GetJobRequest("s", "k1"));
        await other.ErrorAsync("s", PrintErrorCodes.JobNotFound);
        await SendAsync(other, new CancelJobRequest("c", "k1"));
        await other.ErrorAsync("c", PrintErrorCodes.JobNotFound);
        Assert.Empty(_handler.UnfinishedJobs(other.Session));
    }

    [Fact]
    public async Task ForgetsFinishedJobsOfExpiredSessionsAndCapsTheHistory()
    {
        Create(new JobQueueOptions { MaxFinishedRetained = 2 });
        var peer = await PeerAsync();
        foreach (var id in new[] { "h1", "h2", "h3" })
        {
            await SendAsync(peer, Html(id));
            await AcceptedAsync(peer, id);
            await EventAsync(peer, "job.started", id);
            await EventAsync(peer, "job.completed", id);
        }

        await SendAsync(peer, new GetJobRequest("s1", "h1"));
        await peer.ErrorAsync("s1", PrintErrorCodes.JobNotFound);
        await SendAsync(peer, new GetJobRequest("s2", "h2"));
        await peer.ResultAsync("s2");

        _queue.Forget(peer.Session);
        await SendAsync(peer, new GetJobRequest("s3", "h3"));
        await peer.ErrorAsync("s3", PrintErrorCodes.JobNotFound);

        await SendAsync(peer, Html("h3"));
        await AcceptedAsync(peer, "h3");
    }
}
