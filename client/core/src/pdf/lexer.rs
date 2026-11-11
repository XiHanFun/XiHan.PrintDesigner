// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! PDF 的词法与对象：只读出字典、数组、数值、名字与引用，字符串只跳过不留内容

/// 一个 PDF 对象；字符串不留内容
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Object {
    /// null
    Null,
    /// 布尔值
    Boolean(bool),
    /// 数值
    Number(f64),
    /// 名字，#xx 已换成字节
    Name(Vec<u8>),
    /// 字符串，内容不留
    Text,
    /// 数组
    Array(Vec<Object>),
    /// 字典
    Dictionary(Dictionary),
    /// 间接引用：对象号与代号
    Reference(u32, u16),
}

/// 字典：按出现顺序的键值
pub(crate) type Dictionary = Vec<(Vec<u8>, Object)>;

impl Object {
    /// 字典里的一项
    pub(crate) fn get(&self, key: &[u8]) -> Option<&Object> {
        match self {
            Object::Dictionary(entries) => lookup(entries, key),
            _ => None,
        }
    }

    /// 数值；不是数值时为 None
    pub(crate) fn number(&self) -> Option<f64> {
        match self {
            Object::Number(value) => Some(*value),
            _ => None,
        }
    }

    /// 是否是这个名字
    pub(crate) fn is_name(&self, name: &[u8]) -> bool {
        matches!(self, Object::Name(text) if text == name)
    }
}

/// 在字典里按键找值
pub(crate) fn lookup<'a>(entries: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    entries.iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

/// 读出的一项：对象，或对象之外的关键字（obj、endobj、stream、xref、trailer 等）
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Item {
    /// 对象
    Object(Object),
    /// 关键字
    Keyword(Vec<u8>),
}

const MAX_DEPTH: usize = 64;

/// 是否是 PDF 的空白字符
pub(crate) fn is_whitespace(byte: u8) -> bool {
    matches!(byte, 0 | b'\t' | b'\n' | 0x0c | b'\r' | b' ')
}

/// 是否是 PDF 的分隔符
pub(crate) fn is_delimiter(byte: u8) -> bool {
    matches!(byte, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

/// 从某个位置往后读的词法器
pub(crate) struct Lexer<'a> {
    data: &'a [u8],
    /// 当前位置
    pub position: usize,
}

impl<'a> Lexer<'a> {
    /// 从 position 开始读
    pub(crate) fn new(data: &'a [u8], position: usize) -> Self {
        Lexer { data, position }
    }

    /// 跳过空白与注释
    pub(crate) fn skip_space(&mut self) {
        while let Some(&byte) = self.data.get(self.position) {
            if is_whitespace(byte) {
                self.position += 1;
            } else if byte == b'%' {
                while let Some(&byte) = self.data.get(self.position) {
                    if byte == b'\r' || byte == b'\n' {
                        break;
                    }
                    self.position += 1;
                }
            } else {
                break;
            }
        }
    }

    /// 读一个不带符号的整数；不是整数时不动
    pub(crate) fn unsigned(&mut self) -> Option<u64> {
        let start = self.position;
        let mut value: u64 = 0;
        while let Some(&byte) = self.data.get(self.position).filter(|byte| byte.is_ascii_digit()) {
            value = value.checked_mul(10)?.checked_add(u64::from(byte - b'0'))?;
            self.position += 1;
        }
        if self.position == start { None } else { Some(value) }
    }

    /// 读一个普通词（到空白或分隔符为止）
    fn word(&mut self) -> &'a [u8] {
        let start = self.position;
        while let Some(&byte) = self.data.get(self.position) {
            if is_whitespace(byte) || is_delimiter(byte) {
                break;
            }
            self.position += 1;
        }
        &self.data[start..self.position]
    }

    /// 读下一项；读到末尾或格式不对时为 None
    pub(crate) fn item(&mut self) -> Option<Item> {
        self.item_at_depth(0)
    }

    /// 读下一个对象；遇到关键字、末尾或格式不对时为 None
    pub(crate) fn object(&mut self) -> Option<Object> {
        match self.item()? {
            Item::Object(object) => Some(object),
            Item::Keyword(_) => None,
        }
    }

    /// 期望下一项是这个关键字
    pub(crate) fn keyword(&mut self, expected: &[u8]) -> bool {
        self.skip_space();
        let start = self.position;
        if self.word() == expected {
            true
        } else {
            self.position = start;
            false
        }
    }

    fn item_at_depth(&mut self, depth: usize) -> Option<Item> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space();
        let byte = *self.data.get(self.position)?;
        Some(Item::Object(match byte {
            b'/' => {
                self.position += 1;
                Object::Name(decode_name(self.word()))
            }
            b'(' => {
                self.skip_literal_string()?;
                Object::Text
            }
            b'<' if self.data.get(self.position + 1) == Some(&b'<') => {
                self.position += 2;
                let mut entries = Dictionary::new();
                loop {
                    self.skip_space();
                    if self.data.get(self.position..self.position + 2) == Some(b">>") {
                        self.position += 2;
                        break Object::Dictionary(entries);
                    }
                    let Item::Object(Object::Name(key)) = self.item_at_depth(depth + 1)? else {
                        return None;
                    };
                    let Item::Object(value) = self.item_at_depth(depth + 1)? else {
                        return None;
                    };
                    entries.push((key, value));
                }
            }
            b'<' => {
                let end = self.data[self.position..].iter().position(|byte| *byte == b'>')?;
                self.position += end + 1;
                Object::Text
            }
            b'[' => {
                self.position += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_space();
                    if self.data.get(self.position) == Some(&b']') {
                        self.position += 1;
                        break Object::Array(items);
                    }
                    let Item::Object(item) = self.item_at_depth(depth + 1)? else {
                        return None;
                    };
                    items.push(item);
                }
            }
            b'0'..=b'9' => return Some(self.number_or_reference()),
            b'+' | b'-' | b'.' => Object::Number(parse_number(self.word())?),
            _ if is_delimiter(byte) => return None,
            _ => {
                let word = self.word();
                match word {
                    b"true" => Object::Boolean(true),
                    b"false" => Object::Boolean(false),
                    b"null" => Object::Null,
                    _ => return Some(Item::Keyword(word.to_vec())),
                }
            }
        }))
    }

    /// 以数字开头：整数后面跟着「整数 R」时是引用，否则是数值
    fn number_or_reference(&mut self) -> Item {
        let word = self.word();
        let Some(value) = parse_number(word) else {
            return Item::Keyword(word.to_vec());
        };
        if word.iter().all(u8::is_ascii_digit) {
            let after = self.position;
            self.skip_space();
            if let Some(generation) = self.unsigned() {
                self.skip_space();
                let at_r = self.data.get(self.position) == Some(&b'R') && self.data.get(self.position + 1).is_none_or(|byte| is_whitespace(*byte) || is_delimiter(*byte));
                if at_r && let (Ok(number), Ok(generation)) = (u32::try_from(value as u64), u16::try_from(generation)) {
                    self.position += 1;
                    return Item::Object(Object::Reference(number, generation));
                }
            }
            self.position = after;
        }
        Item::Object(Object::Number(value))
    }

    /// 跳过括号字符串：括号可以嵌套，反斜杠转义下一个字节
    fn skip_literal_string(&mut self) -> Option<()> {
        let mut depth = 0usize;
        while let Some(&byte) = self.data.get(self.position) {
            self.position += 1;
            match byte {
                b'\\' => self.position += 1,
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(());
                    }
                }
                _ => {}
            }
        }
        None
    }
}

