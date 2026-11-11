// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 打印：各平台要实现的接口、页码选择、纸张核对、任务队列与业务请求的处理

mod backends;
mod handler;
mod job;
mod pages;
mod paper;
mod queue;
pub mod selftest;

pub use backends::*;
pub use handler::{PrintRequestHandler, RequestExtension};
pub use job::{Job, JobKind, JobOwner, JobPayload, JobRecord};
pub use pages::PageSelection;
pub use paper::{PaperFeed, PaperPlan, TOLERANCE_MM, plan as plan_papers};
pub use queue::{CompletionTracker, JobObserver, JobQueue, JobQueueOptions};

#[cfg(test)]
mod tests;
