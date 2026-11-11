// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 读 PDF 每页的尺寸，供按页面尺寸匹配纸张：认传统交叉引用表、交叉引用流与对象流（FlateDecode），交叉引用读不通时按对象重建；
//! 页面尺寸取 CropBox 与 MediaBox 的交集，按 Rotate 转向、乘 UserUnit。加密的 PDF 只读没加密的部分：页面在加密的对象流里时读不出

mod inflate;
mod lexer;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use lexer::{Dictionary, Item, Lexer, Object, lookup};

use crate::protocol::codes::errors;
use crate::protocol::{Details, ProtocolError, SheetGroup};

/// 解压一个流的上限，字节
const MAX_STREAM_BYTES: usize = 64 * 1024 * 1024;

/// 引用链与页面树的深度上限
const MAX_DEPTH: usize = 64;

/// 同一组里相邻两页尺寸的容差，mm
const SAME_SIZE_MM: f64 = 0.01;

const POINTS_PER_INCH: f64 = 72.0;
const MILLIMETRES_PER_INCH: f64 = 25.4;

/// 读不出 PDF 的原因
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PdfProblem {
    /// 不是 PDF
    NotPdf,
    /// 结构损坏
    Damaged,
    /// 页面在加密的对象流里
    Encrypted,
    /// 用了读不了的结构，如别的压缩方式
    Unsupported,
}

impl PdfProblem {
    /// 写进 details.reason 的写法
    pub fn name(self) -> &'static str {
        match self {
            PdfProblem::NotPdf => "not-pdf",
            PdfProblem::Damaged => "damaged",
            PdfProblem::Encrypted => "encrypted",
            PdfProblem::Unsupported => "unsupported",
        }
    }
}

/// 读不出 PDF
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PdfError {
    /// 原因
    pub problem: PdfProblem,
    /// 给开发者看的说明
    pub message: String,
}

impl PdfError {
    fn new(problem: PdfProblem, message: impl Into<String>) -> PdfError {
        PdfError { problem, message: message.into() }
    }

    fn damaged(message: impl Into<String>) -> PdfError {
        PdfError::new(PdfProblem::Damaged, message)
    }

    /// 写成协议错误 PDF_INVALID，details.reason 是原因
    pub fn to_protocol(&self) -> ProtocolError {
        ProtocolError::new(errors::PDF_INVALID, format!("PDF 读不出来：{}", self.message)).with_details(Details::new().with("reason", self.problem.name()))
    }
}

impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}（{}）", self.message, self.problem.name())
    }
}

impl std::error::Error for PdfError {}

type Read<T> = Result<T, PdfError>;

/// 一页的尺寸，mm：已按 Rotate 转向
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageSize {
    /// 宽
    pub width_mm: f64,
    /// 高
    pub height_mm: f64,
}

/// 读出每页的尺寸，按页序
pub fn page_sizes(data: &[u8]) -> Read<Vec<PageSize>> {
    let head = &data[..data.len().min(1024)];
    if find(head, b"%PDF-").is_none() {
        return Err(PdfError::new(PdfProblem::NotPdf, "开头没有 %PDF- 标记"));
    }
    match Document::open(data).and_then(|document| document.page_sizes()) {
        Err(error) if error.problem == PdfProblem::Damaged => Document::recover(data)?.page_sizes(),
        result => result,
    }
}

/// 相邻同尺寸的页并成一组
pub fn sheet_groups(pages: &[PageSize]) -> Vec<SheetGroup> {
    let mut groups: Vec<SheetGroup> = Vec::new();
    for page in pages {
        match groups.last_mut() {
            Some(group) if (group.width_mm - page.width_mm).abs() <= SAME_SIZE_MM && (group.height_mm - page.height_mm).abs() <= SAME_SIZE_MM => group.count += 1,
            _ => groups.push(SheetGroup {
                width_mm: page.width_mm,
                height_mm: page.height_mm,
                count: 1,
            }),
        }
    }
    groups
}

/// 交叉引用里的一项
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry {
    /// 直接写在文件里，值是 「n g obj」 的位置
    Offset(usize),
    /// 在对象流里：对象流的对象号与在流里的序号
    Compressed(u32, u32),
}

