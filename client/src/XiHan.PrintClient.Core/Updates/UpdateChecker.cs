// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Security.Cryptography;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Updates;

/// <summary>
/// 一次检查的结果
/// </summary>
/// <param name="Offer">有新版时的清单与安装包；已是最新时为 null</param>
/// <param name="Source">取到清单的地址；所有地址都取不到时为 null</param>
public sealed record UpdateCheckResult(UpdateOffer? Offer, Uri? Source);

/// <summary>
/// 可以安装的新版
/// </summary>
/// <param name="Manifest">清单</param>
/// <param name="Asset">本机架构的安装包</param>
public sealed record UpdateOffer(UpdateManifest Manifest, UpdateAsset Asset);

/// <summary>
/// 下载或校验安装包失败
/// </summary>
public sealed class UpdateFailure(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// 检查与下载更新：按顺序取清单，前一个地址取不到或清单不对才取下一个；下载时边写边算 SHA-256，与清单不符就删掉
/// </summary>
public sealed class UpdateChecker
{
    /// <summary>
    /// 缺省的清单地址：先 Gitee 再 GitHub
    /// </summary>
    public static IReadOnlyList<Uri> DefaultManifests { get; } =
    [
        new("https://gitee.com/XiHanFun/XiHan.PrintDesigner/raw/main/client/update.json"),
        new("https://raw.githubusercontent.com/XiHanFun/XiHan.PrintDesigner/main/client/update.json"),
    ];

    private readonly HttpClient _http;
    private readonly IReadOnlyList<Uri> _manifests;
    private readonly SemanticVersion _current;
    private readonly string _arch;
    private readonly IClientLog _log;

    /// <summary>
    /// 以 HTTP 客户端、清单地址、当前版本与本机架构创建
    /// </summary>
    public UpdateChecker(HttpClient http, IReadOnlyList<Uri> manifests, SemanticVersion current, string arch, IClientLog? log = null)
    {
        _http = http;
        _manifests = manifests;
        _current = current;
        _arch = arch;
        _log = log ?? NullClientLog.Instance;
    }

    /// <summary>
    /// 每个清单地址的期限
    /// </summary>
    public TimeSpan ManifestTimeout { get; init; } = TimeSpan.FromSeconds(15);

    /// <summary>
    /// 取清单并与当前版本比较
    /// </summary>
    public async Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken)
    {
        foreach (var source in _manifests)
        {
            UpdateManifest? manifest;
            try
            {
                using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                limit.CancelAfter(ManifestTimeout);
                using var response = await _http.GetAsync(source, HttpCompletionOption.ResponseHeadersRead, limit.Token).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                var body = await ReadLimitedAsync(response, UpdateManifest.MaxManifestBytes, limit.Token).ConfigureAwait(false);
                manifest = UpdateManifest.Parse(body, out var problem);
                if (manifest is null)
                {
                    _log.Write(LogLevel.Warning, $"更新清单 {source} 不对：{problem}");
                    continue;
                }
            }
            catch (Exception error) when (error is HttpRequestException or IOException or UpdateFailure || (error is OperationCanceledException && !cancellationToken.IsCancellationRequested))
            {
                _log.Write(LogLevel.Information, $"取不到更新清单 {source}：{error.Message}");
                continue;
            }

            var asset = manifest.AssetFor(_arch);
            if (manifest.Version.IsNewerThan(_current) && asset is not null)
            {
                _log.Write(LogLevel.Information, $"发现新版本 {manifest.Version}（{source.Host}）");
                return new UpdateCheckResult(new UpdateOffer(manifest, asset), source);
            }
            if (asset is null && manifest.Version.IsNewerThan(_current))
                _log.Write(LogLevel.Information, $"新版本 {manifest.Version} 没有 {_arch} 的安装包");
            return new UpdateCheckResult(null, source);
        }
        return new UpdateCheckResult(null, null);
    }

    /// <summary>
    /// 把安装包下载到目录里，校验大小与 SHA-256 后返回文件路径；不符时删掉并抛出 <see cref="UpdateFailure"/>
    /// </summary>
    public async Task<string> DownloadAsync(UpdateOffer offer, string directory, IProgress<long>? progress, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"XiHanPrint-{offer.Manifest.Version}-{offer.Asset.Arch}-setup.exe");
        var partial = path + ".partial";
        try
        {
            using var response = await _http.GetAsync(offer.Asset.Url, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long total = 0;
            await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
            await using (var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > offer.Asset.Size)
                        throw new UpdateFailure("下载的安装包比清单写的大");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                    progress?.Report(total);
                }
            }
            if (total != offer.Asset.Size)
                throw new UpdateFailure($"下载的安装包大小不对：{total} 字节，清单写的是 {offer.Asset.Size}");
            var actual = Convert.ToHexStringLower(hash.GetHashAndReset());
            if (actual != offer.Asset.Sha256)
                throw new UpdateFailure("下载的安装包 SHA-256 与清单不符");
            File.Move(partial, path, overwrite: true);
            _log.Write(LogLevel.Information, $"安装包已下载并校验：{path}");
            return path;
        }
        catch (Exception error) when (error is HttpRequestException or IOException)
        {
            throw new UpdateFailure("下载安装包失败：" + error.Message, error);
        }
        finally
        {
            File.Delete(partial);
        }
    }

    private static async Task<byte[]> ReadLimitedAsync(HttpResponseMessage response, int limit, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var memory = new MemoryStream();
        var buffer = new byte[16384];
        int read;
        while ((read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            if (memory.Length + read > limit)
                throw new UpdateFailure("更新清单太大");
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }
}
