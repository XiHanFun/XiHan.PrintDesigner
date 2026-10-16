// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Rendering;

/// <summary>
/// 一个任务的隐藏渲染页：页面脚本关闭，只载入任务文档，资源只从任务里取，其余请求一律拒绝；全部在界面线程上调用
/// </summary>
internal sealed class PrintPage : IAsyncDisposable
{
    /// <summary>
    /// 任务文档所在的保留地址
    /// </summary>
    public const string Origin = "https://print.local/";

    /// <summary>
    /// 任务文档的地址
    /// </summary>
    public const string DocumentUri = Origin + "doc.html";

    private const string ResourcePrefix = Origin + "r/";

    private const string ReadyScript = """
        (() => {
          for (const image of document.images) image.loading = 'eager';
          return Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode().then(() => 0, () => 1))])
            .then(results => JSON.stringify({
              sheets: document.querySelectorAll('[data-part="sheet"]').length,
              broken: results.slice(1).reduce((sum, item) => sum + item, 0),
            }));
        })()
        """;

    private readonly CoreWebView2Environment _environment;
    private readonly CoreWebView2Controller _controller;
    private readonly PrintDocument _document;
    private readonly Dictionary<string, DocumentResource> _resources;
    private readonly TaskCompletionSource _crashed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private string? _blocked;
    private string? _missing;

    private PrintPage(CoreWebView2Environment environment, CoreWebView2Controller controller, PrintDocument document)
    {
        _environment = environment;
        _controller = controller;
        _document = document;
        _resources = document.Resources.ToDictionary(resource => resource.Id, StringComparer.Ordinal);
    }

    private CoreWebView2 WebView => _controller.CoreWebView2;

    /// <summary>
    /// 建好渲染页，载入文档并等到字体与图片就绪；超过期限报 RENDER_TIMEOUT
    /// </summary>
    public static async Task<PrintPage> OpenAsync(CoreWebView2Environment environment, nint parentWindow, PrintDocument document, TimeSpan renderTimeout, CancellationToken cancellationToken)
    {
        var options = environment.CreateCoreWebView2ControllerOptions();
        options.IsInPrivateModeEnabled = true;
        options.ProfileName = "print";
        var controller = await environment.CreateCoreWebView2ControllerAsync(parentWindow, options).WaitAsync(cancellationToken);
        var page = new PrintPage(environment, controller, document);
        try
        {
            page.Configure();
            await page.LoadAsync(renderTimeout, cancellationToken);
            return page;
        }
        catch
        {
            await page.DisposeAsync();
            throw;
        }
    }

    /// <summary>
    /// 只显示 [start, start + count) 这一段输出页，最后一页之后不再分页
    /// </summary>
    public async Task ShowAsync(int start, int count, CancellationToken cancellationToken)
    {
        var end = start + count;
        await EvaluateAsync($$"""
            (() => {
              const sheets = document.querySelectorAll('[data-part="sheet"]');
              sheets.forEach((sheet, index) => {
                sheet.style.display = index >= {{start}} && index < {{end}} ? '' : 'none';
                sheet.style.breakAfter = index === {{end - 1}} ? 'auto' : '';
              });
              return sheets.length;
            })()
            """, cancellationToken);
    }

    /// <summary>
    /// 输出页转为灰度
    /// </summary>
    public Task GrayscaleAsync(CancellationToken cancellationToken)
    {
        return EvaluateAsync("document.documentElement.style.filter = 'grayscale(1)'", cancellationToken);
    }

    /// <summary>
    /// 新建一份打印设置
    /// </summary>
    public CoreWebView2PrintSettings CreatePrintSettings() => _environment.CreatePrintSettings();

    /// <summary>
    /// 按设置交给打印机
    /// </summary>
    public Task<CoreWebView2PrintStatus> PrintAsync(CoreWebView2PrintSettings settings, CancellationToken cancellationToken)
    {
        return GuardAsync(WebView.PrintAsync(settings), cancellationToken);
    }

    /// <summary>
    /// 调 DevTools 协议的方法，返回结果 JSON
    /// </summary>
    public Task<string> DevToolsAsync(string method, string parameters, CancellationToken cancellationToken)
    {
        return GuardAsync(WebView.CallDevToolsProtocolMethodAsync(method, parameters), cancellationToken);
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        _controller.Close();
        return ValueTask.CompletedTask;
    }

    private void Configure()
    {
        _controller.IsVisible = false;
        var settings = WebView.Settings;
        settings.IsScriptEnabled = false;
        settings.IsWebMessageEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsBuiltInErrorPageEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsReputationCheckingRequired = false;

        WebView.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        WebView.WebResourceRequested += OnResourceRequested;
        WebView.NavigationStarting += (_, args) => args.Cancel = args.Uri != DocumentUri;
        WebView.FrameNavigationStarting += (_, args) => args.Cancel = !args.Uri.StartsWith(Origin, StringComparison.Ordinal);
        WebView.NewWindowRequested += (_, args) => args.Handled = true;
        WebView.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        WebView.DownloadStarting += (_, args) => args.Cancel = true;
        WebView.ProcessFailed += (_, args) => _crashed.TrySetException(new PrintFailure(PrintErrorCodes.RenderFailed, $"渲染进程意外退出：{args.ProcessFailedKind}"));
    }

