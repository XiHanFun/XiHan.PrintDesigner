// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 诊断信息：给用户看的文本，以及把日志、设置、策略与诊断信息打成 zip 的诊断包

use std::fmt::Write as _;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::consent::ClientPolicy;
use crate::defaults::{PORTS, PRODUCT_NAME, SUB_PROTOCOL};
use crate::printing::JobRecord;
use crate::protocol::ClientInfo;

/// 诊断信息里列出的任务个数
pub const RECENT_JOB_COUNT: usize = 50;

/// 诊断信息的素材
#[derive(Clone, Debug)]
pub struct DiagnosticsInput {
    /// 客户端信息
    pub client: ClientInfo,
    /// 渲染引擎：可用时为名称加版本，不可用时为原因
    pub renderer: Result<String, String>,
    /// 在监听的地址与监听名
    pub listening: Vec<(String, String)>,
    /// 生效的策略
    pub policy: ClientPolicy,
    /// 策略文件是否存在
    pub policy_file_exists: bool,
    /// 用户设的端口；没设时为 None
    pub user_port: Option<u16>,
    /// 访问密钥从哪来：策略或设置；没设时为 None
    pub access_key_source: Option<String>,
    /// 用户的允许名单
    pub allowed: Vec<String>,
    /// 用户的拒绝名单
    pub denied: Vec<String>,
    /// 最近的任务，新的在前
    pub recent_jobs: Vec<JobRecord>,
    /// 扩展补充的段落：标题与各行
    pub sections: Vec<(String, Vec<String>)>,
}

/// 写成文本；时间按 offset（秒）显示
pub fn format(input: &DiagnosticsInput, offset: i32) -> String {
    let mut text = String::new();
    let client = &input.client;
    let _ = writeln!(text, "{PRODUCT_NAME} {}", client.version);
    let _ = writeln!(text, "系统：{} {}", client.os, client.arch);
    match &input.renderer {
        Ok(renderer) => _ = writeln!(text, "渲染：{renderer}"),
        Err(problem) => _ = writeln!(text, "渲染：{problem}，HTML 打印与导出 PDF 不可用"),
    }
    if input.listening.is_empty() {
        text.push_str("监听：没有可用端口，未在监听\n");
    }
    for (name, address) in &input.listening {
        let _ = writeln!(text, "监听：{address}{}", if name == "loopback" { String::new() } else { format!("（{name}）") });
    }
    let _ = writeln!(text, "协议：{SUB_PROTOCOL}");

    let policy = &input.policy;
    text.push('\n');
    text.push_str(if input.policy_file_exists {
        "策略：已读取 policy.json\n"
    } else {
        "策略：没有 policy.json，用缺省值\n"
    });
    let _ = writeln!(text, "  未授权来源弹窗询问：{}", if policy.prompt_for_unknown_origins { "是" } else { "否" });
    let ports = if !policy.ports.is_empty() {
        policy.ports.iter().map(u16::to_string).collect::<Vec<_>>().join(", ")
    } else if let Some(port) = input.user_port {
        format!("{port}（设置）")
    } else {
        format!("{}（缺省）", PORTS.map(|port| port.to_string()).join(", "))
    };
    let _ = writeln!(text, "  端口：{ports}");
    let _ = writeln!(
        text,
        "  访问密钥：{}",
        match &input.access_key_source {
            Some(source) => format!("已设（{source}）"),
            None => "未设".into(),
        }
    );
    let _ = writeln!(text, "  检查更新：{}", if policy.check_for_updates { "允许" } else { "已关闭" });

    text.push_str("\n允许的来源：\n");
    for origin in &policy.allowed_origins {
        let _ = writeln!(text, "  {origin}（策略）");
    }
    for origin in &input.allowed {
        let _ = writeln!(text, "  {origin}");
    }
    if policy.allowed_origins.is_empty() && input.allowed.is_empty() {
        text.push_str("  （无）\n");
    }
    text.push_str("拒绝的来源：\n");
    for origin in &input.denied {
        let _ = writeln!(text, "  {origin}");
    }
    if input.denied.is_empty() {
        text.push_str("  （无）\n");
    }

    for (title, lines) in &input.sections {
        let _ = writeln!(text, "\n{title}：");
        for line in lines {
            let _ = writeln!(text, "  {line}");
        }
    }

    let _ = writeln!(text, "\n最近 {RECENT_JOB_COUNT} 个任务：");
    for job in input.recent_jobs.iter().take(RECENT_JOB_COUNT) {
        let amount = match (job.sheets, job.bytes) {
            (Some(sheets), _) => format!("{sheets} 页"),
            (None, Some(bytes)) => format!("{bytes} 字节"),
            _ => "-".into(),
        };
        let took = match job.finished_at {
            Some(finished) => format!("{:.1} 秒", finished.since(job.created_at).as_secs_f64()),
            None => "进行中".into(),
        };
        let error = job.error_code.as_ref().map(|code| format!(" {code}")).unwrap_or_default();
        let _ = writeln!(
            text,
            "  {}  {}  {}  {}{error}  {amount}  {took}  {}  {}",
            job.created_at.format_local(offset),
            job.kind.name(),
            job.printer.as_deref().unwrap_or("-"),
            job.state.name(),
            job.origin,
            job.id
        );
    }
    if input.recent_jobs.is_empty() {
        text.push_str("  （无）\n");
    }
    text
}