/// 解开的对象流：解压后的数据与各对象的位置
struct ObjectStream {
    data: Vec<u8>,
    offsets: HashMap<u32, usize>,
}

struct Document<'a> {
    data: &'a [u8],
    entries: HashMap<u32, Entry>,
    trailer: Dictionary,
    encrypted: bool,
    sealed: bool,
    streams: RefCell<HashMap<u32, Rc<ObjectStream>>>,
}

/// 读到的一个间接对象：对象本身，是流时还有流数据的范围
struct Indirect {
    object: Object,
    stream: Option<std::ops::Range<usize>>,
}

impl<'a> Document<'a> {
    /// 按 startxref 依次读交叉引用表或交叉引用流，较新的项优先
    fn open(data: &'a [u8]) -> Read<Document<'a>> {
        let marker = find_last(data, b"startxref").ok_or_else(|| PdfError::damaged("找不到 startxref"))?;
        let mut lexer = Lexer::new(data, marker + b"startxref".len());
        lexer.skip_space();
        let mut next = Some(lexer.unsigned().ok_or_else(|| PdfError::damaged("startxref 后面不是位置"))? as usize);
        let mut document = Document {
            data,
            entries: HashMap::new(),
            trailer: Dictionary::new(),
            encrypted: false,
            sealed: false,
            streams: RefCell::new(HashMap::new()),
        };
        let mut seen = HashSet::new();
        let mut first = true;
        while let Some(offset) = next.take() {
            if !seen.insert(offset) || offset >= data.len() {
                return Err(PdfError::damaged("交叉引用的位置不对"));
            }
            let section = document.section(offset)?;
            if first {
                document.trailer = section.clone();
                first = false;
            }
            if let Some(stream) = lookup(&section, b"XRefStm").and_then(Object::number) {
                let stream = stream as usize;
                if seen.insert(stream) && stream < data.len() {
                    document.section(stream)?;
                }
            }
            next = lookup(&section, b"Prev").and_then(Object::number).map(|prev| prev as usize);
        }
        document.encrypted = lookup(&document.trailer, b"Encrypt").is_some();
        if lookup(&document.trailer, b"Root").is_none() {
            return Err(PdfError::damaged("trailer 里没有 Root"));
        }
        Ok(document)
    }

    /// 读一段交叉引用（表或流），把还没有的项登记进来，返回它的 trailer 字典
    fn section(&mut self, offset: usize) -> Read<Dictionary> {
        let mut lexer = Lexer::new(self.data, offset);
        if lexer.keyword(b"xref") {
            return self.table(&mut lexer);
        }
        let indirect = self.parse_at(offset, None)?;
        let Object::Dictionary(dictionary) = &indirect.object else {
            return Err(PdfError::damaged("交叉引用的位置上不是交叉引用"));
        };
        if !lookup(dictionary, b"Type").is_some_and(|kind| kind.is_name(b"XRef")) {
            return Err(PdfError::damaged("交叉引用的位置上不是交叉引用"));
        }
        let data = self.stream_data(&indirect, false)?;
        self.register_stream(dictionary, &data)?;
        Ok(dictionary.clone())
    }

    fn table(&mut self, lexer: &mut Lexer<'a>) -> Read<Dictionary> {
        loop {
            lexer.skip_space();
            if lexer.keyword(b"trailer") {
                return match lexer.object() {
                    Some(Object::Dictionary(trailer)) => Ok(trailer),
                    _ => Err(PdfError::damaged("trailer 不是字典")),
                };
            }
            let start = lexer.unsigned().ok_or_else(|| PdfError::damaged("交叉引用表的小节写法不对"))?;
            lexer.skip_space();
            let count = lexer.unsigned().ok_or_else(|| PdfError::damaged("交叉引用表的小节写法不对"))?;
            for index in 0..count {
                lexer.skip_space();
                let offset = lexer.unsigned().ok_or_else(|| PdfError::damaged("交叉引用表的项写法不对"))?;
                lexer.skip_space();
                lexer.unsigned().ok_or_else(|| PdfError::damaged("交叉引用表的项写法不对"))?;
                lexer.skip_space();
                let in_use = match lexer.item() {
                    Some(Item::Keyword(kind)) if kind == b"n" => true,
                    Some(Item::Keyword(kind)) if kind == b"f" => false,
                    _ => return Err(PdfError::damaged("交叉引用表的项写法不对")),
                };
                let number = u32::try_from(start + index).map_err(|_| PdfError::damaged("对象号太大"))?;
                if in_use && offset > 0 {
                    self.entries.entry(number).or_insert(Entry::Offset(offset as usize));
                } else {
                    self.entries.entry(number).or_insert(Entry::Offset(0));
                }
            }
        }
    }

    /// 按交叉引用流的 W 与 Index 登记各项
    fn register_stream(&mut self, dictionary: &Dictionary, data: &[u8]) -> Read<()> {
        let widths: Vec<usize> = match lookup(dictionary, b"W") {
            Some(Object::Array(items)) if items.len() == 3 => items.iter().map(|item| item.number().unwrap_or(-1.0)).map(|width| width as usize).collect(),
            _ => return Err(PdfError::damaged("交叉引用流的 W 不对")),
        };
        if widths.iter().any(|width| *width > 8) {
            return Err(PdfError::damaged("交叉引用流的 W 不对"));
        }
        let size = lookup(dictionary, b"Size").and_then(Object::number).unwrap_or(0.0) as u64;
        let ranges: Vec<(u64, u64)> = match lookup(dictionary, b"Index") {
            Some(Object::Array(items)) => items
                .chunks(2)
                .map(|pair| (pair[0].number().unwrap_or(0.0) as u64, pair.get(1).and_then(Object::number).unwrap_or(0.0) as u64))
                .collect(),
            _ => vec![(0, size)],
        };
        let row = widths.iter().sum::<usize>();
        if row == 0 {
            return Err(PdfError::damaged("交叉引用流的 W 不对"));
        }
        let field = |bytes: &[u8]| bytes.iter().fold(0u64, |value, byte| value << 8 | u64::from(*byte));
        let mut rows = data.chunks_exact(row);
        for (start, count) in ranges {
            for index in 0..count {
                let Some(entry) = rows.next() else {
                    return Ok(());
                };
                let kind = if widths[0] == 0 { 1 } else { field(&entry[..widths[0]]) };
                let second = field(&entry[widths[0]..widths[0] + widths[1]]);
                let third = field(&entry[widths[0] + widths[1]..]);
                let number = u32::try_from(start + index).map_err(|_| PdfError::damaged("对象号太大"))?;
                let value = match kind {
                    1 => Entry::Offset(second as usize),
                    2 => Entry::Compressed(u32::try_from(second).map_err(|_| PdfError::damaged("对象流号太大"))?, third as u32),
                    _ => Entry::Offset(0),
                };
                self.entries.entry(number).or_insert(value);
            }
        }
        Ok(())
    }

    /// 交叉引用读不通时，按文件里出现的「n g obj」重建：同号的取最后一个，对象流里的对象也登记进来
    fn recover(data: &'a [u8]) -> Read<Document<'a>> {
        let mut document = Document {
            data,
            entries: HashMap::new(),
            trailer: Dictionary::new(),
            encrypted: false,
            sealed: false,
            streams: RefCell::new(HashMap::new()),
        };
        let mut index = 0;
        while let Some(found) = find(&data[index..], b"obj") {
            let at = index + found;
            index = at + 3;
            if data.get(at + 3).is_some_and(|byte| !lexer::is_whitespace(*byte) && !lexer::is_delimiter(*byte)) {
                continue;
            }
            if let Some((number, start)) = object_header_before(data, at) {
                document.entries.insert(number, Entry::Offset(start));
            }
        }
        if document.entries.is_empty() {
            return Err(PdfError::damaged("文件里没有对象"));
        }
        let mut trailers = Vec::new();
        let mut cursor = 0;
        while let Some(found) = find(&data[cursor..], b"trailer") {
            let at = cursor + found;
            cursor = at + 7;
            if let Some(Object::Dictionary(trailer)) = Lexer::new(data, at + 7).object() {
                trailers.push(trailer);
            }
        }
        let mut numbers: Vec<u32> = document.entries.keys().copied().collect();
        numbers.sort_unstable();
        let mut catalog = None;
        let mut object_streams = Vec::new();
        for number in &numbers {
            let Ok(indirect) = document.load(*number) else {
                continue;
            };
            let Object::Dictionary(dictionary) = &indirect.object else {
                continue;
            };
            let kind = lookup(dictionary, b"Type");
            if kind.is_some_and(|kind| kind.is_name(b"XRef")) && lookup(dictionary, b"Root").is_some() {
                trailers.push(dictionary.clone());
            } else if kind.is_some_and(|kind| kind.is_name(b"Catalog")) {
                catalog = Some(*number);
            } else if kind.is_some_and(|kind| kind.is_name(b"ObjStm")) && indirect.stream.is_some() {
                object_streams.push(*number);
            }
        }
        document.trailer = trailers.pop().unwrap_or_default();
        document.encrypted = lookup(&document.trailer, b"Encrypt").is_some();
        if lookup(&document.trailer, b"Root").is_none() {
            let catalog = catalog.ok_or_else(|| PdfError::damaged("找不到文档目录"))?;
            document.trailer.push((b"Root".to_vec(), Object::Reference(catalog, 0)));
        }
        document.sealed = document.encrypted && !object_streams.is_empty();
        if !document.encrypted {
            for stream in object_streams {
                if let Ok(decoded) = document.object_stream(stream) {
                    for &number in decoded.offsets.keys() {
                        document.entries.entry(number).or_insert(Entry::Compressed(stream, 0));
                    }
                }
            }
        }
        Ok(document)
    }

    /// 按对象号取对象并解开引用
    fn get(&self, number: u32) -> Read<Object> {
        Ok(self.load(number)?.object)
    }

    fn load(&self, number: u32) -> Read<Indirect> {
        match self.entries.get(&number) {
            None if self.sealed => Err(PdfError::new(PdfProblem::Encrypted, "PDF 加密了，页面在加密的对象流里")),
            None | Some(Entry::Offset(0)) => Ok(Indirect {
                object: Object::Null,
                stream: None,
            }),
            Some(Entry::Offset(offset)) => self.parse_at(*offset, Some(number)),
            Some(Entry::Compressed(stream, _)) => {
                if self.encrypted {
                    return Err(PdfError::new(PdfProblem::Encrypted, "PDF 加密了，页面在加密的对象流里"));
                }
                let decoded = self.object_stream(*stream)?;
                let offset = *decoded
                    .offsets
                    .get(&number)
                    .ok_or_else(|| PdfError::damaged(format!("对象流 {stream} 里没有对象 {number}")))?;
                let object = Lexer::new(&decoded.data, offset)
                    .object()
                    .ok_or_else(|| PdfError::damaged(format!("对象流 {stream} 里的对象 {number} 读不出来")))?;
                Ok(Indirect { object, stream: None })
            }
        }
    }

    /// 读「n g obj」开头的对象；expected 给了时核对对象号
    fn parse_at(&self, offset: usize, expected: Option<u32>) -> Read<Indirect> {
        let broken = || PdfError::damaged(format!("位置 {offset} 上的对象读不出来"));
        let mut lexer = Lexer::new(self.data, offset);
        lexer.skip_space();
        let number = lexer.unsigned().ok_or_else(broken)?;
        lexer.skip_space();
        lexer.unsigned().ok_or_else(broken)?;
        if !lexer.keyword(b"obj") || expected.is_some_and(|expected| u64::from(expected) != number) {
            return Err(broken());
        }
        let object = lexer.object().ok_or_else(broken)?;
        let stream = if matches!(object, Object::Dictionary(_)) && lexer.keyword(b"stream") {
            let mut start = lexer.position;
            if self.data.get(start) == Some(&b'\r') {
                start += 1;
            }
            if self.data.get(start) == Some(&b'\n') {
                start += 1;
            }
            Some(self.stream_range(&object, start)?)
        } else {
            None
        };
        Ok(Indirect { object, stream })
    }

    /// 流数据的范围：Length 对得上 endstream 时按 Length，否则找 endstream
    fn stream_range(&self, dictionary: &Object, start: usize) -> Read<std::ops::Range<usize>> {
        let length = match dictionary.get(b"Length") {
            Some(Object::Number(length)) => Some(*length as usize),
            Some(Object::Reference(number, _)) => self.get(*number).ok().and_then(|length| length.number()).map(|length| length as usize),
            _ => None,
        };
        if let Some(length) = length
            && let Some(end) = start.checked_add(length).filter(|end| *end <= self.data.len())
        {
            let mut lexer = Lexer::new(self.data, end);
            if lexer.keyword(b"endstream") {
                return Ok(start..end);
            }
        }
        let found = find(&self.data[start..], b"endstream").ok_or_else(|| PdfError::damaged("流没有 endstream"))?;
        let mut end = start + found;
        if end > start && self.data[end - 1] == b'\n' {
            end -= 1;
        }
        if end > start && self.data[end - 1] == b'\r' {
            end -= 1;
        }
        Ok(start..end)
    }

    /// 解码流数据：只认 FlateDecode 与 PNG 预测；加密文件里的流（交叉引用流除外）解不开
    fn stream_data(&self, indirect: &Indirect, encrypted: bool) -> Read<Vec<u8>> {
        let range = indirect.stream.clone().ok_or_else(|| PdfError::damaged("不是流"))?;
        if encrypted {
            return Err(PdfError::new(PdfProblem::Encrypted, "PDF 加密了，读不了里面的流"));
        }
        let raw = &self.data[range];
        let filters: Vec<Object> = match self.resolve(indirect.object.get(b"Filter").cloned().unwrap_or(Object::Null), 0)? {
            Object::Null => Vec::new(),
            Object::Array(items) => items,
            single => vec![single],
        };
        let parameters: Vec<Object> = match self.resolve(indirect.object.get(b"DecodeParms").cloned().unwrap_or(Object::Null), 0)? {
            Object::Array(items) => items,
            Object::Null => Vec::new(),
            single => vec![single],
        };
        let mut data = raw.to_vec();
        for (index, filter) in filters.iter().enumerate() {
            if !(filter.is_name(b"FlateDecode") || filter.is_name(b"Fl")) {
                return Err(PdfError::new(PdfProblem::Unsupported, "对象流或交叉引用流用了 FlateDecode 以外的压缩方式"));
            }
            data = inflate::flate(&data, MAX_STREAM_BYTES).map_err(|error| match error {
                inflate::InflateError::TooLarge => PdfError::new(PdfProblem::Unsupported, "流解压后太大"),
                inflate::InflateError::Corrupt => PdfError::damaged("流的压缩数据损坏"),
            })?;
            let parameter = parameters.get(index).cloned().unwrap_or(Object::Null);
            let parameter = self.resolve(parameter, 0)?;
            data = unpredict(data, &parameter)?;
        }
        Ok(data)
    }

    fn object_stream(&self, number: u32) -> Read<Rc<ObjectStream>> {
        if let Some(decoded) = self.streams.borrow().get(&number) {
            return Ok(decoded.clone());
        }
        let indirect = match self.entries.get(&number) {
            Some(Entry::Offset(offset)) if *offset > 0 => self.parse_at(*offset, Some(number))?,
            _ => return Err(PdfError::damaged(format!("找不到对象流 {number}"))),
        };
        let data = self.stream_data(&indirect, self.encrypted)?;
        let count = indirect.object.get(b"N").and_then(Object::number).ok_or_else(|| PdfError::damaged("对象流没有 N"))? as usize;
        let first = indirect
            .object
            .get(b"First")
            .and_then(Object::number)
            .ok_or_else(|| PdfError::damaged("对象流没有 First"))? as usize;
        let mut lexer = Lexer::new(&data, 0);
        let mut offsets = HashMap::new();
        for _ in 0..count {
            lexer.skip_space();
            let Some(object) = lexer.unsigned() else { break };
            lexer.skip_space();
            let Some(offset) = lexer.unsigned() else { break };
            if let Ok(object) = u32::try_from(object) {
                offsets.insert(object, first + offset as usize);
            }
        }
        let decoded = Rc::new(ObjectStream { data, offsets });
        self.streams.borrow_mut().insert(number, decoded.clone());
        Ok(decoded)
    }

    /// 解开引用，直到不是引用
    fn resolve(&self, object: Object, depth: usize) -> Read<Object> {
        match object {
            Object::Reference(number, _) if depth < MAX_DEPTH => self.resolve(self.get(number)?, depth + 1),
            Object::Reference(..) => Err(PdfError::damaged("引用链太长")),
            other => Ok(other),
        }
    }

    fn page_sizes(&self) -> Read<Vec<PageSize>> {
        let root = self.resolve(lookup(&self.trailer, b"Root").cloned().unwrap_or(Object::Null), 0)?;
        let pages = root.get(b"Pages").cloned().ok_or_else(|| PdfError::damaged("文档目录里没有 Pages"))?;
        let mut sizes = Vec::new();
        let mut visited = HashSet::new();
        self.walk(pages, Inherited::default(), 0, &mut visited, &mut sizes)?;
        if sizes.is_empty() {
            return Err(PdfError::damaged("PDF 里没有页面"));
        }
        Ok(sizes)
    }

    fn walk(&self, node: Object, inherited: Inherited, depth: usize, visited: &mut HashSet<u32>, sizes: &mut Vec<PageSize>) -> Read<()> {
        if depth > MAX_DEPTH {
            return Err(PdfError::damaged("页面树太深"));
        }
        if let Object::Reference(number, _) = node
            && !visited.insert(number)
        {
            return Err(PdfError::damaged("页面树里有环"));
        }
        let node = self.resolve(node, 0)?;
        let Object::Dictionary(entries) = &node else {
            return Err(PdfError::damaged("页面树的节点不是字典"));
        };
        let inherited = Inherited {
            media: self.rectangle(lookup(entries, b"MediaBox"))?.or(inherited.media),
            crop: self.rectangle(lookup(entries, b"CropBox"))?.or(inherited.crop),
            rotate: match lookup(entries, b"Rotate") {
                Some(rotate) => self.resolve(rotate.clone(), 0)?.number().map(|rotate| rotate as i64).or(inherited.rotate),
                None => inherited.rotate,
            },
        };
        let kind = lookup(entries, b"Type");
        let is_page = kind.is_some_and(|kind| kind.is_name(b"Page")) || (!kind.is_some_and(|kind| kind.is_name(b"Pages")) && lookup(entries, b"Kids").is_none());
        if is_page {
            let media = inherited.media.ok_or_else(|| PdfError::damaged(format!("第 {} 页没有 MediaBox", sizes.len() + 1)))?;
            let unit = match lookup(entries, b"UserUnit") {
                Some(unit) => self.resolve(unit.clone(), 0)?.number().filter(|unit| *unit > 0.0).unwrap_or(1.0),
                None => 1.0,
            };
            let visible = inherited.crop.and_then(|crop| intersect(media, crop)).unwrap_or(media);
            let to_mm = unit / POINTS_PER_INCH * MILLIMETRES_PER_INCH;
            let (mut width, mut height) = ((visible[2] - visible[0]) * to_mm, (visible[3] - visible[1]) * to_mm);
            if !(width > 0.0 && height > 0.0) {
                return Err(PdfError::damaged(format!("第 {} 页的尺寸不对", sizes.len() + 1)));
            }
            if inherited.rotate.unwrap_or(0).rem_euclid(360) % 180 == 90 {
                std::mem::swap(&mut width, &mut height);
            }
            sizes.push(PageSize {
                width_mm: width,
                height_mm: height,
            });
            return Ok(());
        }
        let kids = match self.resolve(lookup(entries, b"Kids").cloned().unwrap_or(Object::Null), 0)? {
            Object::Array(kids) => kids,
            _ => return Err(PdfError::damaged("页面树的 Kids 不是数组")),
        };
        for kid in kids {
            self.walk(kid, inherited, depth + 1, visited, sizes)?;
        }
        Ok(())
    }

    /// 读一个矩形 [llx lly urx ury]，换成左下、右上；没写时为 None
    fn rectangle(&self, value: Option<&Object>) -> Read<Option<[f64; 4]>> {
        let Some(value) = value else { return Ok(None) };
        let Object::Array(items) = self.resolve(value.clone(), 0)? else {
            return Err(PdfError::damaged("页面框不是数组"));
        };
        if items.len() != 4 {
            return Err(PdfError::damaged("页面框不是四个数"));
        }
        let mut numbers = [0.0; 4];
        for (slot, item) in numbers.iter_mut().zip(items) {
            *slot = self.resolve(item, 0)?.number().ok_or_else(|| PdfError::damaged("页面框里有不是数的项"))?;
        }
        Ok(Some([
            numbers[0].min(numbers[2]),
            numbers[1].min(numbers[3]),
            numbers[0].max(numbers[2]),
            numbers[1].max(numbers[3]),
        ]))
    }
}

/// 页面树里往下传的 MediaBox、CropBox 与 Rotate
#[derive(Clone, Copy, Default)]
struct Inherited {
    media: Option<[f64; 4]>,
    crop: Option<[f64; 4]>,
    rotate: Option<i64>,
}

fn intersect(a: [f64; 4], b: [f64; 4]) -> Option<[f64; 4]> {
    let box_ = [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])];
    (box_[2] > box_[0] && box_[3] > box_[1]).then_some(box_)
}

