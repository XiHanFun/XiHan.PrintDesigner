// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 日志：级别、写日志的接口，以及按天滚动的文本日志

use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use crate::time::{Clock, Timestamp};

/// 日志级别
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LogLevel {
    /// 调试
    Debug,
    /// 一般信息
    Information,
    /// 警告
    Warning,
    /// 错误
    Error,
}

impl LogLevel {
    /// 全部级别，从低到高
    pub const ALL: [LogLevel; 4] = [LogLevel::Debug, LogLevel::Information, LogLevel::Warning, LogLevel::Error];

    /// 设置文件里的写法
    pub fn name(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Information => "information",
            LogLevel::Warning => "warning",
            LogLevel::Error => "error",
        }
    }

    /// 按设置文件里的写法解析，不区分大小写
    pub fn parse(text: &str) -> Option<LogLevel> {
        LogLevel::ALL.into_iter().find(|level| level.name().eq_ignore_ascii_case(text))
    }

    fn tag(self) -> &'static str {
        match self {
            LogLevel::Debug => "DBG",
            LogLevel::Information => "INF",
            LogLevel::Warning => "WRN",
            LogLevel::Error => "ERR",
        }
    }

    fn from_u8(value: u8) -> LogLevel {
        LogLevel::ALL[usize::from(value).min(3)]
    }
}

/// 写日志；不写文档内容与原始指令内容
pub trait ClientLog: Send + Sync {
    /// 写一条日志，可附带出错原因
    fn write(&self, level: LogLevel, message: &str, error: Option<&dyn Error>);

    /// 调试
    fn debug(&self, message: &str) {
        self.write(LogLevel::Debug, message, None);
    }

    /// 一般信息
    fn info(&self, message: &str) {
        self.write(LogLevel::Information, message, None);
    }

    /// 警告
    fn warn(&self, message: &str) {
        self.write(LogLevel::Warning, message, None);
    }

    /// 错误
    fn error(&self, message: &str, error: Option<&dyn Error>) {
        self.write(LogLevel::Error, message, error);
    }
}

/// 共享的日志
pub type SharedLog = Arc<dyn ClientLog>;

/// 不写日志
pub struct NullLog;

impl ClientLog for NullLog {
    fn write(&self, _level: LogLevel, _message: &str, _error: Option<&dyn Error>) {}
}

/// 不写日志的共享实例
pub fn null_log() -> SharedLog {
    Arc::new(NullLog)
}

/// 记在内存里的日志，供测试核对
#[derive(Default)]
pub struct MemoryLog {
    lines: Mutex<Vec<(LogLevel, String)>>,
}

impl MemoryLog {
    /// 已写的日志
    pub fn lines(&self) -> Vec<(LogLevel, String)> {
        self.lines.lock().unwrap().clone()
    }
}

impl ClientLog for MemoryLog {
    fn write(&self, level: LogLevel, message: &str, error: Option<&dyn Error>) {
        let text = match error {
            Some(error) => format!("{message}：{}", describe(error)),
            None => message.to_owned(),
        };
        self.lines.lock().unwrap().push((level, text));
    }
}

/// 出错原因连同来源链写成一行
pub fn describe(error: &dyn Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        text.push_str(" ← ");
        text.push_str(&inner.to_string());
        source = inner.source();
    }
    text
}

const PREFIX: &str = "print-client-";
const EXTENSION: &str = ".log";

/// 写到日志目录的文本日志：每天一个文件 print-client-yyyyMMdd.log，换天时删掉超过保留天数的旧文件；写不进去时丢弃
pub struct FileLog {
    directory: PathBuf,
    retain_days: i64,
    clock: Arc<dyn Clock>,
    minimum: AtomicU8,
    state: Mutex<Option<(i64, File)>>,
}

impl FileLog {
    /// 创建日志；retain_days 含当天
    pub fn new(directory: impl Into<PathBuf>, minimum: LogLevel, retain_days: i64, clock: Arc<dyn Clock>) -> Self {
        FileLog {
            directory: directory.into(),
            retain_days,
            clock,
            minimum: AtomicU8::new(minimum as u8),
            state: Mutex::new(None),
        }
    }

