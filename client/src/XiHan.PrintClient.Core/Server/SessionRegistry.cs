// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Security.Cryptography;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 会话与连接数的登记：建会话、凭令牌认回会话、清掉过了重连期限的会话、按来源数连接
/// </summary>
public sealed class SessionRegistry
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, ClientSession> _byToken = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _connections = new(StringComparer.Ordinal);
    private readonly TimeSpan _resumeWindow;
    private readonly TimeProvider _time;

    /// <summary>
    /// 按重连期限创建
    /// </summary>
    public SessionRegistry(TimeSpan resumeWindow, TimeProvider? time = null)
    {
        _resumeWindow = resumeWindow;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>
    /// 会话过了重连期限被清掉时调用
    /// </summary>
    public event Action<ClientSession>? Expired;

    /// <summary>
    /// 某来源多占一条连接；超过上限时返回 false
    /// </summary>
    public bool TryAcquireConnection(string origin, int limit)
    {
        lock (_gate)
        {
            var count = _connections.GetValueOrDefault(origin);
            if (count >= limit)
                return false;
            _connections[origin] = count + 1;
            return true;
        }
    }

    /// <summary>
    /// 某来源释放一条连接
    /// </summary>
    public void ReleaseConnection(string origin)
    {
        lock (_gate)
        {
            var count = _connections.GetValueOrDefault(origin) - 1;
            if (count > 0)
                _connections[origin] = count;
            else
                _connections.Remove(origin);
        }
    }

    /// <summary>
    /// 凭令牌认回同一来源、仍在重连期限内的会话并接上连接；认不回时新建会话。Resumed 表示是否认回
    /// </summary>
    public (ClientSession Session, bool Resumed) Open(string origin, string? token, WebSocketConnection connection)
    {
        List<ClientSession> expired;
        ClientSession session;
        var resumed = false;
        lock (_gate)
        {
            expired = SweepLocked();
            if (token is not null && _byToken.TryGetValue(token, out var existing) && existing.Origin == origin && !existing.IsAttached)
            {
                session = existing;
                resumed = true;
            }
            else
            {
                session = new ClientSession(Guid.NewGuid().ToString("N"), origin, NewToken());
                _byToken[session.Token] = session;
            }
            session.Attach(connection);
        }
        foreach (var item in expired)
            Expired?.Invoke(item);
        return (session, resumed);
    }

    /// <summary>
    /// 连接断开：会话进入重连期限
    /// </summary>
    public void Detach(ClientSession session, WebSocketConnection connection)
    {
        session.Detach(connection, _time.GetUtcNow());
    }

    /// <summary>
    /// 清掉过了重连期限的会话
    /// </summary>
    public void Sweep()
    {
        List<ClientSession> expired;
        lock (_gate)
            expired = SweepLocked();
        foreach (var item in expired)
            Expired?.Invoke(item);
    }

    private List<ClientSession> SweepLocked()
    {
        var now = _time.GetUtcNow();
        var expired = _byToken.Values.Where(session => session.DetachedAt is { } at && now - at > _resumeWindow).ToList();
        foreach (var session in expired)
            _byToken.Remove(session.Token);
        return expired;
    }

    private static string NewToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
