// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! WebView2 固定版运行时：离线安装包把它装在程序所在目录的 WebView2 子目录里

use std::path::{Path, PathBuf};

/// 固定版运行时在程序目录下的子目录名
const DIRECTORY: &str = "WebView2";

/// 固定版运行时的浏览器程序
const BROWSER: &str = "msedgewebview2.exe";

/// 程序所在目录下装着固定版运行时时返回运行时目录；没有时为 None
pub(crate) fn find() -> Option<PathBuf> {
    let program = std::env::current_exe().ok()?;
    in_directory(program.parent()?)
}

/// 某个目录下的 WebView2 子目录里有 msedgewebview2.exe 时返回这个子目录
fn in_directory(directory: &Path) -> Option<PathBuf> {
    let runtime = directory.join(DIRECTORY);
    runtime.join(BROWSER).is_file().then_some(runtime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_runtime_only_when_the_browser_is_there() {
        let directory = std::env::temp_dir().join(format!("xihan-print-fixed-runtime-{}", std::process::id()));
        let runtime = directory.join(DIRECTORY);
        std::fs::create_dir_all(&runtime).unwrap();
        assert_eq!(in_directory(&directory), None);
        std::fs::create_dir_all(runtime.join(BROWSER)).unwrap();
        assert_eq!(in_directory(&directory), None);
        std::fs::remove_dir(runtime.join(BROWSER)).unwrap();
        std::fs::write(runtime.join(BROWSER), b"").unwrap();
        assert_eq!(in_directory(&directory), Some(runtime));
        let _ = std::fs::remove_dir_all(directory);
    }
}
