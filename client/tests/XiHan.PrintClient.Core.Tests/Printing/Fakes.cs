// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests.Printing;

/// <summary>
/// 一个会话与它当前连接的浏览器一端：收下客户端发来的每条消息
/// </summary>
internal sealed class TestPeer : IAsyncDisposable
{
    private readonly List<IDisposable> _resources = [];
    private Channel<(WebSocketMessageType Type, byte[] Data)> _messages = Channel.CreateUnbounded<(WebSocketMessageType, byte[])>();
    private WebSocketConnection? _connection;

    private TestPeer(string origin)
    {
        Session = new ClientSession(Guid.NewGuid().ToString("N"), origin, Guid.NewGuid().ToString("N"));
    }

    public ClientSession Session { get; }

    public static CancellationToken Timeout => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;

    public static async Task<TestPeer> OpenAsync(string origin = "https://erp.example.com")
    {
        var peer = new TestPeer(origin);
        await peer.AttachAsync();
        return peer;
    }

    /// <summary>
    /// 换一条新连接挂到同一会话上
    /// </summary>
    public async Task AttachAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var client = new TcpClient();
        var connecting = client.ConnectAsync(IPAddress.Loopback, ((IPEndPoint)listener.LocalEndpoint).Port);
        var server = await listener.AcceptTcpClientAsync(Timeout);
        await connecting;
        listener.Stop();
        _resources.Add(client);
        _resources.Add(server);

        var browser = WebSocket.CreateFromStream(client.GetStream(), new WebSocketCreationOptions());
        _connection = new WebSocketConnection(WebSocket.CreateFromStream(server.GetStream(), new WebSocketCreationOptions { IsServer = true }), ClientDefaults.MaxMessageBytes);
        _messages = Channel.CreateUnbounded<(WebSocketMessageType, byte[])>();
        _ = PumpAsync(browser, _messages.Writer);
        Session.Attach(_connection);
    }

    /// <summary>
    /// 断开当前连接，之后发给会话的消息都被丢弃
    /// </summary>
    public void Detach() => Session.Detach(_connection!, DateTimeOffset.UtcNow);

    public async Task<JsonNode> NextAsync()
    {
        var (type, data) = await _messages.Reader.ReadAsync(Timeout);
        Assert.Equal(WebSocketMessageType.Text, type);
        return JsonNode.Parse(data)!;
    }

    public async Task<byte[]> NextBinaryAsync()
    {
        var (type, data) = await _messages.Reader.ReadAsync(Timeout);
        Assert.Equal(WebSocketMessageType.Binary, type);
        return data;
    }

    /// <summary>
    /// 收下一条消息并核对类型，返回整条消息
    /// </summary>
    public async Task<JsonNode> ExpectAsync(string type)
    {
        var message = await NextAsync();
        Assert.Equal(type, (string?)message["type"]);
        return message;
    }

    /// <summary>
    /// 收下一条响应并核对是否成功
    /// </summary>
    public async Task<JsonNode> ResultAsync(string id, bool ok = true)
    {
        var message = await ExpectAsync("result");
        Assert.Equal(id, (string?)message["id"]);
        Assert.Equal(ok, (bool?)message["ok"]);
        return message;
    }

    /// <summary>
    /// 收下一条错误响应，返回错误码
    /// </summary>
    public async Task<JsonNode> ErrorAsync(string id, string code)
    {
        var error = (await ResultAsync(id, ok: false))["error"]!;
        Assert.Equal(code, (string?)error["code"]);
        return error;
    }

    /// <summary>
    /// 一段时间内没有更多消息
    /// </summary>
    public async Task QuietAsync()
    {
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.False(_messages.Reader.TryRead(out _));
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null)
            await _connection.DisposeAsync();
        foreach (var resource in _resources)
            resource.Dispose();
    }

    private static async Task PumpAsync(WebSocket socket, ChannelWriter<(WebSocketMessageType, byte[])> writer)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            using var stream = new MemoryStream();
            while (true)
            {
                var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close)
                    break;
                stream.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage)
                    continue;
                writer.TryWrite((result.MessageType, stream.ToArray()));
                stream.SetLength(0);
            }
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or IOException)
        {
        }
        writer.TryComplete();
    }
}

internal sealed class FakeCatalog : IPrinterCatalog
{
    public List<PrinterInfo> Printers { get; } = [];

    public string? Default { get; set; }

    public IReadOnlyList<PrinterInfo> List() => Printers;

    public PrinterInfo? Get(string name)
    {
        var printer = Printers.FirstOrDefault(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase));
        return printer is null ? null : new PrinterInfo { Name = printer.Name, IsDefault = printer.IsDefault, Status = printer.Status, Capabilities = new PrinterCapabilities { MaxCopies = 99 } };
    }

    public string? DefaultPrinterName() => Default;
}

/// <summary>
/// 按任务决定行为的后端：缺省立即成功；Hold 里登记的任务一直执行到放行或被取消
/// </summary>
internal sealed class FakeBackend : IHtmlPrintEngine, IRawPrinter
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource> _holds = new();

    public string? Version => "test";

    public ConcurrentQueue<string> Calls { get; } = new();

    public Func<string, Exception?> Fail { get; set; } = _ => null;

    public byte[] Pdf { get; set; } = [0x25, 0x50, 0x44, 0x46];

    public TaskCompletionSource Hold(string printerOrPdf)
    {
        return _holds.GetOrAdd(printerOrPdf, _ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
    }

    public async Task<int> PrintAsync(PrintDocument document, string printer, PrintOptions options, CancellationToken cancellationToken)
    {
        await RunAsync("html:" + printer, printer, cancellationToken);
        return document.SheetCount;
    }

    public async Task<byte[]> ExportPdfAsync(PrintDocument document, PrintOptions options, CancellationToken cancellationToken)
    {
        await RunAsync("pdf", "pdf", cancellationToken);
        return Pdf;
    }

    public async Task<long> WriteAsync(string printer, byte[] data, string documentName, CancellationToken cancellationToken)
    {
        await RunAsync($"raw:{printer}:{documentName}", printer, cancellationToken);
        return data.Length;
    }

    private async Task RunAsync(string call, string key, CancellationToken cancellationToken)
    {
        Calls.Enqueue(call);
        if (_holds.TryRemove(key, out var hold))
            await hold.Task.WaitAsync(cancellationToken);
        if (Fail(key) is { } error)
            throw error;
    }
}