/// 去掉 PNG 预测（Predictor 10–15）；没有预测时原样返回
fn unpredict(data: Vec<u8>, parameters: &Object) -> Read<Vec<u8>> {
    let predictor = parameters.get(b"Predictor").and_then(Object::number).unwrap_or(1.0) as i64;
    if predictor <= 1 {
        return Ok(data);
    }
    if predictor < 10 {
        return Err(PdfError::new(PdfProblem::Unsupported, "流用了 TIFF 预测"));
    }
    let number = |key: &[u8], default: f64| parameters.get(key).and_then(Object::number).unwrap_or(default).max(1.0) as usize;
    let (columns, colors, bits) = (number(b"Columns", 1.0), number(b"Colors", 1.0), number(b"BitsPerComponent", 8.0));
    let pixel = (colors * bits).div_ceil(8);
    let row = (columns * colors * bits).div_ceil(8);
    let mut output = Vec::with_capacity(data.len());
    let mut previous = vec![0u8; row];
    for chunk in data.chunks(row + 1) {
        if chunk.len() < 2 {
            break;
        }
        let (kind, line) = (chunk[0], &chunk[1..]);
        let mut current = vec![0u8; row];
        for index in 0..line.len() {
            let left = if index >= pixel { current[index - pixel] } else { 0 };
            let up = previous[index];
            let corner = if index >= pixel { previous[index - pixel] } else { 0 };
            current[index] = match kind {
                0 => line[index],
                1 => line[index].wrapping_add(left),
                2 => line[index].wrapping_add(up),
                3 => line[index].wrapping_add(((u16::from(left) + u16::from(up)) / 2) as u8),
                4 => line[index].wrapping_add(paeth(left, up, corner)),
                _ => return Err(PdfError::damaged("PNG 预测的行类型不对")),
            };
        }
        output.extend_from_slice(&current[..line.len()]);
        previous = current;
    }
    Ok(output)
}