fn parse_number(word: &[u8]) -> Option<f64> {
    let text = std::str::from_utf8(word).ok()?;
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'+' | b'-' | b'.')) {
        return None;
    }
    let value: f64 = text.parse().ok()?;
    value.is_finite().then_some(value)
}

/// 名字里的 #xx 换成那个字节
fn decode_name(raw: &[u8]) -> Vec<u8> {
    let mut name = Vec::with_capacity(raw.len());
    let mut index = 0;
    while index < raw.len() {
        let hex = |offset: usize| raw.get(index + offset).and_then(|byte| (*byte as char).to_digit(16));
        match (raw[index], hex(1), hex(2)) {
            (b'#', Some(high), Some(low)) => {
                name.push((high * 16 + low) as u8);
                index += 3;
            }
            (byte, _, _) => {
                name.push(byte);
                index += 1;
            }
        }
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Option<Object> {
        Lexer::new(text.as_bytes(), 0).object()
    }

    #[test]
    fn reads_nested_dictionaries_arrays_and_references() {
        let object = read("<< /Type /Page /MediaBox [0 0 595.28 841.89] /Parent 3 0 R /Rotate -90 /Note (a (b) \\) c) /Id <ab12> /N#61me true >>").unwrap();
        assert!(object.get(b"Type").unwrap().is_name(b"Page"));
        assert_eq!(
            object.get(b"MediaBox"),
            Some(&Object::Array(vec![
                Object::Number(0.0),
                Object::Number(0.0),
                Object::Number(595.28),
                Object::Number(841.89)
            ]))
        );
        assert_eq!(object.get(b"Parent"), Some(&Object::Reference(3, 0)));
        assert_eq!(object.get(b"Rotate").and_then(Object::number), Some(-90.0));
        assert_eq!(object.get(b"Note"), Some(&Object::Text));
        assert_eq!(object.get(b"Id"), Some(&Object::Text));
        assert_eq!(object.get(b"Name"), Some(&Object::Boolean(true)));
    }

    #[test]
    fn tells_numbers_from_references() {
        assert_eq!(
            read("[1 2 3 4 0 R 5]"),
            Some(Object::Array(vec![
                Object::Number(1.0),
                Object::Number(2.0),
                Object::Number(3.0),
                Object::Reference(4, 0),
                Object::Number(5.0)
            ]))
        );
        assert_eq!(read("[12 0 Rx]"), None);
        assert_eq!(read("% note\n .5"), Some(Object::Number(0.5)));
    }

    #[test]
    fn returns_keywords_and_stops_on_broken_input() {
        let mut lexer = Lexer::new(b"7 0 obj << /A 1 >> endobj", 0);
        assert_eq!(lexer.unsigned(), Some(7));
        lexer.skip_space();
        assert_eq!(lexer.unsigned(), Some(0));
        assert!(lexer.keyword(b"obj"));
        assert!(lexer.object().unwrap().get(b"A").is_some());
        assert_eq!(lexer.item(), Some(Item::Keyword(b"endobj".to_vec())));
        assert_eq!(read("<< /A [1 2 >>"), None);
        assert_eq!(read("(unterminated"), None);
        assert_eq!(read("<< 1 2 >>"), None);
    }
}
