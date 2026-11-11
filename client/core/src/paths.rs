// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 客户端在本机读写的目录与文件位置；各平台给出自己的根目录

use std::path::PathBuf;

/// 客户端在本机读写的目录与文件
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppPaths {
    /// 用户设置所在的目录：允许名单、拒绝名单与界面设置
    pub settings_directory: PathBuf,
    /// 日志目录
    pub log_directory: PathBuf,
    /// 渲染引擎的数据目录
    pub renderer_data_directory: PathBuf,
    /// 下载的更新安装包所在的目录
    pub update_directory: PathBuf,
    /// 扩展自己的数据目录的上级
    pub data_directory: PathBuf,
    /// 管理员下发的策略文件，不存在即没有策略
    pub policy_file: PathBuf,
}

impl AppPaths {
    /// settings.json
    pub fn settings_file(&self) -> PathBuf {
        self.settings_directory.join("settings.json")
    }

    /// origins.json
    pub fn origins_file(&self) -> PathBuf {
        self.settings_directory.join("origins.json")
    }
}
