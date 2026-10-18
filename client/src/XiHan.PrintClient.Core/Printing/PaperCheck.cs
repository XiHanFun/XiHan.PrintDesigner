// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Globalization;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 纸张怎么放进打印机：宽高是交给驱动的纸张宽高（mm），横放时版面的宽高与它对调
/// </summary>
/// <param name="WidthMm">纸张宽</param>
/// <param name="HeightMm">纸张高</param>
/// <param name="Landscape">是否横放</param>
public sealed record PaperFeed(double WidthMm, double HeightMm, bool Landscape)
{
    /// <summary>
    /// 版面的宽，mm
    /// </summary>
    public double PageWidthMm => Landscape ? HeightMm : WidthMm;

    /// <summary>
    /// 版面的高，mm
    /// </summary>
    public double PageHeightMm => Landscape ? WidthMm : HeightMm;
}

/// <summary>
/// 下发前核对纸张的结果
/// </summary>
/// <param name="Groups">各组怎么放纸，与文档的纸张分组一一对应；没有选中页的组为 null</param>
/// <param name="Warnings">提醒</param>
public sealed record PaperPlan(IReadOnlyList<PaperFeed?> Groups, IReadOnlyList<ProtocolWarning> Warnings);

/// <summary>
/// 下发前按打印机的纸张能力核对每组纸张：驱动报的纸张在容差内、横竖都算，或驱动接受这个尺寸，才照这组的尺寸下发；
/// 有一组不行就整个任务以 PAPER_UNSUPPORTED 失败，除非选项允许改用最接近的纸张
/// </summary>
public static class PaperCheck
{
    /// <summary>
    /// 纸张宽高的容差，mm
    /// </summary>
    public const double ToleranceMm = 1;

    /// <summary>
    /// 核对文档里有选中页的各组纸张；不行时抛出 <see cref="PrintFailure"/>
    /// </summary>
    public static PaperPlan Plan(IPaperCatalog catalog, string printer, PrintDocument document, PageSelection selection, bool fitToNearestPaper)
    {
        using var printerPapers = catalog.Open(printer);
        var papers = printerPapers?.Papers ?? [];
        var groups = new PaperFeed?[document.Sheets.Count];
        var warnings = new List<ProtocolWarning>();
        if (papers.Count == 0)
            warnings.Add(new ProtocolWarning(PrintWarningCodes.PaperUnchecked, $"打印机「{printer}」的驱动没有报纸张，没有核对纸张就照常下发", new JsonObject { ["printer"] = printer }));

        var start = 0;
        for (var index = 0; index < document.Sheets.Count; index++)
        {
            var group = document.Sheets[index];
            if (selection.RangesIn(start, group.Count) is not null)
                groups[index] = papers.Count == 0 ? new PaperFeed(group.WidthMm, group.HeightMm, false) : Check(printerPapers!, printer, index, group, fitToNearestPaper, warnings);
            start += group.Count;
        }
        return new PaperPlan(groups, warnings);
    }

