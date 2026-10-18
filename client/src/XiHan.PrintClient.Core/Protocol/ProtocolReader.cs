// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 读出一条请求的结果：成功时有 Request，失败时有 Error；读得到 id 时 Id 给出，用于回错
/// </summary>
/// <param name="Request">请求</param>
/// <param name="Id">请求标识</param>
/// <param name="Error">错误</param>
public sealed record ReadResult(ClientRequest? Request, string? Id, ProtocolError? Error);

/// <summary>
/// 把浏览器发来的一条 JSON 文本消息读成请求，并检查字段与上限；不认识的字段忽略
/// </summary>
public static partial class ProtocolReader
{
    /// <summary>
    /// 任务资源解码后的总量上限，字节
    /// </summary>
    public const int MaxResourceBytes = 64 * 1024 * 1024;

    /// <summary>
    /// 打印机名的长度上限
    /// </summary>
    public const int MaxPrinterNameLength = 256;

    /// <summary>
    /// 份数上限
    /// </summary>
    public const int MaxCopies = 999;

    /// <summary>
    /// 纸张边长上限，毫米
    /// </summary>
    public const double MaxPaperMm = 2000;

    /// <summary>
    /// 读一条消息
    /// </summary>
    /// <param name="message">UTF-8 编码的 JSON 文本</param>
    /// <param name="maxResourceBytes">任务资源解码后的总量上限，字节</param>
    public static ReadResult Read(ReadOnlyMemory<byte> message, int maxResourceBytes = MaxResourceBytes)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(message, new JsonDocumentOptions { MaxDepth = 16 });
        }
        catch (JsonException)
        {
            return Fail(null, PrintErrorCodes.BadRequest, "消息不是合法的 JSON");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return Fail(null, PrintErrorCodes.BadRequest, "消息必须是 JSON 对象");

            var id = root.TryGetProperty("id", out var idElement) && idElement.ValueKind == JsonValueKind.String ? idElement.GetString() : null;
            try
            {
                var type = Text(root, "type", 64);
                if (id is null || !TokenPattern().IsMatch(id))
                    throw new RequestException(PrintErrorCodes.BadRequest, "id", "id 必须是 1–64 位的字母、数字、短横线或下划线");
                return new ReadResult(ReadRequest(type, id, root, maxResourceBytes), id, null);
            }
            catch (RequestException error)
            {
                return Fail(id, error.Code, error.Message, error.Field);
            }
        }
    }

    private static ClientRequest ReadRequest(string type, string id, JsonElement root, int maxResourceBytes)
    {
        return type switch
        {
            "hello" => new HelloRequest(id, Integer(root, "protocol", 1, int.MaxValue), OptionalInteger(root, "minor", 0, int.MaxValue) ?? 0, Sdk(root), OptionalText(root, "resume", 256)),
            "ping" => new PingRequest(id),
            "printers.list" => new ListPrintersRequest(id),
            "printers.get" => new GetPrinterRequest(id, Text(root, "name", MaxPrinterNameLength)),
            "print.html" => new PrintHtmlRequest(id, JobId(root), Document(root, maxResourceBytes), OptionalText(root, "printer", MaxPrinterNameLength), Options(root)),
            "print.raw" => new PrintRawRequest(id, JobId(root), Text(root, "printer", MaxPrinterNameLength), RawData(root), OptionalText(root, "docName", 256)),
            "export.pdf" => new ExportPdfRequest(id, JobId(root), Document(root, maxResourceBytes), Options(root)),
            "job.get" => new GetJobRequest(id, JobId(root)),
            "job.cancel" => new CancelJobRequest(id, JobId(root)),
            _ => throw new RequestException(PrintErrorCodes.BadRequest, "type", $"不认识的消息类型：{type}"),
        };
    }

    private static string JobId(JsonElement root)
    {
        var value = Text(root, "jobId", 64);
        return TokenPattern().IsMatch(value)
            ? value
            : throw new RequestException(PrintErrorCodes.BadRequest, "jobId", "jobId 必须是 1–64 位的字母、数字、短横线或下划线");
    }

    private static SdkInfo? Sdk(JsonElement root)
    {
        if (!root.TryGetProperty("sdk", out var sdk) || sdk.ValueKind == JsonValueKind.Null)
            return null;
        if (sdk.ValueKind != JsonValueKind.Object)
            throw new RequestException(PrintErrorCodes.BadRequest, "sdk", "sdk 必须是对象");
        return new SdkInfo { Name = OptionalText(sdk, "name", 128), Version = OptionalText(sdk, "version", 64) };
    }

    private static PrintDocument Document(JsonElement root, int maxResourceBytes)
    {
        var document = Object(root, "document");
        var html = Text(document, "html", ClientDefaults.MaxMessageBytes);
        var resources = new List<DocumentResource>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        if (document.TryGetProperty("resources", out var list) && list.ValueKind != JsonValueKind.Null)
        {
            if (list.ValueKind != JsonValueKind.Array)
                throw new RequestException(PrintErrorCodes.BadRequest, "document.resources", "resources 必须是数组");
            foreach (var item in list.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                    throw new RequestException(PrintErrorCodes.BadRequest, "document.resources", "资源必须是对象");
                var resourceId = Text(item, "id", 64);
                if (!TokenPattern().IsMatch(resourceId) || !seen.Add(resourceId))
                    throw new RequestException(PrintErrorCodes.BadRequest, "document.resources.id", $"资源编号不合法或重复：{resourceId}");
                var data = Base64(item, "data", "document.resources.data");
                total += data.Length;
                if (total > maxResourceBytes)
                    throw new RequestException(PrintErrorCodes.DocumentTooLarge, "document.resources", $"资源总量超过 {maxResourceBytes} 字节");
                resources.Add(new DocumentResource(resourceId, Text(item, "type", 128), data));
            }
        }

        var sheets = new List<SheetGroup>();
        var groups = Array(document, "sheets");
        foreach (var group in groups.EnumerateArray())
        {
            if (group.ValueKind != JsonValueKind.Object)
                throw new RequestException(PrintErrorCodes.BadRequest, "document.sheets", "纸张分组必须是对象");
            sheets.Add(new SheetGroup(Length(group, "widthMm"), Length(group, "heightMm"), Integer(group, "count", 1, int.MaxValue)));
        }
        if (sheets.Count == 0)
            throw new RequestException(PrintErrorCodes.BadRequest, "document.sheets", "sheets 至少要有一组");
        return new PrintDocument(html, resources, sheets);
    }

    private static PrintOptions Options(JsonElement root)
    {
        if (!root.TryGetProperty("options", out var options) || options.ValueKind == JsonValueKind.Null)
            return new PrintOptions();
        if (options.ValueKind != JsonValueKind.Object)
            throw new RequestException(PrintErrorCodes.BadRequest, "options", "options 必须是对象");
        var pageRanges = OptionalText(options, "pageRanges", 256);
        if (pageRanges is not null && !PageRangesPattern().IsMatch(pageRanges))
            throw new RequestException(PrintErrorCodes.BadRequest, "options.pageRanges", "pageRanges 的写法如 1-3,5");
        return new PrintOptions
        {
            Copies = OptionalInteger(options, "copies", 1, MaxCopies) ?? 1,
            Collate = OptionalBoolean(options, "collate") ?? true,
            Duplex = OptionalText(options, "duplex", 32) switch
            {
                null or "simplex" => DuplexMode.Simplex,
                "long-edge" => DuplexMode.LongEdge,
                "short-edge" => DuplexMode.ShortEdge,
                var other => throw new RequestException(PrintErrorCodes.BadRequest, "options.duplex", $"不认识的双面方式：{other}"),
            },
            Color = OptionalText(options, "color", 32) switch
            {
                null or "color" => ColorMode.Color,
                "grayscale" => ColorMode.Grayscale,
                var other => throw new RequestException(PrintErrorCodes.BadRequest, "options.color", $"不认识的颜色方式：{other}"),
            },
            PageRanges = pageRanges,
            Dialog = OptionalBoolean(options, "dialog") ?? false,
            TimeoutMs = OptionalInteger(options, "timeoutMs", 1000, 600_000),
            FitToNearestPaper = OptionalBoolean(options, "fitToNearestPaper") ?? false,
        };
    }

    private static byte[] RawData(JsonElement root)
    {
        var data = Base64(root, "data", "data");
        return data.Length > 0 ? data : throw new RequestException(PrintErrorCodes.BadRequest, "data", "data 不能为空");
    }

    private static byte[] Base64(JsonElement owner, string name, string field)
    {
        var text = Text(owner, name, ClientDefaults.MaxMessageBytes, allowEmpty: true);
        var buffer = new byte[text.Length / 4 * 3 + 3];
        return Convert.TryFromBase64String(text, buffer, out var written)
            ? buffer.AsSpan(0, written).ToArray()
            : throw new RequestException(PrintErrorCodes.BadRequest, field, $"{field} 不是合法的 base64");
    }

    private static JsonElement Object(JsonElement owner, string name)
    {
        return owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : throw new RequestException(PrintErrorCodes.BadRequest, name, $"缺少对象 {name}");
    }

    private static JsonElement Array(JsonElement owner, string name)
    {
        return owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value
            : throw new RequestException(PrintErrorCodes.BadRequest, name, $"缺少数组 {name}");
    }

    private static string Text(JsonElement owner, string name, int maxLength, bool allowEmpty = false)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new RequestException(PrintErrorCodes.BadRequest, name, $"缺少字符串 {name}");
        var text = value.GetString()!;
        if (!allowEmpty && text.Length == 0)
            throw new RequestException(PrintErrorCodes.BadRequest, name, $"{name} 不能为空");
        return text.Length <= maxLength ? text : throw new RequestException(PrintErrorCodes.BadRequest, name, $"{name} 超过 {maxLength} 个字符");
    }

    private static string? OptionalText(JsonElement owner, string name, int maxLength)
    {
        return owner.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? Text(owner, name, maxLength) : null;
    }

    private static int Integer(JsonElement owner, string name, int min, int max)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
            throw new RequestException(PrintErrorCodes.BadRequest, name, $"缺少整数 {name}");
        return number >= min && number <= max ? number : throw new RequestException(PrintErrorCodes.BadRequest, name, $"{name} 应在 {min}–{max} 之间");
    }

    private static int? OptionalInteger(JsonElement owner, string name, int min, int max)
    {
        return owner.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? Integer(owner, name, min, max) : null;
    }

    private static bool? OptionalBoolean(JsonElement owner, string name)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new RequestException(PrintErrorCodes.BadRequest, name, $"{name} 必须是布尔值"),
        };
    }

    private static double Length(JsonElement owner, string name)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number)
            throw new RequestException(PrintErrorCodes.BadRequest, name, $"缺少数值 {name}");
        var number = value.GetDouble();
        return number > 0 && number <= MaxPaperMm ? number : throw new RequestException(PrintErrorCodes.BadRequest, name, $"{name} 应大于 0 且不超过 {MaxPaperMm}");
    }

    private static ReadResult Fail(string? id, string code, string message, string? field = null)
    {
        var details = field is null ? null : new JsonObject { ["field"] = field };
        return new ReadResult(null, id, new ProtocolError(code, message, details));
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex TokenPattern();

    [GeneratedRegex(@"^\d+(-\d+)?(,\d+(-\d+)?)*$")]
    private static partial Regex PageRangesPattern();

    /// <summary>
    /// 读字段时发现的问题
    /// </summary>
    private sealed class RequestException(string code, string field, string message) : Exception(message)
    {
        public string Code { get; } = code;

        public string Field { get; } = field;
    }
}
