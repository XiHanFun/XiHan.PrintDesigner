// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 时间：UTC 毫秒时间戳、时钟接口与几种固定写法

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// UTC 时间戳，自 1970-01-01T00:00:00Z 起的毫秒数
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(pub i64);

/// 按年月日时分秒毫秒拆开的时间
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilTime {
    /// 年
    pub year: i64,
    /// 月，1–12
    pub month: u32,
    /// 日，1–31
    pub day: u32,
    /// 时
    pub hour: u32,
    /// 分
    pub minute: u32,
    /// 秒
    pub second: u32,
    /// 毫秒
    pub millisecond: u32,
}

impl Timestamp {
    /// 由年月日时分秒（UTC）得出时间戳
    pub fn from_utc(year: i64, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Self {
        let days = days_from_civil(year, month, day);
        Timestamp(((days * 86_400) + i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second)) * 1_000)
    }

    /// 加上一段时长
    pub fn plus(self, duration: Duration) -> Self {
        Timestamp(self.0 + i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
    }

    /// 与更早的时间之间的时长；早于它时为 0
    pub fn since(self, earlier: Timestamp) -> Duration {
        Duration::from_millis(u64::try_from(self.0 - earlier.0).unwrap_or(0))
    }

    /// 按给定的偏移（秒）拆成年月日时分秒
    pub fn civil(self, offset_seconds: i32) -> CivilTime {
        let millis = self.0 + i64::from(offset_seconds) * 1_000;
        let days = millis.div_euclid(86_400_000);
        let rest = millis.rem_euclid(86_400_000);
        let (year, month, day) = civil_from_days(days);
        CivilTime {
            year,
            month,
            day,
            hour: (rest / 3_600_000) as u32,
            minute: (rest / 60_000 % 60) as u32,
            second: (rest / 1_000 % 60) as u32,
            millisecond: (rest % 1_000) as u32,
        }
    }

    /// RFC 3339 的 UTC 写法，带毫秒，如 2026-11-11T08:00:00.123Z
    pub fn to_rfc3339(self) -> String {
        let t = self.civil(0);
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
            t.year, t.month, t.day, t.hour, t.minute, t.second, t.millisecond
        )
    }

    /// 本地时间 yyyy-MM-dd HH:mm:ss
    pub fn format_local(self, offset_seconds: i32) -> String {
        let t = self.civil(offset_seconds);
        format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second)
    }

    /// 本地时间 yyyy-MM-dd HH:mm:ss.fff +08:00
    pub fn format_local_precise(self, offset_seconds: i32) -> String {
        let t = self.civil(offset_seconds);
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03} {}",
            t.year,
            t.month,
            t.day,
            t.hour,
            t.minute,
            t.second,
            t.millisecond,
            format_offset(offset_seconds)
        )
    }
}

/// 偏移的写法，如 +08:00、-05:30
pub fn format_offset(offset_seconds: i32) -> String {
    let sign = if offset_seconds < 0 { '-' } else { '+' };
    let minutes = offset_seconds.unsigned_abs() / 60;
    format!("{sign}{:02}:{:02}", minutes / 60, minutes % 60)
}

/// 自 1970-01-01 起的天数，按公历推算
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// 由自 1970-01-01 起的天数得出年月日
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// 时钟：当前 UTC 时间与某一时刻的本地时区偏移
pub trait Clock: Send + Sync {
    /// 当前时间
    fn now(&self) -> Timestamp;

    /// 某一时刻本地时间相对 UTC 的偏移，秒
    fn local_offset(&self, at: Timestamp) -> i32;
}

/// 系统时钟；本地时区偏移由平台给出
pub struct SystemClock {
    offset: fn(Timestamp) -> i32,
}

impl SystemClock {
    /// 以平台查本地时区偏移的函数创建
    pub fn new(offset: fn(Timestamp) -> i32) -> Self {
        SystemClock { offset }
    }

    /// 按 UTC 显示本地时间的系统时钟
    pub fn utc() -> Self {
        SystemClock { offset: |_| 0 }
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        Timestamp(i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
    }

    fn local_offset(&self, at: Timestamp) -> i32 {
        (self.offset)(at)
    }
}

/// 手动拨动的时钟，供测试
pub struct ManualClock {
    now: Mutex<Timestamp>,
    offset: i32,
}

impl ManualClock {
    /// 从给定时间开始，本地时区偏移固定
    pub fn new(start: Timestamp, offset_seconds: i32) -> Self {
        ManualClock {
            now: Mutex::new(start),
            offset: offset_seconds,
        }
    }

    /// 往后拨一段时长
    pub fn advance(&self, duration: Duration) {
        let mut now = self.now.lock().unwrap();
        *now = now.plus(duration);
    }

    /// 拨到给定时间
    pub fn set(&self, at: Timestamp) {
        *self.now.lock().unwrap() = at;
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Timestamp {
        *self.now.lock().unwrap()
    }

    fn local_offset(&self, _at: Timestamp) -> i32 {
        self.offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_between_civil_dates_and_days() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        for days in [-1_000_000, -1, 0, 59, 60, 11_016, 20_000, 2_000_000] {
            let (year, month, day) = civil_from_days(days);
            assert_eq!(days_from_civil(year, month, day), days);
        }
    }

    #[test]
    fn writes_the_fixed_formats() {
        let at = Timestamp::from_utc(2026, 11, 11, 23, 30, 5).plus(Duration::from_millis(7));
        assert_eq!(at.to_rfc3339(), "2026-11-11T23:30:05.007Z");
        assert_eq!(at.format_local(8 * 3600), "2026-11-12 07:30:05");
        assert_eq!(at.format_local_precise(-(5 * 3600 + 1800)), "2026-11-11 18:00:05.007 -05:30");
    }
}
