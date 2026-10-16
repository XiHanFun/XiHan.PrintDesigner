// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 只绑 127.0.0.1 的 WebSocket 服务：检查升级请求，握手与来源授权，之后把业务请求交给 <see cref="IRequestHandler"/>
/// </summary>
public sealed class LoopbackServer : IAsyncDisposable
{
    private readonly ServerOptions _options;
    private readonly IOriginAuthorizer _authorizer;
    private readonly IClientEnvironment _environment;
    private readonly IRequestHandler _handler;
    private readonly IClientLog _log;
    private readonly CancellationTokenSource _stopping = new();
    private readonly List<Task> _connections = [];
    private readonly Lock _gate = new();
    private TcpListener? _listener;
    private Task? _acceptLoop;

    /// <summary>
    /// 创建服务，Start 之后才开始监听
    /// </summary>
    public LoopbackServer(ServerOptions options, IOriginAuthorizer authorizer, IClientEnvironment environment, IRequestHandler handler, SessionRegistry? sessions = null, IClientLog? log = null)
    {
        _options = options;
        _authorizer = authorizer;
        _environment = environment;
        _handler = handler;
        _log = log ?? NullClientLog.Instance;
        Sessions = sessions ?? new SessionRegistry(options.ResumeWindow);
    }

    /// <summary>
    /// 会话登记
    /// </summary>
    public SessionRegistry Sessions { get; }

    /// <summary>
    /// 实际监听的端口；未启动时为 0
    /// </summary>
    public int Port { get; private set; }

