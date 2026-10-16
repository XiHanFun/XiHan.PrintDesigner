// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 业务请求的处理：查打印机、核对能力与目标打印机后把任务交给队列、查与取消任务
/// </summary>
public sealed class PrintRequestHandler : IRequestHandler
{
    private readonly IPrinterCatalog _printers;
    private readonly JobQueue _jobs;
    private readonly ClientCapabilities _capabilities;

    /// <summary>
    /// 以打印机查询、任务队列与客户端能力创建
    /// </summary>
    public PrintRequestHandler(IPrinterCatalog printers, JobQueue jobs, ClientCapabilities capabilities)
    {
        _printers = printers;
        _jobs = jobs;
        _capabilities = capabilities;
    }

    /// <inheritdoc />
    public async Task HandleAsync(ClientSession session, ClientRequest request, CancellationToken cancellationToken)
    {
        switch (request)
        {
            case ListPrintersRequest list:
                await session.SendAsync(ProtocolWriter.Printers(list.Id, _printers.List()), cancellationToken).ConfigureAwait(false);
                break;
            case GetPrinterRequest get:
                var printer = _printers.Get(get.Name);
                await session.SendAsync(printer is null ? ProtocolWriter.Error(get.Id, PrinterNotFound(get.Name)) : ProtocolWriter.Printer(get.Id, printer), cancellationToken).ConfigureAwait(false);
                break;
            case PrintHtmlRequest html:
                await SubmitAsync(session, html.Id, () =>
                {
                    var (name, error) = Resolve(html.Printer);
                    return (Unsupported(_capabilities.Html, "html") ?? Unsupported(html.Options) ?? error,
                        () => PrintJob.Html(html.JobId, session, name!, html.Document, html.Options));
                }, cancellationToken).ConfigureAwait(false);
                break;
            case PrintRawRequest raw:
                await SubmitAsync(session, raw.Id, () =>
                {
                    var (name, error) = Resolve(raw.Printer);
                    return (Unsupported(_capabilities.Raw, "raw") ?? error,
                        () => PrintJob.Raw(raw.JobId, session, name!, raw.Data, raw.DocName ?? raw.JobId));
                }, cancellationToken).ConfigureAwait(false);
                break;
            case ExportPdfRequest pdf:
                await SubmitAsync(session, pdf.Id, () =>
                    (Unsupported(_capabilities.Pdf, "pdf"), () => PrintJob.Pdf(pdf.JobId, session, pdf.Document, pdf.Options)), cancellationToken).ConfigureAwait(false);
                break;
            case GetJobRequest getJob:
                var status = _jobs.Status(session, getJob.JobId);
                await session.SendAsync(status is null ? ProtocolWriter.Error(getJob.Id, JobNotFound(getJob.JobId)) : ProtocolWriter.Status(getJob.Id, status), cancellationToken).ConfigureAwait(false);
                break;
            case CancelJobRequest cancel:
                var cancelled = await _jobs.CancelAsync(session, cancel.JobId).ConfigureAwait(false);
                await session.SendAsync(cancelled is { } value ? ProtocolWriter.Cancelled(cancel.Id, new JobCancelled(value)) : ProtocolWriter.Error(cancel.Id, JobNotFound(cancel.JobId)), cancellationToken).ConfigureAwait(false);
                break;
            default:
                await session.SendAsync(ProtocolWriter.Error(request.Id, new ProtocolError(PrintErrorCodes.BadRequest, "不认识的请求")), cancellationToken).ConfigureAwait(false);
                break;
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> UnfinishedJobs(ClientSession session) => [.. _jobs.Unfinished(session).Select(job => job.Id)];

    /// <inheritdoc />
    public Task ReplayAsync(ClientSession session, CancellationToken cancellationToken) => _jobs.ReplayAsync(session, cancellationToken);

    private async Task SubmitAsync(ClientSession session, string requestId, Func<(ProtocolError? Error, Func<PrintJob> Create)> prepare, CancellationToken cancellationToken)
    {
        var (error, create) = prepare();
        error ??= await _jobs.EnqueueAsync(create(), accepted => session.SendAsync(ProtocolWriter.Accepted(requestId, accepted), cancellationToken)).ConfigureAwait(false);
        if (error is not null)
            await session.SendAsync(ProtocolWriter.Error(requestId, error), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// 找到目标打印机：没指定时用默认打印机；不存在、脱机、暂停或出错时给出错误
    /// </summary>
    private (string? Name, ProtocolError? Error) Resolve(string? requested)
    {
        var printers = _printers.List();
        if (printers.Count == 0)
            return (null, new ProtocolError(PrintErrorCodes.NoPrinters, "本机没有打印机"));
        var name = string.IsNullOrEmpty(requested) ? _printers.DefaultPrinterName() : requested;
        if (name is null)
            return (null, new ProtocolError(PrintErrorCodes.PrinterNotFound, "没有指定打印机，本机也没有设默认打印机"));
        var printer = printers.FirstOrDefault(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase));
        if (printer is null)
            return (null, PrinterNotFound(name));
        if (printer.Status is PrinterState.Offline or PrinterState.Paused or PrinterState.Error)
        {
            return (null, new ProtocolError(PrintErrorCodes.PrinterOffline, $"打印机当前不可用：{printer.Name}", new JsonObject
            {
                ["printer"] = printer.Name,
                ["status"] = JsonSerializer.SerializeToNode(printer.Status, ProtocolJsonContext.Default.PrinterState),
                ["statusFlags"] = printer.StatusFlags,
            }));
        }
        return (printer.Name, null);
    }

    private ProtocolError? Unsupported(PrintOptions options)
    {
        return options.Duplex != DuplexMode.Simplex && !_capabilities.Duplex ? Unsupported(false, "duplex") : null;
    }

    private static ProtocolError? Unsupported(bool supported, string capability)
    {
        return supported ? null : new ProtocolError(PrintErrorCodes.CapabilityUnsupported, $"这台机器上的客户端不支持 {capability}", new JsonObject { ["capability"] = capability });
    }

    private static ProtocolError PrinterNotFound(string name)
    {
        return new ProtocolError(PrintErrorCodes.PrinterNotFound, $"没有这台打印机：{name}", new JsonObject { ["printer"] = name });
    }

    private static ProtocolError JobNotFound(string jobId)
    {
        return new ProtocolError(PrintErrorCodes.JobNotFound, $"没有这个任务：{jobId}", new JsonObject { ["jobId"] = jobId });
    }
}
