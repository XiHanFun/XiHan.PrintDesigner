// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 用户的允许名单与拒绝名单，存在设置目录的 origins.json；同一来源只会在其中一张名单里

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::log::ClientLog;
use crate::server::origin;
use crate::settings::write_atomically;

#[derive(Default, Deserialize, Serialize)]
struct ListsFile {
    #[serde(default)]
    allowed: Vec<String>,
    #[serde(default)]
    denied: Vec<String>,
}

type ChangedHandler = Box<dyn Fn() + Send + Sync>;

/// 用户的允许名单与拒绝名单
pub struct OriginLists {
    path: PathBuf,
    state: Mutex<(BTreeSet<String>, BTreeSet<String>)>,
    changed: Mutex<Vec<ChangedHandler>>,
}

impl OriginLists {
    /// 从文件读入名单；文件不存在时为空，读不出时记错误日志并按空名单处理
    pub fn load(path: impl Into<PathBuf>, log: &dyn ClientLog) -> OriginLists {
        let path = path.into();
        let mut allowed = BTreeSet::new();
        let mut denied = BTreeSet::new();
        match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<ListsFile>(&bytes) {
                Ok(file) => {
                    allowed.extend(file.allowed.iter().filter_map(|item| origin::normalize(Some(item))));
                    denied.extend(file.denied.iter().filter_map(|item| origin::normalize(Some(item))).filter(|item| !allowed.contains(item)));
                }
                Err(error) => log.error(&format!("读不出来源名单 {}，按空名单处理", path.display()), Some(&error)),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => log.error(&format!("读不出来源名单 {}，按空名单处理", path.display()), Some(&error)),
        }
        OriginLists {
            path,
            state: Mutex::new((allowed, denied)),
            changed: Mutex::new(Vec::new()),
        }
    }

    /// 名单文件的位置
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 名单变化后调用
    pub fn on_changed(&self, handler: impl Fn() + Send + Sync + 'static) {
        self.changed.lock().unwrap().push(Box::new(handler));
    }

    /// 允许名单
    pub fn allowed(&self) -> Vec<String> {
        self.state.lock().unwrap().0.iter().cloned().collect()
    }

    /// 拒绝名单
    pub fn denied(&self) -> Vec<String> {
        self.state.lock().unwrap().1.iter().cloned().collect()
    }

    /// 是否在允许名单
    pub fn is_allowed(&self, origin: &str) -> bool {
        self.state.lock().unwrap().0.contains(origin)
    }

    /// 是否在拒绝名单
    pub fn is_denied(&self, origin: &str) -> bool {
        self.state.lock().unwrap().1.contains(origin)
    }

    /// 记进允许名单，同时移出拒绝名单
    pub fn allow(&self, origin: &str) -> std::io::Result<()> {
        self.update(|(allowed, denied)| denied.remove(origin) | allowed.insert(origin.to_owned()))
    }

    /// 记进拒绝名单，同时移出允许名单
    pub fn deny(&self, origin: &str) -> std::io::Result<()> {
        self.update(|(allowed, denied)| allowed.remove(origin) | denied.insert(origin.to_owned()))
    }

    /// 从两张名单里都删掉，下次连接时重新询问
    pub fn forget(&self, origin: &str) -> std::io::Result<()> {
        self.update(|(allowed, denied)| allowed.remove(origin) | denied.remove(origin))
    }

    fn update(&self, change: impl FnOnce(&mut (BTreeSet<String>, BTreeSet<String>)) -> bool) -> std::io::Result<()> {
        {
            let mut state = self.state.lock().unwrap();
            if !change(&mut state) {
                return Ok(());
            }
            let file = ListsFile {
                allowed: state.0.iter().cloned().collect(),
                denied: state.1.iter().cloned().collect(),
            };
            write_atomically(&self.path, &serde_json::to_vec_pretty(&file).expect("名单总能写成 JSON"))?;
        }
        for handler in self.changed.lock().unwrap().iter() {
            handler();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::NullLog;
    use crate::server::random_hex;

    #[test]
    fn keeps_each_origin_in_one_list_and_persists() {
        let path = std::env::temp_dir().join(format!("xihan-print-origins-{}", random_hex(8))).join("origins.json");
        let lists = OriginLists::load(&path, &NullLog);
        let changes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        lists.on_changed({
            let changes = changes.clone();
            move || {
                changes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        });
        lists.allow("https://a.example").unwrap();
        lists.deny("https://b.example").unwrap();
        lists.deny("https://a.example").unwrap();
        lists.deny("https://a.example").unwrap();
        assert_eq!(changes.load(std::sync::atomic::Ordering::SeqCst), 3);
        assert!(!lists.is_allowed("https://a.example"));

        let reloaded = OriginLists::load(&path, &NullLog);
        assert_eq!(reloaded.denied(), vec!["https://a.example", "https://b.example"]);
        reloaded.forget("https://b.example").unwrap();
        assert_eq!(OriginLists::load(&path, &NullLog).denied(), vec!["https://a.example"]);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
