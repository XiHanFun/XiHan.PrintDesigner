// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 来源授权：策略预先放行的、用户允许名单里的立即放行，拒绝名单里的立即拒绝；其余在策略允许时弹授权窗口，
//! 同一来源同一时刻只弹一个窗口，同时连上来的连接共用这一次的结论

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use super::{ClientPolicy, OriginLists};
use crate::BoxFuture;
use crate::cancel::Cancel;
use crate::log::SharedLog;
use crate::server::{Authorization, ConsentDecision, OriginAuthorizer};

/// 用户在授权窗口里的选择
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsentChoice {
    /// 允许，并记进允许名单
    Allow,
    /// 只放行这次连接
    AllowOnce,
    /// 拒绝这次
    Deny,
    /// 拒绝，并记进拒绝名单不再询问
    DenyAlways,
}

/// 授权窗口：写明来源，等用户选择
pub trait ConsentPrompt: Send + Sync {
    /// 弹出授权窗口并等用户选择；令牌取消时关掉窗口并返回 None，用户直接关掉窗口时视为 Deny
    fn ask(&self, origin: &str, cancel: Cancel) -> BoxFuture<'static, Option<ConsentChoice>>;
}

/// 来源授权的缺省实现
pub struct Authorizer {
    lists: Arc<OriginLists>,
    policy: Arc<ClientPolicy>,
    prompt: Arc<dyn ConsentPrompt>,
    timeout: Duration,
    log: SharedLog,
    asking: Arc<Mutex<HashMap<String, watch::Receiver<Option<ConsentDecision>>>>>,
}

