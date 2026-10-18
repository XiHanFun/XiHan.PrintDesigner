// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Tests.Printing;

public sealed class PaperCheckTests
{
    private static readonly PaperInfo A4 = new(9, "A4", 210, 297);
    private static readonly PaperInfo A5 = new(11, "A5", 148, 210);
    private static readonly PaperInfo A6 = new(70, "A6", 105, 148);
    private static readonly PaperInfo Photo = new(131, "Photo 4x4", 101.6, 101.6);

    /// <summary>
    /// 像 Microsoft Print to PDF：只认报出来的纸张，别的尺寸一律换成 A4，方向照请求
    /// </summary>
    private static FakePapers PdfLike() => new([A4, A5, A6, Photo], request =>
        new[] { A4, A5, A6, Photo }.FirstOrDefault(paper => Math.Abs(paper.WidthMm - request.WidthMm) <= 1 && Math.Abs(paper.HeightMm - request.HeightMm) <= 1) is { } paper
            ? new PaperFeed(paper.WidthMm, paper.HeightMm, request.Landscape)
            : new PaperFeed(210, 297, request.Landscape));

    private static PrintDocument Document(params SheetGroup[] groups) => new("<!doctype html>", [], groups);

    private static PaperPlan Plan(FakePapers papers, PrintDocument document, string? pageRanges = null, bool fit = false, string printer = "PDF")
    {
        return PaperCheck.Plan(papers, printer, document, PageSelection.Parse(pageRanges, document.SheetCount)!, fit);
    }

    [Fact]
    public void FailsTheWholeJobWhenAGroupHasNoPaperAndTheDriverWontTakeTheSize()
    {
        var papers = PdfLike();

        var failure = Assert.Throws<PrintFailure>(() => Plan(papers, Document(new SheetGroup(210, 297, 2), new SheetGroup(100, 70, 1))));

        Assert.Equal(PrintErrorCodes.PaperUnsupported, failure.Code);
        Assert.Contains("第 2 组", failure.Message);
        Assert.Contains("100×70 mm", failure.Message);
        var details = failure.Details!;
        Assert.Equal(("PDF", 1, 100d, 70d), ((string?)details["printer"], (int?)details["group"], (double?)details["widthMm"], (double?)details["heightMm"]));
        Assert.Equal(["A4", "A5", "A6", "Photo 4x4"], details["papers"]!.AsArray().Select(paper => (string?)paper!["name"]));
        Assert.Equal(297d, (double?)details["papers"]![0]!["heightMm"]);
        Assert.True(papers.Disposed);
    }

    [Fact]
    public void SendsMatchingGroupsOnTheDriversOwnPaper()
    {
        var plan = Plan(PdfLike(), Document(new SheetGroup(210, 297, 2), new SheetGroup(148.6, 209.4, 1)));

        Assert.Equal([new PaperFeed(210, 297, false), new PaperFeed(148, 210, false)], plan.Groups);
        Assert.Empty(plan.Warnings);
    }

    [Fact]
    public void ToleratesOneMillimetreAndNoMore()
    {
        Assert.Equal(new PaperFeed(210, 297, false), Plan(PdfLike(), Document(new SheetGroup(211, 296, 1))).Groups[0]);

        Assert.Throws<PrintFailure>(() => Plan(PdfLike(), Document(new SheetGroup(211.2, 297, 1))));
    }

    [Fact]
    public void TurnsLandscapeGroupsOntoTheUprightPaper()
    {
        var feed = Plan(PdfLike(), Document(new SheetGroup(297, 210, 1))).Groups[0]!;

        Assert.Equal(new PaperFeed(210, 297, true), feed);
        Assert.Equal((297d, 210d), (feed.PageWidthMm, feed.PageHeightMm));
    }

    [Fact]
    public void PrefersAPaperListedInTheSameOrientation()
    {
        var papers = new FakePapers([A4, new PaperInfo(77, "A4 旋转", 297, 210)], request => request);

        Assert.Equal(new PaperFeed(297, 210, false), Plan(papers, Document(new SheetGroup(297, 210, 1))).Groups[0]);
    }

    [Fact]
    public void SendsCustomSizesTheDriverKeeps()
    {
        var label = new FakePapers([new PaperInfo(256, "100×150", 100, 150)], request => request);

        var plan = Plan(label, Document(new SheetGroup(100, 70, 3)));

        Assert.Equal(new PaperFeed(100, 70, false), plan.Groups[0]);
        Assert.Empty(plan.Warnings);
    }

