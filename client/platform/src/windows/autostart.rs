// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 开机自启：当前用户 Run 键下的 XiHanPrint，值为带引号的程序路径加 --autostart

use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW};
use windows::core::HSTRING;

/// 当前用户的 Run 键
pub(crate) const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/// Run 键下这一项的名字
pub(crate) const VALUE_NAME: &str = "XiHanPrint";

/// 写进 Run 键的启动命令
pub(crate) fn command() -> String {
    let executable = std::env::current_exe().map(|path| path.display().to_string()).unwrap_or_default();
    format!("\"{executable}\" {}", crate::autostart::ARGUMENT)
}

/// Run 键里是否有指向本程序的这一项
pub(crate) fn is_enabled() -> bool {
    read(RUN_KEY, VALUE_NAME).is_some_and(|value| value.eq_ignore_ascii_case(&command()))
}

/// 打开或关掉开机自启
pub(crate) fn set(enabled: bool) -> std::io::Result<()> {
    let key = HSTRING::from(RUN_KEY);
    let name = HSTRING::from(VALUE_NAME);
    let result = if enabled {
        let value: Vec<u16> = command().encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: value 以 0 结尾，长度按字节给出
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, &key, &name, REG_SZ.0, Some(value.as_ptr().cast()), (value.len() * 2) as u32) }
    } else {
        // SAFETY: 键名与值名在调用期间有效
        match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, &name) } {
            ERROR_FILE_NOT_FOUND => ERROR_SUCCESS,
            other => other,
        }
    };
    if result == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(std::io::Error::from_raw_os_error(result.0 as i32))
    }
}

fn read(key: &str, name: &str) -> Option<String> {
    let key = HSTRING::from(key);
    let name = HSTRING::from(name);
    let mut size = 0u32;
    // SAFETY: 先只问长度
    let probed = unsafe { RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, None, Some(&mut size)) };
    if probed != ERROR_SUCCESS || size == 0 {
        return None;
    }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    // SAFETY: buffer 按上面问到的字节数分配
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)) };
    if read != ERROR_SUCCESS {
        return None;
    }
    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}
