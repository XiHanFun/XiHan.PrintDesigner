// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;
using System.Text.Json.Serialization;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Consent;

/// <summary>
/// 管理员下发的策略，读自策略文件，优先于用户设置；没有策略文件时取缺省值
/// </summary>
public sealed class ClientPolicy
{
    /// <summary>
    /// 预先放行的来源，不弹授权窗口
    /// </summary>
    public IReadOnlyList<string> AllowedOrigins { get; init; } = [];

    /// <summary>
    /// 是否为不认识的来源弹授权窗口；关掉后只认预先放行的来源与用户名单里已允许的来源
    /// </summary>
    public bool PromptForUnknownOrigins { get; init; } = true;

    /// <summary>
    /// 固定的监听端口；为空时用缺省的端口
    /// </summary>
    public IReadOnlyList<int> Ports { get; init; } = [];

    /// <summary>
    /// 是否检查更新
    /// </summary>
    public bool CheckForUpdates { get; init; } = true;

    /// <summary>
    /// 更新清单地址，依次尝试；为空时用缺省的地址
    /// </summary>
    public IReadOnlyList<string> UpdateManifestUrls { get; init; } = [];

    /// <summary>
    /// 没有策略文件时的策略
    /// </summary>
    public static ClientPolicy Default { get; } = new();

    /// <summary>
    /// 读策略文件：不存在时取缺省值；读不出时记错误日志并取缺省值；不合法的来源与端口记警告日志后跳过
    /// </summary>
    public static ClientPolicy Load(string path, IClientLog? log = null)
    {
        log ??= NullClientLog.Instance;
        if (!File.Exists(path))
            return Default;
        PolicyFile? file;
        try
        {
            file = JsonSerializer.Deserialize(File.ReadAllBytes(path), PolicyJsonContext.Default.PolicyFile);
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            log.Write(LogLevel.Error, $"读不出策略文件 {path}，按没有策略处理", error);
            return Default;
        }
        if (file is null)
            return Default;

        var origins = new List<string>();
        foreach (var origin in file.AllowedOrigins ?? [])
        {
            if (OriginName.TryNormalize(origin, out var normalized))
                origins.Add(normalized);
            else
                log.Write(LogLevel.Warning, $"策略里的来源不合法，已跳过：{origin}");
        }
        var ports = new List<int>();
        foreach (var port in file.Ports ?? [])
        {
            if (port is > 0 and <= 65535)
                ports.Add(port);
            else
                log.Write(LogLevel.Warning, $"策略里的端口不合法，已跳过：{port}");
        }
        var urls = new List<string>();
        foreach (var url in file.Updates?.ManifestUrls ?? [])
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
                urls.Add(uri.AbsoluteUri);
            else
                log.Write(LogLevel.Warning, $"策略里的更新清单地址不是 https，已跳过：{url}");
        }
        return new ClientPolicy
        {
            AllowedOrigins = origins,
            PromptForUnknownOrigins = file.PromptForUnknownOrigins ?? true,
            Ports = ports,
            CheckForUpdates = file.Updates?.Check ?? true,
            UpdateManifestUrls = urls,
        };
    }
}

/// <summary>
/// policy.json 的形状
/// </summary>
internal sealed class PolicyFile
{
    public List<string>? AllowedOrigins { get; init; }

    public bool? PromptForUnknownOrigins { get; init; }

    public List<int>? Ports { get; init; }

    public PolicyUpdates? Updates { get; init; }
}

/// <summary>
/// policy.json 里的更新设置
/// </summary>
internal sealed class PolicyUpdates
{
    public bool? Check { get; init; }

    public List<string>? ManifestUrls { get; init; }
}

/// <summary>
/// policy.json 的源生成上下文：允许注释与尾逗号，便于管理员手写
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true)]
[JsonSerializable(typeof(PolicyFile))]
internal sealed partial class PolicyJsonContext : JsonSerializerContext;
