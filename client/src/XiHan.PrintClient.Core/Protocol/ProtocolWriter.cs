// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 写出发给浏览器的消息：响应、心跳回复、授权等待与任务事件，都是 UTF-8 的 JSON 文本
/// </summary>
public static class ProtocolWriter
{
    /// <summary>
    /// 握手成功
    /// </summary>
    public static byte[] Welcome(string id, WelcomeData data) => Result(id, data, ProtocolJsonContext.Default.WelcomeData);

    /// <summary>
    /// 打印机列表
    /// </summary>
    public static byte[] Printers(string id, IReadOnlyList<PrinterInfo> printers) => Result(id, printers, ProtocolJsonContext.Default.IReadOnlyListPrinterInfo);

    /// <summary>
    /// 一台打印机
    /// </summary>
    public static byte[] Printer(string id, PrinterInfo printer) => Result(id, printer, ProtocolJsonContext.Default.PrinterInfo);

    /// <summary>
    /// 任务已受理
    /// </summary>
    public static byte[] Accepted(string id, JobAccepted accepted) => Result(id, accepted, ProtocolJsonContext.Default.JobAccepted);

    /// <summary>
    /// 任务的当前状态
    /// </summary>
    public static byte[] Status(string id, JobStatus status) => Result(id, status, ProtocolJsonContext.Default.JobStatus);

    /// <summary>
    /// 取消任务的结果
    /// </summary>
    public static byte[] Cancelled(string id, JobCancelled cancelled) => Result(id, cancelled, ProtocolJsonContext.Default.JobCancelled);

    /// <summary>
    /// 请求失败；读不出 id 时 id 为 null
    /// </summary>
    public static byte[] Error(string? id, ProtocolError error)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "result");
            if (id is not null)
                writer.WriteString("id", id);
            writer.WriteBoolean("ok", false);
            writer.WritePropertyName("error");
            JsonSerializer.Serialize(writer, error, ProtocolJsonContext.Default.ProtocolError);
        });
    }

    /// <summary>
    /// 心跳回复
    /// </summary>
    public static byte[] Pong(string id)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "pong");
            writer.WriteString("id", id);
        });
    }

    /// <summary>
    /// 来源未授权，客户端已弹出授权窗口
    /// </summary>
    public static byte[] ConsentPending(string origin)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "consent.pending");
            writer.WriteString("origin", origin);
        });
    }

    /// <summary>
    /// 任务事件：类型为 job. 加状态名，带上状态里有值的字段与发生时间
    /// </summary>
    public static byte[] JobEvent(JobStatus status, DateTimeOffset at)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "job." + StateName(status.State));
            writer.WriteString("jobId", status.JobId);
            if (status.Position is { } position)
                writer.WriteNumber("position", position);
            if (status.Sheets is { } sheets)
                writer.WriteNumber("sheets", sheets);
            if (status.Bytes is { } bytes)
                writer.WriteNumber("bytes", bytes);
            if (status.Error is { } error)
            {
                writer.WritePropertyName("error");
                JsonSerializer.Serialize(writer, error, ProtocolJsonContext.Default.ProtocolError);
            }
            writer.WriteString("at", at.UtcDateTime);
        });
    }

    /// <summary>
    /// 任务产出的头：紧随其后的一条二进制消息就是产出本身
    /// </summary>
    public static byte[] JobOutput(string jobId, string mime, long bytes)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "job.output");
            writer.WriteString("jobId", jobId);
            writer.WriteString("mime", mime);
            writer.WriteNumber("bytes", bytes);
        });
    }

    /// <summary>
    /// 状态在协议里的名字
    /// </summary>
    public static string StateName(JobState state) => state switch
    {
        JobState.Queued => "queued",
        JobState.Started => "started",
        JobState.Completed => "completed",
        JobState.Failed => "failed",
        JobState.Cancelled => "cancelled",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
    };

    private static byte[] Result<T>(string id, T data, JsonTypeInfo<T> typeInfo)
    {
        return Write(writer =>
        {
            writer.WriteString("type", "result");
            writer.WriteString("id", id);
            writer.WriteBoolean("ok", true);
            writer.WritePropertyName("data");
            JsonSerializer.Serialize(writer, data, typeInfo);
        });
    }

    private static byte[] Write(Action<Utf8JsonWriter> body)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            body(writer);
            writer.WriteEndObject();
        }
        return buffer.WrittenSpan.ToArray();
    }
}
