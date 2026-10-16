// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core;

/// <summary>
/// 客户端的缺省约定：协议名、主版本、监听端口与消息上限
/// </summary>
public static class ClientDefaults
{
    /// <summary>
    /// WebSocket 子协议名，带主版本
    /// </summary>
    public const string SubProtocol = "xihan-print.v1";

    /// <summary>
    /// 协议主版本
    /// </summary>
    public const int ProtocolVersion = 1;

    /// <summary>
    /// 协议次版本，只加字段不删字段
    /// </summary>
    public const int ProtocolMinorVersion = 0;

    /// <summary>
    /// 依次尝试的监听端口：第一个被占用时试下一个
    /// </summary>
    public static IReadOnlyList<int> Ports { get; } = [17620, 17621, 17622, 17623];

    /// <summary>
    /// 单条消息的上限，字节
    /// </summary>
    public const int MaxMessageBytes = 32 * 1024 * 1024;
}
