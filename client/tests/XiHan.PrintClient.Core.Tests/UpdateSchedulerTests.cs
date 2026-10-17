// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net;
using XiHan.PrintClient.Core.Server;
using XiHan.PrintClient.Core.Updates;

namespace XiHan.PrintClient.Core.Tests;

public sealed class UpdateSchedulerTests
{
    [Fact]
    public void CreatesOneTimerPerLifetimeWithTheScheduledDelays()
    {
        var time = new ManualTimers();
        using var scheduler = new UpdateScheduler((_, _) => Task.CompletedTask, () => true, time);

        scheduler.Start();
        scheduler.Start();
        scheduler.Start();

        var timer = Assert.Single(time.Created);
        Assert.Equal((TimeSpan.FromMinutes(2), TimeSpan.FromDays(1)), (timer.DueTime, timer.Period));
    }

    [Fact]
    public async Task ChecksAutomaticallyOnEachTickAndSkipsWhileStillChecking()
    {
        var time = new ManualTimers();
        var triggers = new List<UpdateTrigger>();
        var gate = new TaskCompletionSource();
        using var scheduler = new UpdateScheduler(async (trigger, cancellationToken) =>
        {
            triggers.Add(trigger);
            await gate.Task.WaitAsync(cancellationToken);
        }, () => true, time);
        scheduler.Start();
        var timer = time.Created[0];

        timer.Fire();
        timer.Fire();
        gate.SetResult();
        await Task.Delay(50, TestContext.Current.CancellationToken);
        timer.Fire();
        await Task.Delay(50, TestContext.Current.CancellationToken);

        Assert.Equal([UpdateTrigger.Automatic, UpdateTrigger.Automatic], triggers);
    }

    [Fact]
    public void SkipsTicksWhileChecksAreTurnedOffAndStopsWhenDisposed()
    {
        var time = new ManualTimers();
        var enabled = false;
        var checks = 0;
        var scheduler = new UpdateScheduler((_, _) =>
        {
            checks++;
            return Task.CompletedTask;
        }, () => enabled, time);
        scheduler.Start();
        var timer = time.Created[0];

        timer.Fire();
        enabled = true;
        timer.Fire();
        scheduler.Dispose();
        scheduler.Start();

        Assert.Equal(1, checks);
        Assert.True(timer.Disposed);
        Assert.Single(time.Created);
    }

    [Theory]
    [InlineData(UpdateTrigger.Automatic, "自动")]
    [InlineData(UpdateTrigger.Manual, "手动")]
    public async Task LogsWhereEachCheckCameFrom(UpdateTrigger trigger, string label)
    {
        var log = new ListLog();
        var checker = new UpdateChecker(new HttpClient(new NotFoundHandler()), [new Uri("https://updates.example/client.json")], new SemanticVersion(0, 1, 0, null), "x64", log);

        await checker.CheckAsync(trigger, TestContext.Current.CancellationToken);

        Assert.Equal($"检查更新（{label}）", log.Lines[0]);
        Assert.StartsWith($"取不到更新清单 https://updates.example/client.json（{label}）", log.Lines[1]);
    }

    private sealed class ManualTimers : TimeProvider
    {
        public List<ManualTimer> Created { get; } = [];

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(() => callback(state), dueTime, period);
            Created.Add(timer);
            return timer;
        }
    }

    private sealed class ManualTimer(Action fire, TimeSpan dueTime, TimeSpan period) : ITimer
    {
        public TimeSpan DueTime { get; } = dueTime;

        public TimeSpan Period { get; } = period;

        public bool Disposed { get; private set; }

        public void Fire()
        {
            if (!Disposed)
                fire();
        }

        public bool Change(TimeSpan dueTime, TimeSpan period) => throw new NotSupportedException();

        public void Dispose() => Disposed = true;

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class ListLog : IClientLog
    {
        public List<string> Lines { get; } = [];

        public void Write(LogLevel level, string message, Exception? exception = null) => Lines.Add(message);
    }

    private sealed class NotFoundHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