    /// 日志目录
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// 低于这一级的不写
    pub fn minimum(&self) -> LogLevel {
        LogLevel::from_u8(self.minimum.load(Ordering::Relaxed))
    }

    /// 改最低级别
    pub fn set_minimum(&self, level: LogLevel) {
        self.minimum.store(level as u8, Ordering::Relaxed);
    }

    /// 某一天（本地日期）的日志文件名
    pub fn file_name(year: i64, month: u32, day: u32) -> String {
        format!("{PREFIX}{year:04}{month:02}{day:02}{EXTENSION}")
    }

    fn open(&self, day: i64, name: &str) -> std::io::Result<File> {
        fs::create_dir_all(&self.directory)?;
        self.purge(day);
        OpenOptions::new().create(true).append(true).open(self.directory.join(name))
    }

    fn purge(&self, today: i64) {
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };
        let oldest = today + 1 - self.retain_days;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(stamp) = name.to_str().and_then(|name| name.strip_prefix(PREFIX)).and_then(|rest| rest.strip_suffix(EXTENSION)) else {
                continue;
            };
            if let Some(day) = parse_day(stamp)
                && day < oldest
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn parse_day(stamp: &str) -> Option<i64> {
    if stamp.len() != 8 || !stamp.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let year = stamp[..4].parse().ok()?;
    let month = stamp[4..6].parse().ok()?;
    let day = stamp[6..].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(crate::time::days_from_civil(year, month, day))
}

impl ClientLog for FileLog {
    fn write(&self, level: LogLevel, message: &str, error: Option<&dyn Error>) {
        if level < self.minimum() {
            return;
        }
        let now: Timestamp = self.clock.now();
        let offset = self.clock.local_offset(now);
        let civil = now.civil(offset);
        let day = crate::time::days_from_civil(civil.year, civil.month, civil.day);
        let mut line = format!("{} [{}] {}\n", now.format_local_precise(offset), level.tag(), message);
        if let Some(error) = error {
            line.push_str(&describe(error));
            line.push('\n');
        }
        let mut state = self.state.lock().unwrap();
        if state.as_ref().is_none_or(|(current, _)| *current != day) {
            *state = self.open(day, &FileLog::file_name(civil.year, civil.month, civil.day)).ok().map(|file| (day, file));
        }
        if let Some((_, file)) = state.as_mut()
            && file.write_all(line.as_bytes()).and_then(|_| file.flush()).is_err()
        {
            *state = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::ManualClock;
    use std::time::Duration;

    fn temporary() -> PathBuf {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes).unwrap();
        std::env::temp_dir().join(format!("xihan-print-log-{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()))
    }

    #[test]
    fn writes_one_file_per_local_day_and_purges_old_files() {
        let directory = temporary();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("print-client-20261101.log"), "old").unwrap();
        fs::write(directory.join("print-client-20261106.log"), "kept").unwrap();
        fs::write(directory.join("other.log"), "kept").unwrap();
        let clock = Arc::new(ManualClock::new(Timestamp::from_utc(2026, 11, 18, 15, 59, 0), 8 * 3600));
        let log = FileLog::new(&directory, LogLevel::Information, 14, clock.clone());

        log.debug("不写");
        log.info("第一天");
        clock.advance(Duration::from_secs(120));
        log.warn("第二天");

        let first = fs::read_to_string(directory.join("print-client-20261118.log")).unwrap();
        assert!(first.starts_with("2026-11-18 23:59:00.000 +08:00 [INF] 第一天"));
        assert!(!first.contains("不写"));
        let second = fs::read_to_string(directory.join("print-client-20261119.log")).unwrap();
        assert!(second.contains("[WRN] 第二天"));
        assert!(!directory.join("print-client-20261101.log").exists());
        assert!(directory.join("print-client-20261106.log").exists());
        assert!(directory.join("other.log").exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn parses_levels_without_case() {
        assert_eq!(LogLevel::parse("Warning"), Some(LogLevel::Warning));
        assert_eq!(LogLevel::parse("verbose"), None);
    }
}
