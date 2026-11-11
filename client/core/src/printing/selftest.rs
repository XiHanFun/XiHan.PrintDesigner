// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 自检页：一张输出页，写明客户端、渲染引擎、打印机与时间，四周距纸边 5 mm 画框，另有 50 mm 校准线

use crate::defaults::PRODUCT_NAME;
use crate::protocol::{ClientInfo, PrintDocument, PrinterInfo, SheetGroup};
use crate::time::{Timestamp, format_offset};

/// 选自检页的纸张：打印机支持 A4 时用 A4，否则用它报的第一种纸张，都没有时用 100×150 mm
pub fn paper_for(printer: &PrinterInfo) -> (f64, f64) {
    let papers = printer.capabilities.as_ref().map(|capabilities| capabilities.papers.as_slice()).unwrap_or(&[]);
    let a4 = papers.iter().find(|paper| (paper.width_mm - 210.0).abs() <= 1.0 && (paper.height_mm - 297.0).abs() <= 1.0);
    match a4.or_else(|| papers.iter().find(|paper| paper.width_mm > 0.0 && paper.height_mm > 0.0)) {
        Some(paper) => (paper.width_mm, paper.height_mm),
        None => (100.0, 150.0),
    }
}

/// 生成自检页文档；renderer 是渲染引擎的名称，now 与 offset 是当前时间与本地时区偏移
pub fn document(client: &ClientInfo, renderer: &str, printer: &str, width_mm: f64, height_mm: f64, now: Timestamp, offset: i32) -> PrintDocument {
    let lines = [
        format!("客户端：{}（{} {}）", client.version, client.os, client.arch),
        format!("渲染：{renderer} {}", client.renderer.as_deref().unwrap_or("-")),
        format!("打印机：{printer}"),
        format!("纸张：{width_mm} × {height_mm} mm"),
        format!("时间：{} {}", now.format_local(offset), format_offset(offset)),
    ];
    let body: String = lines.iter().map(|line| format!("<p>{}</p>", escape(line))).collect();
    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{PRODUCT_NAME}自检页</title>
<style>
@page {{ margin: 0 }}
@page sheet {{ size: {width_mm}mm {height_mm}mm; margin: 0 }}
html, body {{ margin: 0 }}
[data-part="sheet"] {{ page: sheet; position: relative; width: {width_mm}mm; height: {height_mm}mm; overflow: hidden; font: 3.5mm/1.5 "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; color: #000 }}
.frame {{ position: absolute; inset: 5mm; border: 0.3mm solid #000 }}
.content {{ position: absolute; left: 9mm; top: 9mm; right: 9mm }}
h1 {{ margin: 0 0 3mm; font-size: 5mm }}
p {{ margin: 0 }}
.ruler {{ margin-top: 4mm; width: 50mm; border-top: 0.3mm solid #000 }}
</style>
</head>
<body>
<div data-part="sheet"><div class="frame"></div><div class="content"><h1>{PRODUCT_NAME}自检页</h1>{body}<div class="ruler"></div><p>上面这条线应为 50 mm，四周的框距纸边 5 mm</p></div></div>
</body>
</html>
"#
    );
    PrintDocument {
        html,
        resources: Vec::new(),
        sheets: vec![SheetGroup { width_mm, height_mm, count: 1 }],
    }
}

/// HTML 文字转义
pub fn escape(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            other => output.push(other),
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{PaperInfo, PrinterCapabilities, PrinterState};

    #[test]
    fn picks_a4_then_the_first_paper_then_a_label_size() {
        let mut printer = PrinterInfo::named("P", PrinterState::Ready);
        assert_eq!(paper_for(&printer), (100.0, 150.0));
        printer.capabilities = Some(PrinterCapabilities {
            color: false,
            duplex: false,
            max_copies: 1,
            papers: vec![
                PaperInfo {
                    id: 1,
                    name: "Letter".into(),
                    width_mm: 215.9,
                    height_mm: 279.4,
                },
                PaperInfo {
                    id: 9,
                    name: "A4".into(),
                    width_mm: 210.0,
                    height_mm: 297.0,
                },
            ],
        });
        assert_eq!(paper_for(&printer), (210.0, 297.0));
    }

    #[test]
    fn writes_one_sheet_and_escapes_the_printer_name() {
        let client = ClientInfo {
            version: "1.0.0".into(),
            os: "windows".into(),
            arch: "x64".into(),
            renderer: Some("130.0".into()),
        };
        let document = document(&client, "WebView2", "<Office>", 100.0, 50.0, Timestamp::from_utc(2026, 1, 2, 3, 4, 5), 8 * 3600);
        assert_eq!(document.sheet_count(), 1);
        assert!(document.html.contains("&lt;Office&gt;"));
        assert!(document.html.contains("渲染：WebView2 130.0"));
        assert!(document.html.contains("时间：2026-01-02 11:04:05 +08:00"));
        assert!(document.html.contains("size: 100mm 50mm"));
    }
}
