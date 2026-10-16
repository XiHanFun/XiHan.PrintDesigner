// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Updates;

namespace XiHan.PrintClient;

/// <summary>
/// 新版提示窗口：版本与发布说明，用户点「下载并安装」后下载、校验，再运行安装包并让客户端退出
/// </summary>
internal sealed class UpdateForm : Form
{
    private readonly UpdateService _updates;
    private readonly UpdateOffer _offer;
    private readonly Func<Task> _exit;
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Label _state = new() { AutoSize = true, ForeColor = SystemColors.GrayText };
    private readonly Button _install = new() { Text = "下载并安装", AutoSize = true };
    private readonly Button _later = new() { Text = "以后再说", AutoSize = true };
    private CancellationTokenSource? _downloading;

    public UpdateForm(UpdateService updates, UpdateOffer offer, Func<Task> exit)
    {
        _updates = updates;
        _offer = offer;
        _exit = exit;
        Text = "曦寒打印客户端 新版本";
        StartPosition = FormStartPosition.CenterScreen;
        ShowIcon = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ClientSize = new Size(LogicalToDeviceUnits(460), LogicalToDeviceUnits(320));

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(LogicalToDeviceUnits(12)) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label { Text = $"新版本 {offer.Manifest.Version}（当前 {ClientHost.ProductVersion}）", AutoSize = true, Font = new Font(Font, FontStyle.Bold) });
        layout.Controls.Add(new TextBox { Text = (offer.Manifest.Notes ?? "没有发布说明。").ReplaceLineEndings("\r\n"), Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill });
        layout.Controls.Add(_progress);
        layout.Controls.Add(_state);
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
        buttons.Controls.Add(_later);
        buttons.Controls.Add(_install);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        _later.Click += (_, _) => Close();
        _install.Click += async (_, _) => await InstallAsync();
        FormClosing += (_, _) => _downloading?.Cancel();
    }

    private async Task InstallAsync()
    {
        _install.Enabled = false;
        _progress.Visible = true;
        _progress.Maximum = 1000;
        _state.Text = "正在下载…";
        _downloading = new CancellationTokenSource();
        var progress = new Progress<long>(bytes => _progress.Value = (int)Math.Min(1000, bytes * 1000 / Math.Max(1, _offer.Asset.Size)));
        try
        {
            var installer = await _updates.DownloadAsync(_offer, progress, _downloading.Token);
            _state.Text = "校验通过，正在启动安装…";
            _updates.Launch(installer);
            await _exit();
        }
        catch (UpdateFailure failure)
        {
            _state.Text = failure.Message;
            _install.Enabled = true;
        }
        catch (OperationCanceledException)
        {
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            _state.Text = "安装包没能启动：" + error.Message;
            _install.Enabled = true;
        }
    }
}
