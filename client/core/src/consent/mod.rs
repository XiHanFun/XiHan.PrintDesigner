// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 来源授权：管理员策略、用户的允许与拒绝名单，以及弹授权窗口询问用户

mod authorizer;
pub mod jsonc;
mod lists;
mod policy;

pub use authorizer::{Authorizer, ConsentChoice, ConsentPrompt};
pub use lists::OriginLists;
pub use policy::{ClientPolicy, is_https_url};
