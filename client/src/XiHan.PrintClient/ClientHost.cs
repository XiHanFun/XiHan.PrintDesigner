// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using XiHan.PrintClient.Core;
using XiHan.PrintClient.Core.Consent;
using XiHan.PrintClient.Core.Diagnostics;
using XiHan.PrintClient.Core.Logging;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Core.Server;
using XiHan.PrintClient.Windows;
using XiHan.PrintClient.Windows.Printing;
using XiHan.PrintClient.Windows.Rendering;

namespace XiHan.PrintClient;

/// <summary>
/// 把各层组装起来：设置与日志、策略与来源名单、打印机、渲染引擎、任务队列、回环服务；在界面线程上创建与启动
/// </summary>
internal sealed class ClientHost : IClientEnvironment, IAsyncDisposable
{
    private readonly Control _window;
    private System.Threading.Timer? _sweep;

    /// <summary>
    /// 以承载隐藏渲染页与对话框的窗口创建，读好设置、日志、策略与来源名单
    /// </summary>
    public ClientHost(Control window)
    {
        _window = window;
        Paths = new WindowsAppPaths();
        SettingsFile = Path.Combine(Paths.SettingsDirectory, "settings.json");
        OriginsFile = Path.Combine(Paths.SettingsDirectory, "origins.json");
        Settings = ClientSettings.Load(SettingsFile);
        Log = new FileClientLog(Paths.LogDirectory, Settings.LogLevel);
        Policy = ClientPolicy.Load(Paths.PolicyFile, Log);
        Lists = new OriginLists(OriginsFile, Log);
        AutoStart = new AutoStart(Environment.ProcessPath ?? Application.ExecutablePath);
        Info = new ClientInfo { Version = ProductVersion, Os = "windows", Arch = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant() };
        Capabilities = new ClientCapabilities { Raw = true, Duplex = true, PrinterStatus = true };
        Jobs = new JobQueue(null, Raw, log: Log);
    }