    /// <summary>
    /// 依次尝试端口并开始监听；都被占用时抛出 <see cref="SocketException"/>
    /// </summary>
    public void Start()
    {
        SocketException? last = null;
        foreach (var port in _options.Ports)
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Server.ExclusiveAddressUse = true;
            try
            {
                listener.Start();
            }
            catch (SocketException error)
            {
                last = error;
                _log.Write(LogLevel.Information, $"端口 {port} 不可用：{error.SocketErrorCode}");
                continue;
            }
            _listener = listener;
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            _log.Write(LogLevel.Information, $"开始监听 127.0.0.1:{Port}");
            _acceptLoop = AcceptLoopAsync(listener);
            return;
        }
        throw last ?? new SocketException((int)SocketError.AddressAlreadyInUse);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync().ConfigureAwait(false);
        _listener?.Stop();
        if (_acceptLoop is not null)
            await _acceptLoop.ConfigureAwait(false);
        Task[] running;
        lock (_gate)
            running = [.. _connections];
        await Task.WhenAll(running).ConfigureAwait(false);
        _stopping.Dispose();
    }

    private async Task AcceptLoopAsync(TcpListener listener)
    {
        while (!_stopping.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(_stopping.Token).ConfigureAwait(false);
            }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                return;
            }
            var task = Task.Run(() => ServeAsync(client));
            lock (_gate)
            {
                _connections.RemoveAll(item => item.IsCompleted);
                _connections.Add(task);
            }
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                if (client.Client.RemoteEndPoint is not IPEndPoint remote || !IPAddress.IsLoopback(remote.Address))
                {
                    _log.Write(LogLevel.Warning, $"拒绝非本机连接：{client.Client.RemoteEndPoint}");
                    return;
                }
                var stream = client.GetStream();
                var decision = await UpgradeAsync(stream).ConfigureAwait(false);
                if (decision is null)
                    return;
                var socket = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, SubProtocol = decision.SubProtocol, KeepAliveInterval = TimeSpan.Zero });
                await using var connection = new WebSocketConnection(socket, _options.MaxMessageBytes);
                await RunAsync(connection, decision).ConfigureAwait(false);
            }
            catch (Exception error) when (error is IOException or SocketException or WebSocketException or OperationCanceledException)
            {
                _log.Write(LogLevel.Debug, "连接中断：" + error.Message);
            }
            catch (Exception error)
            {
                _log.Write(LogLevel.Error, "处理连接时出错", error);
            }
        }
    }

    /// <summary>
    /// 读升级请求并回复；拒绝时返回 null
    /// </summary>
    private async Task<UpgradeDecision?> UpgradeAsync(NetworkStream stream)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stopping.Token);
        timeout.CancelAfter(_options.HandshakeTimeout);
        var head = await ReadHeadAsync(stream, timeout.Token).ConfigureAwait(false);
        var request = head is null ? null : HttpUpgrade.Parse(head);
        var decision = request is null ? UpgradeDecision.Reject(400, "升级请求格式不对") : HttpUpgrade.Evaluate(request, Port);
        if (!decision.Accepted)
        {
            _log.Write(LogLevel.Warning, $"拒绝升级（{decision.Status}）：{decision.Reason}");
            await stream.WriteAsync(HttpUpgrade.RejectResponse(decision.Status), timeout.Token).ConfigureAwait(false);
            return null;
        }
        await stream.WriteAsync(HttpUpgrade.AcceptResponse(decision), timeout.Token).ConfigureAwait(false);
        return decision;
    }

    private static async Task<byte[]?> ReadHeadAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[HttpUpgrade.MaxHeaderBytes];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length, 1), cancellationToken).ConfigureAwait(false);
            if (read == 0)
                return null;
            length += read;
            if (length >= 4 && buffer[length - 4] == '\r' && buffer[length - 3] == '\n' && buffer[length - 2] == '\r' && buffer[length - 1] == '\n')
                return buffer[..length];
        }
        return null;
    }

    private async Task RunAsync(WebSocketConnection connection, UpgradeDecision decision)
    {
        var origin = decision.Origin!;
        if (decision.VersionMismatch)
        {
            await connection.SendTextAsync(ProtocolWriter.Error(null, Unsupported())).ConfigureAwait(false);
            await connection.CloseAsync(CloseCodes.ProtocolUnsupported, "协议主版本不匹配").ConfigureAwait(false);
            return;
        }
        if (!Sessions.TryAcquireConnection(origin, _options.MaxConnectionsPerOrigin))
        {
            await connection.CloseAsync(CloseCodes.TooManyConnections, "连接数超过上限").ConfigureAwait(false);
            return;
        }
        try
        {
            await ConverseAsync(connection, origin).ConfigureAwait(false);
        }
        finally
        {
            Sessions.ReleaseConnection(origin);
        }
    }

    private async Task ConverseAsync(WebSocketConnection connection, string origin)
    {
        var inbox = new Inbox(this, connection);
        var first = await inbox.TakeAsync().ConfigureAwait(false);
        if (first is null)
            return;
        var read = ProtocolReader.Read(first, ProtocolReader.MaxResourceBytes);
        if (read.Request is not HelloRequest hello)
        {
            await connection.SendTextAsync(ProtocolWriter.Error(read.Id, read.Error ?? new ProtocolError(PrintErrorCodes.BadRequest, "第一条消息必须是 hello"))).ConfigureAwait(false);
            await connection.CloseAsync(CloseCodes.HelloRequired, "第一条消息必须是 hello").ConfigureAwait(false);
            return;
        }
        if (hello.Protocol != ClientDefaults.ProtocolVersion)
        {
            await connection.SendTextAsync(ProtocolWriter.Error(hello.Id, Unsupported())).ConfigureAwait(false);
            await connection.CloseAsync(CloseCodes.ProtocolUnsupported, "协议主版本不匹配").ConfigureAwait(false);
            return;
        }

        var decision = await AuthorizeAsync(connection, inbox, origin).ConfigureAwait(false);
        if (decision is null)
            return;
        if (decision != ConsentDecision.Allowed)
        {
            var code = decision == ConsentDecision.TimedOut ? PrintErrorCodes.ConsentTimeout : PrintErrorCodes.ConsentDenied;
            _log.Write(LogLevel.Information, $"来源未获授权（{code}）：{origin}");
            await connection.SendTextAsync(ProtocolWriter.Error(hello.Id, new ProtocolError(code, "来源未获授权"))).ConfigureAwait(false);
            await connection.CloseAsync(CloseCodes.OriginRejected, "来源未获授权").ConfigureAwait(false);
            return;
        }

        var (session, resumed) = Sessions.Open(origin, hello.Resume, connection);
        try
        {
            var welcome = new WelcomeData
            {
                Client = _environment.Info,
                SessionToken = session.Token,
                Capabilities = _environment.Capabilities,
                Resumed = resumed ? _handler.UnfinishedJobs(session) : [],
            };
            await connection.SendTextAsync(ProtocolWriter.Welcome(hello.Id, welcome)).ConfigureAwait(false);
            _log.Write(LogLevel.Information, $"会话{(resumed ? "已认回" : "已建立")}：{origin}");
            if (resumed)
                await _handler.ReplayAsync(session, _stopping.Token).ConfigureAwait(false);
            await ServeRequestsAsync(connection, inbox, session).ConfigureAwait(false);
        }
        finally
        {
            Sessions.Detach(session, connection);
        }
    }

    /// <summary>
    /// 等授权结论，期间照常回心跳、其余请求回 CONSENT_PENDING；连接在此期间断开时返回 null
    /// </summary>
    private async Task<ConsentDecision?> AuthorizeAsync(WebSocketConnection connection, Inbox inbox, string origin)
    {
        using var abandon = CancellationTokenSource.CreateLinkedTokenSource(_stopping.Token);
        var authorize = _authorizer.AuthorizeAsync(origin, () => connection.SendTextAsync(ProtocolWriter.ConsentPending(origin)), abandon.Token);
        while (!authorize.IsCompleted)
        {
            if (await Task.WhenAny(authorize, inbox.Next()).ConfigureAwait(false) == authorize)
                break;
            var message = await inbox.TakeAsync().ConfigureAwait(false);
            if (message is null)
            {
                await abandon.CancelAsync().ConfigureAwait(false);
                try
                {
                    await authorize.ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                }
                return null;
            }
            var read = ProtocolReader.Read(message, ProtocolReader.MaxResourceBytes);
            var reply = read.Request is PingRequest ping
                ? ProtocolWriter.Pong(ping.Id)
                : ProtocolWriter.Error(read.Id, read.Error ?? new ProtocolError(PrintErrorCodes.ConsentPending, "正在等用户授权"));
            await connection.SendTextAsync(reply).ConfigureAwait(false);
        }
        return await authorize.ConfigureAwait(false);
    }

    private async Task ServeRequestsAsync(WebSocketConnection connection, Inbox inbox, ClientSession session)
    {
        while (true)
        {
            var message = await inbox.TakeAsync().ConfigureAwait(false);
            if (message is null)
                return;
            var read = ProtocolReader.Read(message, ProtocolReader.MaxResourceBytes);
            switch (read.Request)
            {
                case null:
                    await connection.SendTextAsync(ProtocolWriter.Error(read.Id, read.Error!)).ConfigureAwait(false);
                    break;
                case PingRequest ping:
                    await connection.SendTextAsync(ProtocolWriter.Pong(ping.Id)).ConfigureAwait(false);
                    break;
                case HelloRequest hello:
                    await connection.SendTextAsync(ProtocolWriter.Error(hello.Id, new ProtocolError(PrintErrorCodes.BadRequest, "已经握过手"))).ConfigureAwait(false);
                    break;
                default:
                    try
                    {
                        await _handler.HandleAsync(session, read.Request, _stopping.Token).ConfigureAwait(false);
                    }
                    catch (Exception error) when (error is not OperationCanceledException)
                    {
                        _log.Write(LogLevel.Error, $"处理 {read.Request.GetType().Name} 时出错", error);
                        await connection.SendTextAsync(ProtocolWriter.Error(read.Request.Id, new ProtocolError(PrintErrorCodes.Internal, "客户端内部错误，详情见日志"))).ConfigureAwait(false);
                    }
                    break;
            }
        }
    }

    /// <summary>
    /// 收一条消息；超过空闲期限时以 4408 发起关闭，等对方回关闭帧（最多等一个握手期限）后返回 null
    /// </summary>
    private async Task<byte[]?> ReceiveAsync(WebSocketConnection connection)
    {
        var receive = connection.ReceiveAsync(_stopping.Token);
        using var idle = CancellationTokenSource.CreateLinkedTokenSource(_stopping.Token);
        if (await Task.WhenAny(receive, Task.Delay(_options.IdleTimeout, idle.Token)).ConfigureAwait(false) == receive)
        {
            await idle.CancelAsync().ConfigureAwait(false);
            return await receive.ConfigureAwait(false);
        }
        await connection.CloseAsync(CloseCodes.IdleTimeout, "太久没有收到消息").ConfigureAwait(false);
        await Task.WhenAny(receive, Task.Delay(_options.HandshakeTimeout)).ConfigureAwait(false);
        return null;
    }

    /// <summary>
    /// 一条连接上待取的下一条消息：授权等待期间先开始的接收，授权结束后交给业务循环接着用
    /// </summary>
    private sealed class Inbox(LoopbackServer server, WebSocketConnection connection)
    {
        private Task<byte[]?>? _pending;

        /// <summary>
        /// 下一条消息的接收任务，已在接收时沿用
        /// </summary>
        public Task<byte[]?> Next() => _pending ??= server.ReceiveAsync(connection);

        /// <summary>
        /// 取下一条消息
        /// </summary>
        public async Task<byte[]?> TakeAsync()
        {
            var message = await Next().ConfigureAwait(false);
            _pending = null;
            return message;
        }
    }

    private static ProtocolError Unsupported()
    {
        return new ProtocolError(PrintErrorCodes.ProtocolUnsupported, "协议主版本不匹配", new JsonObject { ["supported"] = new JsonArray(ClientDefaults.ProtocolVersion) });
    }
}
