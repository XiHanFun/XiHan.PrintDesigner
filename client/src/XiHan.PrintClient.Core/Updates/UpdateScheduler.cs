// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Updates;

/// <summary>
/// 一次检查更新的来源
/// </summary>
public enum UpdateTrigger
{
    /// <summary>
    /// 计划检查
    /// </summary>
    Automatic,

    /// <summary>
    /// 用户在托盘菜单里点了检查更新
    /// </summary>
    Manual,
}

/// <summary>
/// 计划检查更新：Start 时建一个计时器，启动后 FirstDelay 查一次，之后每隔 Period 查一次；
/// 一次进程生命周期里计时器只建一个，重复 Start 不再建；上一次还没查完或当前不允许检查时这一轮跳过
/// </summary>
public sealed class UpdateScheduler : IDisposable
{
    /// <summary>
    /// 启动后第一次检查的延迟
    /// </summary>
    public static readonly TimeSpan FirstDelay = TimeSpan.FromMinutes(2);

    /// <summary>
    /// 之后检查的间隔
    /// </summary>
    public static readonly TimeSpan Period = TimeSpan.FromDays(1);

    private readonly Func<UpdateTrigger, CancellationToken, Task> _check;
    private readonly Func<bool> _enabled;
    private readonly TimeProvider _time;
    private readonly IClientLog _log;
    private readonly CancellationTokenSource _stopping = new();
    private readonly Lock _gate = new();
    private ITimer? _timer;
    private int _running;

    /// <summary>
    /// 以检查方法与「当前是否允许检查」创建；检查方法收到的来源总是 <see cref="UpdateTrigger.Automatic"/>
    /// </summary>
    public UpdateScheduler(Func<UpdateTrigger, CancellationToken, Task> check, Func<bool> enabled, TimeProvider? time = null, IClientLog? log = null)
    {
        _check = check;
        _enabled = enabled;
        _time = time ?? TimeProvider.System;
        _log = log ?? NullClientLog.Instance;
    }

    /// <summary>
    /// 开始计划检查；已经开始过时什么都不做
    /// </summary>
    public void Start()
    {
        lock (_gate)
        {
            if (_timer is not null || _stopping.IsCancellationRequested)
                return;
            _timer = _time.CreateTimer(_ => _ = TickAsync(), null, FirstDelay, Period);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            _stopping.Cancel();
            _timer?.Dispose();
            _timer = null;
        }
    }

    private async Task TickAsync()
    {
        if (!_enabled() || Interlocked.Exchange(ref _running, 1) == 1)
            return;
        try
        {
            await _check(UpdateTrigger.Automatic, _stopping.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            _log.Write(LogLevel.Warning, "计划检查更新出错", error);
        }
        finally
        {
            Volatile.Write(ref _running, 0);
        }
    }
}
