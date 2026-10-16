// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests.Server;

public sealed class LoopbackServerTests : IAsyncLifetime
{
    private const string Origin = "https://erp.example.com";
    private readonly FakeAuthorizer _authorizer = new();
    private readonly FakeHandler _handler = new();
    private LoopbackServer _server = null!;

    private ServerOptions Options { get; set; } = new() { Ports = [0], IdleTimeout = TimeSpan.FromSeconds(30) };

    private static CancellationToken Timeout => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;

    public ValueTask InitializeAsync() => ValueTask.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        if (_server is not null)
            await _server.DisposeAsync();
    }

    private void Start()
    {
        _server = new LoopbackServer(Options, _authorizer, new FakeEnvironment(), _handler);
        _server.Start();
    }

    private async Task<ClientWebSocket> ConnectAsync(string? origin = Origin, params string[] protocols)
    {
        var socket = new ClientWebSocket();
        if (origin is not null)
            socket.Options.SetRequestHeader("Origin", origin);
        foreach (var protocol in protocols.Length > 0 ? protocols : [ClientDefaults.SubProtocol, HttpUpgrade.UnversionedSubProtocol])
            socket.Options.AddSubProtocol(protocol);
        await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{_server.Port}/"), Timeout);
        return socket;
    }

    private static Task SendAsync(ClientWebSocket socket, string json) => socket.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, Timeout);

    private static async Task<JsonNode?> ReceiveAsync(ClientWebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, Timeout);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;
            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
                return JsonNode.Parse(stream.ToArray());
        }
    }

    private static async Task<WebSocketCloseStatus?> ClosedWithAsync(ClientWebSocket socket)
    {
        while (await ReceiveAsync(socket) is not null)
        {
        }
        return socket.CloseStatus;
    }

    private async Task<(ClientWebSocket Socket, JsonNode Welcome)> HandshakeAsync(string? resume = null)
    {
        var socket = await ConnectAsync();
        var resumeField = resume is null ? string.Empty : $",\"resume\":\"{resume}\"";
        await SendAsync(socket, $$"""{"type":"hello","id":"h","protocol":1{{resumeField}}}""");
        return (socket, (await ReceiveAsync(socket))!);
    }

    [Fact]
    public async Task HandshakesThenAnswersPingsAndHandsBusinessRequestsToTheHandler()
    {
        Start();
        var (socket, welcome) = await HandshakeAsync();

        Assert.Equal(("result", "h", true), (welcome["type"]!.GetValue<string>(), welcome["id"]!.GetValue<string>(), welcome["ok"]!.GetValue<bool>()));
        Assert.Equal("windows", welcome["data"]!["client"]!["os"]!.GetValue<string>());
        Assert.NotEmpty(welcome["data"]!["sessionToken"]!.GetValue<string>());
        Assert.Equal(ClientDefaults.SubProtocol, socket.SubProtocol);

        await SendAsync(socket, """{"type":"ping","id":"p"}""");
        Assert.Equal("pong", (await ReceiveAsync(socket))!["type"]!.GetValue<string>());

        await SendAsync(socket, """{"type":"job.get","id":"g","jobId":"j1"}""");
        var reply = (await ReceiveAsync(socket))!;
        Assert.Equal(("g", "j1"), (reply["id"]!.GetValue<string>(), reply["data"]!["jobId"]!.GetValue<string>()));
        Assert.Equal(Origin, _handler.Origins.Single());

        await SendAsync(socket, """{"type":"job.get","id":"bad","jobId":"!!"}""");
        Assert.Equal("BAD_REQUEST", (await ReceiveAsync(socket))!["error"]!["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task RejectsUpgradesWithoutOrigin()
    {
        Start();

        await Assert.ThrowsAsync<WebSocketException>(() => ConnectAsync(origin: null));
    }

    [Fact]
    public async Task RejectsUpgradesWhoseHostIsNotTheLoopbackAddress()
    {
        Start();
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", _server.Port, Timeout);
        var stream = client.GetStream();
        var request = $"GET / HTTP/1.1\r\nHost: evil.example.com:{_server.Port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: {Origin}\r\nSec-WebSocket-Protocol: xihan-print.v1\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(request), Timeout);
        var buffer = new byte[256];
        var read = await stream.ReadAsync(buffer, Timeout);

        Assert.StartsWith("HTTP/1.1 403", Encoding.ASCII.GetString(buffer, 0, read));
    }

    [Fact]
    public async Task ReportsProtocolUnsupportedWhenOnlyTheUnversionedSubProtocolIsOffered()
    {
        Start();
        var socket = await ConnectAsync(Origin, "xihan-print.v9", HttpUpgrade.UnversionedSubProtocol);

        var error = (await ReceiveAsync(socket))!;

        Assert.Equal("PROTOCOL_UNSUPPORTED", error["error"]!["code"]!.GetValue<string>());
        Assert.Equal(1, error["error"]!["details"]!["supported"]![0]!.GetValue<int>());
        Assert.Equal(CloseCodes.ProtocolUnsupported, await ClosedWithAsync(socket));
    }

    [Fact]
    public async Task ClosesWhenTheFirstMessageIsNotHello()
    {
        Start();
        var socket = await ConnectAsync();
        await SendAsync(socket, """{"type":"ping","id":"p"}""");

        Assert.Equal("BAD_REQUEST", (await ReceiveAsync(socket))!["error"]!["code"]!.GetValue<string>());
        Assert.Equal(CloseCodes.HelloRequired, await ClosedWithAsync(socket));
    }

    [Fact]
    public async Task AnswersPingsAndRefusesBusinessWhileWaitingForConsent()
    {
        _authorizer.Gate = new TaskCompletionSource<ConsentDecision>();
        Start();
        var socket = await ConnectAsync();
        await SendAsync(socket, """{"type":"hello","id":"h","protocol":1}""");
        Assert.Equal(Origin, (await ReceiveAsync(socket))!["origin"]!.GetValue<string>());

        await SendAsync(socket, """{"type":"ping","id":"p"}""");
        Assert.Equal("pong", (await ReceiveAsync(socket))!["type"]!.GetValue<string>());
        await SendAsync(socket, """{"type":"printers.list","id":"l"}""");
        Assert.Equal(("l", "CONSENT_PENDING"), ((await ReceiveAsync(socket))!["id"]!.GetValue<string>(), "CONSENT_PENDING"));

        _authorizer.Gate.SetResult(ConsentDecision.Allowed);
        var welcome = (await ReceiveAsync(socket))!;
        Assert.Equal(("h", true), (welcome["id"]!.GetValue<string>(), welcome["ok"]!.GetValue<bool>()));
    }

    [Theory]
    [InlineData(ConsentDecision.Denied, "CONSENT_DENIED")]
    [InlineData(ConsentDecision.TimedOut, "CONSENT_TIMEOUT")]
    public async Task ClosesWhenTheOriginIsNotAuthorized(ConsentDecision decision, string code)
    {
        _authorizer.Decision = decision;
        Start();
        var (socket, reply) = await HandshakeAsync();

        Assert.Equal(code, reply["error"]!["code"]!.GetValue<string>());
        Assert.Equal(CloseCodes.OriginRejected, await ClosedWithAsync(socket));
    }

    [Fact]
    public async Task ResumesTheSessionWithItsTokenAndReplaysUnfinishedJobs()
    {
        Start();
        var (first, welcome) = await HandshakeAsync();
        var token = welcome["data"]!["sessionToken"]!.GetValue<string>();
        await first.CloseAsync(WebSocketCloseStatus.NormalClosure, null, Timeout);
        await WaitUntilAsync(() => _handler.Sessions.Count == 0 || !_handler.LastSession!.IsAttached);

        _handler.Unfinished = ["j7"];
        var (second, resumed) = await HandshakeAsync(token);

        Assert.Equal(token, resumed["data"]!["sessionToken"]!.GetValue<string>());
        Assert.Equal("j7", resumed["data"]!["resumed"]![0]!.GetValue<string>());
        Assert.Equal("job.started", (await ReceiveAsync(second))!["type"]!.GetValue<string>());

        var (_, fresh) = await HandshakeAsync("not-a-token");
        Assert.NotEqual(token, fresh["data"]!["sessionToken"]!.GetValue<string>());
        Assert.Empty(fresh["data"]!["resumed"]!.AsArray());
    }

    [Fact]
    public async Task ClosesIdleConnections()
    {
        Options = new ServerOptions { Ports = [0], IdleTimeout = TimeSpan.FromMilliseconds(300) };
        Start();
        var (socket, _) = await HandshakeAsync();

        Assert.Equal(CloseCodes.IdleTimeout, await ClosedWithAsync(socket));
    }

    [Fact]
    public async Task LimitsConnectionsPerOrigin()
    {
        Options = new ServerOptions { Ports = [0], MaxConnectionsPerOrigin = 1 };
        Start();
        var (_, _) = await HandshakeAsync();
        var second = await ConnectAsync();

        Assert.Equal(CloseCodes.TooManyConnections, await ClosedWithAsync(second));
    }

    [Fact]
    public async Task ClosesOnOversizedMessages()
    {
        Options = new ServerOptions { Ports = [0], MaxMessageBytes = 1024 };
        Start();
        var (socket, _) = await HandshakeAsync();
        await SendAsync(socket, $$"""{"type":"ping","id":"p","pad":"{{new string('x', 2048)}}"}""");

        Assert.Equal(WebSocketCloseStatus.MessageTooBig, await ClosedWithAsync(socket));
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++)
            await Task.Delay(20);
    }

    private sealed class FakeAuthorizer : IOriginAuthorizer
    {
        public ConsentDecision Decision { get; set; } = ConsentDecision.Allowed;

        public TaskCompletionSource<ConsentDecision>? Gate { get; set; }

        public async Task<ConsentDecision> AuthorizeAsync(string origin, Func<Task> notifyPending, CancellationToken cancellationToken)
        {
            if (Gate is null)
                return Decision;
            await notifyPending();
            return await Gate.Task.WaitAsync(cancellationToken);
        }
    }

    private sealed class FakeEnvironment : IClientEnvironment
    {
        public ClientInfo Info { get; } = new() { Version = "0.1.0", Os = "windows", Arch = "x64" };

        public ClientCapabilities Capabilities { get; } = new() { Html = true, Raw = true };
    }

    private sealed class FakeHandler : IRequestHandler
    {
        public List<string> Origins { get; } = [];

        public List<ClientSession> Sessions { get; } = [];

        public ClientSession? LastSession => Sessions.LastOrDefault();

        public IReadOnlyList<string> Unfinished { get; set; } = [];

        public async Task HandleAsync(ClientSession session, ClientRequest request, CancellationToken cancellationToken)
        {
            Origins.Add(session.Origin);
            Sessions.Add(session);
            if (request is GetJobRequest get)
                await session.SendAsync(ProtocolWriter.Status(get.Id, new JobStatus { JobId = get.JobId, State = JobState.Queued }), cancellationToken);
        }

        public IReadOnlyList<string> UnfinishedJobs(ClientSession session) => Unfinished;

        public Task ReplayAsync(ClientSession session, CancellationToken cancellationToken)
        {
            return session.SendAsync(ProtocolWriter.JobEvent(new JobStatus { JobId = Unfinished[0], State = JobState.Started }, DateTimeOffset.UtcNow), cancellationToken);
        }
    }
}
