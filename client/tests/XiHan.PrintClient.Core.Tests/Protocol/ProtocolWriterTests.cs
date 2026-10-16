// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Tests.Protocol;

public sealed class ProtocolWriterTests
{
    private static JsonNode Parse(byte[] message) => JsonNode.Parse(Encoding.UTF8.GetString(message))!;

    [Fact]
    public void WritesResultEnvelopeWithCamelCaseDataAndNoNulls()
    {
        var message = Parse(ProtocolWriter.Printer("r-1", new PrinterInfo { Name = "Kitchen", IsDefault = true, Status = PrinterState.PaperOut }));

        Assert.Equal("result", message["type"]!.GetValue<string>());
        Assert.Equal("r-1", message["id"]!.GetValue<string>());
        Assert.True(message["ok"]!.GetValue<bool>());
        Assert.Equal("paperOut", message["data"]!["status"]!.GetValue<string>());
        Assert.True(message["data"]!["isDefault"]!.GetValue<bool>());
        Assert.False(message["data"]!.AsObject().ContainsKey("location"));
    }

    [Fact]
    public void WritesErrorWithDetailsAndWithoutIdWhenUnknown()
    {
        var message = Parse(ProtocolWriter.Error(null, new ProtocolError(PrintErrorCodes.PrinterNotFound, "没有这台打印机", new JsonObject { ["printer"] = "X" })));

        Assert.False(message.AsObject().ContainsKey("id"));
        Assert.False(message["ok"]!.GetValue<bool>());
        Assert.Equal("PRINTER_NOT_FOUND", message["error"]!["code"]!.GetValue<string>());
        Assert.Equal("X", message["error"]!["details"]!["printer"]!.GetValue<string>());
    }

    [Fact]
    public void WritesJobEventsNamedAfterTheirState()
    {
        var at = new DateTimeOffset(2026, 10, 16, 12, 0, 0, TimeSpan.FromHours(8));

        var queued = Parse(ProtocolWriter.JobEvent(new JobStatus { JobId = "j", State = JobState.Queued, Position = 2 }, at));
        var failed = Parse(ProtocolWriter.JobEvent(new JobStatus { JobId = "j", State = JobState.Failed, Error = new ProtocolError(PrintErrorCodes.SpoolFailed, "x") }, at));

        Assert.Equal(("job.queued", 2), (queued["type"]!.GetValue<string>(), queued["position"]!.GetValue<int>()));
        Assert.Equal("2026-10-16T04:00:00Z", queued["at"]!.GetValue<string>());
        Assert.Equal(("job.failed", "SPOOL_FAILED"), (failed["type"]!.GetValue<string>(), failed["error"]!["code"]!.GetValue<string>()));
    }

    [Fact]
    public void WritesWelcomeWithProtocolVersionAndCapabilities()
    {
        var welcome = new WelcomeData
        {
            Client = new ClientInfo { Version = "1.0.0", Os = "windows", Arch = "x64", Renderer = "155.0" },
            SessionToken = "t",
            Capabilities = new ClientCapabilities { Html = true, Raw = true, Pdf = true, Duplex = true, PrinterStatus = true },
            Resumed = ["j1"],
        };

        var data = Parse(ProtocolWriter.Welcome("h", welcome))["data"]!;

        Assert.Equal((1, 0), (data["protocol"]!.GetValue<int>(), data["minor"]!.GetValue<int>()));
        Assert.True(data["capabilities"]!["printerStatus"]!.GetValue<bool>());
        Assert.Equal("j1", data["resumed"]![0]!.GetValue<string>());
    }

    [Fact]
    public void WritesPongConsentPendingAndOutputHeader()
    {
        Assert.Equal("pong", Parse(ProtocolWriter.Pong("p"))["type"]!.GetValue<string>());
        Assert.Equal("https://erp.example.com", Parse(ProtocolWriter.ConsentPending("https://erp.example.com"))["origin"]!.GetValue<string>());
        var output = Parse(ProtocolWriter.JobOutput("j", "application/pdf", 42));
        Assert.Equal(("job.output", 42), (output["type"]!.GetValue<string>(), output["bytes"]!.GetValue<int>()));
    }
}
