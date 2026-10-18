// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 任务的种类
/// </summary>
public enum JobKind
{
    /// <summary>
    /// 按 HTML 文档打印
    /// </summary>
    Html,

    /// <summary>
    /// 写原始指令
    /// </summary>
    Raw,

    /// <summary>
    /// 导出 PDF
    /// </summary>
    Pdf,
}

/// <summary>
/// 一个打印任务：属于某个会话，在某条队列里排队执行
/// </summary>
public sealed class PrintJob
{
    private PrintJob(string id, ClientSession session, JobKind kind, string lane, string? printer)
    {
        Id = id;
        Session = session;
        Kind = kind;
        Lane = lane;
        Printer = printer;
    }

    /// <summary>
    /// 任务标识，由 SDK 生成
    /// </summary>
    public string Id { get; }

    /// <summary>
    /// 所属会话
    /// </summary>
    public ClientSession Session { get; }

    /// <summary>
    /// 种类
    /// </summary>
    public JobKind Kind { get; }

    /// <summary>
    /// 所在队列：同一台打印机一条，导出 PDF 一条
    /// </summary>
    public string Lane { get; }

    /// <summary>
    /// 目标打印机；导出 PDF 时为 null
    /// </summary>
    public string? Printer { get; }

    /// <summary>
    /// 当前状态
    /// </summary>
    public JobState State { get; internal set; } = JobState.Queued;

    /// <summary>
    /// 失败时的错误
    /// </summary>
    public ProtocolError? Error { get; internal set; }

    /// <summary>
    /// HTML 通道完成时的输出页数
    /// </summary>
    public int? Sheets { get; internal set; }

    /// <summary>
    /// 原始通道写出的字节数，或导出的 PDF 大小
    /// </summary>
    public long? Bytes { get; internal set; }

    /// <summary>
    /// HTML 通道完成时的提醒；没有时为 null
    /// </summary>
    public IReadOnlyList<ProtocolWarning>? Warnings { get; internal set; }

    /// <summary>
    /// 受理的时间
    /// </summary>
    public DateTimeOffset CreatedAt { get; internal set; }

    /// <summary>
    /// 结束的时间
    /// </summary>
    public DateTimeOffset? FinishedAt { get; internal set; }

    /// <summary>
    /// 是否已经结束
    /// </summary>
    public bool IsFinished => State is JobState.Completed or JobState.Failed or JobState.Cancelled;

    internal PrintDocument? Document { get; private init; }

    internal byte[]? Data { get; private init; }

    internal string DocumentName { get; private init; } = string.Empty;

    internal PrintOptions Options { get; private init; } = new();

    internal CancellationTokenSource Cancellation { get; } = new();

    /// <summary>
    /// 按 HTML 文档打印的任务
    /// </summary>
    public static PrintJob Html(string id, ClientSession session, string printer, PrintDocument document, PrintOptions options)
    {
        return new PrintJob(id, session, JobKind.Html, LaneOf(printer), printer) { Document = document, Options = options };
    }

    /// <summary>
    /// 写原始指令的任务
    /// </summary>
    public static PrintJob Raw(string id, ClientSession session, string printer, byte[] data, string documentName)
    {
        return new PrintJob(id, session, JobKind.Raw, LaneOf(printer), printer) { Data = data, DocumentName = documentName };
    }

    /// <summary>
    /// 导出 PDF 的任务
    /// </summary>
    public static PrintJob Pdf(string id, ClientSession session, PrintDocument document, PrintOptions options)
    {
        return new PrintJob(id, session, JobKind.Pdf, "pdf", null) { Document = document, Options = options };
    }

    /// <summary>
    /// 当前状态的快照；position 为排队中时前面还有几个任务
    /// </summary>
    public JobStatus Snapshot(int? position = null) => new()
    {
        JobId = Id,
        State = State,
        Position = State == JobState.Queued ? position : null,
        Sheets = Sheets,
        Bytes = Bytes,
        Error = Error,
        Warnings = Warnings,
    };

    /// <summary>
    /// 供诊断用的元数据，不含文档与指令内容
    /// </summary>
    public JobRecord Record() => new(Id, Session.Origin, Kind, Printer, State, Error?.Code, Sheets, Bytes, CreatedAt, FinishedAt);

    private static string LaneOf(string printer) => "printer:" + printer.ToUpperInvariant();
}

/// <summary>
/// 一个任务的元数据
/// </summary>
/// <param name="Id">任务标识</param>
/// <param name="Origin">来源</param>
/// <param name="Kind">种类</param>
/// <param name="Printer">打印机；导出 PDF 时为 null</param>
/// <param name="State">状态</param>
/// <param name="ErrorCode">失败时的错误码</param>
/// <param name="Sheets">输出页数</param>
/// <param name="Bytes">写出或导出的字节数</param>
/// <param name="CreatedAt">受理时间</param>
/// <param name="FinishedAt">结束时间</param>
public sealed record JobRecord(string Id, string Origin, JobKind Kind, string? Printer, JobState State, string? ErrorCode, int? Sheets, long? Bytes, DateTimeOffset CreatedAt, DateTimeOffset? FinishedAt);