    private async Task LoadAsync(TimeSpan renderTimeout, CancellationToken cancellationToken)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(renderTimeout);
        JsonElement ready;
        try
        {
            var navigated = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(TaskCreationOptions.RunContinuationsAsynchronously);
            WebView.NavigationCompleted += (_, args) => navigated.TrySetResult(args);
            WebView.Navigate(DocumentUri);
            var completed = await GuardAsync(navigated.Task, limit.Token);
            if (!completed.IsSuccess)
                throw new PrintFailure(PrintErrorCodes.RenderFailed, $"文档载入失败：{completed.WebErrorStatus}");
            ready = JsonDocument.Parse(await EvaluateAsync(ReadyScript, limit.Token)).RootElement;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PrintFailure(PrintErrorCodes.RenderTimeout, $"文档超过 {renderTimeout.TotalSeconds:0} 秒没有就绪", new JsonObject { ["timeout"] = true });
        }

        if (_blocked is not null)
            throw new PrintFailure(PrintErrorCodes.ResourceBlocked, "文档引用了任务以外的资源，已拒绝", new JsonObject { ["url"] = _blocked });
        if (_missing is not null)
            throw new PrintFailure(PrintErrorCodes.RenderFailed, "文档引用了任务里没有的资源", new JsonObject { ["resource"] = _missing });
        var broken = ready.GetProperty("broken").GetInt32();
        if (broken > 0)
            throw new PrintFailure(PrintErrorCodes.RenderFailed, $"有 {broken} 张图片解码失败", new JsonObject { ["images"] = broken });
        var sheets = ready.GetProperty("sheets").GetInt32();
        if (sheets != _document.SheetCount)
            throw new PrintFailure(PrintErrorCodes.RenderFailed, $"文档里有 {sheets} 张输出页，纸张分组写的是 {_document.SheetCount} 张", new JsonObject { ["expected"] = _document.SheetCount, ["actual"] = sheets });
    }

    private void OnResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        var uri = args.Request.Uri;
        if (uri.StartsWith("data:", StringComparison.Ordinal) || uri.StartsWith("blob:", StringComparison.Ordinal))
            return;
        if (uri == DocumentUri)
        {
            args.Response = Respond(200, "OK", "text/html; charset=utf-8", Encoding.UTF8.GetBytes(_document.Html));
        }
        else if (uri.StartsWith(ResourcePrefix, StringComparison.Ordinal))
        {
            var id = uri[ResourcePrefix.Length..].Split('?', '#')[0];
            if (_resources.TryGetValue(id, out var resource))
            {
                args.Response = Respond(200, "OK", resource.Type, resource.Data);
            }
            else
            {
                _missing ??= id;
                args.Response = Respond(404, "Not Found", null, []);
            }
        }
        else if (uri.StartsWith(Origin, StringComparison.Ordinal))
        {
            args.Response = Respond(404, "Not Found", null, []);
        }
        else
        {
            _blocked ??= Uri.TryCreate(uri, UriKind.Absolute, out var parsed) ? parsed.GetLeftPart(UriPartial.Authority) : uri[..Math.Min(uri.Length, 64)];
            args.Response = Respond(403, "Forbidden", null, []);
        }
    }

    private CoreWebView2WebResourceResponse Respond(int status, string reason, string? type, byte[] body)
    {
        var headers = type is null ? "Cache-Control: no-store" : $"Content-Type: {type}\r\nCache-Control: no-store";
        return _environment.CreateWebResourceResponse(new MemoryStream(body, writable: false), status, reason, headers);
    }

    private async Task<string> EvaluateAsync(string expression, CancellationToken cancellationToken)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("expression", expression);
            writer.WriteBoolean("awaitPromise", true);
            writer.WriteBoolean("returnByValue", true);
            writer.WriteEndObject();
        }
        var json = await DevToolsAsync("Runtime.evaluate", Encoding.UTF8.GetString(buffer.WrittenSpan), cancellationToken);
        var root = JsonDocument.Parse(json).RootElement;
        if (root.TryGetProperty("exceptionDetails", out var exception))
        {
            var text = exception.TryGetProperty("exception", out var detail) && detail.TryGetProperty("description", out var description) ? description.GetString() : exception.GetProperty("text").GetString();
            throw new PrintFailure(PrintErrorCodes.RenderFailed, "渲染页里的检测脚本出错", new JsonObject { ["exception"] = text });
        }
        var value = root.GetProperty("result");
        return value.TryGetProperty("value", out var result) ? result.ToString() : string.Empty;
    }

    private async Task<T> GuardAsync<T>(Task<T> task, CancellationToken cancellationToken)
    {
        var finished = await Task.WhenAny(task, _crashed.Task).WaitAsync(cancellationToken);
        if (finished == _crashed.Task)
            await _crashed.Task;
        return await task;
    }
}
