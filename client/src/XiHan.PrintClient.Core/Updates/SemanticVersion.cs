// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace XiHan.PrintClient.Core.Updates;

/// <summary>
/// 语义化版本 主.次.修订[-预发布]，构建元数据（+ 之后）忽略；预发布版低于同号正式版
/// </summary>
public sealed record SemanticVersion(int Major, int Minor, int Patch, string? Prerelease) : IComparable<SemanticVersion>
{
    /// <summary>
    /// 解析版本；写法不对时返回 false
    /// </summary>
    public static bool TryParse(string? text, [NotNullWhen(true)] out SemanticVersion? version)
    {
        version = null;
        if (string.IsNullOrWhiteSpace(text))
            return false;
        var core = text.Trim().Split('+')[0];
        var dash = core.IndexOf('-');
        var prerelease = dash < 0 ? null : core[(dash + 1)..];
        var numbers = (dash < 0 ? core : core[..dash]).Split('.');
        if (numbers.Length != 3 || prerelease is "" || (prerelease?.Split('.').Any(part => part.Length == 0 || !part.All(item => char.IsAsciiLetterOrDigit(item) || item == '-')) ?? false))
            return false;
        var parts = new int[3];
        for (var index = 0; index < 3; index++)
        {
            if (numbers[index].Length == 0 || !numbers[index].All(char.IsAsciiDigit) || !int.TryParse(numbers[index], NumberStyles.None, CultureInfo.InvariantCulture, out parts[index]))
                return false;
        }
        version = new SemanticVersion(parts[0], parts[1], parts[2], prerelease);
        return true;
    }

    /// <inheritdoc />
    public int CompareTo(SemanticVersion? other)
    {
        if (other is null)
            return 1;
        var result = (Major, Minor, Patch).CompareTo((other.Major, other.Minor, other.Patch));
        if (result != 0)
            return result;
        if (Prerelease is null || other.Prerelease is null)
            return (Prerelease is null).CompareTo(other.Prerelease is null);
        var mine = Prerelease.Split('.');
        var theirs = other.Prerelease.Split('.');
        for (var index = 0; index < Math.Min(mine.Length, theirs.Length); index++)
        {
            var leftNumeric = int.TryParse(mine[index], NumberStyles.None, CultureInfo.InvariantCulture, out var left);
            var rightNumeric = int.TryParse(theirs[index], NumberStyles.None, CultureInfo.InvariantCulture, out var right);
            result = leftNumeric && rightNumeric
                ? left.CompareTo(right)
                : leftNumeric != rightNumeric ? (leftNumeric ? -1 : 1) : string.CompareOrdinal(mine[index], theirs[index]);
            if (result != 0)
                return Math.Sign(result);
        }
        return mine.Length.CompareTo(theirs.Length);
    }

    /// <summary>
    /// 是否比另一个版本新
    /// </summary>
    public bool IsNewerThan(SemanticVersion other) => CompareTo(other) > 0;

    /// <inheritdoc />
    public override string ToString() => Prerelease is null ? $"{Major}.{Minor}.{Patch}" : $"{Major}.{Minor}.{Patch}-{Prerelease}";
}
