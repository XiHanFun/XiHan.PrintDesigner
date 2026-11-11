// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! zlib（RFC 1950）与 deflate（RFC 1951）解压：读 PDF 里 FlateDecode 的交叉引用流与对象流

/// 解压没有完成的原因
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InflateError {
    /// 数据不是合法的 deflate，或在块中间断了
    Corrupt,
    /// 解压后超过上限
    TooLarge,
}

const MAX_BITS: usize = 15;
const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/// 解压 FlateDecode 的数据：带 zlib 头时跳过头，不带时按裸的 deflate 读；不核对末尾的 Adler-32
pub(crate) fn flate(data: &[u8], limit: usize) -> Result<Vec<u8>, InflateError> {
    let zlib = data.len() >= 2 && data[0] & 0x0f == 8 && data[0] >> 4 <= 7 && (u16::from(data[0]) << 8 | u16::from(data[1])) % 31 == 0;
    if zlib && data[1] & 0x20 != 0 {
        return Err(InflateError::Corrupt);
    }
    inflate(if zlib { &data[2..] } else { data }, limit)
}

/// 解压裸的 deflate 数据，读到最后一块为止
pub(crate) fn inflate(data: &[u8], limit: usize) -> Result<Vec<u8>, InflateError> {
    let mut bits = Bits {
        data,
        position: 0,
        buffer: 0,
        count: 0,
    };
    let mut output = Vec::new();
    loop {
        let last = bits.take(1)? == 1;
        match bits.take(2)? {
            0 => stored(&mut bits, &mut output, limit)?,
            1 => {
                let (literals, distances) = fixed_tables();
                codes(&mut bits, &mut output, &literals, &distances, limit)?;
            }
            2 => {
                let (literals, distances) = dynamic_tables(&mut bits)?;
                codes(&mut bits, &mut output, &literals, &distances, limit)?;
            }
            _ => return Err(InflateError::Corrupt),
        }
        if last {
            return Ok(output);
        }
    }
}

struct Bits<'a> {
    data: &'a [u8],
    position: usize,
    buffer: u32,
    count: u32,
}

impl Bits<'_> {
    /// 取 n 位（n ≤ 16），低位在前
    fn take(&mut self, n: u32) -> Result<u32, InflateError> {
        while self.count < n {
            let byte = *self.data.get(self.position).ok_or(InflateError::Corrupt)?;
            self.buffer |= u32::from(byte) << self.count;
            self.position += 1;
            self.count += 8;
        }
        let value = self.buffer & ((1u32 << n) - 1);
        self.buffer >>= n;
        self.count -= n;
        Ok(value)
    }

    /// 丢掉当前字节剩下的位
    fn align(&mut self) {
        self.buffer = 0;
        self.count = 0;
    }
}

/// 规范 Huffman 码表：各长度的码数与按码排好的符号
struct Huffman {
    counts: [u16; MAX_BITS + 1],
    symbols: Vec<u16>,
}

impl Huffman {
    /// 由各符号的码长建表；码长超额时报错，不足时照样建（只用到的码可解）
    fn new(lengths: &[u8]) -> Result<Huffman, InflateError> {
        let mut counts = [0u16; MAX_BITS + 1];
        for &length in lengths {
            counts[usize::from(length)] += 1;
        }
        let mut left: i32 = 1;
        for &count in &counts[1..] {
            left <<= 1;
            left -= i32::from(count);
            if left < 0 {
                return Err(InflateError::Corrupt);
            }
        }
        let mut offsets = [0u16; MAX_BITS + 2];
        for length in 1..=MAX_BITS {
            offsets[length + 1] = offsets[length] + counts[length];
        }
        let mut symbols = vec![0u16; lengths.len()];
        for (symbol, &length) in lengths.iter().enumerate() {
            if length != 0 {
                let slot = &mut offsets[usize::from(length)];
                symbols[usize::from(*slot)] = symbol as u16;
                *slot += 1;
            }
        }
        Ok(Huffman { counts, symbols })
    }

