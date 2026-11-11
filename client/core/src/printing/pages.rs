// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 按 pageRanges 与 pageSet 选中的输出页：一页一张，页码从 1 起；超出总页数的部分不算

use crate::protocol::codes::errors;
use crate::protocol::{Details, PageSet, PrintOptions, ProtocolError};

/// 选中的输出页
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageSelection {
    selected: Vec<bool>,
}

impl PageSelection {
    /// 按选项里的页码范围与奇偶页选页；一页都没选中时给出 BAD_REQUEST，field 指到是哪一项让它落空
    pub fn from_options(options: &PrintOptions, total: u32) -> Result<PageSelection, ProtocolError> {
        let empty = |field: &str| {
            ProtocolError::new(errors::BAD_REQUEST, format!("页码范围在 {total} 页里一页都没选中")).with_details(Details::new().with("field", format!("options.{field}")))
        };
        let selection = PageSelection::parse(options.page_ranges.as_deref(), total).ok_or_else(|| empty("pageRanges"))?;
        selection.with_page_set(options.page_set).ok_or_else(|| empty("pageSet"))
    }

    /// 只留奇数页或偶数页（按全文页码）；一页都不剩时为 None
    pub fn with_page_set(mut self, set: PageSet) -> Option<PageSelection> {
        let keep = |index: usize| match set {
            PageSet::All => true,
            PageSet::Odd => index.is_multiple_of(2),
            PageSet::Even => !index.is_multiple_of(2),
        };
        for (index, item) in self.selected.iter_mut().enumerate() {
            *item = *item && keep(index);
        }
        if self.count() == 0 { None } else { Some(self) }
    }

    /// 解析页码范围，如 1-3,5；缺省为全部。写法不对、页码为 0、起页大于止页或一页都没选中时为 None
    pub fn parse(ranges: Option<&str>, total: u32) -> Option<PageSelection> {
        let total = total as usize;
        let ranges = match ranges {
            None | Some("") => return Some(PageSelection { selected: vec![true; total] }),
            Some(ranges) => ranges,
        };
        let mut selected = vec![false; total];
        for part in ranges.split(',') {
            let bounds: Vec<&str> = part.split('-').collect();
            if bounds.len() > 2 {
                return None;
            }
            let first: u64 = parse_page(bounds[0])?;
            let last = match bounds.get(1) {
                Some(text) => parse_page(text)?,
                None => first,
            };
            if first < 1 || last < first {
                return None;
            }
            let end = last.min(total as u64);
            for page in first..=end {
                selected[page as usize - 1] = true;
            }
        }
        let selection = PageSelection { selected };
        if selection.count() == 0 { None } else { Some(selection) }
    }

    /// 选中的页数
    pub fn count(&self) -> u32 {
        self.selected.iter().filter(|item| **item).count() as u32
    }

    /// 是否选中了全部
    pub fn is_all(&self) -> bool {
        self.selected.iter().all(|item| *item)
    }

    /// 第几页（从 0 起）是否选中
    pub fn contains(&self, index: usize) -> bool {
        self.selected.get(index).copied().unwrap_or(false)
    }

    /// 全文里选中的页码（从 1 起）写成页码范围，如 1-3,5；全选时为空串
    pub fn ranges(&self) -> String {
        self.ranges_in(0, self.selected.len()).unwrap_or_default()
    }

    /// 一段连续输出页里选中的页，按全文页码（从 1 起）写成页码范围；一页都没选中时为 None
    pub fn absolute_ranges_in(&self, start: usize, count: usize) -> Option<String> {
        let span = &self.selected[start..start + count];
        if !span.contains(&true) {
            return None;
        }
        Some(format_ranges(span, start + 1))
    }

    /// 在一段连续输出页 [start, start + count) 里选中的页数
    pub fn count_in(&self, start: usize, count: usize) -> u32 {
        self.selected[start..start + count].iter().filter(|item| **item).count() as u32
    }

    /// 一段连续输出页里选中的页，换成以这一段为准的页码范围；全选时为空串，一页都没选中时为 None
    pub fn ranges_in(&self, start: usize, count: usize) -> Option<String> {
        let span = &self.selected[start..start + count];
        if !span.contains(&true) {
            return None;
        }
        if !span.contains(&false) {
            return Some(String::new());
        }
        Some(format_ranges(span, 1))
    }
}

