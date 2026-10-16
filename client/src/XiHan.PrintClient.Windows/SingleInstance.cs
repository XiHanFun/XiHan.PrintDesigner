// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Diagnostics;
using System.IO.Pipes;

namespace XiHan.PrintClient.Windows;

/// <summary>
/// 单实例：同一登录会话里只留一个进程。先占住命名互斥体的就是首个实例，它在命名管道上等后来者的通知；
/// 管道只接受同一用户的连接
/// </summary>
public sealed class SingleInstance : IDisposable
{
    /// <summary>
    /// 缺省名称
    /// </summary>
    public const string DefaultName = "XiHanFun.PrintClient";

    private readonly Mutex _mutex;
    private readonly string _pipeName;
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _listening;

    private SingleInstance(Mutex mutex, string pipeName)
    {
        _mutex = mutex;
        _pipeName = pipeName;
        _listening = ListenAsync();
    }

    /// <summary>
    /// 后来的进程发来通知时触发，在线程池线程上
    /// </summary>
    public event Action? Activated;

    /// <summary>
    /// 尝试成为首个实例；已有首个实例时返回 null
    /// </summary>
    public static SingleInstance? TryAcquire(string name = DefaultName)
    {
        var mutex = new Mutex(initiallyOwned: false, @"Local\" + name, out var createdNew);
        if (createdNew)
            return new SingleInstance(mutex, PipeName(name));
        mutex.Dispose();
        return null;
    }

    /// <summary>
    /// 通知首个实例把窗口带到前台；在期限内连不上时返回 false
    /// </summary>
    public static async Task<bool> SignalAsync(string name = DefaultName, TimeSpan? timeout = null)
    {
        await using var pipe = new NamedPipeClientStream(".", PipeName(name), PipeDirection.Out, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        using var limit = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(3));
        try
        {
            await pipe.ConnectAsync(limit.Token).ConfigureAwait(false);
            await pipe.WriteAsync(new byte[] { 1 }, limit.Token).ConfigureAwait(false);
            return true;
        }
        catch (Exception error) when (error is OperationCanceledException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _stopping.Cancel();
        try
        {
            _listening.Wait(TimeSpan.FromSeconds(3));
        }
        catch (AggregateException)
        {
        }
        _stopping.Dispose();
        _mutex.Dispose();
    }

    private static string PipeName(string name) => $"{name}.{Process.GetCurrentProcess().SessionId}";

    private async Task ListenAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(_pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(_stopping.Token).ConfigureAwait(false);
                var buffer = new byte[1];
                if (await pipe.ReadAsync(buffer, _stopping.Token).ConfigureAwait(false) > 0)
                    Activated?.Invoke();
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
            }
        }
    }
}