    fn decode(&self, bits: &mut Bits<'_>) -> Result<u16, InflateError> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for length in 1..=MAX_BITS {
            code |= bits.take(1)? as i32;
            let count = i32::from(self.counts[length]);
            if code - count < first {
                return self.symbols.get((index + code - first) as usize).copied().ok_or(InflateError::Corrupt);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err(InflateError::Corrupt)
    }
}

fn stored(bits: &mut Bits<'_>, output: &mut Vec<u8>, limit: usize) -> Result<(), InflateError> {
    bits.align();
    let header = bits.data.get(bits.position..bits.position + 4).ok_or(InflateError::Corrupt)?;
    let length = usize::from(u16::from_le_bytes([header[0], header[1]]));
    let complement = u16::from_le_bytes([header[2], header[3]]);
    if complement != !(length as u16) {
        return Err(InflateError::Corrupt);
    }
    bits.position += 4;
    let block = bits.data.get(bits.position..bits.position + length).ok_or(InflateError::Corrupt)?;
    if output.len() + length > limit {
        return Err(InflateError::TooLarge);
    }
    output.extend_from_slice(block);
    bits.position += length;
    Ok(())
}

fn fixed_tables() -> (Huffman, Huffman) {
    let mut lengths = [0u8; 288];
    for (symbol, length) in lengths.iter_mut().enumerate() {
        *length = match symbol {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let literals = Huffman::new(&lengths).expect("固定码表合法");
    let distances = Huffman::new(&[5u8; 30]).expect("固定码表合法");
    (literals, distances)
}

fn dynamic_tables(bits: &mut Bits<'_>) -> Result<(Huffman, Huffman), InflateError> {
    let literal_count = bits.take(5)? as usize + 257;
    let distance_count = bits.take(5)? as usize + 1;
    let code_count = bits.take(4)? as usize + 4;
    if literal_count > 286 || distance_count > 30 {
        return Err(InflateError::Corrupt);
    }
    let mut code_lengths = [0u8; 19];
    for &slot in &CODE_LENGTH_ORDER[..code_count] {
        code_lengths[slot] = bits.take(3)? as u8;
    }
    let code_table = Huffman::new(&code_lengths)?;
    let mut lengths = vec![0u8; literal_count + distance_count];
    let mut index = 0;
    while index < lengths.len() {
        let symbol = code_table.decode(bits)?;
        let (value, repeat) = match symbol {
            0..=15 => (symbol as u8, 1),
            16 => {
                let previous = *lengths.get(index.wrapping_sub(1)).ok_or(InflateError::Corrupt)?;
                (previous, 3 + bits.take(2)? as usize)
            }
            17 => (0, 3 + bits.take(3)? as usize),
            18 => (0, 11 + bits.take(7)? as usize),
            _ => return Err(InflateError::Corrupt),
        };
        if index + repeat > lengths.len() {
            return Err(InflateError::Corrupt);
        }
        lengths[index..index + repeat].fill(value);
        index += repeat;
    }
    if lengths[256] == 0 {
        return Err(InflateError::Corrupt);
    }
    Ok((Huffman::new(&lengths[..literal_count])?, Huffman::new(&lengths[literal_count..])?))
}

fn codes(bits: &mut Bits<'_>, output: &mut Vec<u8>, literals: &Huffman, distances: &Huffman, limit: usize) -> Result<(), InflateError> {
    loop {
        let symbol = literals.decode(bits)?;
        match symbol {
            0..=255 => {
                if output.len() >= limit {
                    return Err(InflateError::TooLarge);
                }
                output.push(symbol as u8);
            }
            256 => return Ok(()),
            _ => {
                let index = usize::from(symbol - 257);
                if index >= LENGTH_BASE.len() {
                    return Err(InflateError::Corrupt);
                }
                let length = usize::from(LENGTH_BASE[index]) + bits.take(u32::from(LENGTH_EXTRA[index]))? as usize;
                let code = usize::from(distances.decode(bits)?);
                if code >= DISTANCE_BASE.len() {
                    return Err(InflateError::Corrupt);
                }
                let distance = usize::from(DISTANCE_BASE[code]) + bits.take(u32::from(DISTANCE_EXTRA[code]))? as usize;
                if distance > output.len() {
                    return Err(InflateError::Corrupt);
                }
                if output.len() + length > limit {
                    return Err(InflateError::TooLarge);
                }
                let start = output.len() - distance;
                for offset in 0..length {
                    let byte = output[start + offset];
                    output.push(byte);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};

    /// 用 zip 写一份 deflate 压缩的条目，取出它未解压的字节
    fn deflated(data: &[u8]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("data", options).unwrap();
        writer.write_all(data).unwrap();
        let archive = writer.finish().unwrap().into_inner();
        let mut reader = zip::ZipArchive::new(Cursor::new(archive)).unwrap();
        let mut raw = Vec::new();
        reader.by_index_raw(0).unwrap().read_to_end(&mut raw).unwrap();
        raw
    }

    #[test]
    fn reads_a_fixed_huffman_zlib_stream() {
        let hello = [0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 0x06, 0x2c, 0x02, 0x15];
        assert_eq!(flate(&hello, 1024).unwrap(), b"hello");
        assert_eq!(flate(&hello[..hello.len() - 4], 1024).unwrap(), b"hello");
    }

    #[test]
    fn reads_stored_blocks() {
        let stored = [0x01, 0x03, 0x00, 0xfc, 0xff, b'a', b'b', b'c'];
        assert_eq!(inflate(&stored, 16).unwrap(), b"abc");
        assert_eq!(inflate(&[0x01, 0x03, 0x00, 0xfc, 0xfe, b'a', b'b', b'c'], 16), Err(InflateError::Corrupt));
    }

    #[test]
    fn round_trips_dynamic_blocks_written_by_zip() {
        let mut text = Vec::new();
        for index in 0..5000u32 {
            text.extend_from_slice(format!("{index} 0 obj << /Type /Page /MediaBox [0 0 595.28 841.89] >> endobj\n").as_bytes());
        }
        text.extend((0..=255u8).cycle().take(70_000));
        let raw = deflated(&text);
        assert!(raw.len() < text.len());
        assert_eq!(inflate(&raw, text.len()).unwrap(), text);
        assert_eq!(inflate(&raw, text.len() - 1), Err(InflateError::TooLarge));
    }

    #[test]
    fn rejects_truncated_or_invalid_data() {
        let raw = deflated(b"the quick brown fox jumps over the lazy dog, again and again and again");
        assert_eq!(inflate(&raw[..raw.len() / 2], 1024), Err(InflateError::Corrupt));
        assert_eq!(inflate(&[0x07], 16), Err(InflateError::Corrupt));
        assert_eq!(flate(&[0x78, 0xbb, 0, 0], 16), Err(InflateError::Corrupt));
    }
}