    [Fact]
    public void RejectsListedPapersTheDriverSwapsForAnother()
    {
        var stuck = new FakePapers([A4, A5], request => new PaperFeed(210, 297, request.Landscape));

        var failure = Assert.Throws<PrintFailure>(() => Plan(stuck, Document(new SheetGroup(148, 210, 1))));

        Assert.Equal(PrintErrorCodes.PaperUnsupported, failure.Code);
        Assert.Contains("会换成 210×297 mm", failure.Message);
    }

    [Fact]
    public void ChecksOnlyGroupsWithSelectedPages()
    {
        var plan = Plan(PdfLike(), Document(new SheetGroup(210, 297, 2), new SheetGroup(100, 70, 1)), pageRanges: "1-2");

        Assert.NotNull(plan.Groups[0]);
        Assert.Null(plan.Groups[1]);
    }

    [Theory]
    [InlineData("PDF")]
    [InlineData("missing")]
    public void WarnsAndSendsAsIsWhenTheDriverReportsNoPapers(string printer)
    {
        var plan = Plan(new FakePapers([], _ => throw new InvalidOperationException()), Document(new SheetGroup(100, 70, 1)), printer: printer);

        Assert.Equal(new PaperFeed(100, 70, false), plan.Groups[0]);
        var warning = Assert.Single(plan.Warnings);
        Assert.Equal((PrintWarningCodes.PaperUnchecked, printer), (warning.Code, (string?)warning.Details!["printer"]));
    }

    [Fact]
    public void WarnsWhenTheDriverAnswerCannotBeRead()
    {
        var plan = Plan(new FakePapers([A4], _ => null), Document(new SheetGroup(210, 297, 1), new SheetGroup(100, 70, 1)));

        Assert.Equal(new PaperFeed(100, 70, false), plan.Groups[1]);
        Assert.Equal([0, 1], plan.Warnings.Select(warning => (int)warning.Details!["group"]!));
        Assert.All(plan.Warnings, warning => Assert.Equal(PrintWarningCodes.PaperUnchecked, warning.Code));
    }

    [Fact]
    public void FitsOntoTheSmallestPaperThatHoldsTheGroupWhenAllowed()
    {
        var plan = Plan(PdfLike(), Document(new SheetGroup(210, 297, 2), new SheetGroup(100, 70, 1)), fit: true);

        Assert.Equal(new PaperFeed(101.6, 101.6, false), plan.Groups[1]);
        var warning = Assert.Single(plan.Warnings);
        Assert.Equal(PrintWarningCodes.PaperFitted, warning.Code);
        Assert.Equal(("Photo 4x4", 1, 1d), ((string?)warning.Details!["paper"]!["name"], (int?)warning.Details["group"], (double?)warning.Details["scale"]));
    }

    [Fact]
    public void ShrinksOntoThePaperThatNeedsTheLeastWhenNoneHoldsTheGroup()
    {
        var plan = Plan(PdfLike(), Document(new SheetGroup(594, 420, 1)), fit: true);

        Assert.Equal(new PaperFeed(210, 297, true), plan.Groups[0]);
        Assert.Equal(0.5, (double?)Assert.Single(plan.Warnings).Details!["scale"]);
    }

    [Fact]
    public void SkipsNearestPapersTheDriverWillNotKeep()
    {
        var onlyA4 = new FakePapers([A4, A6], request => new PaperFeed(210, 297, request.Landscape));

        var plan = Plan(onlyA4, Document(new SheetGroup(100, 70, 1)), fit: true);

        Assert.Equal(new PaperFeed(210, 297, false), plan.Groups[0]);
    }

    private sealed class FakePapers(IReadOnlyList<PaperInfo> papers, Func<PaperFeed, PaperFeed?> resolve) : IPaperCatalog, IPrinterPapers
    {
        public bool Disposed { get; private set; }

        public IReadOnlyList<PaperInfo> Papers => papers;

        public IPrinterPapers? Open(string printer) => printer == "missing" ? null : this;

        public PaperFeed? Resolve(PaperFeed request) => resolve(request);

        public void Dispose() => Disposed = true;
    }
}
