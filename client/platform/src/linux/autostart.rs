// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 开机自启：$XDG_CONFIG_HOME/autostart/xihan-print.desktop，Exec 是本程序加 --autostart

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use xihan_print_client_core::defaults::PRODUCT_NAME;

use crate::autostart::ARGUMENT;

/// 自启项的文件名
const FILE_NAME: &str = "xihan-print.desktop";

/// 自启项的位置
fn entry_path() -> PathBuf {
    super::xdg_directory("XDG_CONFIG_HOME", ".config").join("autostart").join(FILE_NAME)
}

/// 本程序的路径：以 AppImage 运行时取 AppImage 文件本身
fn program() -> io::Result<PathBuf> {
    if let Some(image) = std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|path| path.is_absolute() && path.is_file()) {
        return Ok(image);
    }
    std::env::current_exe()
}

/// 是否登记了指向本程序的开机自启：自启项存在、没有被隐藏或关掉，且 Exec 的程序就是本程序
pub(crate) fn is_enabled() -> bool {
    let Ok(text) = fs::read_to_string(entry_path()) else {
        return false;
    };
    let Ok(program) = program() else {
        return false;
    };
    let entry = parse_entry(&text);
    let flag = |key: &str| entry.iter().any(|(name, value)| name == key && value.eq_ignore_ascii_case("true"));
    let off = |key: &str| entry.iter().any(|(name, value)| name == key && value.eq_ignore_ascii_case("false"));
    if flag("Hidden") || off("X-GNOME-Autostart-enabled") {
        return false;
    }
    let Some(arguments) = entry.iter().find(|(name, _)| name == "Exec").and_then(|(_, value)| split_exec(value)) else {
        return false;
    };
    arguments.first().is_some_and(|first| same_file(Path::new(first), &program)) && arguments.iter().skip(1).any(|argument| argument == ARGUMENT)
}

/// 打开时写入自启项，关掉时删除它
pub(crate) fn set(enabled: bool) -> io::Result<()> {
    let path = entry_path();
    if !enabled {
        return match fs::remove_file(&path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        };
    }
    let program = program()?;
    let program = program
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, format!("程序路径不是 UTF-8，写不进自启项：{}", program.display())))?;
    let text = format!(
        "[Desktop Entry]\nType=Application\nName={PRODUCT_NAME}\nExec={} {ARGUMENT}\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n",
        quote_exec(program)
    );
    let directory = path.parent().expect("自启项在 autostart 目录下");
    fs::create_dir_all(directory)?;
    let temporary = directory.join(format!(".{FILE_NAME}.{}", std::process::id()));
    fs::write(&temporary, text)?;
    fs::rename(&temporary, &path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// [Desktop Entry] 组里的键值，值已按 desktop 文件的转义还原
fn parse_entry(text: &str) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    let mut in_group = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_group = line == "[Desktop Entry]";
            continue;
        }
        if !in_group || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            entries.push((key.trim().to_owned(), unescape_value(value.trim())));
        }
    }
    entries
}

/// desktop 文件字符串值的转义：\s \n \t \r \\
fn unescape_value(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        match characters.next() {
            Some('s') => output.push(' '),
            Some('n') => output.push('\n'),
            Some('t') => output.push('\t'),
            Some('r') => output.push('\r'),
            Some(other) => output.push(other),
            None => output.push('\\'),
        }
    }
    output
}

/// Exec 的一个参数：一律加双引号，引号里的 " ` $ \ 前加反斜杠，% 写成 %%；再按字符串值的规则把反斜杠写成两个
fn quote_exec(argument: &str) -> String {
    let mut quoted = String::from("\"");
    for character in argument.chars() {
        match character {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(character);
            }
            '%' => quoted.push_str("%%"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted.replace('\\', "\\\\")
}

/// 把已还原字符串转义的 Exec 值拆成参数；引号不配对时为 None
fn split_exec(value: &str) -> Option<Vec<String>> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut has_current = false;
    let mut quoted = false;
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' => {
                quoted = !quoted;
                has_current = true;
            }
            '\\' if quoted => current.push(characters.next()?),
            '%' if characters.peek() == Some(&'%') => {
                characters.next();
                current.push('%');
                has_current = true;
            }
            ' ' | '\t' if !quoted => {
                if has_current {
                    arguments.push(std::mem::take(&mut current));
                    has_current = false;
                }
            }
            other => {
                current.push(other);
                has_current = true;
            }
        }
    }
    if quoted {
        return None;
    }
    if has_current {
        arguments.push(current);
    }
    Some(arguments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_and_splits_the_program_path() {
        let path = "/opt/曦寒 打印/bin/x\"$`\\%y";
        let line = format!("Exec={} {ARGUMENT}", quote_exec(path));
        let entry = parse_entry(&format!("[Desktop Entry]\n{line}\n"));
        let arguments = split_exec(&entry[0].1).unwrap();
        assert_eq!(arguments, vec![path.to_owned(), ARGUMENT.to_owned()]);
    }

    #[test]
    fn reads_only_the_desktop_entry_group() {
        let entry = parse_entry("# 注释\n[Desktop Action x]\nExec=other\n[Desktop Entry]\nExec=/usr/bin/xihan-print --autostart\nHidden=false\n");
        assert_eq!(
            entry,
            vec![
                ("Exec".to_owned(), "/usr/bin/xihan-print --autostart".to_owned()),
                ("Hidden".to_owned(), "false".to_owned())
            ]
        );
        assert_eq!(split_exec("\"/a b\" --autostart"), Some(vec!["/a b".to_owned(), "--autostart".to_owned()]));
        assert_eq!(split_exec("\"/a b --autostart"), None);
    }
}
