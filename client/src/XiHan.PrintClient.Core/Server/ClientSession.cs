// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 一个来源的会话：握手时建立，断线后在重连期限内可凭令牌认回，任务事件经它发给当前连接
/// </summary>
public sealed class ClientSession
{
    private readonly Lock _gate = new();
    private WebSocketConnection? _connection;

    internal ClientSession(string id, string origin, string token)
    {
        Id = id;
        Origin = origin;
        Token = token;
    }

    /// <summary>
    /// 会话标识，只在客户端内部用
    /// </summary>
    public string Id { get; }

    /// <summary>
    /// 规范写法的来源
    /// </summary>
    public string Origin { get; }

    /// <summary>
    /// 重连令牌
    /// </summary>
    public string Token { get; }

    /// <summary>
    /// 断开的时间；连着时为 null
    /// </summary>
    public DateTimeOffset? DetachedAt { get; private set; }

    /// <summary>
    /// 当前是否连着
    /// </summary>
    public bool IsAttached
    {
        get
        {
            lock (_gate)
                return _connection is not null;
        }
    }

    /// <summary>
    /// 发一条文本消息给当前连接；断开时丢弃并返回 false
    /// </summary>
    public Task<bool> SendAsync(byte[] message, CancellationToken cancellationToken = default)
    {
        var connection = Current();
        return connection is null ? Task.FromResult(false) : connection.SendTextAsync(message, cancellationToken);
    }

    /// <summary>
    /// 发一条二进制消息给当前连接；断开时丢弃并返回 false
    /// </summary>
    public Task<bool> SendBinaryAsync(byte[] message, CancellationToken cancellationToken = default)
    {
        var connection = Current();
        return connection is null ? Task.FromResult(false) : connection.SendBinaryAsync(message, cancellationToken);
    }

    internal void Attach(WebSocketConnection connection)
    {
        lock (_gate)
        {
            _connection = connection;
            DetachedAt = null;
        }
    }

    internal void Detach(WebSocketConnection connection, DateTimeOffset now)
    {
        lock (_gate)
        {
            if (!ReferenceEquals(_connection, connection))
                return;
            _connection = null;
            DetachedAt = now;
        }
    }

    private WebSocketConnection? Current()
    {
        lock (_gate)
            return _connection;
    }
}
