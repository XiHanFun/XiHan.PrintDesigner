// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Printing;

namespace XiHan.PrintClient.Core.Tests.Printing;

public sealed class PageSelectionTests
{
    [Theory]
    [InlineData(null, 5)]
    [InlineData("", 5)]
    [InlineData("1-3,5", 4)]
    [InlineData("2,2,1-2", 2)]
    [InlineData("4-99", 2)]
    [InlineData("5", 1)]
    public void CountsTheSelectedPagesWithinTheDocument(string? ranges, int count)
    {
        var selection = PageSelection.Parse(ranges, 5);

        Assert.NotNull(selection);
        Assert.Equal(count, selection.Count);
        Assert.Equal(count == 5, selection.IsAll);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("3-2")]
    [InlineData("6")]
    [InlineData("6-9")]
    [InlineData("1-2-3")]
    [InlineData("a")]
    public void RejectsRangesThatSelectNothingOrAreMalformed(string ranges)
    {
        Assert.Null(PageSelection.Parse(ranges, 5));
    }

    [Fact]
    public void RewritesTheSelectionRelativeToEachGroup()
    {
        var selection = PageSelection.Parse("2-3,5,7-8", 8)!;

        Assert.Equal("2-3", selection.RangesIn(0, 4));
        Assert.Equal(2, selection.CountIn(0, 4));
        Assert.Equal("1,3-4", selection.RangesIn(4, 4));
        Assert.Equal(string.Empty, selection.RangesIn(6, 2));
        Assert.Null(selection.RangesIn(0, 1));
        Assert.Equal("2-3,5,7-8", selection.RangesIn(0, 8));
    }
}