impl Authorizer {
    /// 创建授权；timeout 是授权窗口等用户的期限
    pub fn new(lists: Arc<OriginLists>, policy: Arc<ClientPolicy>, prompt: Arc<dyn ConsentPrompt>, timeout: Duration, log: SharedLog) -> Self {
        Authorizer {
            lists,
            policy,
            prompt,
            timeout,
            log,
            asking: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn start(&self, origin: &str) -> watch::Receiver<Option<ConsentDecision>> {
        let (sender, receiver) = watch::channel(None);
        let origin = origin.to_owned();
        let prompt = self.prompt.clone();
        let lists = self.lists.clone();
        let log = self.log.clone();
        let asking = self.asking.clone();
        let timeout = self.timeout;
        tokio::spawn(async move {
            let cancel = Cancel::new();
            let ask = prompt.ask(&origin, cancel.clone());
            let choice = tokio::select! {
                choice = ask => choice,
                _ = tokio::time::sleep(timeout) => {
                    cancel.cancel();
                    None
                }
            };
            let decision = match choice {
                None => {
                    log.info(&format!("授权窗口超时：{origin}"));
                    ConsentDecision::TimedOut
                }
                Some(choice) => {
                    log.info(&format!("授权窗口：{origin} → {choice:?}"));
                    let saved = match choice {
                        ConsentChoice::Allow => lists.allow(&origin),
                        ConsentChoice::DenyAlways => lists.deny(&origin),
                        _ => Ok(()),
                    };
                    if let Err(error) = saved {
                        log.warn(&format!("来源名单没存成：{error}"));
                    }
                    match choice {
                        ConsentChoice::Allow | ConsentChoice::AllowOnce => ConsentDecision::Allowed,
                        ConsentChoice::Deny | ConsentChoice::DenyAlways => ConsentDecision::Denied,
                    }
                }
            };
            asking.lock().unwrap().remove(&origin);
            let _ = sender.send(Some(decision));
        });
        receiver
    }
}

impl OriginAuthorizer for Authorizer {
    fn authorize(&self, origin: &str) -> Authorization {
        if self.policy.allowed_origins.iter().any(|item| item == origin) || self.lists.is_allowed(origin) {
            return Authorization::Decided(ConsentDecision::Allowed);
        }
        if self.lists.is_denied(origin) || !self.policy.prompt_for_unknown_origins {
            return Authorization::Decided(ConsentDecision::Denied);
        }
        let mut receiver = {
            let mut asking = self.asking.lock().unwrap();
            match asking.get(origin) {
                Some(receiver) => receiver.clone(),
                None => {
                    let receiver = self.start(origin);
                    asking.insert(origin.to_owned(), receiver.clone());
                    receiver
                }
            }
        };
        Authorization::Pending(Box::pin(async move {
            match receiver.wait_for(Option::is_some).await {
                Ok(decision) => decision.unwrap_or(ConsentDecision::TimedOut),
                Err(_) => ConsentDecision::TimedOut,
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::{NullLog, null_log};
    use crate::server::random_hex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakePrompt {
        asked: AtomicUsize,
        answer: Mutex<Option<tokio::sync::oneshot::Receiver<ConsentChoice>>>,
        never: bool,
    }

    impl ConsentPrompt for FakePrompt {
        fn ask(&self, _origin: &str, cancel: Cancel) -> BoxFuture<'static, Option<ConsentChoice>> {
            self.asked.fetch_add(1, Ordering::SeqCst);
            let answer = self.answer.lock().unwrap().take();
            let never = self.never;
            Box::pin(async move {
                if never {
                    cancel.cancelled().await;
                    return None;
                }
                answer?.await.ok()
            })
        }
    }

    fn lists() -> Arc<OriginLists> {
        Arc::new(OriginLists::load(
            std::env::temp_dir().join(format!("xihan-print-consent-{}", random_hex(8))).join("origins.json"),
            &NullLog,
        ))
    }

    fn pending(authorization: Authorization) -> BoxFuture<'static, ConsentDecision> {
        match authorization {
            Authorization::Pending(future) => future,
            Authorization::Decided(decision) => panic!("期望等待授权窗口，却直接得出 {decision:?}"),
        }
    }

    #[tokio::test]
    async fn decides_from_policy_and_lists_without_asking() {
        let lists = lists();
        lists.deny("https://deny.example").unwrap();
        lists.allow("https://allow.example").unwrap();
        let policy = Arc::new(ClientPolicy {
            allowed_origins: vec!["https://policy.example".into()],
            prompt_for_unknown_origins: false,
            ..ClientPolicy::default()
        });
        let prompt = Arc::new(FakePrompt {
            asked: AtomicUsize::new(0),
            answer: Mutex::new(None),
            never: false,
        });
        let authorizer = Authorizer::new(lists, policy, prompt.clone(), Duration::from_secs(60), null_log());
        for (origin, expected) in [
            ("https://policy.example", ConsentDecision::Allowed),
            ("https://allow.example", ConsentDecision::Allowed),
            ("https://deny.example", ConsentDecision::Denied),
            ("https://unknown.example", ConsentDecision::Denied),
        ] {
            assert!(matches!(authorizer.authorize(origin), Authorization::Decided(decision) if decision == expected), "{origin}");
        }
        assert_eq!(prompt.asked.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn asks_once_for_concurrent_connections_and_remembers_allow() {
        let lists = lists();
        let (answer, receiver) = tokio::sync::oneshot::channel();
        let prompt = Arc::new(FakePrompt {
            asked: AtomicUsize::new(0),
            answer: Mutex::new(Some(receiver)),
            never: false,
        });
        let authorizer = Authorizer::new(lists.clone(), Arc::new(ClientPolicy::default()), prompt.clone(), Duration::from_secs(60), null_log());
        let first = pending(authorizer.authorize("https://a.example"));
        let second = pending(authorizer.authorize("https://a.example"));
        tokio::task::yield_now().await;
        answer.send(ConsentChoice::Allow).unwrap();
        assert_eq!(first.await, ConsentDecision::Allowed);
        assert_eq!(second.await, ConsentDecision::Allowed);
        assert_eq!(prompt.asked.load(Ordering::SeqCst), 1);
        assert!(lists.is_allowed("https://a.example"));
    }

    #[tokio::test(start_paused = true)]
    async fn times_out_and_closes_the_prompt() {
        let prompt = Arc::new(FakePrompt {
            asked: AtomicUsize::new(0),
            answer: Mutex::new(None),
            never: true,
        });
        let authorizer = Authorizer::new(lists(), Arc::new(ClientPolicy::default()), prompt, Duration::from_secs(60), null_log());
        let decision = pending(authorizer.authorize("https://slow.example"));
        assert_eq!(decision.await, ConsentDecision::TimedOut);
    }
}
