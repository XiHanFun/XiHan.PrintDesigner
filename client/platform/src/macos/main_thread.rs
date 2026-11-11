// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 主线程：AppKit 与 WebKit 只能在主线程上调用，经主队列异步派发过去，结果经 oneshot 送回

use std::mem::ManuallyDrop;

use dispatch2::{DispatchQueue, MainThreadBound};
use objc2::MainThreadMarker;
use tokio::sync::oneshot;
use xihan_print_client_core::printing::JobError;
use xihan_print_client_core::protocol::codes::errors;

/// 只能在主线程上使用的值：可以在线程间传递，只在主线程上取用；释放时转到主线程上异步释放，不阻塞释放它的线程
pub(super) struct OnMain<T: 'static>(ManuallyDrop<MainThreadBound<T>>);

impl<T: 'static> OnMain<T> {
    /// 在主线程上包起一个值
    pub(super) fn new(value: T, mtm: MainThreadMarker) -> Self {
        OnMain(ManuallyDrop::new(MainThreadBound::new(value, mtm)))
    }

    /// 在主线程上取用
    pub(super) fn get(&self, mtm: MainThreadMarker) -> &T {
        self.0.get(mtm)
    }
}

impl<T: 'static> Drop for OnMain<T> {
    fn drop(&mut self) {
        // SAFETY: drop 只执行一次，取出之后 self.0 不再使用
        let bound = unsafe { ManuallyDrop::take(&mut self.0) };
        DispatchQueue::main().exec_async(move || drop(bound));
    }
}

/// 把一段工作派发到主线程上执行，等它的结果；主线程没有执行就丢弃了这段工作时报 RENDER_FAILED
pub(super) async fn on_main<R, F>(work: F) -> Result<R, JobError>
where
    R: Send + 'static,
    F: FnOnce(MainThreadMarker) -> R + Send + 'static,
{
    let (sender, receiver) = oneshot::channel();
    DispatchQueue::main().exec_async(move || {
        // SAFETY: 主队列上的工作只在主线程上执行
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let _ = sender.send(work(mtm));
    });
    receiver.await.map_err(|_| JobError::failure(errors::RENDER_FAILED, "主线程没有回复", None))
}

/// 等一个由主线程回调送回的结果；回调没有送回就被释放时报 RENDER_FAILED
pub(super) async fn reply<T>(receiver: oneshot::Receiver<Result<T, JobError>>, what: &str) -> Result<T, JobError> {
    receiver
        .await
        .unwrap_or_else(|_| Err(JobError::failure(errors::RENDER_FAILED, format!("{what}没有回复"), None)))
}