const SECRET_KEYS: [&str; 6] = ["sessiontoken", "token", "resume", "password", "secret", "accesskey"];

/// 把形如令牌的值换成 ***：键是 token、sessionToken、resume、password、secret、accessKey，值至少 4 个字符
pub fn mask(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    while index < bytes.len() {
        if let Some(value_start) = secret_key_end(lower.as_bytes(), index) {
            let mut end = value_start;
            let mut characters = 0;
            while end < bytes.len() && !matches!(bytes[end], b' ' | b'\t' | b'\r' | b'\n' | b',' | b'"' | b'}' | b'&') {
                let width = utf8_width(bytes[end]);
                end += width;
                characters += 1;
            }
            if characters >= 4 {
                output.push_str(&text[index..value_start]);
                output.push_str("***");
                index = end;
                continue;
            }
        }
        let width = utf8_width(bytes[index]);
        output.push_str(&text[index..index + width]);
        index += width;
    }
    output
}

fn utf8_width(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

/// 从 index 起是不是「可选引号 + 键 + 可选引号 + 空白 + : 或 = + 空白 + 可选引号」，是时返回值开始的位置
fn secret_key_end(lower: &[u8], index: usize) -> Option<usize> {
    let mut at = index;
    if lower.get(at) == Some(&b'"') {
        at += 1;
    }
    let key = SECRET_KEYS.iter().find(|key| lower[at..].starts_with(key.as_bytes()))?;
    at += key.len();
    if lower.get(at) == Some(&b'"') {
        at += 1;
    }
    while lower.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    if !matches!(lower.get(at), Some(b':' | b'=')) {
        return None;
    }
    at += 1;
    while lower.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    if lower.get(at) == Some(&b'"') {
        at += 1;
    }
    Some(at)
}

/// 打诊断包：diagnostics.txt、logs/ 下的日志、settings/ 下的设置文件，以及 policy.json；文本里形如令牌的值打码
pub fn export(zip_path: &Path, report: &str, log_directory: &Path, settings_files: &[PathBuf], policy_file: &Path) -> std::io::Result<()> {
    let mut zip = ZipWriter::new(File::create(zip_path)?);
    add_text(&mut zip, "diagnostics.txt", report)?;
    if let Ok(entries) = std::fs::read_dir(log_directory) {
        let mut logs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "log"))
            .collect();
        logs.sort();
        for path in logs {
            add_file(&mut zip, &format!("logs/{}", file_name(&path)), &path)?;
        }
    }
    for path in settings_files.iter().filter(|path| path.exists()) {
        add_file(&mut zip, &format!("settings/{}", file_name(path)), path)?;
    }
    if policy_file.exists() {
        add_file(&mut zip, "policy.json", policy_file)?;
    }
    zip.finish().map_err(std::io::Error::other)?;
    Ok(())
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

fn add_file(zip: &mut ZipWriter<File>, name: &str, path: &Path) -> std::io::Result<()> {
    let mut bytes = Vec::new();
    match File::open(path).and_then(|mut file| file.read_to_end(&mut bytes)) {
        Ok(_) => add_text(zip, name, &String::from_utf8_lossy(&bytes)),
        Err(error) => add_text(zip, &format!("{name}.unreadable.txt"), &error.to_string()),
    }
}

