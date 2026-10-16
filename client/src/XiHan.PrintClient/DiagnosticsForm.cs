// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient;

/// <summary>
/// 诊断信息窗口：只读文本，可复制、刷新与导出诊断包
/// </summary>
internal sealed class DiagnosticsForm : Form
{
    private readonly ClientHost _host;
    private readonly TextBox _text;

    public DiagnosticsForm(ClientHost host)
    {
        _host = host;
        Text = "曦寒打印客户端 诊断信息";
        StartPosition = FormStartPosition.CenterScreen;
        ShowIcon = false;
        MinimizeBox = false;
        ClientSize = new Size(LogicalToDeviceUnits(720), LogicalToDeviceUnits(480));

        _text = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            WordWrap = false,
            Dock = DockStyle.Fill,
            Font = new Font(FontFamily.GenericMonospace, Font.Size),
        };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(LogicalToDeviceUnits(8)) };
        buttons.Controls.Add(ActionButton("关闭", Close));
        buttons.Controls.Add(ActionButton("导出诊断包…", () => ExportPackage(this, _host)));
        buttons.Controls.Add(ActionButton("复制", () => Clipboard.SetText(_text.Text)));
        buttons.Controls.Add(ActionButton("刷新", Refill));
        Controls.Add(_text);
        Controls.Add(buttons);
        Refill();
    }

    /// <summary>
    /// 选位置后导出诊断包，结果以消息框告知
    /// </summary>
    public static void ExportPackage(IWin32Window? owner, ClientHost host)
    {
        using var dialog = new SaveFileDialog
        {
            Title = "导出诊断包",
            Filter = "zip 压缩包|*.zip",
            FileName = $"曦寒打印客户端诊断包-{DateTime.Now:yyyyMMdd-HHmmss}.zip",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
        };
        if (dialog.ShowDialog(owner) != DialogResult.OK)
            return;
        try
        {
            File.Delete(dialog.FileName);
            host.ExportDiagnostics(dialog.FileName);
            MessageBox.Show(owner, $"诊断包已存到{Environment.NewLine}{dialog.FileName}", "曦寒打印客户端", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show(owner, $"诊断包没存成：{error.Message}", "曦寒打印客户端", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void Refill()
    {
        _text.Text = _host.DiagnosticsText().ReplaceLineEndings("\r\n");
        _text.SelectionStart = 0;
    }

    private Button ActionButton(string text, Action click)
    {
        var button = new Button { Text = text, AutoSize = true, Margin = new Padding(LogicalToDeviceUnits(6), 0, 0, 0) };
        button.Click += (_, _) => click();
        return button;
    }
}
