// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 把浏览器发来的一条 JSON 文本消息读成请求，并检查字段与上限；不认识的字段忽略

use std::collections::HashSet;
use std::sync::Arc;

use base64::Engine;
use serde_json::{Map, Value};

use super::codes::errors;
use super::request::*;
use super::{Details, ProtocolError};
use crate::defaults::MAX_MESSAGE_BYTES;

/// 任务资源解码后的总量上限，字节
pub const MAX_RESOURCE_BYTES: usize = 64 * 1024 * 1024;

/// 打印机名的长度上限
pub const MAX_PRINTER_NAME_LENGTH: usize = 256;

/// 份数上限
pub const MAX_COPIES: i64 = 999;

/// 纸张边长上限，毫米
pub const MAX_PAPER_MM: f64 = 2000.0;

const MAX_DEPTH: usize = 16;

/// 读不出请求：读得到 id 时带上，用于回错
#[derive(Clone, Debug, PartialEq)]
pub struct ReadError {
    /// 请求标识
    pub id: Option<String>,
    /// 错误
    pub error: ProtocolError,
}

struct Problem {
    code: &'static str,
    field: String,
    message: String,
}

fn bad(field: &str, message: impl Into<String>) -> Problem {
    Problem {
        code: errors::BAD_REQUEST,
        field: field.to_owned(),
        message: message.into(),
    }
}

type Read<T> = Result<T, Problem>;

/// 读一条消息；max_resource_bytes 是任务资源解码后的总量上限
pub fn read(message: &[u8], max_resource_bytes: usize) -> Result<ClientRequest, ReadError> {
    let fail = |id: Option<String>, problem: Problem| ReadError {
        id,
        error: ProtocolError::new(problem.code, problem.message).with_details(Details::new().with("field", problem.field)),
    };
    let not_json = || ReadError {
        id: None,
        error: ProtocolError::new(errors::BAD_REQUEST, "消息不是合法的 JSON"),
    };
    let root: Value = serde_json::from_slice(message).map_err(|_| not_json())?;
    if depth(&root) > MAX_DEPTH {
        return Err(not_json());
    }
    let Value::Object(root) = root else {
        return Err(ReadError {
            id: None,
            error: ProtocolError::new(errors::BAD_REQUEST, "消息必须是 JSON 对象"),
        });
    };
    let id = root.get("id").and_then(Value::as_str).map(str::to_owned);
    let kind = text(&root, "type", 64).map_err(|problem| fail(id.clone(), problem))?;
    let valid = match &id {
        Some(id) if is_token(id) => id.clone(),
        _ => return Err(fail(id, bad("id", "id 必须是 1–64 位的字母、数字、短横线或下划线"))),
    };
    match body(&kind, root, max_resource_bytes) {
        Ok(body) => Ok(ClientRequest { id: valid, body }),
        Err(problem) => Err(fail(id, problem)),
    }
}

fn depth(value: &Value) -> usize {
    match value {
        Value::Array(items) => 1 + items.iter().map(depth).max().unwrap_or(0),
        Value::Object(map) => 1 + map.values().map(depth).max().unwrap_or(0),
        _ => 0,
    }
}

