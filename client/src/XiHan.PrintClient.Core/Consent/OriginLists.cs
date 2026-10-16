// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;
using System.Text.Json.Serialization;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Consent;

/// <summary>
/// 用户的允许名单与拒绝名单，存在设置目录的 origins.json；同一来源只会在其中一张名单里
/// </summary>
public sealed class OriginLists
{
    private readonly string _path;
    private readonly IClientLog _log;
    private readonly Lock _gate = new();
    private readonly SortedSet<string> _allowed = new(StringComparer.Ordinal);
    private readonly SortedSet<string> _denied = new(StringComparer.Ordinal);

    /// <summary>
    /// 从文件读入名单；文件不存在时为空，读不出时记错误日志并按空名单处理
    /// </summary>
    public OriginLists(string path, IClientLog? log = null)
    {
        _path = path;
        _log = log ?? NullClientLog.Instance;
        Load();
    }

    /// <summary>
    /// 名单变化后调用
    /// </summary>
    public event Action? Changed;

    /// <summary>
    /// 允许名单
    /// </summary>
    public IReadOnlyList<string> Allowed
    {
        get
        {
            lock (_gate)
                return [.. _allowed];
        }
    }

    /// <summary>
    /// 拒绝名单
    /// </summary>
    public IReadOnlyList<string> Denied
    {
        get
        {
            lock (_gate)
                return [.. _denied];
        }
    }

    /// <summary>
    /// 是否在允许名单
    /// </summary>
    public bool IsAllowed(string origin)
    {
        lock (_gate)
            return _allowed.Contains(origin);
    }

    /// <summary>
    /// 是否在拒绝名单
    /// </summary>
    public bool IsDenied(string origin)
    {
        lock (_gate)
            return _denied.Contains(origin);
    }

    /// <summary>
    /// 记进允许名单，同时移出拒绝名单
    /// </summary>
    public void Allow(string origin) => Update(() => _denied.Remove(origin) | _allowed.Add(origin));

    /// <summary>
    /// 记进拒绝名单，同时移出允许名单
    /// </summary>
    public void Deny(string origin) => Update(() => _allowed.Remove(origin) | _denied.Add(origin));

    /// <summary>
    /// 从两张名单里都删掉，下次连接时重新询问
    /// </summary>
    public void Forget(string origin) => Update(() => _allowed.Remove(origin) | _denied.Remove(origin));

    private void Update(Func<bool> change)
    {
        lock (_gate)
        {
            if (!change())
                return;
            Save();
        }
        Changed?.Invoke();
    }

    private void Load()
    {
        if (!File.Exists(_path))
            return;
        try
        {
            var file = JsonSerializer.Deserialize(File.ReadAllBytes(_path), OriginListsJsonContext.Default.OriginListsFile);
            foreach (var origin in file?.Allowed ?? [])
            {
                if (OriginName.TryNormalize(origin, out var normalized))
                    _allowed.Add(normalized);
            }
            foreach (var origin in file?.Denied ?? [])
            {
                if (OriginName.TryNormalize(origin, out var normalized) && !_allowed.Contains(normalized))
                    _denied.Add(normalized);
            }
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            _log.Write(LogLevel.Error, $"读不出来源名单 {_path}，按空名单处理", error);
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = _path + ".tmp";
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(new OriginListsFile { Allowed = [.. _allowed], Denied = [.. _denied] }, OriginListsJsonContext.Default.OriginListsFile));
        File.Move(temporary, _path, overwrite: true);
    }
}

/// <summary>
/// origins.json 的形状
/// </summary>
internal sealed class OriginListsFile
{
    public List<string> Allowed { get; init; } = [];

    public List<string> Denied { get; init; } = [];
}

/// <summary>
/// origins.json 的源生成上下文
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]
[JsonSerializable(typeof(OriginListsFile))]
internal sealed partial class OriginListsJsonContext : JsonSerializerContext;
