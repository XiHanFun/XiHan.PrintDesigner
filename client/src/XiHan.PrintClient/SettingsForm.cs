// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Diagnostics;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient;

/// <summary>
/// 设置窗口：常规（开机自启、检查更新、日志级别）、来源（允许名单与拒绝名单，可删除）、关于
/// </summary>
internal sealed class SettingsForm : Form
{
    private static readonly (LogLevel Level, string Name)[] Levels =
    [
        (LogLevel.Debug, "调试"),
        (LogLevel.Information, "一般"),
        (LogLevel.Warning, "警告"),
        (LogLevel.Error, "错误"),
    ];

    private readonly ClientHost _host;
    private readonly ListBox _allowed = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    private readonly ListBox _denied = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    private readonly Label _about = new() { AutoSize = true };
    private readonly CheckBox _autoStart = new() { Text = "开机时自动启动", AutoSize = true };

    public SettingsForm(ClientHost host)
    {
        _host = host;
        Text = "曦寒打印客户端 设置";
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowIcon = false;
        ClientSize = new Size(LogicalToDeviceUnits(520), LogicalToDeviceUnits(400));
        MinimumSize = Size;

        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(General());
        tabs.TabPages.Add(Origins());
        tabs.TabPages.Add(About());
        Controls.Add(tabs);

        host.Lists.Changed += OnListsChanged;
        FormClosed += (_, _) => host.Lists.Changed -= OnListsChanged;
        Activated += (_, _) => Refill();
        Refill();
    }

