// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using XiHan.PrintClient.Core.Protocol;
using XiHan.PrintClient.Windows.Rendering;

namespace XiHan.PrintClient;

/// <summary>
/// 系统打印对话框：以请求的打印机、份数、逐份、双面、颜色与页码为初值；
/// 请求里是多段页码时不让在对话框里改页码，沿用请求的页码
/// </summary>
internal sealed partial class PrintDialogPrompt : IPrintDialog
{
    /// <inheritdoc />
    public Task<PrintDialogChoice?> AskAsync(string printer, PrintOptions options, int sheetCount, CancellationToken cancellationToken)
    {
        var single = SingleRange(options.PageRanges, sheetCount);
        var multiple = options.PageRanges is not null && single is null;
        var settings = new PrinterSettings
        {
            PrinterName = printer,
            Copies = (short)options.Copies,
            Collate = options.Collate,
            Duplex = options.Duplex switch
            {
                DuplexMode.LongEdge => Duplex.Vertical,
                DuplexMode.ShortEdge => Duplex.Horizontal,
                _ => Duplex.Simplex,
            },
            MinimumPage = 1,
            MaximumPage = sheetCount,
            FromPage = single?.From ?? 1,
            ToPage = single?.To ?? sheetCount,
            PrintRange = single is null ? PrintRange.AllPages : PrintRange.SomePages,
        };
        if (settings.IsValid)
            settings.DefaultPageSettings.Color = options.Color == ColorMode.Color;

        using var owner = Owner();
        // 走带钩子的 PrintDlg：旧式对话框在本进程里弹出
        using var dialog = new PrintDialog
        {
            UseEXDialog = false,
            AllowSomePages = !multiple,
            AllowSelection = false,
            AllowCurrentPage = false,
            AllowPrintToFile = false,
            PrinterSettings = settings,
        };
        // 任务超时或被取消时，在界面线程上替用户点「取消」，对话框随之返回
        using var closing = cancellationToken.Register(() => owner.BeginInvoke(() => CancelOwnedDialog(owner.Handle)));
        var result = dialog.ShowDialog(owner);
        cancellationToken.ThrowIfCancellationRequested();
        if (result != DialogResult.OK)
            return Task.FromResult<PrintDialogChoice?>(null);

        var chosen = dialog.PrinterSettings;
        var ranges = multiple
            ? options.PageRanges
            : chosen.PrintRange == PrintRange.SomePages
                ? chosen.FromPage == chosen.ToPage ? $"{chosen.FromPage}" : $"{chosen.FromPage}-{chosen.ToPage}"
                : null;
        return Task.FromResult<PrintDialogChoice?>(new PrintDialogChoice(chosen.PrinterName, new PrintOptions
        {
            Copies = Math.Clamp((int)chosen.Copies, 1, 999),
            Collate = chosen.Collate,
            Duplex = chosen.Duplex switch
            {
                Duplex.Vertical => DuplexMode.LongEdge,
                Duplex.Horizontal => DuplexMode.ShortEdge,
                _ => DuplexMode.Simplex,
            },
            Color = chosen.DefaultPageSettings.Color ? ColorMode.Color : ColorMode.Grayscale,
            PageRanges = ranges,
            TimeoutMs = options.TimeoutMs,
        }));
    }

    /// <summary>
    /// 只有一段的页码范围；没有或多段时为 null
    /// </summary>
    private static (int From, int To)? SingleRange(string? ranges, int sheetCount)
    {
        if (ranges is null || SingleRangePattern().Match(ranges) is not { Success: true } match)
            return null;
        var from = int.Parse(match.Groups["from"].Value);
        var to = match.Groups["to"].Success ? int.Parse(match.Groups["to"].Value) : from;
        return (Math.Clamp(from, 1, sheetCount), Math.Clamp(to, from, sheetCount));
    }

    [GeneratedRegex(@"^(?<from>\d+)(-(?<to>\d+))?$")]
    private static partial Regex SingleRangePattern();

    /// <summary>
    /// 给 owner 名下正开着的那个对话框发「取消」
    /// </summary>
    private static void CancelOwnedDialog(nint owner)
    {
        var dialog = GetWindow(owner, GetWindowEnabledPopup);
        if (dialog != 0 && dialog != owner)
            SendMessage(dialog, WindowMessageCommand, CancelCommand, 0);
    }

    private const uint GetWindowEnabledPopup = 6;
    private const uint WindowMessageCommand = 0x0111;
    private const nint CancelCommand = 2;

    [LibraryImport("user32.dll")]
    private static partial nint GetWindow(nint window, uint command);

    [LibraryImport("user32.dll", EntryPoint = "SendMessageW")]
    private static partial nint SendMessage(nint window, uint message, nint wParam, nint lParam);

    /// <summary>
    /// 置顶的透明小窗放在屏幕中央作对话框的所有者，对话框就会出现在浏览器前面的屏幕中央
    /// </summary>
    private static Form Owner()
    {
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        var owner = new Form
        {
            TopMost = true,
            ShowInTaskbar = false,
            FormBorderStyle = FormBorderStyle.None,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(area.Left + (area.Width / 2), area.Top + (area.Height / 2)),
            Size = new Size(1, 1),
            Opacity = 0,
        };
        owner.Show();
        owner.Activate();
        return owner;
    }
}
