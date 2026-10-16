// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;
using System.Text.Json.Serialization;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core;

/// <summary>
/// 用户自己的设置，存在设置目录的 settings.json；开机自启以注册表为准，不在这里
/// </summary>
public sealed class ClientSettings
{
    /// <summary>
    /// 日志级别
    /// </summary>
    public LogLevel LogLevel { get; set; } = LogLevel.Information;

    /// <summary>
    /// 是否检查更新；策略关掉时不生效
    /// </summary>
    public bool CheckForUpdates { get; set; } = true;

    /// <summary>
    /// 读设置；文件不存在或读不出来时用缺省值
    /// </summary>
    public static ClientSettings Load(string path, IClientLog? log = null)
    {
        var settings = new ClientSettings();
        if (!File.Exists(path))
            return settings;
        try
        {
            var file = JsonSerializer.Deserialize(File.ReadAllBytes(path), ClientSettingsJsonContext.Default.ClientSettingsFile);
            if (Enum.TryParse<LogLevel>(file?.LogLevel, ignoreCase: true, out var level) && Enum.IsDefined(level))
                settings.LogLevel = level;
            settings.CheckForUpdates = file?.CheckForUpdates ?? true;
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            log?.Write(LogLevel.Warning, $"读不出设置 {path}，用缺省值", error);
        }
        return settings;
    }

    /// <summary>
    /// 存设置：先写临时文件再替换
    /// </summary>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        var file = new ClientSettingsFile { LogLevel = LogLevel.ToString().ToLowerInvariant(), CheckForUpdates = CheckForUpdates };
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(file, ClientSettingsJsonContext.Default.ClientSettingsFile));
        File.Move(temporary, path, overwrite: true);
    }
}

/// <summary>
/// settings.json 的形状
/// </summary>
internal sealed class ClientSettingsFile
{
    public string? LogLevel { get; init; }

    public bool? CheckForUpdates { get; init; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true, ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true)]
[JsonSerializable(typeof(ClientSettingsFile))]
internal sealed partial class ClientSettingsJsonContext : JsonSerializerContext;
