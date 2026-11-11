// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 计划检查更新：启动后 FIRST_DELAY 查一次，之后每隔 PERIOD 查一次；当前不允许检查时这一轮跳过

use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::BoxFuture;
use crate::cancel::Cancel;

/// 启动后第一次检查的延迟
pub const FIRST_DELAY: Duration = Duration::from_secs(120);

/// 之后检查的间隔
pub const PERIOD: Duration = Duration::from_secs(24 * 3600);

/// 一次检查更新的来源
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateTrigger {
    /// 计划检查
    Automatic,
    /// 用户点了检查更新
    Manual,
}

impl UpdateTrigger {
    /// 写进日志的说法
    pub fn label(self) -> &'static str {
        match self {
            UpdateTrigger::Automatic => "自动",
            UpdateTrigger::Manual => "手动",
        }
    }
}

type Check = Arc<dyn Fn(Cancel) -> BoxFuture<'static, ()> + Send + Sync>;
type Enabled = Arc<dyn Fn() -> bool + Send + Sync>;

/// 计划检查更新；丢弃或 stop 时停止
pub struct UpdateScheduler {
    stopping: Cancel,
    task: JoinHandle<()>,
}

impl UpdateScheduler {
    /// 开始计划检查；check 每次都按自动检查执行，enabled 返回 false 时这一轮跳过
    pub fn start(check: Check, enabled: Enabled) -> UpdateScheduler {
        let stopping = Cancel::new();
        let task = tokio::spawn({
            let stopping = stopping.clone();
            async move {
                let mut delay = FIRST_DELAY;
                loop {
                    if stopping.run(tokio::time::sleep(delay)).await.is_err() {
                        return;
                    }
                    delay = PERIOD;
                    if enabled() && stopping.run(check(stopping.clone())).await.is_err() {
                        return;
                    }
                }
            }
        });
        UpdateScheduler { stopping, task }
    }

    /// 停止计划检查
    pub fn stop(&self) {
        self.stopping.cancel();
    }
}

impl Drop for UpdateScheduler {
    fn drop(&mut self) {
        self.stopping.cancel();
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[tokio::test(start_paused = true)]
    async fn checks_after_the_first_delay_then_daily_and_skips_when_disabled() {
        let count = Arc::new(AtomicUsize::new(0));
        let enabled = Arc::new(AtomicBool::new(true));
        let scheduler = UpdateScheduler::start(
            {
                let count = count.clone();
                Arc::new(move |_| {
                    let count = count.clone();
                    Box::pin(async move {
                        count.fetch_add(1, Ordering::SeqCst);
                    })
                })
            },
            {
                let enabled = enabled.clone();
                Arc::new(move || enabled.load(Ordering::SeqCst))
            },
        );
        tokio::time::sleep(FIRST_DELAY - Duration::from_secs(1)).await;
        assert_eq!(count.load(Ordering::SeqCst), 0);
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(count.load(Ordering::SeqCst), 1);
        enabled.store(false, Ordering::SeqCst);
        tokio::time::sleep(PERIOD).await;
        assert_eq!(count.load(Ordering::SeqCst), 1);
        enabled.store(true, Ordering::SeqCst);
        tokio::time::sleep(PERIOD).await;
        assert_eq!(count.load(Ordering::SeqCst), 2);
        scheduler.stop();
        tokio::time::sleep(PERIOD * 2).await;
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
}