    /// <summary>
    /// 产品版本，不含构建元数据
    /// </summary>
    public static string ProductVersion { get; } = (typeof(ClientHost).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0").Split('+')[0];

    public WindowsAppPaths Paths { get; }

    public string SettingsFile { get; }

    public string OriginsFile { get; }

    public ClientSettings Settings { get; }

    public FileClientLog Log { get; }

    public ClientPolicy Policy { get; }

    public OriginLists Lists { get; }

    public AutoStart AutoStart { get; }

    public WindowsPrinterCatalog Printers { get; } = new();

    public WindowsRawPrinter Raw { get; } = new();

    public WebView2PrintEngine? Engine { get; private set; }

    public JobQueue Jobs { get; private set; }

    public LoopbackServer? Server { get; private set; }

    /// <summary>
    /// 监听的端口；没在监听时为 null
    /// </summary>
    public int? Port => Server is { Port: > 0 } server ? server.Port : null;

    /// <inheritdoc />
    public ClientInfo Info { get; private set; }

    /// <inheritdoc />
    public ClientCapabilities Capabilities { get; private set; }

    /// <summary>
    /// 是否检查更新：策略与用户设置都允许时才查
    /// </summary>
    public bool ChecksForUpdates => Policy.CheckForUpdates && Settings.CheckForUpdates;

    /// <summary>
    /// 建渲染引擎并开始监听；返回给用户看的问题，没问题时为空
    /// </summary>
    public async Task<IReadOnlyList<string>> StartAsync(IConsentPrompt consent, IPrintDialog dialog)
    {
        var problems = new List<string>();
        Log.Write(LogLevel.Information, $"曦寒打印客户端 {ProductVersion} 启动");
        try
        {
            Engine = await WebView2PrintEngine.CreateAsync(_window.Handle, Paths.RendererDataDirectory, dialog, Log);
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            Log.Write(LogLevel.Warning, "没有 WebView2 运行时，HTML 打印与导出 PDF 不可用", error);
            problems.Add("没有检测到 WebView2 运行时，HTML 打印与导出 PDF 暂不可用。");
        }
        Info = new ClientInfo { Version = Info.Version, Os = Info.Os, Arch = Info.Arch, Renderer = Engine?.Version };
        Capabilities = new ClientCapabilities { Html = Engine is not null, Raw = true, Pdf = Engine is not null, Duplex = true, PrinterStatus = true };
        await Jobs.DisposeAsync();
        Jobs = new JobQueue(Engine, Raw, log: Log);

        var handler = new PrintRequestHandler(Printers, Jobs, Capabilities);
        var authorizer = new OriginAuthorizer(Lists, Policy, consent, log: Log);
        var options = new ServerOptions { Ports = Policy.Ports.Count > 0 ? Policy.Ports : ClientDefaults.Ports };
        var server = new LoopbackServer(options, authorizer, this, handler, log: Log);
        server.Sessions.Expired += Jobs.Forget;
        try
        {
            server.Start();
            Server = server;
            _sweep = new System.Threading.Timer(_ => server.Sessions.Sweep(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
        }
        catch (SocketException error)
        {
            await server.DisposeAsync();
            Log.Write(LogLevel.Error, $"端口 {string.Join(", ", options.Ports)} 都不可用", error);
            problems.Add($"端口 {string.Join("、", options.Ports)} 都被占用，网页暂时连不上客户端。");
        }
        return problems;
    }

    /// <summary>
    /// 改日志级别并存设置
    /// </summary>
    public void SetLogLevel(LogLevel level)
    {
        Settings.LogLevel = level;
        Log.Minimum = level;
        Settings.Save(SettingsFile);
    }

    /// <summary>
    /// 改是否检查更新并存设置
    /// </summary>
    public void SetCheckForUpdates(bool enabled)
    {
        Settings.CheckForUpdates = enabled;
        Settings.Save(SettingsFile);
    }

    /// <summary>
    /// 当前的诊断信息
    /// </summary>
    public string DiagnosticsText()
    {
        return DiagnosticsReport.Format(new DiagnosticsInput
        {
            Client = Info,
            Port = Port,
            Policy = Policy,
            PolicyFileExists = File.Exists(Paths.PolicyFile),
            Allowed = Lists.Allowed,
            Denied = Lists.Denied,
            RecentJobs = Jobs.Recent(DiagnosticsReport.RecentJobCount),
        });
    }

    /// <summary>
    /// 导出诊断包
    /// </summary>
    public void ExportDiagnostics(string zipPath)
    {
        DiagnosticsReport.Export(zipPath, DiagnosticsText(), Paths.LogDirectory, [SettingsFile, OriginsFile], Paths.PolicyFile);
        Log.Write(LogLevel.Information, $"导出诊断包 {zipPath}");
    }

    /// <summary>
    /// 给打印机印一张自检页，返回结果说明
    /// </summary>
    public async Task<string> TestPrintAsync(string printer)
    {
        if (Engine is null)
            return "没有 WebView2 运行时，印不了自检页。";
        try
        {
            var info = Printers.Get(printer);
            if (info is null)
                return $"没有这台打印机：{printer}";
            var (width, height) = SelfTestDocument.PaperFor(info);
            var document = SelfTestDocument.Create(Info, info.Name, width, height, DateTimeOffset.Now);
            using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            await Engine.PrintAsync(document, info.Name, new PrintOptions(), limit.Token);
            Log.Write(LogLevel.Information, $"自检页已交给 {info.Name}");
            return $"自检页已交给「{info.Name}」的打印队列。";
        }
        catch (PrintFailure failure)
        {
            Log.Write(LogLevel.Warning, $"自检页失败：{failure.Code}", failure);
            return $"自检页没印成：{failure.Message}（{failure.Code}）";
        }
        catch (OperationCanceledException)
        {
            return "自检页超过 2 分钟没有交给打印池。";
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_sweep is not null)
            await _sweep.DisposeAsync();
        if (Server is not null)
            await Server.DisposeAsync();
        await Jobs.DisposeAsync();
        Log.Write(LogLevel.Information, "曦寒打印客户端退出");
        Log.Dispose();
    }
}
