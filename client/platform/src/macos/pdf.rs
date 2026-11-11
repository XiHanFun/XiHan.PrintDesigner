// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 经 PDFKit 把几份 PDF 依次合成一份，每页保持自己的尺寸；可在任意线程上调用

use objc2::AnyThread;
use objc2::rc::autoreleasepool;
use objc2_foundation::NSData;
use objc2_pdf_kit::PDFDocument;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::Details;
use xihan_print_client_core::protocol::codes::errors;

/// 依次合并；只有一份时原样返回
pub(super) fn merge(mut pdfs: Vec<Vec<u8>>) -> Result<Vec<u8>, JobError> {
    if pdfs.len() == 1 {
        return Ok(pdfs.swap_remove(0));
    }
    autoreleasepool(|_| {
        let documents = pdfs.iter().enumerate().map(|(index, bytes)| open(index, bytes)).collect::<Result<Vec<_>, _>>()?;
        let (merged, rest) = documents.split_first().ok_or_else(|| JobError::failure(errors::PDF_FAILED, "没有要合并的 PDF", None))?;
        for (index, document) in rest.iter().enumerate() {
            // SAFETY: 两份文档都是本函数里打开的有效对象，页序号都在页数之内
            unsafe {
                for page_index in 0..document.pageCount() {
                    let page = document.pageAtIndex(page_index).ok_or_else(|| {
                        JobError::failure(
                            errors::PDF_FAILED,
                            format!("第 {} 份 PDF 的第 {} 页读不出来", index + 2, page_index + 1),
                            Some(Details::new().with("part", index + 1)),
                        )
                    })?;
                    merged.insertPage_atIndex(&page, merged.pageCount());
                }
            }
        }
        // SAFETY: merged 是有效的 PDF 文档
        let data = unsafe { merged.dataRepresentation() }.ok_or_else(|| JobError::failure(errors::PDF_FAILED, "合并后的 PDF 写不出来", None))?;
        Ok(data.to_vec())
    })
}

/// 打开一份 PDF；读不出来时报 PDF_FAILED
fn open(index: usize, bytes: &[u8]) -> Result<objc2::rc::Retained<PDFDocument>, JobError> {
    // SAFETY: 数据是本函数里复制出的有效 NSData
    unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(bytes)) }
        .ok_or_else(|| JobError::failure(errors::PDF_FAILED, format!("第 {} 份 PDF 读不出来", index + 1), Some(Details::new().with("part", index))))
}