    private TabPage General()
    {
        var page = new TabPage("常规") { Padding = new Padding(LogicalToDeviceUnits(12)) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoSize = true };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        _autoStart.CheckedChanged += (_, _) =>
        {
            if (_autoStart.Checked != _host.AutoStart.IsEnabled)
                _host.AutoStart.Set(_autoStart.Checked);
        };
        layout.Controls.Add(_autoStart, 0, 0);
        layout.SetColumnSpan(_autoStart, 2);

        var updates = new CheckBox { Text = "检查新版本（只提示，确认后再安装）", AutoSize = true, Checked = _host.ChecksForUpdates, Enabled = _host.Policy.CheckForUpdates };
        updates.CheckedChanged += (_, _) => _host.SetCheckForUpdates(updates.Checked);
        layout.Controls.Add(updates, 0, 1);
        layout.SetColumnSpan(updates, 2);
        if (!_host.Policy.CheckForUpdates)
        {
            var note = new Label { Text = "管理员已用策略关闭检查更新。", AutoSize = true, ForeColor = SystemColors.GrayText };
            layout.Controls.Add(note, 0, 2);
            layout.SetColumnSpan(note, 2);
        }

        layout.Controls.Add(new Label { Text = "日志级别", AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, LogicalToDeviceUnits(12), LogicalToDeviceUnits(8), 0) }, 0, 3);
        var level = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = LogicalToDeviceUnits(120), Margin = new Padding(0, LogicalToDeviceUnits(10), 0, 0) };
        level.Items.AddRange([.. Levels.Select(item => item.Name)]);
        level.SelectedIndex = Array.FindIndex(Levels, item => item.Level == _host.Settings.LogLevel);
        level.SelectedIndexChanged += (_, _) => _host.SetLogLevel(Levels[level.SelectedIndex].Level);
        layout.Controls.Add(level, 1, 3);

        var logs = new LinkLabel { Text = "打开日志目录", AutoSize = true, Margin = new Padding(0, LogicalToDeviceUnits(12), 0, 0) };
        logs.LinkClicked += (_, _) => OpenFolder(_host.Paths.LogDirectory);
        layout.Controls.Add(logs, 0, 4);
        layout.SetColumnSpan(logs, 2);
        page.Controls.Add(layout);
        return page;
    }

    private TabPage Origins()
    {
        var page = new TabPage("来源") { Padding = new Padding(LogicalToDeviceUnits(12)) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label { Text = "允许的网站", AutoSize = true }, 0, 0);
        layout.Controls.Add(new Label { Text = "拒绝的网站", AutoSize = true }, 1, 0);
        // 名单的名字写在名单上；两个「删除」各自写明删哪张名单；Tab 顺序是一张名单接着它的「删除」
        _allowed.AccessibleName = "允许的网站";
        _denied.AccessibleName = "拒绝的网站";
        var removeAllowed = RemoveButton(_allowed, "从允许的网站中删除");
        var removeDenied = RemoveButton(_denied, "从拒绝的网站中删除");
        _allowed.TabIndex = 0;
        removeAllowed.TabIndex = 1;
        _denied.TabIndex = 2;
        removeDenied.TabIndex = 3;
        layout.Controls.Add(_allowed, 0, 1);
        layout.Controls.Add(_denied, 1, 1);
        layout.Controls.Add(removeAllowed, 0, 2);
        layout.Controls.Add(removeDenied, 1, 2);
        page.Controls.Add(layout);
        return page;
    }

    private TabPage About()
    {
        var page = new TabPage("关于") { Padding = new Padding(LogicalToDeviceUnits(12)) };
        page.Controls.Add(_about);
        return page;
    }

    private Button RemoveButton(ListBox list, string accessibleName)
    {
        var button = new Button { Text = "删除", AutoSize = true, AccessibleName = accessibleName, Enabled = false };
        // 选中的是自己加进来的来源才能删；策略里的来源与没选中时删除钮不可用
        list.SelectedIndexChanged += (_, _) => button.Enabled = list.SelectedItem is OriginItem { FromPolicy: false };
        button.Click += (_, _) =>
        {
            if (list.SelectedItem is OriginItem { FromPolicy: false } item)
                _host.Lists.Forget(item.Origin);
        };
        return button;
    }

    private void OnListsChanged()
    {
        if (IsHandleCreated)
            BeginInvoke(Refill);
    }

    private void Refill()
    {
        _autoStart.Checked = _host.AutoStart.IsEnabled;
        Fill(_allowed, [.. _host.Policy.AllowedOrigins.Select(origin => new OriginItem(origin, FromPolicy: true)), .. _host.Lists.Allowed.Select(origin => new OriginItem(origin, FromPolicy: false))]);
        Fill(_denied, [.. _host.Lists.Denied.Select(origin => new OriginItem(origin, FromPolicy: false))]);
        _about.Text = string.Join(Environment.NewLine,
            $"曦寒打印客户端 {ClientHost.ProductVersion}",
            _host.Info.Renderer is { } renderer ? $"WebView2 运行时 {renderer}" : "没有 WebView2 运行时",
            _host.Port is { } port ? $"监听 127.0.0.1:{port}" : "未在监听",
            string.Empty,
            $"设置：{_host.Paths.SettingsDirectory}",
            $"日志：{_host.Paths.LogDirectory}",
            $"策略：{_host.Paths.PolicyFile}");
    }

    /// <summary>
    /// 换上一张名单的条目；原来选中的来源还在名单里时照旧选中它
    /// </summary>
    private static void Fill(ListBox list, IReadOnlyList<OriginItem> items)
    {
        var selected = (list.SelectedItem as OriginItem)?.Origin;
        list.BeginUpdate();
        list.Items.Clear();
        foreach (var item in items)
            list.Items.Add(item);
        if (selected is not null)
            list.SelectedItem = items.FirstOrDefault(item => item.Origin == selected);
        list.EndUpdate();
    }

    /// <summary>
    /// 在资源管理器里打开目录，目录不存在时先建出来
    /// </summary>
    public static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
    }

    private sealed record OriginItem(string Origin, bool FromPolicy)
    {
        public override string ToString() => FromPolicy ? $"{Origin}（策略）" : Origin;
    }
}
