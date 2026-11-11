// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 写出发给浏览器的消息：响应、心跳回复、授权等待与任务事件

use serde::Serialize;

use super::response::*;
use crate::time::Timestamp;

#[derive(Serialize)]
struct Success<'a, T: Serialize> {
    #[serde(rename = "type")]
    kind: &'static str,
    id: &'a str,
    ok: bool,
    data: &'a T,
}

#[derive(Serialize)]
struct Failure<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<&'a str>,
    ok: bool,
    error: &'a ProtocolError,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobEvent<'a> {
    #[serde(rename = "type")]
    kind: String,
    job_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sheets: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a ProtocolError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    warnings: Option<&'a Vec<ProtocolWarning>>,
    at: String,
}

fn json(value: &impl Serialize) -> Vec<u8> {
    serde_json::to_vec(value).expect("协议消息总能写成 JSON")
}

/// 请求成功的结果
pub fn result<T: Serialize>(id: &str, data: &T) -> Vec<u8> {
    json(&Success {
        kind: "result",
        id,
        ok: true,
        data,
    })
}

/// 握手成功
pub fn welcome(id: &str, data: &WelcomeData) -> Vec<u8> {
    result(id, data)
}

/// 打印机列表
pub fn printers(id: &str, printers: &[PrinterInfo]) -> Vec<u8> {
    result(id, &printers)
}

/// 一台打印机
pub fn printer(id: &str, printer: &PrinterInfo) -> Vec<u8> {
    result(id, printer)
}

/// 任务已受理
pub fn accepted(id: &str, accepted: &JobAccepted) -> Vec<u8> {
    result(id, accepted)
}

/// 任务的当前状态
pub fn status(id: &str, status: &JobStatus) -> Vec<u8> {
    result(id, status)
}

/// 取消任务的结果
pub fn cancelled(id: &str, cancelled: bool) -> Vec<u8> {
    result(id, &JobCancelled { cancelled })
}

/// 请求失败；读不出 id 时 id 为 None
pub fn error(id: Option<&str>, error: &ProtocolError) -> Vec<u8> {
    json(&Failure {
        kind: "result",
        id,
        ok: false,
        error,
    })
}

/// 心跳回复
pub fn pong(id: &str) -> Vec<u8> {
    #[derive(Serialize)]
    struct Pong<'a> {
        #[serde(rename = "type")]
        kind: &'static str,
        id: &'a str,
    }
    json(&Pong { kind: "pong", id })
}

/// 来源未授权，客户端已弹出授权窗口
pub fn consent_pending(origin: &str) -> Vec<u8> {
    #[derive(Serialize)]
    struct Pending<'a> {
        #[serde(rename = "type")]
        kind: &'static str,
        origin: &'a str,
    }
    json(&Pending { kind: "consent.pending", origin })
}

/// 任务事件：类型为 job. 加状态名，带上状态里有值的字段与发生时间
pub fn job_event(status: &JobStatus, at: Timestamp) -> Vec<u8> {
    json(&JobEvent {
        kind: format!("job.{}", status.state.name()),
        job_id: &status.job_id,
        position: status.position,
        sheets: status.sheets,
        bytes: status.bytes,
        error: status.error.as_ref(),
        warnings: status.warnings.as_ref().filter(|warnings| !warnings.is_empty()),
        at: at.to_rfc3339(),
    })
}

/// 任务产出的头：紧随其后的一条二进制消息就是产出本身
pub fn job_output(job_id: &str, mime: &str, bytes: u64) -> Vec<u8> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Output<'a> {
        #[serde(rename = "type")]
        kind: &'static str,
        job_id: &'a str,
        mime: &'a str,
        bytes: u64,
    }
    json(&Output {
        kind: "job.output",
        job_id,
        mime,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Details;
    use crate::protocol::codes::{errors, warnings};

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn writes_results_and_errors() {
        assert_eq!(text(cancelled("c1", true)), r#"{"type":"result","id":"c1","ok":true,"data":{"cancelled":true}}"#);
        let failure = ProtocolError::new(errors::PRINTER_NOT_FOUND, "没有").with_details(Details::new().with("printer", "P"));
        assert_eq!(
            text(error(None, &failure)),
            r#"{"type":"result","ok":false,"error":{"code":"PRINTER_NOT_FOUND","message":"没有","details":{"printer":"P"}}}"#
        );
        assert_eq!(text(pong("p")), r#"{"type":"pong","id":"p"}"#);
        assert_eq!(text(consent_pending("https://a.example")), r#"{"type":"consent.pending","origin":"https://a.example"}"#);
    }

    #[test]
    fn writes_printers_without_empty_fields() {
        let mut info = PrinterInfo::named("Office", PrinterState::PaperOut);
        info.is_default = true;
        info.capabilities = Some(PrinterCapabilities {
            color: true,
            duplex: false,
            max_copies: 9,
            papers: vec![PaperInfo {
                id: 9,
                name: "A4".into(),
                width_mm: 210.0,
                height_mm: 297.5,
            }],
        });
        assert_eq!(
            text(printer("g", &info)),
            r#"{"type":"result","id":"g","ok":true,"data":{"name":"Office","isDefault":true,"status":"paperOut","statusFlags":0,"isNetwork":false,"capabilities":{"color":true,"duplex":false,"maxCopies":9,"papers":[{"id":9,"name":"A4","widthMm":210,"heightMm":297.5}]}}}"#
        );
    }

    #[test]
    fn writes_job_events_with_only_the_fields_that_have_values() {
        let at = Timestamp::from_utc(2026, 11, 11, 8, 0, 0);
        let queued = JobStatus {
            job_id: "j".into(),
            state: JobState::Queued,
            position: Some(2),
            sheets: None,
            bytes: None,
            error: None,
            warnings: None,
        };
        assert_eq!(
            text(job_event(&queued, at)),
            r#"{"type":"job.queued","jobId":"j","position":2,"at":"2026-11-11T08:00:00.000Z"}"#
        );
        let done = JobStatus {
            job_id: "j".into(),
            state: JobState::Completed,
            position: None,
            sheets: Some(3),
            bytes: None,
            error: None,
            warnings: Some(vec![ProtocolWarning::new(warnings::PAPER_UNCHECKED, "未核对", Details::new().with("printer", "P"))]),
        };
        assert_eq!(
            text(job_event(&done, at)),
            r#"{"type":"job.completed","jobId":"j","sheets":3,"warnings":[{"code":"PAPER_UNCHECKED","message":"未核对","details":{"printer":"P"}}],"at":"2026-11-11T08:00:00.000Z"}"#
        );
        assert_eq!(
            text(job_output("j", "application/pdf", 10)),
            r#"{"type":"job.output","jobId":"j","mime":"application/pdf","bytes":10}"#
        );
    }

    #[test]
    fn writes_welcome_with_the_protocol_version() {
        let welcome_data = WelcomeData::new(
            ClientInfo {
                version: "1.0.0".into(),
                os: "windows".into(),
                arch: "x64".into(),
                renderer: None,
            },
            "tok".into(),
            ClientCapabilities {
                html: true,
                raw: true,
                pdf: true,
                duplex: true,
                printer_status: true,
                extensions: vec![],
            },
            vec![],
        );
        assert_eq!(
            text(welcome("h", &welcome_data)),
            r#"{"type":"result","id":"h","ok":true,"data":{"protocol":1,"minor":0,"client":{"version":"1.0.0","os":"windows","arch":"x64"},"sessionToken":"tok","capabilities":{"html":true,"raw":true,"pdf":true,"duplex":true,"printerStatus":true},"resumed":[]}}"#
        );
    }
}