fn body(kind: &str, root: Map<String, Value>, max_resource_bytes: usize) -> Read<RequestBody> {
    Ok(match kind {
        "hello" => RequestBody::Hello(HelloRequest {
            protocol: integer(&root, "protocol", 1, i64::from(i32::MAX))?,
            minor: optional_integer(&root, "minor", 0, i64::from(i32::MAX))?.unwrap_or(0),
            sdk: sdk(&root)?,
            resume: optional_text(&root, "resume", 256)?,
            key: optional_text(&root, "key", 256)?,
        }),
        "ping" => RequestBody::Ping,
        "printers.list" => RequestBody::ListPrinters,
        "printers.get" => RequestBody::GetPrinter {
            name: text(&root, "name", MAX_PRINTER_NAME_LENGTH)?,
        },
        "print.html" => RequestBody::PrintHtml(PrintHtmlRequest {
            job_id: job_id(&root)?,
            document: Arc::new(document(&root, max_resource_bytes)?),
            printer: optional_text(&root, "printer", MAX_PRINTER_NAME_LENGTH)?,
            options: options(&root)?,
        }),
        "print.raw" => RequestBody::PrintRaw(PrintRawRequest {
            job_id: job_id(&root)?,
            printer: text(&root, "printer", MAX_PRINTER_NAME_LENGTH)?,
            data: Arc::new(raw_data(&root)?),
            doc_name: optional_text(&root, "docName", 256)?,
        }),
        "export.pdf" => RequestBody::ExportPdf(ExportPdfRequest {
            job_id: job_id(&root)?,
            document: Arc::new(document(&root, max_resource_bytes)?),
            options: options(&root)?,
        }),
        "job.get" => RequestBody::GetJob { job_id: job_id(&root)? },
        "job.cancel" => RequestBody::CancelJob { job_id: job_id(&root)? },
        _ => RequestBody::Custom(CustomRequest {
            kind: kind.to_owned(),
            message: root,
        }),
    })
}

/// 是否是 1–64 位的字母、数字、短横线或下划线
pub(crate) fn is_token(text: &str) -> bool {
    (1..=64).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// 页码范围的写法：1-3,5
pub(crate) fn is_page_ranges(text: &str) -> bool {
    !text.is_empty()
        && text.split(',').all(|part| {
            let mut bounds = part.split('-');
            let first = bounds.next().unwrap_or("");
            let second = bounds.next();
            bounds.next().is_none()
                && !first.is_empty()
                && first.bytes().all(|byte| byte.is_ascii_digit())
                && second.is_none_or(|last| !last.is_empty() && last.bytes().all(|byte| byte.is_ascii_digit()))
        })
}

fn job_id(root: &Map<String, Value>) -> Read<String> {
    let value = text(root, "jobId", 64)?;
    if is_token(&value) {
        Ok(value)
    } else {
        Err(bad("jobId", "jobId 必须是 1–64 位的字母、数字、短横线或下划线"))
    }
}

fn sdk(root: &Map<String, Value>) -> Read<Option<SdkInfo>> {
    match root.get("sdk") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(sdk)) => Ok(Some(SdkInfo {
            name: optional_text(sdk, "name", 128)?,
            version: optional_text(sdk, "version", 64)?,
        })),
        Some(_) => Err(bad("sdk", "sdk 必须是对象")),
    }
}

fn document(root: &Map<String, Value>, max_resource_bytes: usize) -> Read<PrintDocument> {
    let document = match root.get("document") {
        Some(Value::Object(document)) => document,
        _ => return Err(bad("document", "缺少对象 document")),
    };
    let html = text(document, "html", MAX_MESSAGE_BYTES)?;
    let mut resources = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0usize;
    match document.get("resources") {
        None | Some(Value::Null) => {}
        Some(Value::Array(items)) => {
            for item in items {
                let Value::Object(item) = item else {
                    return Err(bad("document.resources", "资源必须是对象"));
                };
                let id = text(item, "id", 64)?;
                if !is_token(&id) || !seen.insert(id.clone()) {
                    return Err(bad("document.resources.id", format!("资源编号不合法或重复：{id}")));
                }
                let data = base64(item, "data", "document.resources.data")?;
                total += data.len();
                if total > max_resource_bytes {
                    return Err(Problem {
                        code: errors::DOCUMENT_TOO_LARGE,
                        field: "document.resources".to_owned(),
                        message: format!("资源总量超过 {max_resource_bytes} 字节"),
                    });
                }
                resources.push(DocumentResource {
                    id,
                    mime: text(item, "type", 128)?,
                    data: Arc::new(data),
                });
            }
        }
        Some(_) => return Err(bad("document.resources", "resources 必须是数组")),
    }
    let groups = match document.get("sheets") {
        Some(Value::Array(groups)) => groups,
        _ => return Err(bad("sheets", "缺少数组 sheets")),
    };
    let mut sheets = Vec::new();
    for group in groups {
        let Value::Object(group) = group else {
            return Err(bad("document.sheets", "纸张分组必须是对象"));
        };
        sheets.push(SheetGroup {
            width_mm: length(group, "widthMm")?,
            height_mm: length(group, "heightMm")?,
            count: integer(group, "count", 1, i64::from(i32::MAX))? as u32,
        });
    }
    if sheets.is_empty() {
        return Err(bad("document.sheets", "sheets 至少要有一组"));
    }
    Ok(PrintDocument { html, resources, sheets })
}

