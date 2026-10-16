// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;

namespace XiHan.PrintClient.Core.Updates;

/// <summary>
/// 一个架构的安装包
/// </summary>
/// <param name="Arch">架构：x64、arm64</param>
/// <param name="Url">下载地址，只认 https</param>
/// <param name="Sha256">安装包的 SHA-256，小写十六进制</param>
/// <param name="Size">字节数</param>
public sealed record UpdateAsset(string Arch, Uri Url, string Sha256, long Size);

/// <summary>
/// 更新清单：最新版本、发布说明与各架构的安装包
/// </summary>
/// <param name="Version">版本</param>
/// <param name="Notes">发布说明</param>
/// <param name="Assets">安装包</param>
public sealed record UpdateManifest(SemanticVersion Version, string? Notes, IReadOnlyList<UpdateAsset> Assets)
{
    /// <summary>
    /// 清单最大字节数
    /// </summary>
    public const int MaxManifestBytes = 1024 * 1024;

    /// <summary>
    /// 安装包最大字节数
    /// </summary>
    public const long MaxAssetBytes = 512L * 1024 * 1024;

    /// <summary>
    /// 某个架构的安装包；没有时为 null
    /// </summary>
    public UpdateAsset? AssetFor(string arch) => Assets.FirstOrDefault(asset => string.Equals(asset.Arch, arch, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// 解析清单；形状不对时返回 null 并给出原因
    /// </summary>
    public static UpdateManifest? Parse(ReadOnlySpan<byte> json, out string? problem)
    {
        problem = null;
        try
        {
            using var document = JsonDocument.Parse(json.ToArray(), new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return Fail("清单必须是对象", out problem);
            if (!root.TryGetProperty("version", out var versionText) || versionText.ValueKind != JsonValueKind.String || !SemanticVersion.TryParse(versionText.GetString(), out var version))
                return Fail("version 不是有效的版本号", out problem);
            var notes = root.TryGetProperty("notes", out var notesText) && notesText.ValueKind == JsonValueKind.String ? notesText.GetString() : null;
            if (!root.TryGetProperty("assets", out var items) || items.ValueKind != JsonValueKind.Array)
                return Fail("assets 必须是数组", out problem);
            var assets = new List<UpdateAsset>();
            foreach (var item in items.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object
                    || Text(item, "arch") is not { Length: > 0 } arch
                    || !Uri.TryCreate(Text(item, "url"), UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps
                    || Text(item, "sha256") is not { Length: 64 } sha256 || !sha256.All(char.IsAsciiHexDigit)
                    || !item.TryGetProperty("size", out var sizeValue) || !sizeValue.TryGetInt64(out var size) || size <= 0 || size > MaxAssetBytes)
                    return Fail("assets 里有一项不完整：要有 arch、https 的 url、64 位十六进制的 sha256 与正数 size", out problem);
                assets.Add(new UpdateAsset(arch, url, sha256.ToLowerInvariant(), size));
            }
            return new UpdateManifest(version, notes, assets);
        }
        catch (JsonException error)
        {
            return Fail("清单不是有效的 JSON：" + error.Message, out problem);
        }
    }

    private static string? Text(JsonElement item, string name) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static UpdateManifest? Fail(string message, out string? problem)
    {
        problem = message;
        return null;
    }
}
