// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Security.Cryptography;
using System.Text;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 一条 HTTP/1.1 升级请求：方法、目标与请求头（名不区分大小写）
/// </summary>
/// <param name="Method">方法</param>
/// <param name="Target">请求目标</param>
/// <param name="Headers">请求头</param>
public sealed record UpgradeRequest(string Method, string Target, IReadOnlyDictionary<string, string> Headers)
{
    /// <summary>
    /// 取请求头，没有时为 null
    /// </summary>
    public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;
}

/// <summary>
/// 是否接受升级：接受时给出来源、选中的子协议与回给浏览器的 Accept 值；VersionMismatch 表示浏览器只给了不带版本的子协议
/// </summary>
/// <param name="Accepted">是否接受</param>
/// <param name="Status">拒绝时回的 HTTP 状态码</param>
/// <param name="Reason">拒绝的原因，写进日志</param>
/// <param name="Origin">规范写法的来源</param>
/// <param name="SubProtocol">选中的子协议</param>
/// <param name="AcceptKey">Sec-WebSocket-Accept 的值</param>
/// <param name="VersionMismatch">子协议主版本不匹配，升级后立即回错并关闭</param>
public sealed record UpgradeDecision(bool Accepted, int Status, string Reason, string? Origin = null, string? SubProtocol = null, string? AcceptKey = null, bool VersionMismatch = false)
{
    /// <summary>
    /// 拒绝
    /// </summary>
    public static UpgradeDecision Reject(int status, string reason) => new(false, status, reason);
}

/// <summary>
/// WebSocket 升级握手：解析请求、按约定检查、写出回复
/// </summary>
public static class HttpUpgrade
{
    /// <summary>
    /// 不带版本的子协议：浏览器同时给出它，主版本不匹配时客户端选它，升级后再回 PROTOCOL_UNSUPPORTED
    /// </summary>
    public const string UnversionedSubProtocol = "xihan-print";

    /// <summary>
    /// 请求头的长度上限，字节
    /// </summary>
    public const int MaxHeaderBytes = 8 * 1024;

    private const string Guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    /// <summary>
    /// 解析请求行与请求头；格式不对时为 null
    /// </summary>
    /// <param name="head">从开头到空行（含）的字节</param>
    public static UpgradeRequest? Parse(ReadOnlySpan<byte> head)
    {
        var text = Encoding.ASCII.GetString(head);
        var lines = text.Split("\r\n");
        var start = lines[0].Split(' ');
        if (start.Length != 3 || !start[2].StartsWith("HTTP/1.", StringComparison.Ordinal))
            return null;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0)
                continue;
            var colon = line.IndexOf(':');
            if (colon <= 0)
                return null;
            var name = line[..colon].Trim();
            var value = line[(colon + 1)..].Trim();
            headers[name] = headers.TryGetValue(name, out var existing) ? existing + ", " + value : value;
        }
        return new UpgradeRequest(start[0], start[1], headers);
    }

    /// <summary>
    /// 按约定检查升级请求：GET、websocket 升级、版本 13、合法的 Key、Host 只能是本机地址加监听端口、Origin 合法、带上我们的子协议
    /// </summary>
    /// <param name="request">升级请求</param>
    /// <param name="port">监听端口</param>
    public static UpgradeDecision Evaluate(UpgradeRequest request, int port)
    {
        if (request.Method != "GET")
            return UpgradeDecision.Reject(405, "方法不是 GET");
        if (!Contains(request.Header("Upgrade"), "websocket") || !Contains(request.Header("Connection"), "upgrade"))
            return UpgradeDecision.Reject(400, "不是 WebSocket 升级请求");
        if (request.Header("Sec-WebSocket-Version") != "13")
            return UpgradeDecision.Reject(426, "WebSocket 版本不是 13");
        var key = request.Header("Sec-WebSocket-Key");
        if (key is null || !IsValidKey(key))
            return UpgradeDecision.Reject(400, "Sec-WebSocket-Key 不合法");
        var host = request.Header("Host");
        if (!string.Equals(host, $"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase) && !string.Equals(host, $"localhost:{port}", StringComparison.OrdinalIgnoreCase))
            return UpgradeDecision.Reject(403, $"Host 不是本机地址：{host}");
        if (!OriginName.TryNormalize(request.Header("Origin"), out var origin))
            return UpgradeDecision.Reject(403, $"Origin 缺失或不合法：{request.Header("Origin")}");

        var offered = (request.Header("Sec-WebSocket-Protocol") ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var accept = ComputeAccept(key);
        if (offered.Contains(ClientDefaults.SubProtocol, StringComparer.Ordinal))
            return new UpgradeDecision(true, 101, string.Empty, origin, ClientDefaults.SubProtocol, accept);
        if (offered.Contains(UnversionedSubProtocol, StringComparer.Ordinal))
            return new UpgradeDecision(true, 101, string.Empty, origin, UnversionedSubProtocol, accept, VersionMismatch: true);
        return UpgradeDecision.Reject(400, "没有带上 xihan-print 子协议");
    }

    /// <summary>
    /// 计算 Sec-WebSocket-Accept
    /// </summary>
    public static string ComputeAccept(string key) => Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + Guid)));

    /// <summary>
    /// 接受升级的回复
    /// </summary>
    public static byte[] AcceptResponse(UpgradeDecision decision)
    {
        return Encoding.ASCII.GetBytes(
            "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + $"Sec-WebSocket-Accept: {decision.AcceptKey}\r\n"
            + $"Sec-WebSocket-Protocol: {decision.SubProtocol}\r\n\r\n");
    }

    /// <summary>
    /// 拒绝升级的回复，没有正文
    /// </summary>
    public static byte[] RejectResponse(int status)
    {
        var version = status == 426 ? "Sec-WebSocket-Version: 13\r\n" : string.Empty;
        return Encoding.ASCII.GetBytes($"HTTP/1.1 {status} {ReasonPhrase(status)}\r\n{version}Connection: close\r\nContent-Length: 0\r\n\r\n");
    }

    private static bool IsValidKey(string key)
    {
        Span<byte> buffer = stackalloc byte[24];
        return Convert.TryFromBase64String(key, buffer, out var written) && written == 16;
    }

    private static bool Contains(string? header, string token)
    {
        return header is not null && header.Split(',', StringSplitOptions.TrimEntries).Any(part => string.Equals(part, token, StringComparison.OrdinalIgnoreCase));
    }

    private static string ReasonPhrase(int status) => status switch
    {
        400 => "Bad Request",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        426 => "Upgrade Required",
        _ => "Error",
    };
}
