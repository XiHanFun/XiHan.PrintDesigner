// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 取消令牌：可派生子令牌，父令牌取消时子令牌一并取消

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

use tokio::sync::Notify;

/// 取消令牌；克隆的令牌是同一个
#[derive(Clone, Default)]
pub struct Cancel {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    notify: Notify,
    children: Mutex<Vec<Weak<Inner>>>,
}

/// 操作因令牌取消而中止
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("操作已取消")
    }
}

impl std::error::Error for Cancelled {}

impl Cancel {
    /// 新建一个未取消的令牌
    pub fn new() -> Self {
        Cancel::default()
    }

    /// 派生子令牌：父令牌取消时它也取消，它自己取消不影响父令牌
    pub fn child(&self) -> Cancel {
        let child = Cancel::new();
        let mut children = self.inner.children.lock().unwrap();
        children.retain(|item| item.strong_count() > 0);
        children.push(Arc::downgrade(&child.inner));
        drop(children);
        if self.is_cancelled() {
            child.cancel();
        }
        child
    }

    /// 取消，连同所有子令牌
    pub fn cancel(&self) {
        Inner::cancel(&self.inner);
    }

    /// 是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::Acquire)
    }

    /// 等到取消
    pub async fn cancelled(&self) {
        loop {
            let notified = self.inner.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    /// 执行一段异步操作，取消时立即放弃并返回 Cancelled
    pub async fn run<F: Future>(&self, future: F) -> Result<F::Output, Cancelled> {
        tokio::select! {
            biased;
            _ = self.cancelled() => Err(Cancelled),
            value = future => Ok(value),
        }
    }
}

impl Inner {
    fn cancel(inner: &Arc<Inner>) {
        if inner.cancelled.swap(true, Ordering::AcqRel) {
            return;
        }
        inner.notify.notify_waiters();
        let children: Vec<_> = inner.children.lock().unwrap().drain(..).collect();
        for child in children.iter().filter_map(Weak::upgrade) {
            Inner::cancel(&child);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn cancels_children_and_wakes_waiters() {
        let parent = Cancel::new();
        let child = parent.child();
        let waiting = tokio::spawn({
            let child = child.clone();
            async move { child.cancelled().await }
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        parent.cancel();
        waiting.await.unwrap();
        assert!(child.is_cancelled());
        assert_eq!(child.run(std::future::pending::<()>()).await, Err(Cancelled));
    }

    #[test]
    fn child_of_a_cancelled_token_starts_cancelled() {
        let parent = Cancel::new();
        parent.cancel();
        assert!(parent.child().is_cancelled());
        let other = Cancel::new();
        other.child().cancel();
        assert!(!other.is_cancelled());
    }
}