fn options(root: &Map<String, Value>) -> Read<PrintOptions> {
    let options = match root.get("options") {
        None | Some(Value::Null) => return Ok(PrintOptions::default()),
        Some(Value::Object(options)) => options,
        Some(_) => return Err(bad("options", "options 必须是对象")),
    };
    let page_ranges = optional_text(options, "pageRanges", 256)?;
    if page_ranges.as_deref().is_some_and(|ranges| !is_page_ranges(ranges)) {
        return Err(bad("options.pageRanges", "pageRanges 的写法如 1-3,5"));
    }
    Ok(PrintOptions {
        copies: optional_integer(options, "copies", 1, MAX_COPIES)?.unwrap_or(1) as u32,
        collate: optional_boolean(options, "collate")?.unwrap_or(true),
        duplex: match optional_text(options, "duplex", 32)?.as_deref() {
            None | Some("simplex") => DuplexMode::Simplex,
            Some("long-edge") => DuplexMode::LongEdge,
            Some("short-edge") => DuplexMode::ShortEdge,
            Some(other) => return Err(bad("options.duplex", format!("不认识的双面方式：{other}"))),
        },
        color: match optional_text(options, "color", 32)?.as_deref() {
            None | Some("color") => ColorMode::Color,
            Some("grayscale") => ColorMode::Grayscale,
            Some(other) => return Err(bad("options.color", format!("不认识的颜色方式：{other}"))),
        },
        page_ranges,
        dialog: optional_boolean(options, "dialog")?.unwrap_or(false),
        timeout_ms: optional_integer(options, "timeoutMs", 1_000, 600_000)?.map(|ms| ms as u32),
        fit_to_nearest_paper: optional_boolean(options, "fitToNearestPaper")?.unwrap_or(false),
    })
}

fn raw_data(root: &Map<String, Value>) -> Read<Vec<u8>> {
    let data = base64(root, "data", "data")?;
    if data.is_empty() { Err(bad("data", "data 不能为空")) } else { Ok(data) }
}

fn base64(owner: &Map<String, Value>, name: &str, field: &str) -> Read<Vec<u8>> {
    let text = text_allow_empty(owner, name, MAX_MESSAGE_BYTES)?;
    base64::engine::general_purpose::STANDARD
        .decode(text.as_bytes())
        .map_err(|_| bad(field, format!("{field} 不是合法的 base64")))
}

/// 按 UTF-16 码元数是否超过上限
fn too_long(text: &str, max: usize) -> bool {
    text.len() > max && text.encode_utf16().count() > max
}

fn checked(name: &str, text: &str, max: usize, allow_empty: bool) -> Read<()> {
    if !allow_empty && text.is_empty() {
        return Err(bad(name, format!("{name} 不能为空")));
    }
    if too_long(text, max) {
        return Err(bad(name, format!("{name} 超过 {max} 个字符")));
    }
    Ok(())
}

