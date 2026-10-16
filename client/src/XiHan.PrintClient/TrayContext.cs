// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Updates;
using XiHan.PrintClient.Windows;

namespace XiHan.PrintClient;

/// <summary>
/// 托盘程序的生命周期：隐藏的宿主窗口、托盘图标与菜单、设置与诊断窗口；后来的进程启动时把设置窗口带到前台
/// </summary>
internal sealed class TrayContext : ApplicationContext
{
    private const string Title = "曦寒打印客户端";

    private readonly Form _window;
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _status = new() { Enabled = false };
    private readonly ToolStripMenuItem _autoStart = new("开机自启") { CheckOnClick = true };
    private readonly ToolStripMenuItem _testPrint = new("测试打印");
    private readonly ToolStripMenuItem _checkUpdates = new("检查更新…") { Visible = false };
    private readonly SingleInstance _instance;
    private readonly bool _quiet;
    private ClientHost? _host;
    private SettingsForm? _settings;
    private DiagnosticsForm? _diagnostics;
    private UpdateService? _updates;
    private UpdateForm? _updateForm;
    private Action? _balloonClick;
    private bool _exiting;

    /// <summary>
    /// 建托盘与宿主窗口，随后在界面线程上启动；quiet 为开机自启时不弹「已在后台运行」的提示
    /// </summary>
    public TrayContext(SingleInstance instance, bool quiet)
    {
        _instance = instance;
        _quiet = quiet;
        _window = new Form { ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, Opacity = 0 };
        _ = _window.Handle;

        var menu = new ContextMenuStrip();
        menu.Items.Add(_status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("设置…", null, (_, _) => ShowSettings());
        menu.Items.Add("诊断信息…", null, (_, _) => ShowDiagnostics());
        menu.Items.Add("打开日志目录", null, (_, _) => Run(host => SettingsForm.OpenFolder(host.Paths.LogDirectory)));
        menu.Items.Add("导出诊断包…", null, (_, _) => Run(host => DiagnosticsForm.ExportPackage(null, host)));
        _testPrint.DropDownItems.Add(new ToolStripMenuItem("…"));
        _testPrint.DropDownOpening += (_, _) => FillPrinters();
        menu.Items.Add(_testPrint);
        _checkUpdates.Click += async (_, _) => await CheckUpdatesAsync();
        menu.Items.Add(_checkUpdates);
        menu.Items.Add(new ToolStripSeparator());
        _autoStart.Click += (_, _) => Run(host => host.AutoStart.Set(_autoStart.Checked));
        menu.Items.Add(_autoStart);
        menu.Items.Add("退出", null, async (_, _) => await ExitAsync());
        menu.Opening += (_, _) => RefreshStatus();

        _icon = new NotifyIcon { Icon = SystemIcons.Application, Text = Title, ContextMenuStrip = menu, Visible = true };
        _icon.DoubleClick += (_, _) => ShowSettings();
        _icon.BalloonTipClicked += (_, _) =>
        {
            var click = _balloonClick;
            _balloonClick = null;
            click?.Invoke();
        };
        _instance.Activated += () => _window.BeginInvoke(ShowSettings);
        RefreshStatus();
        _window.BeginInvoke(StartAsync);
    }

    private async void StartAsync()
    {
        try
        {
            _host = new ClientHost(_window);
            var problems = await _host.StartAsync(new ConsentPrompt(SynchronizationContext.Current!), new PrintDialogPrompt());
            RefreshStatus();
            _updates = new UpdateService(_host);
            _updates.Found += offer => Balloon($"发现新版本 {offer.Manifest.Version}，点这里查看。", ToolTipIcon.Info, () => ShowUpdate(offer));
            _checkUpdates.Visible = _updates.Allowed;
            _updates.Start();
            if (problems.Count > 0)
                Balloon(string.Join(Environment.NewLine, problems), ToolTipIcon.Warning);
            else if (!_quiet)
                Balloon($"已在后台运行，监听 127.0.0.1:{_host.Port}。右键托盘图标可打开设置。", ToolTipIcon.Info);
        }
        catch (Exception error)
        {
            _host?.Log.Write(Core.Server.LogLevel.Error, "启动失败", error);
            MessageBox.Show($"启动失败：{error.Message}", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            await ExitAsync();
        }
    }

    private void RefreshStatus()
    {
        _status.Text = _host?.Port is { } port ? $"{Title} {ClientHost.ProductVersion} · 端口 {port}" : $"{Title} {ClientHost.ProductVersion} · 未在监听";
        _icon.Text = _host?.Port is null ? $"{Title}（未在监听）" : Title;
        if (_host is not null)
            _autoStart.Checked = _host.AutoStart.IsEnabled;
    }

    private void ShowSettings()
    {
        if (_host is null)
            return;
        if (_settings is null || _settings.IsDisposed)
        {
            _settings = new SettingsForm(_host);
            _settings.Show();
        }
        if (_settings.WindowState == FormWindowState.Minimized)
            _settings.WindowState = FormWindowState.Normal;
        _settings.Activate();
    }

    private void ShowDiagnostics()
    {
        if (_host is null)
            return;
        if (_diagnostics is null || _diagnostics.IsDisposed)
        {
            _diagnostics = new DiagnosticsForm(_host);
            _diagnostics.Show();
        }
        _diagnostics.Activate();
    }

    private void FillPrinters()
    {
        _testPrint.DropDownItems.Clear();
        var printers = _host?.Printers.List() ?? [];
        if (printers.Count == 0)
        {
            _testPrint.DropDownItems.Add(new ToolStripMenuItem("本机没有打印机") { Enabled = false });
            return;
        }
        foreach (var printer in printers)
        {
            var name = printer.Name;
            _testPrint.DropDownItems.Add(new ToolStripMenuItem(printer.IsDefault ? $"{name}（默认）" : name, null, async (_, _) =>
            {
                if (_host is null)
                    return;
                Balloon(await _host.TestPrintAsync(name), ToolTipIcon.Info);
            }));
        }
    }

    private async Task CheckUpdatesAsync()
    {
        if (_updates is null)
            return;
        _checkUpdates.Enabled = false;
        try
        {
            var result = await _updates.CheckAsync();
            if (result.Offer is { } offer)
                ShowUpdate(offer);
            else
                Balloon(result.Source is null ? "取不到更新信息，请稍后再试。" : $"已是最新版本 {ClientHost.ProductVersion}。", ToolTipIcon.Info);
        }
        catch (OperationCanceledException)
        {
            Balloon("检查更新超时，请稍后再试。", ToolTipIcon.Info);
        }
        finally
        {
            _checkUpdates.Enabled = true;
        }
    }

    private void ShowUpdate(UpdateOffer offer)
    {
        if (_updates is null)
            return;
        if (_updateForm is null || _updateForm.IsDisposed)
        {
            _updateForm = new UpdateForm(_updates, offer, ExitAsync);
            _updateForm.Show();
        }
        _updateForm.Activate();
    }

    private void Balloon(string text, ToolTipIcon icon, Action? click = null)
    {
        _balloonClick = click;
        _icon.ShowBalloonTip(click is null ? 5_000 : 15_000, Title, text, icon);
    }

    private void Run(Action<ClientHost> action)
    {
        if (_host is null)
            return;
        try
        {
            action(_host);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _host.Log.Write(Core.Server.LogLevel.Warning, "托盘菜单操作失败", error);
            MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task ExitAsync()
    {
        if (_exiting)
            return;
        _exiting = true;
        _icon.Visible = false;
        _updates?.Dispose();
        if (_host is not null)
            await _host.DisposeAsync();
        ExitThread();
    }

    /// <inheritdoc />
    protected override void ExitThreadCore()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _window.Dispose();
        base.ExitThreadCore();
    }
}
