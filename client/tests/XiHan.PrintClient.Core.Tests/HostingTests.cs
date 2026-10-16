// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Logging;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests;

public sealed class HostingTests : IDisposable
{
    private readonly string _directory = Directory.CreateTempSubdirectory("xihan-print-hosting-").FullName;

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void WritesOneFilePerDayAndSkipsLowerLevels()
    {
        var time = new ManualTime(new DateTimeOffset(2026, 10, 16, 23, 59, 0, TimeSpan.Zero));
        using (var log = new FileClientLog(_directory, LogLevel.Information, time: time))
        {
            log.Write(LogLevel.Debug, "调试");
            log.Write(LogLevel.Information, "受理任务 j1");
            time.Advance(TimeSpan.FromMinutes(2));
            log.Write(LogLevel.Error, "任务 j1 出错", new InvalidOperationException("意外"));
            log.Minimum = LogLevel.Debug;
            log.Write(LogLevel.Debug, "调试打开");
        }

        var first = File.ReadAllLines(Path.Combine(_directory, "print-client-20261016.log"));
        Assert.Equal(["2026-10-16 23:59:00.000 +00:00 [INF] 受理任务 j1"], first);
        var second = File.ReadAllText(Path.Combine(_directory, "print-client-20261017.log"));
        Assert.Contains("[ERR] 任务 j1 出错", second);
        Assert.Contains("System.InvalidOperationException: 意外", second);
        Assert.Contains("[DBG] 调试打开", second);
    }

    [Fact]
    public void KeepsOnlyTheRetainedDaysOfLogs()
    {
        foreach (var day in new[] { "20261001", "20261002", "20261003", "20261005" })
            File.WriteAllText(Path.Combine(_directory, $"print-client-{day}.log"), day);
        File.WriteAllText(Path.Combine(_directory, "notes.txt"), "保留");

        using (var log = new FileClientLog(_directory, retainDays: 3, time: new ManualTime(new DateTimeOffset(2026, 10, 5, 8, 0, 0, TimeSpan.Zero))))
            log.Write(LogLevel.Warning, "启动");

        Assert.Equal(["notes.txt", "print-client-20261003.log", "print-client-20261005.log"], Directory.GetFiles(_directory).Select(Path.GetFileName).Order());
    }

    [Fact]
    public void SettingsRoundTripAndFallBackToDefaults()
    {
        var path = Path.Combine(_directory, "settings", "settings.json");
        Assert.Equal(LogLevel.Information, ClientSettings.Load(path).LogLevel);

        new ClientSettings { LogLevel = LogLevel.Debug, CheckForUpdates = false }.Save(path);
        var loaded = ClientSettings.Load(path);
        Assert.Equal(LogLevel.Debug, loaded.LogLevel);
        Assert.False(loaded.CheckForUpdates);
        Assert.Contains("\"logLevel\": \"debug\"", File.ReadAllText(path));

        File.WriteAllText(path, """
            { "logLevel": "loud", // 不认识的级别
              "checkForUpdates": false, }
            """);
        loaded = ClientSettings.Load(path);
        Assert.Equal(LogLevel.Information, loaded.LogLevel);
        Assert.False(loaded.CheckForUpdates);

        File.WriteAllText(path, "{ broken");
        Assert.True(ClientSettings.Load(path).CheckForUpdates);
    }

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan span) => _now += span;
    }
}