fn text(owner: &Map<String, Value>, name: &str, max: usize) -> Read<String> {
    match owner.get(name) {
        Some(Value::String(text)) => checked(name, text, max, false).map(|_| text.clone()),
        _ => Err(bad(name, format!("缺少字符串 {name}"))),
    }
}

fn text_allow_empty<'a>(owner: &'a Map<String, Value>, name: &str, max: usize) -> Read<&'a str> {
    match owner.get(name) {
        Some(Value::String(text)) => checked(name, text, max, true).map(|_| text.as_str()),
        _ => Err(bad(name, format!("缺少字符串 {name}"))),
    }
}

fn optional_text(owner: &Map<String, Value>, name: &str, max: usize) -> Read<Option<String>> {
    match owner.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => text(owner, name, max).map(Some),
    }
}

fn integer(owner: &Map<String, Value>, name: &str, min: i64, max: i64) -> Read<i64> {
    let number = owner
        .get(name)
        .and_then(Value::as_i64)
        .filter(|number| i32::try_from(*number).is_ok())
        .ok_or_else(|| bad(name, format!("缺少整数 {name}")))?;
    if (min..=max).contains(&number) {
        Ok(number)
    } else {
        Err(bad(name, format!("{name} 应在 {min}–{max} 之间")))
    }
}

fn optional_integer(owner: &Map<String, Value>, name: &str, min: i64, max: i64) -> Read<Option<i64>> {
    match owner.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => integer(owner, name, min, max).map(Some),
    }
}

fn optional_boolean(owner: &Map<String, Value>, name: &str) -> Read<Option<bool>> {
    match owner.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(bad(name, format!("{name} 必须是布尔值"))),
    }
}

