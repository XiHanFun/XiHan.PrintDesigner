// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 渲染出的 PDF 的后处理：把每页裁成这组的尺寸、把几份 PDF 依次合成一份。
//! 只读传统交叉引用表的 PDF（WebKitGTK 经 Skia 或 cairo 写出的都是这种），遇到交叉引用流或加密时报错

use std::collections::{BTreeMap, HashMap, HashSet};

/// PDF 里的一个值；字符串、名字与数字保留原文
#[derive(Clone, Debug, PartialEq)]
enum Value {
    Null,
    Boolean(bool),
    Number(Vec<u8>),
    Name(Vec<u8>),
    Text(Vec<u8>),
    Array(Vec<Value>),
    Dictionary(Entries),
    Reference(u32, u16),
}

impl Value {
    fn get(&self, key: &[u8]) -> Option<&Value> {
        match self {
            Value::Dictionary(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    fn set(&mut self, key: &[u8], value: Value) {
        if let Value::Dictionary(entries) = self {
            match entries.iter_mut().find(|(name, _)| name == key) {
                Some(entry) => entry.1 = value,
                None => entries.push((key.to_vec(), value)),
            }
        }
    }

    fn remove(&mut self, key: &[u8]) {
        if let Value::Dictionary(entries) = self {
            entries.retain(|(name, _)| name != key);
        }
    }

    fn number(&self) -> Option<f64> {
        match self {
            Value::Number(text) => std::str::from_utf8(text).ok()?.parse().ok(),
            _ => None,
        }
    }

    fn is_name(&self, name: &[u8]) -> bool {
        matches!(self, Value::Name(text) if text == name)
    }

    fn real(value: f64) -> Value {
        let text = format!("{value:.4}");
        Value::Number(text.trim_end_matches('0').trim_end_matches('.').as_bytes().to_vec())
    }

    fn integer(value: usize) -> Value {
        Value::Number(value.to_string().into_bytes())
    }

    /// 把引用按 map 换成新的对象号
    fn renumber(&mut self, map: &HashMap<u32, u32>) {
        match self {
            Value::Reference(number, generation) => {
                if let Some(new) = map.get(number) {
                    *number = *new;
                    *generation = 0;
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| item.renumber(map)),
            Value::Dictionary(entries) => entries.iter_mut().for_each(|(_, value)| value.renumber(map)),
            _ => {}
        }
    }

    fn references(&self, output: &mut Vec<u32>) {
        match self {
            Value::Reference(number, _) => output.push(*number),
            Value::Array(items) => items.iter().for_each(|item| item.references(output)),
            Value::Dictionary(entries) => entries.iter().for_each(|(_, value)| value.references(output)),
            _ => {}
        }
    }

    fn write(&self, output: &mut Vec<u8>) {
        match self {
            Value::Null => output.extend_from_slice(b"null"),
            Value::Boolean(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
            Value::Number(text) | Value::Name(text) | Value::Text(text) => output.extend_from_slice(text),
            Value::Array(items) => {
                output.push(b'[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        output.push(b' ');
                    }
                    item.write(output);
                }
                output.push(b']');
            }
            Value::Dictionary(entries) => {
                output.extend_from_slice(b"<<");
                for (key, value) in entries {
                    output.extend_from_slice(key);
                    output.push(b' ');
                    value.write(output);
                    output.push(b'\n');
                }
                output.extend_from_slice(b">>");
            }
            Value::Reference(number, generation) => output.extend_from_slice(format!("{number} {generation} R").as_bytes()),
        }
    }
}

/// 字典里的一组键值
type Entries = Vec<(Vec<u8>, Value)>;

/// 一个间接对象：值与流（不是流对象时为 None）
#[derive(Clone, Debug)]
struct Object {
    value: Value,
    stream: Option<Vec<u8>>,
}

/// 读出的 PDF：间接对象与目录对象号
struct Document {
    objects: BTreeMap<u32, Object>,
    root: u32,
}

fn is_whitespace(byte: u8) -> bool {
    matches!(byte, b'\0' | b'\t' | b'\n' | b'\x0c' | b'\r' | b' ')
}

fn is_delimiter(byte: u8) -> bool {
    matches!(byte, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

/// 从某个位置起读 PDF 的词法单元
struct Parser<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> Parser<'a> {
    fn new(data: &'a [u8], position: usize) -> Self {
        Parser { data, position }
    }

    fn error(&self, message: &str) -> String {
        format!("{message}（第 {} 字节）", self.position)
    }

    fn skip_space(&mut self) {
        while let Some(&byte) = self.data.get(self.position) {
            if is_whitespace(byte) {
                self.position += 1;
            } else if byte == b'%' {
                while let Some(&byte) = self.data.get(self.position) {
                    if byte == b'\n' || byte == b'\r' {
                        break;
                    }
                    self.position += 1;
                }
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.position).copied()
    }

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

    fn expect_word(&mut self, expected: &[u8]) -> Result<(), String> {
        self.skip_space();
        if self.word() == expected {
            Ok(())
        } else {
            Err(self.error(&format!("这里应当是 {}", String::from_utf8_lossy(expected))))
        }
    }

    fn unsigned(&mut self) -> Option<u64> {
        self.skip_space();
        let start = self.position;
        let word = self.word();
        let value = std::str::from_utf8(word)
            .ok()
            .filter(|text| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|text| text.parse().ok());
        if value.is_none() {
            self.position = start;
        }
        value
    }

    fn value(&mut self) -> Result<Value, String> {
        self.skip_space();
        let start = self.position;
        match self.peek() {
            None => Err(self.error("PDF 提前结束")),
            Some(b'/') => {
                self.position += 1;
                self.word();
                Ok(Value::Name(self.data[start..self.position].to_vec()))
            }
            Some(b'<') if self.data.get(self.position + 1) == Some(&b'<') => {
                self.position += 2;
                let mut entries = Vec::new();
                loop {
                    self.skip_space();
                    match self.peek() {
                        Some(b'>') if self.data.get(self.position + 1) == Some(&b'>') => {
                            self.position += 2;
                            return Ok(Value::Dictionary(entries));
                        }
                        Some(b'/') => {
                            let Value::Name(key) = self.value()? else { unreachable!() };
                            let value = self.value()?;
                            entries.push((key, value));
                        }
                        _ => return Err(self.error("字典的键应当是名字")),
                    }
                }
            }
            Some(b'<') => {
                let end = self.data[self.position..]
                    .iter()
                    .position(|byte| *byte == b'>')
                    .ok_or_else(|| self.error("十六进制字符串没有结束"))?;
                self.position += end + 1;
                Ok(Value::Text(self.data[start..self.position].to_vec()))
            }
            Some(b'(') => {
                let mut depth = 0usize;
                while let Some(&byte) = self.data.get(self.position) {
                    self.position += 1;
                    match byte {
                        b'\\' => self.position += 1,
                        b'(' => depth += 1,
                        b')' => {
                            depth -= 1;
                            if depth == 0 {
                                return Ok(Value::Text(self.data[start..self.position].to_vec()));
                            }
                        }
                        _ => {}
                    }
                }
                Err(self.error("字符串没有结束"))
            }
            Some(b'[') => {
                self.position += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_space();
                    if self.peek() == Some(b']') {
                        self.position += 1;
                        return Ok(Value::Array(items));
                    }
                    items.push(self.value()?);
                }
            }
            Some(_) => {
                let word = self.word();
                match word {
                    b"true" => Ok(Value::Boolean(true)),
                    b"false" => Ok(Value::Boolean(false)),
                    b"null" => Ok(Value::Null),
                    _ if !word.is_empty() && word.iter().all(|byte| byte.is_ascii_digit() || matches!(byte, b'+' | b'-' | b'.')) => {
                        let after = self.position;
                        if word.iter().all(u8::is_ascii_digit)
                            && let Some(generation) = self.unsigned()
                        {
                            self.skip_space();
                            if self.word() == b"R" {
                                let number = std::str::from_utf8(word).ok().and_then(|text| text.parse().ok()).ok_or_else(|| self.error("对象号太大"))?;
                                return Ok(Value::Reference(number, generation as u16));
                            }
                        }
                        self.position = after;
                        Ok(Value::Number(word.to_vec()))
                    }
                    _ => {
                        self.position = start;
                        Err(self.error("读不懂的值"))
                    }
                }
            }
        }
    }
}

impl Document {
    fn parse(data: &[u8]) -> Result<Document, String> {
        if !data.starts_with(b"%PDF-") {
            return Err("不是 PDF".to_owned());
        }
        let tail_start = data.len().saturating_sub(2048);
        let marker = find_last(&data[tail_start..], b"startxref").ok_or("找不到 startxref")? + tail_start;
        let mut parser = Parser::new(data, marker + b"startxref".len());
        let mut offset = parser.unsigned().ok_or("startxref 后面不是偏移")? as usize;
        let mut offsets: HashMap<u32, usize> = HashMap::new();
        let mut root = None;
        let mut visited = Vec::new();
        loop {
            if visited.contains(&offset) || offset >= data.len() {
                return Err("交叉引用表的位置不对".to_owned());
            }
            visited.push(offset);
            let mut parser = Parser::new(data, offset);
            parser.skip_space();
            if parser.word() != b"xref" {
                return Err("只支持传统交叉引用表，不支持交叉引用流".to_owned());
            }
            while let Some(first) = parser.unsigned() {
                let count = parser.unsigned().ok_or_else(|| parser.error("交叉引用表的条数不对"))?;
                for index in 0..count {
                    let position = parser.unsigned().ok_or_else(|| parser.error("交叉引用表的偏移不对"))?;
                    parser.unsigned().ok_or_else(|| parser.error("交叉引用表的代号不对"))?;
                    parser.skip_space();
                    let kind = parser.word();
                    let number = (first + index) as u32;
                    if kind == b"n" {
                        offsets.entry(number).or_insert(position as usize);
                    }
                }
            }
            parser.expect_word(b"trailer")?;
            let trailer = parser.value()?;
            if trailer.get(b"/Encrypt").is_some() {
                return Err("不支持加密的 PDF".to_owned());
            }
            if root.is_none()
                && let Some(Value::Reference(number, _)) = trailer.get(b"/Root")
            {
                root = Some(*number);
            }
            match trailer.get(b"/Prev").and_then(Value::number) {
                Some(previous) => offset = previous as usize,
                None => break,
            }
        }
        let root = root.ok_or("trailer 里没有 /Root")?;

        let mut objects = BTreeMap::new();
        for (&number, &position) in &offsets {
            let mut parser = Parser::new(data, position);
            let found = parser.unsigned().ok_or_else(|| parser.error("这里应当是对象号"))? as u32;
            parser.unsigned().ok_or_else(|| parser.error("这里应当是代号"))?;
            parser.expect_word(b"obj")?;
            if found != number {
                return Err(parser.error(&format!("交叉引用表说这里是对象 {number}，实际是 {found}")));
            }
            let value = parser.value()?;
            parser.skip_space();
            let rest = &data[parser.position..];
            let stream = if rest.starts_with(b"stream") {
                let mut start = parser.position + b"stream".len();
                if data.get(start) == Some(&b'\r') {
                    start += 1;
                }
                if data.get(start) == Some(&b'\n') {
                    start += 1;
                }
                Some(start)
            } else {
                None
            };
            objects.insert(number, (value, stream));
        }

        let mut document = Document { objects: BTreeMap::new(), root };
        for (number, (value, start)) in &objects {
            let stream = match start {
                Some(start) => {
                    let length = match value.get(b"/Length") {
                        Some(Value::Reference(target, _)) => objects.get(target).and_then(|(value, _)| value.number()),
                        Some(other) => other.number(),
                        None => None,
                    }
                    .ok_or_else(|| format!("对象 {number} 的流没有长度"))? as usize;
                    let end = start
                        .checked_add(length)
                        .filter(|end| *end <= data.len())
                        .ok_or_else(|| format!("对象 {number} 的流超出了文件"))?;
                    Some(data[*start..end].to_vec())
                }
                None => None,
            };
            document.objects.insert(*number, Object { value: value.clone(), stream });
        }
        Ok(document)
    }

    fn value(&self, value: &Value) -> Option<Value> {
        match value {
            Value::Reference(number, _) => self.objects.get(number).map(|object| object.value.clone()),
            other => Some(other.clone()),
        }
    }

    /// 页面对象号，按页序；从上层页面树继承的属性写进页面本身
    fn pages(&mut self) -> Result<Vec<u32>, String> {
        let catalog = self.objects.get(&self.root).ok_or("找不到目录对象")?.value.clone();
        let Some(Value::Reference(tree, _)) = catalog.get(b"/Pages") else {
            return Err("目录里没有 /Pages".to_owned());
        };
        let mut pages = Vec::new();
        let mut stack: Vec<(u32, Entries)> = vec![(*tree, Vec::new())];
        let mut seen = Vec::new();
        while let Some((number, inherited)) = stack.pop() {
            if seen.contains(&number) {
                return Err("页面树里有环".to_owned());
            }
            seen.push(number);
            let node = self.objects.get(&number).ok_or_else(|| format!("页面树里的对象 {number} 不存在"))?.value.clone();
            if node.get(b"/Type").is_some_and(|kind| kind.is_name(b"/Page")) {
                let object = self.objects.get_mut(&number).expect("刚取到");
                for (key, value) in inherited {
                    if object.value.get(&key).is_none() {
                        object.value.set(&key, value);
                    }
                }
                pages.push(number);
                continue;
            }
            let mut passed = inherited.clone();
            for key in [&b"/Resources"[..], b"/MediaBox", b"/CropBox", b"/Rotate"] {
                if let Some(value) = node.get(key) {
                    passed.retain(|(name, _)| name != key);
                    passed.push((key.to_vec(), value.clone()));
                }
            }
            let kids = node
                .get(b"/Kids")
                .and_then(|kids| self.value(kids))
                .ok_or_else(|| format!("页面树节点 {number} 没有 /Kids"))?;
            let Value::Array(kids) = kids else {
                return Err(format!("页面树节点 {number} 的 /Kids 不是数组"));
            };
            for kid in kids.iter().rev() {
                match kid {
                    Value::Reference(kid, _) => stack.push((*kid, passed.clone())),
                    _ => return Err(format!("页面树节点 {number} 的 /Kids 里有直接对象")),
                }
            }
        }
        Ok(pages)
    }
}

fn find_last(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).rposition(|window| window == needle)
}

/// 每页的 /MediaBox 改成 width × height（点），保留上边与左边；返回新文件与页数
pub(super) fn trim(pdf: &[u8], width_pt: f64, height_pt: f64) -> Result<(Vec<u8>, usize), String> {
    let mut document = Document::parse(pdf)?;
    let pages = document.pages()?;
    for number in &pages {
        let object = document.objects.get_mut(number).expect("页面对象存在");
        let media = object.value.get(b"/MediaBox").cloned().ok_or_else(|| format!("页面 {number} 没有 /MediaBox"))?;
        let corners: Vec<f64> = match &media {
            Value::Array(items) => items.iter().filter_map(Value::number).collect(),
            _ => Vec::new(),
        };
        let [left, _, _, top] = corners[..] else {
            return Err(format!("页面 {number} 的 /MediaBox 写法不对"));
        };
        let trimmed = Value::Array(vec![Value::real(left), Value::real(top - height_pt), Value::real(left + width_pt), Value::real(top)]);
        object.value.set(b"/MediaBox", trimmed);
        object.value.remove(b"/CropBox");
    }
    let count = pages.len();
    Ok((write(vec![(document, pages)]), count))
}

/// 把几份 PDF 依次合成一份，每页保持自己的尺寸；只有一份时原样返回
pub(super) fn merge(pdfs: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    match pdfs {
        [] => Err("没有要合并的 PDF".to_owned()),
        [only] => Ok(only.clone()),
        _ => {
            let mut documents = Vec::with_capacity(pdfs.len());
            for (index, pdf) in pdfs.iter().enumerate() {
                let mut document = Document::parse(pdf).map_err(|error| format!("第 {} 份：{error}", index + 1))?;
                let pages = document.pages().map_err(|error| format!("第 {} 份：{error}", index + 1))?;
                documents.push((document, pages));
            }
            Ok(write(documents))
        }
    }
}

/// 只写从各页面能走到的对象：按页序挂到新的页面树下，对象重新编号
fn write(documents: Vec<(Document, Vec<u32>)>) -> Vec<u8> {
    let tree_number = 1u32;
    let catalog_number = 2u32;
    let mut next = 3u32;
    let mut written: Vec<(u32, Object)> = Vec::new();
    let mut kids = Vec::new();
    for (document, pages) in documents {
        let page_set: HashSet<u32> = pages.iter().copied().collect();
        let mut seen: HashSet<u32> = HashSet::new();
        let mut queue: Vec<u32> = pages.clone();
        while let Some(number) = queue.pop() {
            if !seen.insert(number) {
                continue;
            }
            let Some(object) = document.objects.get(&number) else { continue };
            let mut value = object.value.clone();
            if page_set.contains(&number) {
                value.remove(b"/Parent");
            }
            let mut references = Vec::new();
            value.references(&mut references);
            queue.extend(references.into_iter().filter(|reference| !seen.contains(reference)));
        }
        let mut reachable: Vec<u32> = seen.into_iter().filter(|number| document.objects.contains_key(number)).collect();
        reachable.sort_unstable();
        let mut map = HashMap::new();
        for number in &reachable {
            map.insert(*number, next);
            next += 1;
        }
        for number in &reachable {
            let mut object = document.objects[number].clone();
            if page_set.contains(number) {
                object.value.set(b"/Parent", Value::Reference(tree_number, 0));
            }
            object.value.renumber(&map);
            if let Some(stream) = &object.stream {
                object.value.set(b"/Length", Value::integer(stream.len()));
            }
            written.push((map[number], object));
        }
        kids.extend(pages.iter().map(|page| Value::Reference(map[page], 0)));
    }
    let count = kids.len();
    written.push((
        tree_number,
        Object {
            value: Value::Dictionary(vec![
                (b"/Type".to_vec(), Value::Name(b"/Pages".to_vec())),
                (b"/Kids".to_vec(), Value::Array(kids)),
                (b"/Count".to_vec(), Value::integer(count)),
            ]),
            stream: None,
        },
    ));
    written.push((
        catalog_number,
        Object {
            value: Value::Dictionary(vec![
                (b"/Type".to_vec(), Value::Name(b"/Catalog".to_vec())),
                (b"/Pages".to_vec(), Value::Reference(tree_number, 0)),
            ]),
            stream: None,
        },
    ));
    written.sort_by_key(|(number, _)| *number);

    let mut output = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = vec![0usize; next as usize];
    for (number, object) in &written {
        offsets[*number as usize] = output.len();
        output.extend_from_slice(format!("{number} 0 obj\n").as_bytes());
        object.value.write(&mut output);
        if let Some(stream) = &object.stream {
            output.extend_from_slice(b"\nstream\n");
            output.extend_from_slice(stream);
            output.extend_from_slice(b"\nendstream");
        }
        output.extend_from_slice(b"\nendobj\n");
    }
    let xref = output.len();
    output.extend_from_slice(format!("xref\n0 {next}\n0000000000 65535 f \n").as_bytes());
    for offset in &offsets[1..] {
        output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    output.extend_from_slice(format!("trailer\n<</Size {next} /Root {catalog_number} 0 R>>\nstartxref\n{xref}\n%%EOF\n").as_bytes());
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拼一份传统交叉引用表的 PDF：页面树里每页一个尺寸，内容流的长度用间接对象，MediaBox 继承自页面树
    fn sample(sizes: &[(f64, f64)], inherit: bool) -> Vec<u8> {
        let mut objects: Vec<String> = Vec::new();
        let page_count = sizes.len();
        let kids: Vec<String> = (0..page_count).map(|index| format!("{} 0 R", 3 + index * 3)).collect();
        objects.push("<< /Type /Catalog /Pages 2 0 R /Outlines null >>".to_owned());
        let inherited = if inherit {
            format!(" /MediaBox [0 0 {} {}]", sizes[0].0, sizes[0].1)
        } else {
            String::new()
        };
        objects.push(format!("<< /Type /Pages /Kids [{}] /Count {page_count}{inherited} >>", kids.join(" ")));
        for (index, (width, height)) in sizes.iter().enumerate() {
            let content = 3 + index * 3 + 1;
            let media = if inherit { String::new() } else { format!(" /MediaBox [0 0 {width} {height}]") };
            objects.push(format!("<< /Type /Page /Parent 2 0 R{media} /Contents {content} 0 R /Resources << /ProcSet [/PDF] >> >>"));
            let stream = format!("BT (第 {index} 页 \\) endstream) Tj ET");
            objects.push(format!("<< /Length {} 0 R >>\nstream\n{stream}\nendstream", content + 1));
            objects.push(stream.len().to_string());
        }
        let mut output = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(output.len());
            output.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
        }
        let xref = output.len();
        output.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for offset in offsets {
            output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        output.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
        output
    }

    fn media_boxes(pdf: &[u8]) -> Vec<Vec<f64>> {
        let mut document = Document::parse(pdf).unwrap();
        let pages = document.pages().unwrap();
        pages
            .iter()
            .map(|number| match document.objects[number].value.get(b"/MediaBox") {
                Some(Value::Array(items)) => items.iter().filter_map(Value::number).collect(),
                other => panic!("没有 MediaBox：{other:?}"),
            })
            .collect()
    }

    #[test]
    fn merges_pages_in_order_keeping_each_size() {
        let merged = merge(&[sample(&[(595.0, 842.0), (595.0, 842.0)], false), sample(&[(420.0, 595.0)], true)]).unwrap();
        assert_eq!(
            media_boxes(&merged),
            vec![vec![0.0, 0.0, 595.0, 842.0], vec![0.0, 0.0, 595.0, 842.0], vec![0.0, 0.0, 420.0, 595.0]]
        );
        let text = String::from_utf8_lossy(&merged);
        assert!(text.contains("(第 2 页 \\) endstream) Tj ET") || text.contains("(第 0 页 \\) endstream) Tj ET"));
        assert!(!text.contains("/Outlines"));
        assert_eq!(Document::parse(&merged).unwrap().pages().unwrap().len(), 3);
    }

    #[test]
    fn trims_every_page_from_the_top_left() {
        let (trimmed, pages) = trim(&sample(&[(283.0, 150.0), (283.0, 150.0)], true), 283.4646, 141.7323).unwrap();
        assert_eq!(pages, 2);
        assert_eq!(media_boxes(&trimmed), vec![vec![0.0, 8.2677, 283.4646, 150.0]; 2]);
    }

    #[test]
    fn refuses_cross_reference_streams() {
        let pdf = b"%PDF-1.5\n1 0 obj\n<< /Type /XRef >>\nstream\n\nendstream\nendobj\nstartxref\n9\n%%EOF\n";
        let Err(error) = Document::parse(pdf) else { panic!("期望读不了交叉引用流") };
        assert!(error.contains("交叉引用流"));
    }
}
