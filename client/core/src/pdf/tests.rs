// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

use std::io::{Cursor, Read, Write};

use super::*;

/// 拼一份 PDF：按顺序写对象，最后写交叉引用表或交叉引用流
struct Builder {
    data: Vec<u8>,
    offsets: Vec<(u32, usize)>,
}

impl Builder {
    fn new() -> Builder {
        Builder {
            data: b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n".to_vec(),
            offsets: Vec::new(),
        }
    }

    fn object(&mut self, number: u32, body: &str) -> &mut Builder {
        self.offsets.push((number, self.data.len()));
        self.data.extend_from_slice(format!("{number} 0 obj\n{body}\nendobj\n").as_bytes());
        self
    }

    fn stream(&mut self, number: u32, dictionary: &str, content: &[u8]) -> &mut Builder {
        self.offsets.push((number, self.data.len()));
        self.data
            .extend_from_slice(format!("{number} 0 obj\n<< /Length {} {dictionary} >>\nstream\n", content.len()).as_bytes());
        self.data.extend_from_slice(content);
        self.data.extend_from_slice(b"\nendstream\nendobj\n");
        self
    }

    fn table(&mut self, trailer: &str) -> Vec<u8> {
        let start = self.data.len();
        let size = self.offsets.iter().map(|(number, _)| *number).max().unwrap_or(0) + 1;
        let mut table = format!("xref\n0 {size}\n0000000000 65535 f \n");
        for number in 1..size {
            match self.offsets.iter().rev().find(|(candidate, _)| *candidate == number) {
                Some((_, offset)) => table.push_str(&format!("{offset:010} 00000 n \n")),
                None => table.push_str("0000000000 00000 f \n"),
            }
        }
        table.push_str(&format!("trailer\n<< /Size {size} {trailer} >>\nstartxref\n{start}\n%%EOF\n"));
        self.data.extend_from_slice(table.as_bytes());
        self.data.clone()
    }
}

/// zlib 包装的 deflate 数据：deflate 取自 zip 写出的条目，末尾的 Adler-32 填 0
fn zlib(data: &[u8]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("data", options).unwrap();
    writer.write_all(data).unwrap();
    let archive = writer.finish().unwrap().into_inner();
    let mut reader = zip::ZipArchive::new(Cursor::new(archive)).unwrap();
    let mut raw = vec![0x78, 0x9c];
    reader.by_index_raw(0).unwrap().read_to_end(&mut raw).unwrap();
    raw.extend_from_slice(&[0, 0, 0, 0]);
    raw
}

const A4: (f64, f64) = (210.0, 297.0);

fn sizes(data: &[u8]) -> Vec<(f64, f64)> {
    page_sizes(data)
        .unwrap()
        .iter()
        .map(|page| ((page.width_mm * 100.0).round() / 100.0, (page.height_mm * 100.0).round() / 100.0))
        .collect()
}

fn three_pages(trailer_extra: &str) -> Vec<u8> {
    Builder::new()
        .object(1, "<< /Type /Catalog /Pages 2 0 R >>")
        .object(2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 595.28 841.89] >>")
        .stream(6, "", b"BT /F1 12 Tf (endobj 7 0 obj) Tj ET")
        .object(3, "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>")
        .object(4, "<< /Type /Page /Parent 2 0 R /CropBox [10 10 100 100] >>")
        .object(5, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 500] /UserUnit 2 /Rotate -90 >>")
        .table(&format!("/Root 1 0 R {trailer_extra}"))
}

#[test]
fn reads_inherited_boxes_crop_rotation_and_user_unit() {
    assert_eq!(sizes(&three_pages("")), vec![A4, (31.75, 31.75), (352.78, 705.56)]);
}

#[test]
fn reads_dictionaries_of_an_encrypted_file_with_a_plain_table() {
    assert_eq!(sizes(&three_pages("/Encrypt 9 0 R /ID [<00> <00>]")).len(), 3);
}

#[test]
fn prefers_the_newest_section_of_an_incremental_update() {
    let mut builder = Builder::new();
    let first = builder
        .object(1, "<< /Type /Catalog /Pages 2 0 R >>")
        .object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
        .object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>")
        .table("/Root 1 0 R");
    let previous = first.windows(9).rposition(|window| window == b"startxref").unwrap();
    let previous_offset: usize = std::str::from_utf8(&first[previous + 10..]).unwrap().split_whitespace().next().unwrap().parse().unwrap();
    let mut data = first.clone();
    let update = data.len();
    data.extend_from_slice(b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 283.46 425.197] >>\nendobj\n");
    let xref = data.len();
    data.extend_from_slice(format!("xref\n3 1\n{update:010} 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R /Prev {previous_offset} >>\nstartxref\n{xref}\n%%EOF\n").as_bytes());
    assert_eq!(sizes(&data), vec![(100.0, 150.0)]);
}

