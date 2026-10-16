// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Drawing.Printing;
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
        using var dialog = new PrintDialog
        {
            UseEXDialog = true,
            AllowSomePages = !multiple,
            AllowSelection = false,
            AllowCurrentPage = false,
            AllowPrintToFile = false,
            PrinterSettings = settings,
        };
        if (dialog.ShowDialog(owner) != DialogResult.OK)
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
