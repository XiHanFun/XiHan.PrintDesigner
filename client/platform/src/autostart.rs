// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 开机自启：Windows 上是当前用户 Run 键下的 XiHanPrint，macOS 上是 LaunchAgents 里的 plist，Linux 上是 XDG autostart 里的 .desktop

/// 自启时附带的参数
pub const ARGUMENT: &str = "--autostart";

/// 是否登记了指向本程序的开机自启
pub fn is_enabled() -> bool {
    #[cfg(windows)]
    return crate::windows::autostart::is_enabled();
    #[cfg(target_os = "macos")]
    return crate::macos::autostart::is_enabled();
    #[cfg(target_os = "linux")]
    return crate::linux::autostart::is_enabled();
}

/// 打开或关掉开机自启
pub fn set(enabled: bool) -> std::io::Result<()> {
    #[cfg(windows)]
    return crate::windows::autostart::set(enabled);
    #[cfg(target_os = "macos")]
    return crate::macos::autostart::set(enabled);
    #[cfg(target_os = "linux")]
    return crate::linux::autostart::set(enabled);
}
