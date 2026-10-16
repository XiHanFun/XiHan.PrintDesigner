// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net.WebSockets;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 客户端主动关闭连接时用的关闭码
/// </summary>
public static class CloseCodes
{
    /// <summary>
    /// 连接后第一条不是 hello
    /// </summary>
    public const WebSocketCloseStatus HelloRequired = (WebSocketCloseStatus)4400;

    /// <summary>
    /// 来源不被允许
    /// </summary>
    public const WebSocketCloseStatus OriginRejected = (WebSocketCloseStatus)4401;

    /// <summary>
    /// 太久没有收到消息
    /// </summary>
    public const WebSocketCloseStatus IdleTimeout = (WebSocketCloseStatus)4408;

    /// <summary>
    /// 同一来源的连接数超过上限
    /// </summary>
    public const WebSocketCloseStatus TooManyConnections = (WebSocketCloseStatus)4409;

    /// <summary>
    /// 协议主版本不匹配
    /// </summary>
    public const WebSocketCloseStatus ProtocolUnsupported = (WebSocketCloseStatus)4426;
}
