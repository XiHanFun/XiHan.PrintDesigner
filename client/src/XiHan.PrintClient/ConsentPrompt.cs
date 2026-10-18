// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Consent;

namespace XiHan.PrintClient;

/// <summary>
/// 授权窗口：在界面线程上弹出，写明来源与静默打印；关掉窗口视为这次拒绝，到期时窗口自动关闭
/// </summary>
internal sealed class ConsentPrompt(SynchronizationContext ui) : IConsentPrompt
{
    private int _open;

    /// <inheritdoc />
    public Task<ConsentChoice> AskAsync(string origin, CancellationToken cancellationToken)
    {
        var done = new TaskCompletionSource<ConsentChoice>(TaskCreationOptions.RunContinuationsAsynchronously);
        ui.Post(_ =>
        {
            var form = new ConsentForm(origin, Interlocked.Increment(ref _open) - 1);
            var registration = cancellationToken.Register(() => ui.Post(_ =>
            {
                if (!form.IsDisposed)
                    form.Close();
            }, null));
            form.FormClosed += (_, _) =>
            {
                Interlocked.Decrement(ref _open);
                registration.Dispose();
                if (form.Choice is { } choice)
                    done.TrySetResult(choice);
                else
                    done.TrySetCanceled(cancellationToken);
                form.Dispose();
            };
            form.Show();
            form.Activate();
        }, null);
        return done.Task;
    }

    /// <summary>
    /// 授权窗口本身：靠屏幕右下角弹出，多个窗口依次往上错开
    /// </summary>
    private sealed class ConsentForm : Form
    {
        private readonly CheckBox _remember;

        public ConsentForm(string origin, int stack)
        {
            Text = "曦寒打印客户端";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            ShowInTaskbar = true;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            StartPosition = FormStartPosition.Manual;
            Icon = SystemIcons.Shield;

            var width = LogicalToDeviceUnits(380);
            var layout = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Padding = new Padding(LogicalToDeviceUnits(16)), Dock = DockStyle.Fill };
            layout.Controls.Add(new Label { Text = origin, AutoSize = true, MaximumSize = new Size(width, 0), Font = new Font(Font.FontFamily, Font.Size * 1.15f, FontStyle.Bold), Margin = new Padding(0, 0, 0, LogicalToDeviceUnits(8)) });
            layout.Controls.Add(new Label { Text = "这个网站想使用本机的打印机，包括不弹对话框直接打印。只在你信任它时允许。", AutoSize = true, MaximumSize = new Size(width, 0) });
            layout.Controls.Add(new Label { Text = "60 秒内不处理视为这次不允许。", AutoSize = true, MaximumSize = new Size(width, 0), ForeColor = SystemColors.GrayText, Margin = new Padding(0, LogicalToDeviceUnits(4), 0, LogicalToDeviceUnits(8)) });
            _remember = new CheckBox { Text = "拒绝时不再询问这个网站", AutoSize = true };
            layout.Controls.Add(_remember);

            // 从右往左排，先放的「拒绝」在最右；Tab 顺序照从左往右看到的：允许、仅这次、拒绝
            var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, Margin = new Padding(0, LogicalToDeviceUnits(12), 0, 0) };
            var deny = ChoiceButton("拒绝", () => _remember.Checked ? ConsentChoice.DenyAlways : ConsentChoice.Deny);
            var once = ChoiceButton("仅这次", () => ConsentChoice.AllowOnce);
            var allow = ChoiceButton("允许", () => ConsentChoice.Allow);
            buttons.Controls.Add(deny);
            buttons.Controls.Add(once);
            buttons.Controls.Add(allow);
            allow.TabIndex = 0;
            once.TabIndex = 1;
            deny.TabIndex = 2;
            layout.Controls.Add(buttons);
            Controls.Add(layout);
            CancelButton = deny;

            Load += (_, _) =>
            {
                var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
                var gap = LogicalToDeviceUnits(12);
                Location = new Point(area.Right - Width - gap, Math.Max(area.Top, area.Bottom - ((Height + gap) * (stack + 1))));
            };
            FormClosing += (_, args) =>
            {
                if (Choice is null && args.CloseReason == CloseReason.UserClosing)
                    Choice = ConsentChoice.Deny;
            };
        }

        public ConsentChoice? Choice { get; private set; }

        private Button ChoiceButton(string text, Func<ConsentChoice> choose)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(LogicalToDeviceUnits(84), 0), Margin = new Padding(LogicalToDeviceUnits(6), 0, 0, 0) };
            button.Click += (_, _) =>
            {
                Choice = choose();
                Close();
            };
            return button;
        }
    }
}
