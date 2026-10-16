// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 按 pageRanges 选中的输出页：一页一张，页码从 1 起；超出总页数的部分不算
/// </summary>
public sealed class PageSelection
{
    private readonly bool[] _selected;

    private PageSelection(bool[] selected)
    {
        _selected = selected;
        Count = selected.Count(item => item);
    }

    /// <summary>
    /// 选中的页数
    /// </summary>
    public int Count { get; }

    /// <summary>
    /// 是否选中了全部
    /// </summary>
    public bool IsAll => Count == _selected.Length;

    /// <summary>
    /// 解析页码范围，如 1-3,5；缺省为全部。写法不对、页码为 0、起页大于止页或一页都没选中时返回 null
    /// </summary>
    public static PageSelection? Parse(string? ranges, int total)
    {
        var selected = new bool[total];
        if (string.IsNullOrEmpty(ranges))
        {
            Array.Fill(selected, true);
            return new PageSelection(selected);
        }
        foreach (var part in ranges.Split(','))
        {
            var bounds = part.Split('-');
            if (bounds.Length > 2 || !int.TryParse(bounds[0], out var first) || first < 1)
                return null;
            var last = first;
            if (bounds.Length == 2 && (!int.TryParse(bounds[1], out last) || last < first))
                return null;
            for (var page = first; page <= Math.Min(last, total); page++)
                selected[page - 1] = true;
        }
        var selection = new PageSelection(selected);
        return selection.Count == 0 ? null : selection;
    }

    /// <summary>
    /// 在一段连续输出页 [start, start + count) 里选中的页数
    /// </summary>
    public int CountIn(int start, int count) => _selected.AsSpan(start, count).Count(true);

    /// <summary>
    /// 一段连续输出页里选中的页，换成以这一段为准的页码范围；全选时为空串，一页都没选中时为 null
    /// </summary>
    public string? RangesIn(int start, int count)
    {
        var span = _selected.AsSpan(start, count);
        if (!span.Contains(true))
            return null;
        if (!span.Contains(false))
            return string.Empty;
        var text = new StringBuilder();
        for (var index = 0; index < span.Length; index++)
        {
            if (!span[index])
                continue;
            var end = index;
            while (end + 1 < span.Length && span[end + 1])
                end++;
            if (text.Length > 0)
                text.Append(',');
            text.Append(index + 1);
            if (end > index)
                text.Append('-').Append(end + 1);
            index = end;
        }
        return text.ToString();
    }
}
