// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Serialization;

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 浏览器发来的一条请求；Id 由 SDK 生成，响应原样带回
/// </summary>
/// <param name="Id">请求标识</param>
public abstract record ClientRequest(string Id);

/// <summary>
/// 握手：连接建立后的第一条消息
/// </summary>
public sealed record HelloRequest(string Id, int Protocol, int Minor, SdkInfo? Sdk, string? Resume) : ClientRequest(Id);

/// <summary>
/// 心跳
/// </summary>
public sealed record PingRequest(string Id) : ClientRequest(Id);

/// <summary>
/// 列出打印机，不含能力明细
/// </summary>
public sealed record ListPrintersRequest(string Id) : ClientRequest(Id);

/// <summary>
/// 查一台打印机，含能力明细
/// </summary>
public sealed record GetPrinterRequest(string Id, string Name) : ClientRequest(Id);

/// <summary>
/// 按 HTML 文档打印
/// </summary>
public sealed record PrintHtmlRequest(string Id, string JobId, PrintDocument Document, string? Printer, PrintOptions Options) : ClientRequest(Id);

/// <summary>
/// 把原始指令原样写给打印机
/// </summary>
public sealed record PrintRawRequest(string Id, string JobId, string Printer, byte[] Data, string? DocName) : ClientRequest(Id);

/// <summary>
/// 把 HTML 文档导出为 PDF
/// </summary>
public sealed record ExportPdfRequest(string Id, string JobId, PrintDocument Document, PrintOptions Options) : ClientRequest(Id);

/// <summary>
/// 查任务状态
/// </summary>
public sealed record GetJobRequest(string Id, string JobId) : ClientRequest(Id);

/// <summary>
/// 取消任务
/// </summary>
public sealed record CancelJobRequest(string Id, string JobId) : ClientRequest(Id);

/// <summary>
/// 发起连接的 SDK
/// </summary>
public sealed class SdkInfo
{
    /// <summary>
    /// 包名
    /// </summary>
    public string? Name { get; init; }

    /// <summary>
    /// 版本
    /// </summary>
    public string? Version { get; init; }
}

/// <summary>
/// 要打印的 HTML 文档：输出页与随任务带来的资源，以及按出现顺序的纸张分组
/// </summary>
/// <param name="Html">自包含的输出页，资源地址已改写到客户端的虚拟地址</param>
/// <param name="Resources">资源，Data 为解码后的字节</param>
/// <param name="Sheets">纸张分组</param>
public sealed record PrintDocument(string Html, IReadOnlyList<DocumentResource> Resources, IReadOnlyList<SheetGroup> Sheets)
{
    /// <summary>
    /// 输出页总数
    /// </summary>
    public int SheetCount => Sheets.Sum(group => group.Count);
}

/// <summary>
/// 随任务带来的一份资源
/// </summary>
/// <param name="Id">资源编号，文档里经 r/{Id} 引用</param>
/// <param name="Type">媒体类型</param>
/// <param name="Data">字节</param>
public sealed record DocumentResource(string Id, string Type, byte[] Data);

/// <summary>
/// 连续的若干张同尺寸输出页
/// </summary>
/// <param name="WidthMm">宽，毫米</param>
/// <param name="HeightMm">高，毫米</param>
/// <param name="Count">张数</param>
public sealed record SheetGroup(double WidthMm, double HeightMm, int Count);

/// <summary>
/// 双面方式
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<DuplexMode>))]
public enum DuplexMode
{
    /// <summary>
    /// 单面
    /// </summary>
    [JsonStringEnumMemberName("simplex")]
    Simplex,

    /// <summary>
    /// 双面，长边翻页
    /// </summary>
    [JsonStringEnumMemberName("long-edge")]
    LongEdge,

    /// <summary>
    /// 双面，短边翻页
    /// </summary>
    [JsonStringEnumMemberName("short-edge")]
    ShortEdge,
}

/// <summary>
/// 颜色方式
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ColorMode>))]
public enum ColorMode
{
    /// <summary>
    /// 彩色
    /// </summary>
    [JsonStringEnumMemberName("color")]
    Color,

    /// <summary>
    /// 灰度
    /// </summary>
    [JsonStringEnumMemberName("grayscale")]
    Grayscale,
}

/// <summary>
/// 打印选项
/// </summary>
public sealed class PrintOptions
{
    /// <summary>
    /// 份数，1–999
    /// </summary>
    public int Copies { get; init; } = 1;

    /// <summary>
    /// 多份时逐份打印
    /// </summary>
    public bool Collate { get; init; } = true;

    /// <summary>
    /// 双面方式
    /// </summary>
    public DuplexMode Duplex { get; init; } = DuplexMode.Simplex;

    /// <summary>
    /// 颜色方式
    /// </summary>
    public ColorMode Color { get; init; } = ColorMode.Color;

    /// <summary>
    /// 页码范围，如 1-3,5；缺省全部
    /// </summary>
    public string? PageRanges { get; init; }

    /// <summary>
    /// 弹系统打印对话框，缺省静默
    /// </summary>
    public bool Dialog { get; init; }

    /// <summary>
    /// 交给打印池的期限，毫秒；缺省用客户端的期限
    /// </summary>
    public int? TimeoutMs { get; init; }
}
