// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Diagnostics;
using System.Net;
using System.Reflection;
using XiHan.PrintClient.Core.Server;
using XiHan.PrintClient.Core.Updates;
using XiHan.PrintClient.Windows.Updates;

namespace XiHan.PrintClient;

/// <summary>
/// 自动更新：启动 2 分钟后查一次，之后每天一次；发现新版只提示，用户确认后才下载，
/// 校验 SHA-256 与签名者后静默运行安装包，随后客户端退出由安装包覆盖
/// </summary>
internal sealed class UpdateService : IDisposable
{
    /// <summary>
    /// 运行安装包时附带的参数：静默安装、不重启系统、装完启动客户端
    /// </summary>
    public const string InstallerArguments = "/SILENT /SUPPRESSMSGBOXES /NORESTART /LAUNCH";

    private readonly ClientHost _host;
    private readonly HttpClient _http;
    private readonly UpdateChecker _checker;
    private readonly UpdateScheduler _scheduler;
    private readonly SynchronizationContext _ui;

    public UpdateService(ClientHost host)
    {
        _host = host;
        _http = new HttpClient(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All, ConnectTimeout = TimeSpan.FromSeconds(15) }) { Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"XiHanPrint/{ClientHost.ProductVersion}");
        var manifests = host.Policy.UpdateManifestUrls.Count > 0 ? [.. host.Policy.UpdateManifestUrls.Select(url => new Uri(url))] : UpdateChecker.DefaultManifests;
        SemanticVersion.TryParse(ClientHost.ProductVersion, out var current);
        _checker = new UpdateChecker(_http, manifests, current ?? new SemanticVersion(0, 0, 0, null), host.Info.Arch, host.Log);
        _ui = SynchronizationContext.Current ?? new SynchronizationContext();
        _scheduler = new UpdateScheduler(ScheduledCheckAsync, () => _host.ChecksForUpdates, log: host.Log);
    }

    /// <summary>
    /// 安装包要求的签名者；构建时没配置时为空串
    /// </summary>
    public static string Publisher { get; } = typeof(UpdateService).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(item => item.Key == "UpdatePublisher")?.Value ?? string.Empty;

    /// <summary>
    /// 策略是否允许检查更新
    /// </summary>
    public bool Allowed => _host.Policy.CheckForUpdates;

    /// <summary>
    /// 按计划检查时发现了新版，在界面线程上
    /// </summary>
    public event Action<UpdateOffer>? Found;

    /// <summary>
    /// 开始计划检查
    /// </summary>
    public void Start()
    {
        if (Allowed)
            _scheduler.Start();
    }

    /// <summary>
    /// 立即检查，日志里记为手动
    /// </summary>
    public async Task<UpdateCheckResult> CheckAsync()
    {
        using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(1));
        return await _checker.CheckAsync(UpdateTrigger.Manual, limit.Token);
    }

    /// <summary>
    /// 下载并校验安装包，返回安装包路径
    /// </summary>
    public async Task<string> DownloadAsync(UpdateOffer offer, IProgress<long> progress, CancellationToken cancellationToken)
    {
        if (Publisher.Length == 0)
            throw new UpdateFailure("这个版本没有配置安装包的签名者，不能自动安装，请到发布页手动下载新版。");
        var path = await _checker.DownloadAsync(offer, _host.Paths.UpdateDirectory, progress, cancellationToken);
        var signature = await Task.Run(() => Authenticode.Verify(path, Publisher), cancellationToken);
        _host.Log.Write(LogLevel.Information, $"安装包签名：{signature.State}，签名者 {signature.Publisher ?? "-"}（{signature.Organization ?? "-"}）");
        if (signature.State == SignatureState.Trusted)
            return path;
        File.Delete(path);
        throw new UpdateFailure(signature.State switch
        {
            SignatureState.Unsigned => "安装包没有签名，已删除。",
            SignatureState.WrongPublisher => $"安装包的签名者是「{signature.Organization ?? signature.Publisher}」，不是本客户端的发布者，已删除。",
            _ => $"安装包的签名不可信（0x{signature.Code:X8}），已删除。",
        });
    }

    /// <summary>
    /// 静默运行安装包
    /// </summary>
    public void Launch(string installer)
    {
        _host.Log.Write(LogLevel.Information, $"运行安装包 {installer}");
        Process.Start(new ProcessStartInfo { FileName = installer, Arguments = InstallerArguments, UseShellExecute = true });
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _scheduler.Dispose();
        _http.Dispose();
    }

    private async Task ScheduledCheckAsync(UpdateTrigger trigger, CancellationToken cancellationToken)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(TimeSpan.FromMinutes(1));
        if ((await _checker.CheckAsync(trigger, limit.Token).ConfigureAwait(false)).Offer is { } offer)
            _ui.Post(_ => Found?.Invoke(offer), null);
    }
}
