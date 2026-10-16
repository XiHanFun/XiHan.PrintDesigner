// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using Microsoft.Win32;

namespace XiHan.PrintClient.Windows.Tests;

public sealed class HostingTests : IDisposable
{
    private readonly string _keyPath = @"Software\XiHanFun.PrintClient.Tests." + Guid.NewGuid().ToString("N");

    public void Dispose() => Registry.CurrentUser.DeleteSubKeyTree(_keyPath, throwOnMissingSubKey: false);

    [Fact]
    public void TogglesTheAutoStartEntryForThisExecutable()
    {
        var autoStart = new AutoStart(@"C:\Users\me\AppData\Local\Programs\XiHanPrint\XiHanPrint.exe", _keyPath);
        Assert.False(autoStart.IsEnabled);

        autoStart.Set(true);
        Assert.True(autoStart.IsEnabled);
        using (var key = Registry.CurrentUser.OpenSubKey(_keyPath))
            Assert.Equal("\"C:\\Users\\me\\AppData\\Local\\Programs\\XiHanPrint\\XiHanPrint.exe\" --autostart", key!.GetValue(AutoStart.ValueName));
        Assert.False(new AutoStart(@"D:\other\XiHanPrint.exe", _keyPath).IsEnabled);

        autoStart.Set(false);
        autoStart.Set(false);
        Assert.False(autoStart.IsEnabled);
    }

    [Fact]
    public async Task KeepsOneInstanceAndWakesItWhenAnotherStarts()
    {
        var name = "XiHanFun.PrintClient.Tests." + Guid.NewGuid().ToString("N");
        Assert.False(await SingleInstance.SignalAsync(name, TimeSpan.FromMilliseconds(200)));

        using (var first = SingleInstance.TryAcquire(name))
        {
            Assert.NotNull(first);
            var activated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            first.Activated += () => activated.TrySetResult();

            Assert.Null(SingleInstance.TryAcquire(name));
            Assert.True(await SingleInstance.SignalAsync(name));
            await activated.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

            var again = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            first.Activated += () => again.TrySetResult();
            Assert.True(await SingleInstance.SignalAsync(name));
            await again.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        }

        using var next = SingleInstance.TryAcquire(name);
        Assert.NotNull(next);
    }
}
