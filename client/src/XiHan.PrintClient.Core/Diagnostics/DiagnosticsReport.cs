// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using XiHan.PrintClient.Core.Consent;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Diagnostics;

/// <summary>
/// 诊断信息的素材
/// </summary>
public sealed class DiagnosticsInput
{
    /// <summary>
    /// 客户端信息
    /// </summary>
    public required ClientInfo Client { get; init; }

    /// <summary>
    /// 监听的端口；没在监听时为 null
    /// </summary>
    public int? Port { get; init; }

    /// <summary>
    /// 生效的策略
    /// </summary>
    public required ClientPolicy Policy { get; init; }

    /// <summary>
    /// 策略文件是否存在
    /// </summary>
    public bool PolicyFileExists { get; init; }

    /// <summary>
    /// 用户的允许名单
    /// </summary>
    public IReadOnlyList<string> Allowed { get; init; } = [];

    /// <summary>
    /// 用户的拒绝名单
    /// </summary>
    public IReadOnlyList<string> Denied { get; init; } = [];

    /// <summary>
    /// 最近的任务，新的在前
    /// </summary>
    public IReadOnlyList<JobRecord> RecentJobs { get; init; } = [];
}

/// <summary>
/// 诊断信息：给用户看的文本，以及把日志、设置、策略与诊断信息打成 zip 的诊断包
/// </summary>
public static partial class DiagnosticsReport
{
    /// <summary>
    /// 诊断信息里列出的任务个数
    /// </summary>
    public const int RecentJobCount = 50;

    /// <summary>
    /// 写成文本；时间按 timeZone 显示
    /// </summary>
    public static string Format(DiagnosticsInput input, TimeZoneInfo? timeZone = null)
    {
        timeZone ??= TimeZoneInfo.Local;
        var text = new StringBuilder();
        var client = input.Client;
        text.AppendLine(CultureInfo.InvariantCulture, $"曦寒打印客户端 {client.Version}");
        text.AppendLine(CultureInfo.InvariantCulture, $"系统：{client.Os} {client.Arch}");
        text.AppendLine(client.Renderer is null ? "渲染：没有 WebView2 运行时，HTML 打印与导出 PDF 不可用" : $"渲染：WebView2 {client.Renderer}");
        text.AppendLine(input.Port is { } port ? $"监听：127.0.0.1:{port}" : "监听：没有可用端口，未在监听");
        text.AppendLine(CultureInfo.InvariantCulture, $"协议：{ClientDefaults.SubProtocol}");

        var policy = input.Policy;
        text.AppendLine();
        text.AppendLine(input.PolicyFileExists ? "策略：已读取 policy.json" : "策略：没有 policy.json，用缺省值");
        text.AppendLine(CultureInfo.InvariantCulture, $"  未授权来源弹窗询问：{(policy.PromptForUnknownOrigins ? "是" : "否")}");
        text.AppendLine(CultureInfo.InvariantCulture, $"  端口：{(policy.Ports.Count > 0 ? string.Join(", ", policy.Ports) : string.Join(", ", ClientDefaults.Ports) + "（缺省）")}");
        text.AppendLine(CultureInfo.InvariantCulture, $"  检查更新：{(policy.CheckForUpdates ? "允许" : "已关闭")}");

        text.AppendLine();
        text.AppendLine("允许的来源：");
        foreach (var origin in policy.AllowedOrigins)
            text.AppendLine(CultureInfo.InvariantCulture, $"  {origin}（策略）");
        foreach (var origin in input.Allowed)
            text.AppendLine(CultureInfo.InvariantCulture, $"  {origin}");
        if (policy.AllowedOrigins.Count + input.Allowed.Count == 0)
            text.AppendLine("  （无）");
        text.AppendLine("拒绝的来源：");
        foreach (var origin in input.Denied)
            text.AppendLine(CultureInfo.InvariantCulture, $"  {origin}");
        if (input.Denied.Count == 0)
            text.AppendLine("  （无）");

        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $"最近 {RecentJobCount} 个任务：");
        foreach (var job in input.RecentJobs.Take(RecentJobCount))
        {
            var at = TimeZoneInfo.ConvertTime(job.CreatedAt, timeZone);
            var amount = job.Sheets is { } sheets ? $"{sheets} 页" : job.Bytes is { } bytes ? $"{bytes} 字节" : "-";
            var took = job.FinishedAt is { } finished ? $"{(finished - job.CreatedAt).TotalSeconds:0.0} 秒" : "进行中";
            var error = job.ErrorCode is null ? string.Empty : " " + job.ErrorCode;
            text.AppendLine(CultureInfo.InvariantCulture, $"  {at:yyyy-MM-dd HH:mm:ss}  {Kind(job.Kind)}  {job.Printer ?? "-"}  {ProtocolWriter.StateName(job.State)}{error}  {amount}  {took}  {job.Origin}  {job.Id}");
        }
        if (input.RecentJobs.Count == 0)
            text.AppendLine("  （无）");
        return text.ToString();
    }

    /// <summary>
    /// 打诊断包：diagnostics.txt、logs/ 下的日志、settings/ 下的设置文件，以及 policy.json；文本里形如令牌的值打码
    /// </summary>
    public static void Export(string zipPath, string report, string logDirectory, IEnumerable<string> settingsFiles, string policyFile)
    {
        using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
        AddText(zip, "diagnostics.txt", report);
        if (Directory.Exists(logDirectory))
        {
            foreach (var file in Directory.EnumerateFiles(logDirectory, "*.log").Order(StringComparer.Ordinal))
                AddFile(zip, "logs/" + Path.GetFileName(file), file);
        }
        foreach (var file in settingsFiles.Where(File.Exists))
            AddFile(zip, "settings/" + Path.GetFileName(file), file);
        if (File.Exists(policyFile))
            AddFile(zip, "policy.json", policyFile);
    }

    /// <summary>
    /// 把形如令牌的值换成 ***
    /// </summary>
    public static string Mask(string text) => TokenPattern().Replace(text, "${key}***");

    [GeneratedRegex("""(?<key>"?(?:token|sessionToken|resume|password|secret)"?\s*[:=]\s*"?)[^\s",}&]{4,}""", RegexOptions.IgnoreCase)]
    private static partial Regex TokenPattern();

    private static void AddFile(ZipArchive zip, string name, string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);
            AddText(zip, name, reader.ReadToEnd());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            AddText(zip, name + ".unreadable.txt", error.Message);
        }
    }

    private static void AddText(ZipArchive zip, string name, string text)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(Mask(text));
    }

    private static string Kind(JobKind kind) => kind switch
    {
        JobKind.Html => "html",
        JobKind.Raw => "raw",
        _ => "pdf",
    };
}
