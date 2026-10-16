// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Globalization;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Logging;

/// <summary>
/// 写到日志目录的文本日志：每天一个文件 print-client-yyyyMMdd.log，换天时删掉超过保留天数的旧文件；写不进去时静默丢弃
/// </summary>
public sealed class FileClientLog : IClientLog, IDisposable
{
    private const string Prefix = "print-client-";
    private const string Extension = ".log";

    private readonly string _directory;
    private readonly int _retainDays;
    private readonly TimeProvider _time;
    private readonly Lock _gate = new();
    private StreamWriter? _writer;
    private DateOnly _day;

    /// <summary>
    /// 创建日志；retainDays 含当天
    /// </summary>
    public FileClientLog(string directory, LogLevel minimum = LogLevel.Information, int retainDays = 14, TimeProvider? time = null)
    {
        _directory = directory;
        _retainDays = retainDays;
        _time = time ?? TimeProvider.System;
        Minimum = minimum;
    }

    /// <summary>
    /// 低于这一级的不写
    /// </summary>
    public LogLevel Minimum { get; set; }

    /// <summary>
    /// 日志目录
    /// </summary>
    public string Directory => _directory;

    /// <inheritdoc />
    public void Write(LogLevel level, string message, Exception? exception = null)
    {
        if (level < Minimum)
            return;
        var now = _time.GetLocalNow();
        lock (_gate)
        {
            try
            {
                var writer = WriterFor(DateOnly.FromDateTime(now.DateTime));
                writer.WriteLine(string.Create(CultureInfo.InvariantCulture, $"{now:yyyy-MM-dd HH:mm:ss.fff zzz} [{Tag(level)}] {message}"));
                if (exception is not null)
                    writer.WriteLine(exception.ToString());
                writer.Flush();
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                _writer?.Dispose();
                _writer = null;
            }
        }
    }

    /// <summary>
    /// 某一天的日志文件名
    /// </summary>
    public static string FileName(DateOnly day) => Prefix + day.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + Extension;

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }

    private StreamWriter WriterFor(DateOnly day)
    {
        if (_writer is not null && day == _day)
            return _writer;
        _writer?.Dispose();
        System.IO.Directory.CreateDirectory(_directory);
        Purge(day);
        var stream = new FileStream(Path.Combine(_directory, FileName(day)), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        _writer = new StreamWriter(stream);
        _day = day;
        return _writer;
    }

    private void Purge(DateOnly today)
    {
        var oldest = today.AddDays(1 - _retainDays);
        foreach (var file in System.IO.Directory.EnumerateFiles(_directory, Prefix + "*" + Extension))
        {
            var stamp = Path.GetFileNameWithoutExtension(file)[Prefix.Length..];
            if (DateOnly.TryParseExact(stamp, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) && day < oldest)
            {
                try
                {
                    File.Delete(file);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                }
            }
        }
    }

    private static string Tag(LogLevel level) => level switch
    {
        LogLevel.Debug => "DBG",
        LogLevel.Information => "INF",
        LogLevel.Warning => "WRN",
        _ => "ERR",
    };
}