fn length(owner: &Map<String, Value>, name: &str) -> Read<f64> {
    let number = owner.get(name).and_then(Value::as_f64).ok_or_else(|| bad(name, format!("缺少数值 {name}")))?;
    if number > 0.0 && number <= MAX_PAPER_MM {
        Ok(number)
    } else {
        Err(bad(name, format!("{name} 应大于 0 且不超过 {MAX_PAPER_MM}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read_json(value: Value) -> Result<ClientRequest, ReadError> {
        read(value.to_string().as_bytes(), MAX_RESOURCE_BYTES)
    }

    fn document_json() -> Value {
        json!({ "html": "<p>x</p>", "resources": [{ "id": "a1", "type": "image/png", "data": "AAEC" }], "sheets": [{ "widthMm": 210, "heightMm": 297.5, "count": 2 }] })
    }

    #[test]
    fn reads_hello_with_its_optional_fields() {
        let request = read_json(
            json!({ "type": "hello", "id": "h1", "protocol": 1, "minor": 3, "sdk": { "name": "@xihan-print/runtime", "version": "1.0.0" }, "resume": "tok", "key": "k" }),
        )
        .unwrap();
        assert_eq!(request.id, "h1");
        let RequestBody::Hello(hello) = request.body else { panic!() };
        assert_eq!((hello.protocol, hello.minor, hello.resume.as_deref(), hello.key.as_deref()), (1, 3, Some("tok"), Some("k")));
        assert_eq!(hello.sdk.unwrap().name.as_deref(), Some("@xihan-print/runtime"));
    }

    #[test]
    fn reads_a_print_html_request_with_resources_and_options() {
        let request = read_json(json!({ "type": "print.html", "id": "r1", "jobId": "j-1", "printer": "Office", "document": document_json(),
            "options": { "copies": 3, "collate": false, "duplex": "long-edge", "color": "grayscale", "pageRanges": "1-2,5", "dialog": true, "timeoutMs": 5000, "fitToNearestPaper": true } })).unwrap();
        let RequestBody::PrintHtml(print) = request.body else { panic!() };
        assert_eq!(print.printer.as_deref(), Some("Office"));
        assert_eq!(print.document.resources[0].data.as_slice(), &[0, 1, 2]);
        assert_eq!(
            print.document.sheets[0],
            SheetGroup {
                width_mm: 210.0,
                height_mm: 297.5,
                count: 2
            }
        );
        assert_eq!(
            print.options,
            PrintOptions {
                copies: 3,
                collate: false,
                duplex: DuplexMode::LongEdge,
                color: ColorMode::Grayscale,
                page_ranges: Some("1-2,5".into()),
                dialog: true,
                timeout_ms: Some(5000),
                fit_to_nearest_paper: true,
            }
        );
    }

    #[test]
    fn reports_the_field_and_keeps_the_id() {
        let error = read_json(json!({ "type": "print.raw", "id": "r2", "jobId": "j", "printer": "P", "data": "" })).unwrap_err();
        assert_eq!(error.id.as_deref(), Some("r2"));
        assert_eq!(error.error.code, errors::BAD_REQUEST);
        assert_eq!(error.error.details.unwrap().get("field"), Some(&json!("data")));

        let error = read_json(json!({ "type": "job.get", "id": "bad id", "jobId": "j" })).unwrap_err();
        assert_eq!(error.error.details.unwrap().get("field"), Some(&json!("id")));

        let error = read_json(json!({ "type": "print.html", "id": "r3", "jobId": "j", "document": document_json(), "options": { "pageRanges": "1-" } })).unwrap_err();
        assert_eq!(error.error.details.unwrap().get("field"), Some(&json!("options.pageRanges")));

        let error = read_json(json!({ "type": "print.html", "id": "r4", "jobId": "j", "document": document_json(), "options": { "copies": 1000 } })).unwrap_err();
        assert_eq!(error.error.message, "copies 应在 1–999 之间");
    }

    #[test]
    fn rejects_duplicate_resources_and_oversized_totals() {
        let mut document = document_json();
        document["resources"] = json!([{ "id": "a", "type": "t", "data": "AAEC" }, { "id": "a", "type": "t", "data": "AAEC" }]);
        let error = read_json(json!({ "type": "export.pdf", "id": "r", "jobId": "j", "document": document })).unwrap_err();
        assert_eq!(error.error.details.unwrap().get("field"), Some(&json!("document.resources.id")));

        let error = read(
            json!({ "type": "export.pdf", "id": "r", "jobId": "j", "document": document_json() }).to_string().as_bytes(),
            2,
        )
        .unwrap_err();
        assert_eq!(error.error.code, errors::DOCUMENT_TOO_LARGE);
    }

    #[test]
    fn rejects_malformed_messages() {
        assert_eq!(read(b"{", MAX_RESOURCE_BYTES).unwrap_err().error.message, "消息不是合法的 JSON");
        assert_eq!(read(b"[1]", MAX_RESOURCE_BYTES).unwrap_err().error.message, "消息必须是 JSON 对象");
        let deep = "[".repeat(20) + &"]".repeat(20);
        assert_eq!(read(deep.as_bytes(), MAX_RESOURCE_BYTES).unwrap_err().error.message, "消息不是合法的 JSON");
        let error = read_json(json!({ "type": "hello", "id": "x", "protocol": 1.5 })).unwrap_err();
        assert_eq!(error.error.message, "缺少整数 protocol");
    }

    #[test]
    fn hands_unknown_types_to_extensions() {
        let request = read_json(json!({ "type": "label.print", "id": "x", "extra": 1 })).unwrap();
        let RequestBody::Custom(custom) = request.body else { panic!() };
        assert_eq!(custom.kind, "label.print");
        assert_eq!(custom.message.get("extra"), Some(&json!(1)));
    }

    #[test]
    fn checks_page_range_syntax() {
        for good in ["1", "1-3", "1-3,5", "10,2-4"] {
            assert!(is_page_ranges(good), "{good}");
        }
        for bad in ["", "1-", "-1", "1,,2", "1-2-3", "a"] {
            assert!(!is_page_ranges(bad), "{bad}");
        }
    }
}
