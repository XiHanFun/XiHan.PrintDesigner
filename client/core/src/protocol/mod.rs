// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 协议 `xihan-print.v1`：浏览器发来的请求、客户端的响应与任务事件，都是 UTF-8 的 JSON 文本；导出的 PDF 用二进制帧

pub mod codes;
mod reader;
mod request;
mod response;
pub mod writer;

pub use reader::{MAX_COPIES, MAX_PAPER_MM, MAX_PRINTER_NAME_LENGTH, MAX_RESOURCE_BYTES, ReadError, read};
pub use request::*;
pub use response::*;

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value;

/// 错误与提醒里的附加信息：按写入的先后输出的 JSON 对象
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Details(Vec<(String, Value)>);

impl Details {
    /// 空的附加信息
    pub fn new() -> Self {
        Details(Vec::new())
    }

    /// 加一项并返回自己
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.insert(key, value);
        self
    }

    /// 加一项；同名的覆盖
    pub fn insert(&mut self, key: &str, value: impl Into<Value>) {
        let value = value.into();
        match self.0.iter_mut().find(|(name, _)| name == key) {
            Some(entry) => entry.1 = value,
            None => self.0.push((key.to_owned(), value)),
        }
    }

    /// 取一项
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.iter().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    /// 各项
    pub fn entries(&self) -> &[(String, Value)] {
        &self.0
    }
}

impl Serialize for Details {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

/// 数值写成 JSON：整数值不带小数部分
pub fn number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9.0e15 {
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}

pub(crate) fn serialize_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    number(*value).serialize(serializer)
}