fn paeth(left: u8, up: u8, corner: u8) -> u8 {
    let estimate = i16::from(left) + i16::from(up) - i16::from(corner);
    let (to_left, to_up, to_corner) = ((estimate - i16::from(left)).abs(), (estimate - i16::from(up)).abs(), (estimate - i16::from(corner)).abs());
    if to_left <= to_up && to_left <= to_corner {
        left
    } else if to_up <= to_corner {
        up
    } else {
        corner
    }
}

/// 「obj」前面是不是「对象号 代号 」：是时给出对象号与对象号开头的位置
fn object_header_before(data: &[u8], at: usize) -> Option<(u32, usize)> {
    let mut index = at;
    let skip_space = |index: &mut usize| {
        let start = *index;
        while *index > 0 && lexer::is_whitespace(data[*index - 1]) {
            *index -= 1;
        }
        *index < start
    };
    let digits = |index: &mut usize| {
        let end = *index;
        while *index > 0 && data[*index - 1].is_ascii_digit() {
            *index -= 1;
        }
        (*index < end).then(|| std::str::from_utf8(&data[*index..end]).ok()?.parse::<u64>().ok()).flatten()
    };
    if !skip_space(&mut index) {
        return None;
    }
    digits(&mut index)?;
    if !skip_space(&mut index) {
        return None;
    }
    let number = digits(&mut index)?;
    if index > 0 && !lexer::is_whitespace(data[index - 1]) && !lexer::is_delimiter(data[index - 1]) {
        return None;
    }
    Some((u32::try_from(number).ok()?, index))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn find_last(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).rposition(|window| window == needle)
}

#[cfg(test)]
mod tests;
