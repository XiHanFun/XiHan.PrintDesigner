// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 管理员手写的 JSON：去掉注释与末尾逗号后再按 JSON 读

/// 去掉字符串之外的 // 与 /* */ 注释，以及 } 与 ] 前面多出来的逗号
pub fn strip(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut output: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    let mut in_string = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            output.push(byte);
            if byte == b'\\' && index + 1 < bytes.len() {
                output.push(bytes[index + 1]);
                index += 2;
                continue;
            }
            if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        match byte {
            b'"' => {
                in_string = true;
                output.push(byte);
                index += 1;
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                    index += 1;
                }
                index = (index + 2).min(bytes.len());
                output.push(b' ');
            }
            b'}' | b']' => {
                let mut end = output.len();
                while end > 0 && output[end - 1].is_ascii_whitespace() {
                    end -= 1;
                }
                if end > 0 && output[end - 1] == b',' {
                    output.remove(end - 1);
                }
                output.push(byte);
                index += 1;
            }
            _ => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).unwrap_or_default()
}

/// 读管理员手写的 JSON
pub fn parse(text: &str) -> serde_json::Result<serde_json::Value> {
    serde_json::from_str(&strip(text.trim_start_matches('\u{feff}')))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_comments_and_trailing_commas_outside_strings() {
        let text = "{\n  // 注释\n  \"a\": \"http://x/*y*/\", /* 块 */\n  \"b\": [1, 2,],\n}";
        assert_eq!(parse(text).unwrap(), json!({ "a": "http://x/*y*/", "b": [1, 2] }));
        assert_eq!(parse("\u{feff}{\"s\": \"a\\\"//b\"}").unwrap(), json!({ "s": "a\"//b" }));
    }
}