/// 对象 1–4 放进对象流 5，交叉引用流是对象 6，用 PNG Up 预测
fn compressed(dictionary_extra: &str) -> Vec<u8> {
    let objects = [
        (1, "<< /Type /Catalog /Pages 2 0 R >>"),
        (2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 595.28 841.89] >>"),
        (3, "<< /Type /Page /Parent 2 0 R >>"),
        (4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 283.46 170.08] /Rotate 90 >>"),
    ];
    let mut header = String::new();
    let mut body = String::new();
    for (number, text) in objects {
        header.push_str(&format!("{number} {} ", body.len()));
        body.push_str(text);
        body.push('\n');
    }
    let content = format!("{header}\n{body}");
    let first = header.len() + 1;
    let mut builder = Builder::new();
    builder.stream(5, &format!("/Type /ObjStm /N 4 /First {first} /Filter /FlateDecode"), &zlib(content.as_bytes()));
    let object_stream_offset = builder.offsets[0].1;
    let xref_offset = builder.data.len();
    let mut rows: Vec<[u8; 7]> = vec![[0, 0, 0, 0, 0, 0xff, 0xff]];
    for index in 0..4u8 {
        rows.push([2, 0, 0, 0, 5, 0, index]);
    }
    let offset = |value: usize| {
        let bytes = (value as u32).to_be_bytes();
        [1, bytes[0], bytes[1], bytes[2], bytes[3], 0, 0]
    };
    rows.push(offset(object_stream_offset));
    rows.push(offset(xref_offset));
    let mut predicted = Vec::new();
    let mut previous = [0u8; 7];
    for row in &rows {
        predicted.push(2);
        predicted.extend(row.iter().zip(previous).map(|(byte, above)| byte.wrapping_sub(above)));
        previous = *row;
    }
    let mut data = builder.data.clone();
    let stream = zlib(&predicted);
    data.extend_from_slice(
        format!(
            "6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R {dictionary_extra} /Filter /FlateDecode /DecodeParms << /Columns 7 /Predictor 12 >> /Length {} >>\nstream\n",
            stream.len()
        )
        .as_bytes(),
    );
    data.extend_from_slice(&stream);
    data.extend_from_slice(format!("\nendstream\nendobj\nstartxref\n{xref_offset}\n%%EOF\n").as_bytes());
    data
}

#[test]
fn reads_cross_reference_and_object_streams() {
    assert_eq!(sizes(&compressed("")), vec![A4, (60.0, 100.0)]);
}

#[test]
fn refuses_pages_hidden_in_encrypted_object_streams() {
    let error = page_sizes(&compressed("/Encrypt 9 0 R")).unwrap_err();
    assert_eq!(error.problem, PdfProblem::Encrypted);
    let protocol = error.to_protocol();
    assert_eq!(protocol.code, errors::PDF_INVALID);
    assert_eq!(protocol.details.unwrap().get("reason"), Some(&serde_json::json!("encrypted")));
}

#[test]
fn rebuilds_the_cross_reference_when_offsets_are_wrong() {
    let mut data = three_pages("");
    let at = data.windows(9).rposition(|window| window == b"startxref").unwrap();
    data.truncate(at);
    data.extend_from_slice(b"startxref\n12\n%%EOF\n");
    assert_eq!(sizes(&data), vec![A4, (31.75, 31.75), (352.78, 705.56)]);

    let mut shifted = b"junk before the header\n".to_vec();
    shifted.extend_from_slice(&compressed(""));
    assert_eq!(sizes(&shifted), vec![A4, (60.0, 100.0)]);
}

#[test]
fn tells_why_a_file_cannot_be_read() {
    assert_eq!(page_sizes(b"<html></html>").unwrap_err().problem, PdfProblem::NotPdf);
    assert_eq!(page_sizes(b"%PDF-1.4\nnothing here\n").unwrap_err().problem, PdfProblem::Damaged);
    let empty = Builder::new()
        .object(1, "<< /Type /Catalog /Pages 2 0 R >>")
        .object(2, "<< /Type /Pages /Kids [] /Count 0 >>")
        .table("/Root 1 0 R");
    assert_eq!(page_sizes(&empty).unwrap_err().problem, PdfProblem::Damaged);
    let lzw = Builder::new()
        .stream(1, "/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode", b"2 0 x")
        .object(3, "<< /Type /Pages /Kids [2 0 R] >>")
        .object(4, "<< /Type /Catalog /Pages 3 0 R >>")
        .table("/Root 4 0 R");
    assert_eq!(page_sizes(&lzw).unwrap_err().problem, PdfProblem::Damaged);
}

#[test]
fn groups_adjacent_pages_of_the_same_size() {
    let page = |width_mm: f64, height_mm: f64| PageSize { width_mm, height_mm };
    let groups = sheet_groups(&[page(210.0, 297.0), page(210.004, 297.0), page(100.0, 60.0), page(210.0, 297.0)]);
    assert_eq!(
        groups.iter().map(|group| (group.width_mm, group.height_mm, group.count)).collect::<Vec<_>>(),
        vec![(210.0, 297.0, 2), (100.0, 60.0, 1), (210.0, 297.0, 1)]
    );
}
