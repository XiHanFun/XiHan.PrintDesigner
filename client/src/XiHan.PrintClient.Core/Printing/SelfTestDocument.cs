// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Globalization;
using System.Net;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Printing;

/// <summary>
/// 自检页：一张输出页，写明客户端、渲染引擎、打印机与时间，四周距纸边 5 mm 画框，另有 50 mm 校准线
/// </summary>
public static class SelfTestDocument
{
    /// <summary>
    /// 选自检页的纸张：打印机支持 A4 时用 A4，否则用它报的第一种纸张，都没有时用 100×150 mm
    /// </summary>
    public static (double WidthMm, double HeightMm) PaperFor(PrinterInfo printer)
    {
        var papers = printer.Capabilities?.Papers ?? [];
        var paper = papers.FirstOrDefault(item => item.Id == 9) ?? papers.FirstOrDefault(item => item.WidthMm > 0 && item.HeightMm > 0);
        return paper is null ? (100, 150) : (paper.WidthMm, paper.HeightMm);
    }

    /// <summary>
    /// 生成自检页文档
    /// </summary>
    public static PrintDocument Create(ClientInfo client, string printer, double widthMm, double heightMm, DateTimeOffset now)
    {
        var width = widthMm.ToString(CultureInfo.InvariantCulture);
        var height = heightMm.ToString(CultureInfo.InvariantCulture);
        var lines = new[]
        {
            $"客户端：{client.Version}（{client.Os} {client.Arch}）",
            $"渲染：WebView2 {client.Renderer ?? "-"}",
            $"打印机：{printer}",
            $"纸张：{width} × {height} mm",
            $"时间：{now:yyyy-MM-dd HH:mm:ss zzz}",
        };
        var body = string.Concat(lines.Select(line => $"<p>{WebUtility.HtmlEncode(line)}</p>"));
        var html = $$"""
            <!doctype html>
            <html lang="zh-CN">
            <head>
            <meta charset="utf-8">
            <title>曦寒打印客户端自检页</title>
            <style>
            @page { margin: 0 }
            @page sheet { size: {{width}}mm {{height}}mm; margin: 0 }
            html, body { margin: 0 }
            [data-part="sheet"] { page: sheet; position: relative; width: {{width}}mm; height: {{height}}mm; overflow: hidden; font: 3.5mm/1.5 "Microsoft YaHei", sans-serif; color: #000 }
            .frame { position: absolute; inset: 5mm; border: 0.3mm solid #000 }
            .content { position: absolute; left: 9mm; top: 9mm; right: 9mm }
            h1 { margin: 0 0 3mm; font-size: 5mm }
            p { margin: 0 }
            .ruler { margin-top: 4mm; width: 50mm; border-top: 0.3mm solid #000 }
            </style>
            </head>
            <body>
            <div data-part="sheet"><div class="frame"></div><div class="content"><h1>曦寒打印客户端自检页</h1>{{body}}<div class="ruler"></div><p>上面这条线应为 50 mm，四周的框距纸边 5 mm</p></div></div>
            </body>
            </html>
            """;
        return new PrintDocument(html, [], [new SheetGroup(widthMm, heightMm, 1)]);
    }
}
