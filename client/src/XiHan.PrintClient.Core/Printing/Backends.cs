// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 本机打印机的查询
/// </summary>
public interface IPrinterCatalog
{
    /// <summary>
    /// 列出打印机，不含能力明细
    /// </summary>
    IReadOnlyList<PrinterInfo> List();

    /// <summary>
    /// 查一台打印机，含能力明细；没有这台时为 null
    /// </summary>
    PrinterInfo? Get(string name);

    /// <summary>
    /// 默认打印机的名称；没有时为 null
    /// </summary>
    string? DefaultPrinterName();
}

/// <summary>
/// HTML 通道：渲染输出页，交给打印池或导出 PDF
/// </summary>
public interface IHtmlPrintEngine
{
    /// <summary>
    /// 渲染引擎的版本，写进 welcome
    /// </summary>
    string? Version { get; }

    /// <summary>
    /// 打印到指定打印机，返回交给打印池的输出页数与提醒；失败时抛出 <see cref="PrintFailure"/>
    /// </summary>
    Task<HtmlPrintResult> PrintAsync(PrintDocument document, string printer, PrintOptions options, CancellationToken cancellationToken);

    /// <summary>
    /// 导出为 PDF；失败时抛出 <see cref="PrintFailure"/>
    /// </summary>
    Task<byte[]> ExportPdfAsync(PrintDocument document, PrintOptions options, CancellationToken cancellationToken);
}

/// <summary>
/// HTML 通道打印的结果
/// </summary>
/// <param name="Sheets">交给打印池的输出页数</param>
/// <param name="Warnings">提醒，如没能核对纸张</param>
public sealed record HtmlPrintResult(int Sheets, IReadOnlyList<ProtocolWarning> Warnings);

/// <summary>
/// 下发前核对纸张用的打印机纸张能力
/// </summary>
public interface IPaperCatalog
{
    /// <summary>
    /// 打开一台打印机的纸张能力；没有这台打印机或查不了时为 null
    /// </summary>
    IPrinterPapers? Open(string printer);
}

/// <summary>
/// 一台打印机的纸张能力，用完释放
/// </summary>
public interface IPrinterPapers : IDisposable
{
    /// <summary>
    /// 驱动报的纸张；驱动不报时为空
    /// </summary>
    IReadOnlyList<PaperInfo> Papers { get; }

    /// <summary>
    /// 照渲染引擎下发的写法请求这样放的纸张，驱动实际留下的纸张；读不出驱动的结果时为 null
    /// </summary>
    PaperFeed? Resolve(PaperFeed request);
}

/// <summary>
/// 原始指令通道：把字节原样写给打印机
/// </summary>
public interface IRawPrinter
{
    /// <summary>
    /// 写给指定打印机，返回写出的字节数；失败时抛出 <see cref="PrintFailure"/>
    /// </summary>
    Task<long> WriteAsync(string printer, byte[] data, string documentName, CancellationToken cancellationToken);
}

/// <summary>
/// 打印、导出或写原始指令失败，带协议错误码
/// </summary>
public sealed class PrintFailure : Exception
{
    /// <summary>
    /// 以错误码、说明与附加信息创建
    /// </summary>
    public PrintFailure(string code, string message, JsonObject? details = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Details = details;
    }

    /// <summary>
    /// 错误码，取 <see cref="PrintErrorCodes"/>
    /// </summary>
    public string Code { get; }

    /// <summary>
    /// 附加信息
    /// </summary>
    public JsonObject? Details { get; }

    /// <summary>
    /// 换成协议里的错误
    /// </summary>
    public ProtocolError ToError() => new(Code, Message, Details);
}

/// <summary>
/// 用户在系统打印对话框里取消了打印，任务记为已取消
/// </summary>
public sealed class PrintCancelledByUser : Exception
{
    /// <summary>
    /// 创建
    /// </summary>
    public PrintCancelledByUser()
        : base("用户取消了打印")
    {
    }
}
