// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 开机自启：~/Library/LaunchAgents/com.xihanfun.printclient.plist，登录时以 --autostart 启动本程序

use std::fs;
use std::io;
use std::path::PathBuf;

use objc2_foundation::{NSBundle, NSHomeDirectory};

use crate::autostart::ARGUMENT;

/// launchd 里的任务名，也是 plist 的文件名
const LABEL: &str = "com.xihanfun.printclient";

/// 是否登记了指向本程序的开机自启：plist 的 ProgramArguments 是本程序加 --autostart
pub(crate) fn is_enabled() -> bool {
    let Ok(program) = program() else {
        return false;
    };
    let Ok(text) = fs::read_to_string(plist_path()) else {
        return false;
    };
    program_arguments(&text).is_some_and(|arguments| arguments == [program.to_string_lossy().as_ref(), ARGUMENT])
}

/// 打开时写 plist，关掉时删掉它；改动在下次登录时生效
pub(crate) fn set(enabled: bool) -> io::Result<()> {
    let path = plist_path();
    if !enabled {
        return match fs::remove_file(&path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        };
    }
    let program = program()?;
    let program = program
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, format!("程序路径不是 UTF-8：{}", program.display())))?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }
    let staging = path.with_extension("plist.tmp");
    fs::write(&staging, plist(program))?;
    fs::rename(&staging, &path)
}

/// plist 的位置
fn plist_path() -> PathBuf {
    PathBuf::from(NSHomeDirectory().to_string()).join("Library/LaunchAgents").join(format!("{LABEL}.plist"))
}

/// 自启要运行的程序：在 .app 包里时是包里的可执行文件，否则是当前程序
fn program() -> io::Result<PathBuf> {
    let bundle = NSBundle::mainBundle();
    if bundle.bundlePath().to_string().ends_with(".app")
        && let Some(executable) = bundle.executablePath()
    {
        return Ok(PathBuf::from(executable.to_string()));
    }
    std::env::current_exe()
}

/// 以程序路径写出 plist：RunAtLoad 为真，ProgramArguments 是程序加 --autostart
fn plist(program: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n\
         <dict>\n\
         \t<key>Label</key>\n\
         \t<string>{LABEL}</string>\n\
         \t<key>ProgramArguments</key>\n\
         \t<array>\n\
         \t\t<string>{}</string>\n\
         \t\t<string>{ARGUMENT}</string>\n\
         \t</array>\n\
         \t<key>RunAtLoad</key>\n\
         \t<true/>\n\
         </dict>\n\
         </plist>\n",
        escape(program)
    )
}

/// 读出 plist 里 ProgramArguments 的各项；没有这一项或格式不对时为 None
fn program_arguments(text: &str) -> Option<Vec<String>> {
    let after_key = &text[text.find("<key>ProgramArguments</key>")? + "<key>ProgramArguments</key>".len()..];
    let body = after_key.trim_start().strip_prefix("<array>")?;
    let body = &body[..body.find("</array>")?];
    let mut arguments = Vec::new();
    let mut rest = body.trim();
    while !rest.is_empty() {
        let value = rest.strip_prefix("<string>")?;
        let end = value.find("</string>")?;
        arguments.push(unescape(&value[..end])?);
        rest = value[end + "</string>".len()..].trim_start();
    }
    Some(arguments)
}

/// 按 XML 转义 &、<、>
fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 还原 XML 的五个预定义实体；有别的实体时为 None
fn unescape(text: &str) -> Option<String> {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        result.push_str(&rest[..start]);
        let end = start + rest[start..].find(';')?;
        result.push(match &rest[start + 1..end] {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ => return None,
        });
        rest = &rest[end + 1..];
    }
    result.push_str(rest);
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_back_the_program_it_wrote() {
        let program = "/Applications/曦寒 & 打印.app/Contents/MacOS/xihan-print-client";
        assert_eq!(program_arguments(&plist(program)), Some(vec![program.to_owned(), ARGUMENT.to_owned()]));
    }

    #[test]
    fn rejects_plists_without_program_arguments() {
        assert_eq!(program_arguments("<plist><dict><key>Program</key><string>/bin/sh</string></dict></plist>"), None);
        assert_eq!(program_arguments("<key>ProgramArguments</key><array><string>&bogus;</string></array>"), None);
    }
}