    private static PaperFeed Check(IPrinterPapers printerPapers, string printer, int index, SheetGroup group, bool fitToNearestPaper, List<ProtocolWarning> warnings)
    {
        var papers = printerPapers.Papers;
        var request = Request(papers, group);
        var resolved = printerPapers.Resolve(request);
        if (resolved is null)
        {
            warnings.Add(new ProtocolWarning(PrintWarningCodes.PaperUnchecked, $"读不出打印机「{printer}」的驱动给第 {index + 1} 组留下的纸张，没有核对就照常下发", GroupDetails(printer, index, group)));
            return request;
        }
        if (Fits(resolved, group.WidthMm, group.HeightMm))
            return request;
        if (fitToNearestPaper && Nearest(printerPapers, group) is { } fitted)
        {
            var (paper, feed, scale) = fitted;
            var details = GroupDetails(printer, index, group);
            details["paper"] = PaperDetails(paper);
            details["landscape"] = feed.Landscape;
            details["scale"] = scale;
            warnings.Add(new ProtocolWarning(PrintWarningCodes.PaperFitted, $"打印机「{printer}」没有第 {index + 1} 组要的 {Mm(group.WidthMm)}×{Mm(group.HeightMm)} mm 纸张，改用「{paper.Name}」{Mm(feed.PageWidthMm)}×{Mm(feed.PageHeightMm)} mm，内容按 {scale.ToString("0.###", CultureInfo.InvariantCulture)} 倍居中", details));
            return feed;
        }

        var unsupported = GroupDetails(printer, index, group);
        unsupported["papers"] = new JsonArray([.. papers.Select(PaperDetails)]);
        throw new PrintFailure(PrintErrorCodes.PaperUnsupported, $"打印机「{printer}」没有第 {index + 1} 组要的 {Mm(group.WidthMm)}×{Mm(group.HeightMm)} mm 纸张，驱动也不接受这个尺寸（会换成 {Mm(resolved.PageWidthMm)}×{Mm(resolved.PageHeightMm)} mm）", unsupported);
    }

    /// <summary>
    /// 这组要请求的纸张：驱动报的纸张里同向的优先、其次横放的，取尺寸最近的一种，按那种纸张自己的宽高请求；都不在容差内时按这组的尺寸请求
    /// </summary>
    private static PaperFeed Request(IReadOnlyList<PaperInfo> papers, SheetGroup group)
    {
        var upright = papers.Where(paper => Near(paper.WidthMm, group.WidthMm) && Near(paper.HeightMm, group.HeightMm))
            .MinBy(paper => Distance(paper.WidthMm, paper.HeightMm, group.WidthMm, group.HeightMm));
        if (upright is not null)
            return new PaperFeed(upright.WidthMm, upright.HeightMm, false);
        var turned = papers.Where(paper => Near(paper.WidthMm, group.HeightMm) && Near(paper.HeightMm, group.WidthMm))
            .MinBy(paper => Distance(paper.WidthMm, paper.HeightMm, group.HeightMm, group.WidthMm));
        return turned is not null ? new PaperFeed(turned.WidthMm, turned.HeightMm, true) : new PaperFeed(group.WidthMm, group.HeightMm, false);
    }

    /// <summary>
    /// 最接近的纸张：横竖两种放法里，放得下原大内容的取面积最小的，都放不下时取缩得最少的；按这个次序找第一种驱动照样留下的。
    /// 渲染引擎把内容放到纸上时，比纸大的等比缩小到放得下，比纸小的原大居中，scale 即这个倍数
    /// </summary>
    private static (PaperInfo Paper, PaperFeed Feed, double Scale)? Nearest(IPrinterPapers printerPapers, SheetGroup group)
    {
        var candidates = printerPapers.Papers.Where(paper => paper.WidthMm > 0 && paper.HeightMm > 0)
            .SelectMany(paper => new[] { false, true }.Select(landscape => (Paper: paper, Feed: new PaperFeed(paper.WidthMm, paper.HeightMm, landscape))))
            .DistinctBy(candidate => candidate.Feed)
            .Select(candidate => (candidate.Paper, candidate.Feed, Scale: Math.Min(candidate.Feed.PageWidthMm / group.WidthMm, candidate.Feed.PageHeightMm / group.HeightMm)))
            .OrderBy(candidate => candidate.Scale >= 1 ? 0 : 1)
            .ThenBy(candidate => candidate.Scale >= 1 ? candidate.Feed.WidthMm * candidate.Feed.HeightMm : -candidate.Scale)
            .ThenBy(candidate => candidate.Feed.WidthMm * candidate.Feed.HeightMm);
        foreach (var (paper, feed, scale) in candidates)
        {
            if (printerPapers.Resolve(feed) is { } resolved && Fits(resolved, feed.PageWidthMm, feed.PageHeightMm))
                return (paper, feed, Math.Min(1, scale));
        }
        return null;
    }

    private static bool Fits(PaperFeed resolved, double widthMm, double heightMm) => Near(resolved.PageWidthMm, widthMm) && Near(resolved.PageHeightMm, heightMm);

    private static bool Near(double actual, double expected) => Math.Abs(actual - expected) <= ToleranceMm + 1e-9;

    private static double Distance(double width, double height, double targetWidth, double targetHeight) => Math.Abs(width - targetWidth) + Math.Abs(height - targetHeight);

    private static JsonObject GroupDetails(string printer, int index, SheetGroup group) => new()
    {
        ["printer"] = printer,
        ["group"] = index,
        ["widthMm"] = group.WidthMm,
        ["heightMm"] = group.HeightMm,
    };

    private static JsonObject PaperDetails(PaperInfo paper) => new()
    {
        ["id"] = paper.Id,
        ["name"] = paper.Name,
        ["widthMm"] = paper.WidthMm,
        ["heightMm"] = paper.HeightMm,
    };

    private static string Mm(double value) => value.ToString("0.#", CultureInfo.InvariantCulture);
}
