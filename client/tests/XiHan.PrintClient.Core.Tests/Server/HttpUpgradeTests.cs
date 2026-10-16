// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests.Server;

public sealed class HttpUpgradeTests
{
    private const string Key = "dGhlIHNhbXBsZSBub25jZQ==";

    private static UpgradeRequest Request(Action<Dictionary<string, string>>? change = null, string method = "GET")
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Host"] = "127.0.0.1:17620",
            ["Upgrade"] = "websocket",
            ["Connection"] = "keep-alive, Upgrade",
            ["Sec-WebSocket-Version"] = "13",
            ["Sec-WebSocket-Key"] = Key,
            ["Origin"] = "https://erp.example.com",
            ["Sec-WebSocket-Protocol"] = "xihan-print.v1, xihan-print",
        };
        change?.Invoke(headers);
        return new UpgradeRequest(method, "/", headers);
    }

    [Fact]
    public void AcceptsAWellFormedRequestAndComputesTheAcceptKey()
    {
        var decision = HttpUpgrade.Evaluate(Request(), 17620);

        Assert.True(decision.Accepted);
        Assert.Equal(("https://erp.example.com", "xihan-print.v1", false), (decision.Origin, decision.SubProtocol, decision.VersionMismatch));
        Assert.Equal("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", decision.AcceptKey);
        Assert.Contains("Sec-WebSocket-Protocol: xihan-print.v1\r\n", Encoding.ASCII.GetString(HttpUpgrade.AcceptResponse(decision)));
    }

    [Fact]
    public void AcceptsLocalhostAsHost()
    {
        Assert.True(HttpUpgrade.Evaluate(Request(headers => headers["Host"] = "LOCALHOST:17620"), 17620).Accepted);
    }

    [Fact]
    public void SelectsTheUnversionedSubProtocolToReportAVersionMismatch()
    {
        var decision = HttpUpgrade.Evaluate(Request(headers => headers["Sec-WebSocket-Protocol"] = "xihan-print.v9, xihan-print"), 17620);

        Assert.Equal(("xihan-print", true), (decision.SubProtocol, decision.VersionMismatch));
    }

    [Theory]
    [InlineData("Host", "evil.example.com:17620", 403)]
    [InlineData("Host", "127.0.0.1:17621", 403)]
    [InlineData("Origin", null, 403)]
    [InlineData("Origin", "null", 403)]
    [InlineData("Origin", "file://", 403)]
    [InlineData("Origin", "chrome-extension://abc", 403)]
    [InlineData("Upgrade", "h2c", 400)]
    [InlineData("Sec-WebSocket-Version", "8", 426)]
    [InlineData("Sec-WebSocket-Key", "short", 400)]
    [InlineData("Sec-WebSocket-Protocol", "chat", 400)]
    [InlineData("Sec-WebSocket-Protocol", null, 400)]
    public void RejectsRequestsThatBreakTheRules(string header, string? value, int status)
    {
        var decision = HttpUpgrade.Evaluate(Request(headers =>
        {
            if (value is null)
                headers.Remove(header);
            else
                headers[header] = value;
        }), 17620);

        Assert.False(decision.Accepted);
        Assert.Equal(status, decision.Status);
        Assert.StartsWith($"HTTP/1.1 {status} ", Encoding.ASCII.GetString(HttpUpgrade.RejectResponse(status)));
    }

    [Fact]
    public void RejectsMethodsOtherThanGet()
    {
        Assert.Equal(405, HttpUpgrade.Evaluate(Request(method: "POST"), 17620).Status);
    }

    [Fact]
    public void ParsesTheRequestLineAndCaseInsensitiveHeaders()
    {
        var request = HttpUpgrade.Parse(Encoding.ASCII.GetBytes("GET / HTTP/1.1\r\nhost: 127.0.0.1:1\r\nX-A: 1\r\nX-A: 2\r\n\r\n"))!;

        Assert.Equal(("GET", "/", "127.0.0.1:1", "1, 2"), (request.Method, request.Target, request.Header("Host"), request.Header("x-a")));
        Assert.Null(HttpUpgrade.Parse(Encoding.ASCII.GetBytes("garbage\r\n\r\n")));
    }

    [Theory]
    [InlineData("https://erp.example.com", "https://erp.example.com")]
    [InlineData("HTTPS://ERP.Example.com", "https://erp.example.com")]
    [InlineData("http://localhost:5173", "http://localhost:5173")]
    [InlineData("https://erp.example.com:443", "https://erp.example.com")]
    public void NormalizesOrigins(string value, string expected)
    {
        Assert.True(OriginName.TryNormalize(value, out var origin));
        Assert.Equal(expected, origin);
    }

    [Theory]
    [InlineData("https://erp.example.com/")]
    [InlineData("https://erp.example.com/app")]
    [InlineData("https://user@erp.example.com")]
    [InlineData("ws://erp.example.com")]
    [InlineData("")]
    public void RejectsOriginsThatAreNotPlainSchemeHostPort(string value)
    {
        Assert.False(OriginName.TryNormalize(value, out _));
    }
}
