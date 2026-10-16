// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 回环服务的端口、期限与上限
/// </summary>
public sealed class ServerOptions
{
    /// <summary>
    /// 依次尝试的端口
    /// </summary>
    public IReadOnlyList<int> Ports { get; init; } = ClientDefaults.Ports;

    /// <summary>
    /// 读完升级请求的期限
    /// </summary>
    public TimeSpan HandshakeTimeout { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// 多久收不到任何消息就关闭连接
    /// </summary>
    public TimeSpan IdleTimeout { get; init; } = TimeSpan.FromSeconds(45);

    /// <summary>
    /// 断线后多久内可以凭令牌认回会话
    /// </summary>
    public TimeSpan ResumeWindow { get; init; } = TimeSpan.FromMinutes(10);

    /// <summary>
    /// 单条消息上限，字节
    /// </summary>
    public int MaxMessageBytes { get; init; } = ClientDefaults.MaxMessageBytes;

    /// <summary>
    /// 同一来源同时保持的连接数上限
    /// </summary>
    public int MaxConnectionsPerOrigin { get; init; } = 8;
}
