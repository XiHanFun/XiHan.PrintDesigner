// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 响应或任务事件里的错误
/// </summary>
/// <param name="Code">错误码，取 <see cref="PrintErrorCodes"/></param>
/// <param name="Message">给开发者看的说明</param>
/// <param name="Details">附加信息，如打印机名、Win32 错误码</param>
public sealed record ProtocolError(string Code, string Message, JsonObject? Details = null);

/// <summary>
/// 握手成功后的回复
/// </summary>
public sealed class WelcomeData
{
    /// <summary>
    /// 协议主版本
    /// </summary>
    public int Protocol { get; init; } = ClientDefaults.ProtocolVersion;

    /// <summary>
    /// 协议次版本
    /// </summary>
    public int Minor { get; init; } = ClientDefaults.ProtocolMinorVersion;

    /// <summary>
    /// 客户端信息
    /// </summary>
    public required ClientInfo Client { get; init; }

    /// <summary>
    /// 断线重连时认回任务用的令牌
    /// </summary>
    public required string SessionToken { get; init; }

    /// <summary>
    /// 客户端具备的能力
    /// </summary>
    public required ClientCapabilities Capabilities { get; init; }

    /// <summary>
    /// 重连后挂回这个会话、仍未结束的任务
    /// </summary>
    public IReadOnlyList<string> Resumed { get; init; } = [];
}

/// <summary>
/// 客户端信息
/// </summary>
public sealed class ClientInfo
{
    /// <summary>
    /// 客户端版本
    /// </summary>
    public required string Version { get; init; }

    /// <summary>
    /// 操作系统，如 windows
    /// </summary>
    public required string Os { get; init; }

    /// <summary>
    /// 处理器架构，如 x64
    /// </summary>
    public required string Arch { get; init; }

    /// <summary>
    /// 渲染引擎版本
    /// </summary>
    public string? Renderer { get; init; }
}

/// <summary>
/// 客户端具备的能力，次版本只加不减
/// </summary>
public sealed class ClientCapabilities
{
    /// <summary>
    /// HTML 通道
    /// </summary>
    public bool Html { get; init; }

    /// <summary>
    /// 原始指令通道
    /// </summary>
    public bool Raw { get; init; }

    /// <summary>
    /// 导出 PDF
    /// </summary>
    public bool Pdf { get; init; }

    /// <summary>
    /// 双面
    /// </summary>
    public bool Duplex { get; init; }

    /// <summary>
    /// 打印机状态
    /// </summary>
    public bool PrinterStatus { get; init; }
}

/// <summary>
/// 打印机状态
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<PrinterState>))]
public enum PrinterState
{
    /// <summary>
    /// 就绪
    /// </summary>
    [JsonStringEnumMemberName("ready")]
    Ready,

    /// <summary>
    /// 暂停
    /// </summary>
    [JsonStringEnumMemberName("paused")]
    Paused,

    /// <summary>
    /// 脱机
    /// </summary>
    [JsonStringEnumMemberName("offline")]
    Offline,

    /// <summary>
    /// 出错
    /// </summary>
    [JsonStringEnumMemberName("error")]
    Error,

    /// <summary>
    /// 缺纸
    /// </summary>
    [JsonStringEnumMemberName("paperOut")]
    PaperOut,

    /// <summary>
    /// 卡纸
    /// </summary>
    [JsonStringEnumMemberName("paperJam")]
    PaperJam,

    /// <summary>
    /// 忙
    /// </summary>
    [JsonStringEnumMemberName("busy")]
    Busy,

    /// <summary>
    /// 无法判断
    /// </summary>
    [JsonStringEnumMemberName("unknown")]
    Unknown,
}

/// <summary>
/// 一台打印机
/// </summary>
public sealed class PrinterInfo
{
    /// <summary>
    /// 名称
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// 是否默认打印机
    /// </summary>
    public bool IsDefault { get; init; }

    /// <summary>
    /// 状态
    /// </summary>
    public PrinterState Status { get; init; } = PrinterState.Unknown;

    /// <summary>
    /// 平台给出的原始状态位
    /// </summary>
    public long StatusFlags { get; init; }

    /// <summary>
    /// 位置
    /// </summary>
    public string? Location { get; init; }

    /// <summary>
    /// 注释
    /// </summary>
    public string? Comment { get; init; }

    /// <summary>
    /// 驱动名
    /// </summary>
    public string? Driver { get; init; }

    /// <summary>
    /// 端口名
    /// </summary>
    public string? Port { get; init; }

    /// <summary>
    /// 是否网络打印机
    /// </summary>
    public bool IsNetwork { get; init; }

    /// <summary>
    /// 能力，只在查单台打印机时给出
    /// </summary>
    public PrinterCapabilities? Capabilities { get; init; }
}

/// <summary>
/// 打印机能力
/// </summary>
public sealed class PrinterCapabilities
{
    /// <summary>
    /// 支持彩色
    /// </summary>
    public bool Color { get; init; }

    /// <summary>
    /// 支持双面
    /// </summary>
    public bool Duplex { get; init; }

    /// <summary>
    /// 最多份数
    /// </summary>
    public int MaxCopies { get; init; } = 1;

    /// <summary>
    /// 驱动提供的纸张
    /// </summary>
    public IReadOnlyList<PaperInfo> Papers { get; init; } = [];
}

/// <summary>
/// 一种纸张
/// </summary>
/// <param name="Id">驱动的纸张编号</param>
/// <param name="Name">名称</param>
/// <param name="WidthMm">宽，毫米</param>
/// <param name="HeightMm">高，毫米</param>
public sealed record PaperInfo(int Id, string Name, double WidthMm, double HeightMm);

/// <summary>
/// 任务状态
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<JobState>))]
public enum JobState
{
    /// <summary>
    /// 排队中
    /// </summary>
    [JsonStringEnumMemberName("queued")]
    Queued,

    /// <summary>
    /// 执行中
    /// </summary>
    [JsonStringEnumMemberName("started")]
    Started,

    /// <summary>
    /// 已交给打印池或导出完毕
    /// </summary>
    [JsonStringEnumMemberName("completed")]
    Completed,

    /// <summary>
    /// 失败
    /// </summary>
    [JsonStringEnumMemberName("failed")]
    Failed,

    /// <summary>
    /// 已取消
    /// </summary>
    [JsonStringEnumMemberName("cancelled")]
    Cancelled,
}

/// <summary>
/// 任务受理后的回复
/// </summary>
/// <param name="JobId">任务标识</param>
/// <param name="Position">同一台打印机前面还有几个任务</param>
public sealed record JobAccepted(string JobId, int Position);

/// <summary>
/// 任务的当前状态
/// </summary>
public sealed class JobStatus
{
    /// <summary>
    /// 任务标识
    /// </summary>
    public required string JobId { get; init; }

    /// <summary>
    /// 状态
    /// </summary>
    public JobState State { get; init; }

    /// <summary>
    /// 排队中时前面还有几个任务
    /// </summary>
    public int? Position { get; init; }

    /// <summary>
    /// HTML 通道完成时的输出页数
    /// </summary>
    public int? Sheets { get; init; }

    /// <summary>
    /// 原始通道完成时写出的字节数
    /// </summary>
    public long? Bytes { get; init; }

    /// <summary>
    /// 失败时的错误
    /// </summary>
    public ProtocolError? Error { get; init; }
}

/// <summary>
/// 取消任务的结果
/// </summary>
/// <param name="Cancelled">是否已取消</param>
public sealed record JobCancelled(bool Cancelled);
