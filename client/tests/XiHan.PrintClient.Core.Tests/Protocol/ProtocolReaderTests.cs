// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Tests.Protocol;

public sealed class ProtocolReaderTests
{
    private static ReadResult Read(string json) => ProtocolReader.Read(Encoding.UTF8.GetBytes(json));

    private static string Base64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));

    [Fact]
    public void ReadsHelloWithSdkAndResumeToken()
    {
        var result = Read("""{"type":"hello","id":"h-1","protocol":1,"minor":2,"sdk":{"name":"@xihan-print/runtime","version":"1.0.0"},"resume":"abc","extra":true}""");

        var hello = Assert.IsType<HelloRequest>(result.Request);
        Assert.Equal(("h-1", 1, 2, "abc"), (hello.Id, hello.Protocol, hello.Minor, hello.Resume));
        Assert.Equal("@xihan-print/runtime", hello.Sdk!.Name);
        Assert.Null(result.Error);
    }

    [Fact]
    public void ReadsPrintHtmlWithDecodedResourcesAndDefaults()
    {
        var json = $$$"""
            {"type":"print.html","id":"r-2","jobId":"job_1","printer":"Kitchen",
             "document":{"html":"<p>hi</p>","resources":[{"id":"0","type":"font/woff2","data":"{{{Base64("font")}}}"}],
                         "sheets":[{"widthMm":210,"heightMm":297,"count":2},{"widthMm":148,"heightMm":210,"count":1}]},
             "options":{"copies":2,"duplex":"long-edge","pageRanges":"1-2,3"}}
            """;

        var request = Assert.IsType<PrintHtmlRequest>(Read(json).Request);

        Assert.Equal(("job_1", "Kitchen", 3), (request.JobId, request.Printer, request.Document.SheetCount));
        Assert.Equal("font", Encoding.UTF8.GetString(request.Document.Resources[0].Data));
        Assert.Equal((2, DuplexMode.LongEdge, ColorMode.Color, true, false), (request.Options.Copies, request.Options.Duplex, request.Options.Color, request.Options.Collate, request.Options.Dialog));
    }

    [Fact]
    public void ReadsRawDataAsBytes()
    {
        var request = Assert.IsType<PrintRawRequest>(Read($$$"""{"type":"print.raw","id":"r","jobId":"j","printer":"Label","data":"{{{Base64("^XA^XZ")}}}"}""").Request);

        Assert.Equal("^XA^XZ", Encoding.ASCII.GetString(request.Data));
    }

    [Theory]
    [InlineData("not json", null, null)]
    [InlineData("[]", null, null)]
    [InlineData("""{"id":"r"}""", "r", "type")]
    [InlineData("""{"type":"ping"}""", null, "id")]
    [InlineData("""{"type":"ping","id":"has space"}""", "has space", "id")]
    [InlineData("""{"type":"teleport","id":"r"}""", "r", "type")]
    [InlineData("""{"type":"job.get","id":"r","jobId":"../x"}""", "r", "jobId")]
    [InlineData("""{"type":"print.raw","id":"r","jobId":"j","printer":"P","data":"%%%"}""", "r", "data")]
    [InlineData("""{"type":"print.raw","id":"r","jobId":"j","printer":"P","data":""}""", "r", "data")]
    [InlineData("""{"type":"print.html","id":"r","jobId":"j","document":{"html":"x","sheets":[]}}""", "r", "document.sheets")]
    [InlineData("""{"type":"print.html","id":"r","jobId":"j","document":{"html":"x","sheets":[{"widthMm":0,"heightMm":297,"count":1}]}}""", "r", "widthMm")]
    [InlineData("""{"type":"print.html","id":"r","jobId":"j","document":{"html":"x","sheets":[{"widthMm":210,"heightMm":297,"count":1}]},"options":{"copies":1000}}""", "r", "copies")]
    [InlineData("""{"type":"print.html","id":"r","jobId":"j","document":{"html":"x","sheets":[{"widthMm":210,"heightMm":297,"count":1}]},"options":{"duplex":"both"}}""", "r", "options.duplex")]
    [InlineData("""{"type":"print.html","id":"r","jobId":"j","document":{"html":"x","sheets":[{"widthMm":210,"heightMm":297,"count":1}]},"options":{"pageRanges":"1-"}}""", "r", "options.pageRanges")]
    public void RejectsMalformedRequestsAsBadRequest(string json, string? id, string? field)
    {
        var result = Read(json);

        Assert.Null(result.Request);
        Assert.Equal(id, result.Id);
        Assert.Equal(PrintErrorCodes.BadRequest, result.Error!.Code);
        Assert.Equal(field, result.Error.Details?["field"]?.GetValue<string>());
    }

    [Fact]
    public void RejectsDuplicateResourceIds()
    {
        var json = $$$"""{"type":"export.pdf","id":"r","jobId":"j","document":{"html":"x","resources":[{"id":"a","type":"t","data":""},{"id":"a","type":"t","data":""}],"sheets":[{"widthMm":1,"heightMm":1,"count":1}]}}""";

        Assert.Equal("document.resources.id", Read(json).Error!.Details!["field"]!.GetValue<string>());
    }

    [Fact]
    public void ReportsOversizedResourcesAsDocumentTooLarge()
    {
        var chunk = Convert.ToBase64String(new byte[513]);
        var json = $$$"""{"type":"export.pdf","id":"r","jobId":"j","document":{"html":"x","resources":[{"id":"a","type":"t","data":"{{{chunk}}}"},{"id":"b","type":"t","data":"{{{chunk}}}"}],"sheets":[{"widthMm":1,"heightMm":1,"count":1}]}}""";

        Assert.Equal(PrintErrorCodes.DocumentTooLarge, ProtocolReader.Read(Encoding.UTF8.GetBytes(json), maxResourceBytes: 1024).Error!.Code);
        Assert.Null(ProtocolReader.Read(Encoding.UTF8.GetBytes(json), maxResourceBytes: 1026).Error);
    }
}
