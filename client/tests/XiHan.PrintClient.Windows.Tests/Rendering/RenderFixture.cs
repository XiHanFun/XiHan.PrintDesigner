// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Collections.Concurrent;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Windows.Rendering;

namespace XiHan.PrintClient.Windows.Tests.Rendering;

/// <summary>
/// 一个跑消息循环的界面线程，上面建好隐藏窗口与渲染引擎，整个测试类共用
/// </summary>
public sealed class RenderFixture : IAsyncLifetime
{
    private readonly string _dataFolder = Path.Combine(Path.GetTempPath(), "xihan-print-webview-" + Guid.NewGuid().ToString("N"));
    private Thread? _thread;
    private Form? _window;
    private SynchronizationContext? _context;

    public WebView2PrintEngine Engine { get; private set; } = null!;

    public FakeDialog Dialog { get; } = new();

    public async ValueTask InitializeAsync()
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _thread = new Thread(() =>
        {
            _window = new Form { ShowInTaskbar = false };
            _ = _window.Handle;
            _context = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(_context);
            ready.SetResult();
            Application.Run();
        });
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.IsBackground = true;
        _thread.Start();
        await ready.Task;

        var created = new TaskCompletionSource<WebView2PrintEngine>(TaskCreationOptions.RunContinuationsAsynchronously);
        _context!.Post(async _ =>
        {
            try
            {
                created.SetResult(await WebView2PrintEngine.CreateAsync(_window!.Handle, _dataFolder, Dialog));
            }
            catch (Exception error)
            {
                created.SetException(error);
            }
        }, null);
        Engine = await created.Task;
    }

    public ValueTask DisposeAsync()
    {
        _context?.Post(_ =>
        {
            _window?.Dispose();
            Application.ExitThread();
        }, null);
        _thread?.Join(TimeSpan.FromSeconds(10));
        try
        {
            Directory.Delete(_dataFolder, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
        return ValueTask.CompletedTask;
    }

    /// <summary>
    /// 记下每次询问，按 Choose 给出结果；缺省视为用户取消
    /// </summary>
    public sealed class FakeDialog : IPrintDialog
    {
        public ConcurrentQueue<(string Printer, int Sheets, bool OnUiThread)> Asked { get; } = new();

        public Func<string, PrintOptions, PrintDialogChoice?> Choose { get; set; } = (_, _) => null;

        public Task<PrintDialogChoice?> AskAsync(string printer, PrintOptions options, int sheetCount, CancellationToken cancellationToken)
        {
            Asked.Enqueue((printer, sheetCount, SynchronizationContext.Current is WindowsFormsSynchronizationContext));
            return Task.FromResult(Choose(printer, options));
        }
    }
}
