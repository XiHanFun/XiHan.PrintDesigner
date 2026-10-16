// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Nodes;
using System.Threading.Channels;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 任务队列的期限与上限
/// </summary>
public sealed class JobQueueOptions
{
    /// <summary>
    /// 单个任务从开始执行到交给打印池（或导出完毕）的期限；请求里给了 timeoutMs 时以请求为准
    /// </summary>
    public TimeSpan JobTimeout { get; init; } = TimeSpan.FromSeconds(150);

    /// <summary>
    /// 同一会话同时排队与执行的任务上限
    /// </summary>
    public int MaxActivePerSession { get; init; } = 100;

    /// <summary>
    /// 已结束任务最多留多少个供查询
    /// </summary>
    public int MaxFinishedRetained { get; init; } = 1000;
}

/// <summary>
/// 任务队列：同一台打印机一条队列，导出 PDF 一条队列，队列内按先后逐个执行，队列之间互不等待；
/// 状态变化以任务事件发给所属会话的当前连接
/// </summary>
public sealed class JobQueue : IAsyncDisposable
{
    private readonly IHtmlPrintEngine? _html;
    private readonly IRawPrinter? _raw;
    private readonly JobQueueOptions _options;
    private readonly TimeProvider _time;
    private readonly IClientLog _log;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, PrintJob> _jobs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Lane> _lanes = new(StringComparer.Ordinal);
    private readonly Queue<PrintJob> _finished = new();
    private readonly CancellationTokenSource _stopping = new();

    /// <summary>
    /// 创建队列；平台不提供的通道传 null
    /// </summary>
    public JobQueue(IHtmlPrintEngine? html, IRawPrinter? raw, JobQueueOptions? options = null, TimeProvider? time = null, IClientLog? log = null)
    {
        _html = html;
        _raw = raw;
        _options = options ?? new JobQueueOptions();
        _time = time ?? TimeProvider.System;
        _log = log ?? NullClientLog.Instance;
    }

    /// <summary>
    /// 受理任务：先经 acknowledge 回复受理结果，再推送 queued 事件并排进队列；不能受理时返回错误，什么都不发
    /// </summary>
    public async Task<ProtocolError?> EnqueueAsync(PrintJob job, Func<JobAccepted, Task> acknowledge)
    {
        Lane lane;
        int position;
        lock (_gate)
        {
            if (_jobs.ContainsKey(job.Id))
                return new ProtocolError(PrintErrorCodes.JobDuplicate, $"任务标识重复：{job.Id}", new JsonObject { ["jobId"] = job.Id });
            var active = _jobs.Values.Count(item => ReferenceEquals(item.Session, job.Session) && !item.IsFinished);
            if (active >= _options.MaxActivePerSession)
                return new ProtocolError(PrintErrorCodes.QueueFull, $"同一会话最多同时排 {_options.MaxActivePerSession} 个任务");
            if (!_lanes.TryGetValue(job.Lane, out lane!))
            {
                lane = new Lane(job.Lane);
                _lanes[job.Lane] = lane;
                lane.Worker = Task.Run(() => DrainAsync(lane));
            }
            position = lane.Active.Count;
            lane.Active.Add(job);
            job.CreatedAt = _time.GetUtcNow();
            _jobs[job.Id] = job;
        }
        _log.Write(LogLevel.Information, $"受理任务 {job.Id}：{job.Kind} {job.Printer ?? "pdf"}，来源 {job.Session.Origin}");
        await acknowledge(new JobAccepted(job.Id, position)).ConfigureAwait(false);
        await SendAsync(job, position).ConfigureAwait(false);
        lane.Pending.Writer.TryWrite(job);
        return null;
    }

    /// <summary>
    /// 查同一会话的任务状态；查不到时为 null
    /// </summary>
    public JobStatus? Status(ClientSession session, string jobId)
    {
        lock (_gate)
        {
            if (!_jobs.TryGetValue(jobId, out var job) || !ReferenceEquals(job.Session, session))
                return null;
            return job.Snapshot(PositionOf(job));
        }
    }

