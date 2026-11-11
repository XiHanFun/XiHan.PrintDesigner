// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 按 pageRanges 选中的输出页：一页一张，页码从 1 起；超出总页数的部分不算

/// 选中的输出页
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageSelection {
    selected: Vec<bool>,
}

impl PageSelection {
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
            text.push_str(&(index + 1).to_string());
            if end > index {
                text.push('-');
                text.push_str(&(end + 1).to_string());
            }
            index = end + 1;
        }
        Some(text)
    }
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
    fn rejects_invalid_or_empty_selections() {
        assert_eq!(PageSelection::parse(Some("0"), 3), None);
        assert_eq!(PageSelection::parse(Some("3-2"), 3), None);
        assert_eq!(PageSelection::parse(Some("4-9"), 3), None);
        assert_eq!(PageSelection::parse(Some("1-2-3"), 3), None);
        assert_eq!(PageSelection::parse(Some("99999999999"), 3), None);
    }
}
