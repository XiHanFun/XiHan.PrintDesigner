// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 更新：语义化版本、更新清单、检查与下载、计划检查

mod checker;
mod manifest;
mod scheduler;
mod semver;

pub use checker::{DEFAULT_MANIFESTS, HttpClient, HttpResponse, UpdateCheckResult, UpdateChecker, UpdateFailure, UpdateOffer};
pub use manifest::{MAX_ASSET_BYTES, MAX_MANIFEST_BYTES, OFFLINE_VARIANT, UpdateAsset, UpdateManifest};
pub use scheduler::{FIRST_DELAY, PERIOD, UpdateScheduler, UpdateTrigger};
pub use semver::SemanticVersion;