fn add_text(zip: &mut ZipWriter<File>, name: &str, text: &str) -> std::io::Result<()> {
    zip.start_file(name, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
        .map_err(std::io::Error::other)?;
    zip.write_all(mask(text).as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing::JobKind;
    use crate::protocol::JobState;
    use crate::time::Timestamp;
    use std::time::Duration;

    #[test]
    fn masks_token_like_values() {
        assert_eq!(mask(r#"{"sessionToken":"abcdEFGH","x":1}"#), r#"{"sessionToken":"***","x":1}"#);
        assert_eq!(mask("resume=tok-1234&b=2 password: hunter22 token=ab"), "resume=***&b=2 password: *** token=ab");
        assert_eq!(mask("会话 Secret = 秘密秘密秘密"), "会话 Secret = ***");
        assert_eq!(mask("\"accessKey\": \"k-0001\""), "\"accessKey\": \"***\"");
    }

    #[test]
    fn writes_the_report() {
        let start = Timestamp::from_utc(2026, 11, 11, 0, 0, 0);
        let input = DiagnosticsInput {
            client: ClientInfo {
                version: "1.0.0".into(),
                os: "windows".into(),
                arch: "x64".into(),
                renderer: Some("130".into()),
            },
            renderer: Err("没有 WebView2 运行时".into()),
            listening: vec![("loopback".into(), "127.0.0.1:17620".into())],
            policy: ClientPolicy {
                allowed_origins: vec!["https://p.example".into()],
                ..ClientPolicy::default()
            },
            policy_file_exists: true,
            user_port: None,
            access_key_source: Some("设置".into()),
            allowed: vec!["https://a.example".into()],
            denied: vec![],
            recent_jobs: vec![JobRecord {
                id: "j1".into(),
                origin: "https://a.example".into(),
                kind: JobKind::Html,
                printer: Some("Office".into()),
                state: JobState::Failed,
                error_code: Some("SPOOL_FAILED".into()),
                sheets: Some(2),
                bytes: None,
                created_at: start,
                finished_at: Some(start.plus(Duration::from_millis(1500))),
            }],
            sections: vec![("打印记录".into(), vec!["保存内容：是".into()])],
        };
        let text = format(&input, 8 * 3600);
        assert!(text.contains("渲染：没有 WebView2 运行时，HTML 打印与导出 PDF 不可用\n"));
        assert!(text.contains("监听：127.0.0.1:17620\n"));
        assert!(text.contains("  端口：17620, 17621, 17622, 17623（缺省）\n  访问密钥：已设（设置）\n"));
        let custom = format(
            &DiagnosticsInput {
                user_port: Some(18000),
                access_key_source: None,
                ..input.clone()
            },
            0,
        );
        assert!(custom.contains("  端口：18000（设置）\n  访问密钥：未设\n"));
        assert!(text.contains("  https://p.example（策略）\n  https://a.example\n拒绝的来源：\n  （无）\n"));
        assert!(text.contains("\n打印记录：\n  保存内容：是\n"));
        assert!(text.contains("  2026-11-11 08:00:00  html  Office  failed SPOOL_FAILED  2 页  1.5 秒  https://a.example  j1\n"));
    }

    #[test]
    fn exports_a_masked_package() {
        let directory = std::env::temp_dir().join(format!("xihan-print-diag-{}", crate::server::random_hex(8)));
        let logs = directory.join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(logs.join("print-client-20261111.log"), "resume=abcdefg").unwrap();
        std::fs::write(directory.join("settings.json"), "{}").unwrap();
        let zip_path = directory.join("out.zip");
        export(
            &zip_path,
            "报告",
            &logs,
            &[directory.join("settings.json"), directory.join("missing.json")],
            &directory.join("policy.json"),
        )
        .unwrap();
        let mut archive = zip::ZipArchive::new(File::open(&zip_path).unwrap()).unwrap();
        let mut names: Vec<String> = archive.file_names().map(str::to_owned).collect();
        names.sort();
        assert_eq!(names, vec!["diagnostics.txt", "logs/print-client-20261111.log", "settings/settings.json"]);
        let mut log = String::new();
        archive.by_name("logs/print-client-20261111.log").unwrap().read_to_string(&mut log).unwrap();
        assert_eq!(log, "resume=***");
        let _ = std::fs::remove_dir_all(directory);
    }
}
