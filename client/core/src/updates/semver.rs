// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 语义化版本 主.次.修订[-预发布]，构建元数据（+ 之后）忽略；预发布版低于同号正式版

use std::cmp::Ordering;
use std::fmt;

/// 语义化版本
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SemanticVersion {
    /// 主版本
    pub major: u64,
    /// 次版本
    pub minor: u64,
    /// 修订号
    pub patch: u64,
    /// 预发布后缀，如 rc.1
    pub prerelease: Option<String>,
}

impl SemanticVersion {
    /// 解析版本；写法不对时为 None
    pub fn parse(text: &str) -> Option<SemanticVersion> {
        let core = text.trim().split('+').next()?;
        let (numbers, prerelease) = match core.split_once('-') {
            Some((numbers, prerelease)) => (numbers, Some(prerelease)),
            None => (core, None),
        };
        if let Some(prerelease) = prerelease
            && (prerelease.is_empty()
                || prerelease
                    .split('.')
                    .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')))
        {
            return None;
        }
        let parts: Vec<&str> = numbers.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        let mut values = [0u64; 3];
        for (index, part) in parts.iter().enumerate() {
            if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            values[index] = part.parse().ok()?;
        }
        Some(SemanticVersion {
            major: values[0],
            minor: values[1],
            patch: values[2],
            prerelease: prerelease.map(str::to_owned),
        })
    }

    /// 是否比另一个版本新
    pub fn is_newer_than(&self, other: &SemanticVersion) -> bool {
        self > other
    }
}

impl PartialOrd for SemanticVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SemanticVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (&self.prerelease, &other.prerelease) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(mine), Some(theirs)) => {
                    let mine: Vec<&str> = mine.split('.').collect();
                    let theirs: Vec<&str> = theirs.split('.').collect();
                    for (left, right) in mine.iter().zip(theirs.iter()) {
                        let numeric = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit()).then(|| part.parse::<u64>().ok()).flatten();
                        let order = match (numeric(left).ok_or(()), numeric(right).ok_or(())) {
                            (Ok(left), Ok(right)) => left.cmp(&right),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            _ => left.cmp(right),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                    mine.len().cmp(&theirs.len())
                }
            })
    }
}

impl fmt::Display for SemanticVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(prerelease) = &self.prerelease {
            write!(f, "-{prerelease}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::SemanticVersion;

    fn v(text: &str) -> SemanticVersion {
        SemanticVersion::parse(text).unwrap()
    }

    #[test]
    fn parses_and_ignores_build_metadata() {
        assert_eq!(v("1.2.3-rc.1+abc").to_string(), "1.2.3-rc.1");
        for bad in ["", "1.2", "1.2.3.4", "1.2.x", "1.2.3-", "1.2.3-a..b", "v1.2.3"] {
            assert!(SemanticVersion::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn orders_prereleases_below_releases() {
        assert!(v("1.0.0").is_newer_than(&v("1.0.0-rc.9")));
        assert!(v("1.0.0-rc.10").is_newer_than(&v("1.0.0-rc.9")));
        assert!(v("1.0.0-rc.1").is_newer_than(&v("1.0.0-beta.9")));
        assert!(v("1.0.0-rc").is_newer_than(&v("1.0.0-1")));
        assert!(v("1.0.0-rc.1.1").is_newer_than(&v("1.0.0-rc.1")));
        assert!(v("1.10.0").is_newer_than(&v("1.9.9")));
        assert!(!v("1.0.0").is_newer_than(&v("1.0.0+other")));
    }
}