/// 把选中标记写成页码范围，第一项的页码是 first
fn format_ranges(span: &[bool], first: usize) -> String {
    let mut text = String::new();
    let mut index = 0;
    while index < span.len() {
        if !span[index] {
            index += 1;
            continue;
        }
        let mut end = index;
        while end + 1 < span.len() && span[end + 1] {
            end += 1;
        }
        if !text.is_empty() {
            text.push(',');
        }
        text.push_str(&(index + first).to_string());
        if end > index {
            text.push('-');
            text.push_str(&(end + first).to_string());
        }
        index = end + 1;
    }
    text
}

fn parse_page(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse::<u64>().ok().filter(|page| *page <= i32::MAX as u64)
}

#[cfg(test)]
mod tests {
    use super::PageSelection;
    use crate::protocol::{PageSet, PrintOptions};

    #[test]
    fn selects_all_pages_by_default() {
        let selection = PageSelection::parse(None, 3).unwrap();
        assert!(selection.is_all());
        assert_eq!(selection.ranges_in(0, 3), Some(String::new()));
    }

    #[test]
    fn maps_ranges_into_each_group() {
        let selection = PageSelection::parse(Some("2-4,6,9-20"), 10).unwrap();
        assert_eq!(selection.count(), 6);
        assert_eq!(selection.ranges_in(0, 3), Some("2-3".into()));
        assert_eq!(selection.ranges_in(3, 3), Some("1,3".into()));
        assert_eq!(selection.ranges_in(6, 2), None);
        assert_eq!(selection.ranges_in(8, 2), Some(String::new()));
        assert_eq!(selection.count_in(3, 3), 2);
    }

    #[test]
    fn keeps_odd_or_even_pages_by_their_page_number() {
        let odd = PageSelection::parse(Some("2-5"), 6).unwrap().with_page_set(PageSet::Odd).unwrap();
        assert_eq!(odd.ranges(), "3,5");
        let even = PageSelection::parse(None, 5).unwrap().with_page_set(PageSet::Even).unwrap();
        assert_eq!(even.ranges(), "2,4");
        assert_eq!(even.ranges_in(2, 3), Some("2".into()));
        assert_eq!(even.absolute_ranges_in(2, 3), Some("4".into()));
        assert_eq!(PageSelection::parse(None, 3).unwrap().with_page_set(PageSet::All).unwrap().ranges(), "");
        assert_eq!(PageSelection::parse(Some("3"), 3).unwrap().with_page_set(PageSet::Even), None);
    }

    #[test]
    fn names_the_option_that_leaves_nothing_selected() {
        let field = |options: &PrintOptions| PageSelection::from_options(options, 3).unwrap_err().details.unwrap().get("field").cloned();
        let ranges = PrintOptions {
            page_ranges: Some("7".into()),
            ..PrintOptions::default()
        };
        assert_eq!(field(&ranges), Some(serde_json::json!("options.pageRanges")));
        let set = PrintOptions {
            page_ranges: Some("1".into()),
            page_set: PageSet::Even,
            ..PrintOptions::default()
        };
        assert_eq!(field(&set), Some(serde_json::json!("options.pageSet")));
        assert_eq!(PageSelection::from_options(&PrintOptions::default(), 3).unwrap().count(), 3);
    }

    #[test]
    fn writes_absolute_ranges_for_a_span() {
        let selection = PageSelection::parse(Some("2-4,6"), 8).unwrap();
        assert_eq!(selection.absolute_ranges_in(3, 4), Some("4,6".into()));
        assert_eq!(selection.absolute_ranges_in(0, 1), None);
        assert_eq!(selection.ranges(), "2-4,6");
    }

    #[test]
    fn rejects_invalid_or_empty_selections() {
        assert_eq!(PageSelection::parse(Some("0"), 3), None);
        assert_eq!(PageSelection::parse(Some("3-2"), 3), None);
        assert_eq!(PageSelection::parse(Some("4-9"), 3), None);
        assert_eq!(PageSelection::parse(Some("1-2-3"), 3), None);
        assert_eq!(PageSelection::parse(Some("99999999999"), 3), None);
    }
}