    /// <summary>
    /// 取消同一会话的任务：排队中的直接取消并返回 true；执行中的尽力取消并返回 false，结果以任务事件为准；
    /// 已结束的返回 false；查不到时为 null
    /// </summary>
    public async Task<bool?> CancelAsync(ClientSession session, string jobId)
    {
        PrintJob? job;
        JobState state;
        lock (_gate)
        {
            if (!_jobs.TryGetValue(jobId, out job) || !ReferenceEquals(job.Session, session))
                return null;
            state = job.State;
            if (state == JobState.Queued)
                FinishLocked(job, JobState.Cancelled);
        }
        if (state == JobState.Queued)
            await SendAsync(job).ConfigureAwait(false);
        else if (state == JobState.Started)
            await job.Cancellation.CancelAsync().ConfigureAwait(false);
        return state == JobState.Queued;
    }

    /// <summary>
    /// 最近受理的若干个任务，新的在前
    /// </summary>
    public IReadOnlyList<JobRecord> Recent(int count)
    {
        lock (_gate)
            return [.. _jobs.Values.OrderByDescending(job => job.CreatedAt).Take(count).Select(job => job.Record())];
    }

    /// <summary>
    /// 会话名下仍未结束的任务
    /// </summary>
    public IReadOnlyList<PrintJob> Unfinished(ClientSession session)
    {
        lock (_gate)
            return [.. _jobs.Values.Where(job => ReferenceEquals(job.Session, session) && !job.IsFinished)];
    }

    /// <summary>
    /// 补发会话名下未结束任务的当前状态
    /// </summary>
    public async Task ReplayAsync(ClientSession session, CancellationToken cancellationToken)
    {
        List<(PrintJob Job, int? Position)> unfinished;
        lock (_gate)
            unfinished = [.. _jobs.Values.Where(job => ReferenceEquals(job.Session, session) && !job.IsFinished).Select(job => (job, PositionOf(job)))];
        foreach (var (job, position) in unfinished)
            await session.SendAsync(ProtocolWriter.JobEvent(job.Snapshot(position), _time.GetUtcNow()), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// 会话过了重连期限：丢掉它名下已结束的任务，未结束的照常执行完
    /// </summary>
    public void Forget(ClientSession session)
    {
        lock (_gate)
        {
            foreach (var job in _jobs.Values.Where(job => ReferenceEquals(job.Session, session) && job.IsFinished).ToList())
                _jobs.Remove(job.Id);
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync().ConfigureAwait(false);
        Task[] workers;
        lock (_gate)
        {
            foreach (var lane in _lanes.Values)
                lane.Pending.Writer.TryComplete();
            workers = [.. _lanes.Values.Select(lane => lane.Worker!)];
        }
        await Task.WhenAll(workers).ConfigureAwait(false);
        _stopping.Dispose();
    }

    private async Task DrainAsync(Lane lane)
    {
        try
        {
            await foreach (var job in lane.Pending.Reader.ReadAllAsync(_stopping.Token).ConfigureAwait(false))
                await RunAsync(job).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task RunAsync(PrintJob job)
    {
        lock (_gate)
        {
            if (job.State != JobState.Queued)
                return;
            job.State = JobState.Started;
        }
        await SendAsync(job).ConfigureAwait(false);

        var timeout = job.Options.TimeoutMs is { } ms ? TimeSpan.FromMilliseconds(ms) : _options.JobTimeout;
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(job.Cancellation.Token, _stopping.Token);
        limit.CancelAfter(timeout);
        JobState state;
        try
        {
            await ExecuteAsync(job, limit.Token).ConfigureAwait(false);
            state = JobState.Completed;
        }
        catch (PrintFailure failure)
        {
            job.Error = failure.ToError();
            state = JobState.Failed;
        }
        catch (OperationCanceledException) when (job.Cancellation.IsCancellationRequested)
        {
            state = JobState.Cancelled;
        }
        catch (PrintCancelledByUser)
        {
            state = JobState.Cancelled;
        }
        catch (OperationCanceledException) when (!_stopping.IsCancellationRequested)
        {
            var code = job.Kind == JobKind.Pdf ? PrintErrorCodes.PdfFailed : PrintErrorCodes.SpoolFailed;
            job.Error = new ProtocolError(code, $"任务超过 {timeout.TotalSeconds:0} 秒没有完成", new JsonObject { ["timeout"] = true });
            state = JobState.Failed;
        }
        catch (OperationCanceledException)
        {
            job.Error = new ProtocolError(PrintErrorCodes.Internal, "客户端正在退出");
            state = JobState.Failed;
        }
        catch (Exception error)
        {
            _log.Write(LogLevel.Error, $"任务 {job.Id} 出错", error);
            job.Error = new ProtocolError(PrintErrorCodes.Internal, "客户端内部错误，详情见日志");
            state = JobState.Failed;
        }

        lock (_gate)
            FinishLocked(job, state);
        _log.Write(state == JobState.Completed ? LogLevel.Information : LogLevel.Warning, $"任务 {job.Id} {ProtocolWriter.StateName(state)}{(job.Error is null ? string.Empty : "：" + job.Error.Code)}");
        await SendAsync(job).ConfigureAwait(false);
    }

    private async Task ExecuteAsync(PrintJob job, CancellationToken cancellationToken)
    {
        switch (job.Kind)
        {
            case JobKind.Html:
                job.Sheets = await Require(_html).PrintAsync(job.Document!, job.Printer!, job.Options, cancellationToken).ConfigureAwait(false);
                break;
            case JobKind.Raw:
                job.Bytes = await Require(_raw).WriteAsync(job.Printer!, job.Data!, job.DocumentName, cancellationToken).ConfigureAwait(false);
                break;
            case JobKind.Pdf:
                var pdf = await Require(_html).ExportPdfAsync(job.Document!, job.Options, cancellationToken).ConfigureAwait(false);
                job.Bytes = pdf.Length;
                var delivered = await job.Session.SendAsync(ProtocolWriter.JobOutput(job.Id, "application/pdf", pdf.Length), cancellationToken).ConfigureAwait(false)
                    && await job.Session.SendBinaryAsync(pdf, cancellationToken).ConfigureAwait(false);
                if (!delivered)
                    throw new PrintFailure(PrintErrorCodes.PdfFailed, "导出完成时连接已断开，结果没有送到", new JsonObject { ["delivered"] = false });
                break;
        }
    }

    private static T Require<T>(T? backend) where T : class
    {
        return backend ?? throw new PrintFailure(PrintErrorCodes.CapabilityUnsupported, "这台机器上的客户端没有这项能力");
    }

    private void FinishLocked(PrintJob job, JobState state)
    {
        job.State = state;
        job.FinishedAt = _time.GetUtcNow();
        if (_lanes.TryGetValue(job.Lane, out var lane))
            lane.Active.Remove(job);
        _finished.Enqueue(job);
        while (_finished.Count > _options.MaxFinishedRetained)
        {
            var oldest = _finished.Dequeue();
            if (_jobs.TryGetValue(oldest.Id, out var current) && ReferenceEquals(current, oldest))
                _jobs.Remove(oldest.Id);
        }
    }

    private int? PositionOf(PrintJob job)
    {
        return job.State == JobState.Queued && _lanes.TryGetValue(job.Lane, out var lane) ? lane.Active.IndexOf(job) : null;
    }

    private Task<bool> SendAsync(PrintJob job, int? position = null)
    {
        JobStatus status;
        lock (_gate)
            status = job.Snapshot(position ?? PositionOf(job));
        return job.Session.SendAsync(ProtocolWriter.JobEvent(status, _time.GetUtcNow()));
    }

    /// <summary>
    /// 一条队列：排队与执行中的任务按先后排列，待执行的任务经通道交给工作循环
    /// </summary>
    private sealed class Lane(string key)
    {
        public string Key { get; } = key;

        public List<PrintJob> Active { get; } = [];

        public Channel<PrintJob> Pending { get; } = Channel.CreateUnbounded<PrintJob>(new UnboundedChannelOptions { SingleReader = true });

        public Task? Worker { get; set; }
    }
}
