// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 把各层组装起来：设置与日志、策略与来源名单、打印机、渲染引擎、任务队列、打印服务、更新检查

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::AppHandle;
use xihan_print_client_core::consent::{Authorizer, ClientPolicy, OriginLists};
use xihan_print_client_core::defaults::{PRODUCT_NAME, RENDER_TIMEOUT};
use xihan_print_client_core::diagnostics::{self, DiagnosticsInput, RECENT_JOB_COUNT};
use xihan_print_client_core::log::{ClientLog, FileLog, LogLevel, SharedLog};
use xihan_print_client_core::paths::AppPaths;
use xihan_print_client_core::printing::{HtmlPrintEngine, JobQueue, JobQueueOptions, PrintRequestHandler, PrinterCatalog, selftest};
use xihan_print_client_core::protocol::{ClientCapabilities, ClientInfo, PrintOptions, PrinterInfo};
use xihan_print_client_core::server::{AccessKeyGate, ClientEnvironment, GateChain, HandshakeGate, PrintServer, ServerOptions, ServerParts, is_access_key};
use xihan_print_client_core::settings::{ClientSettings, MIN_USER_PORT};
use xihan_print_client_core::time::{Clock, SystemClock};
use xihan_print_client_platform as platform;

use crate::updates::UpdateService;
use crate::{DiagnosticsSection, ExtensionPage, Extensions};

/// 客户端版本，取自 Cargo 工作区的版本
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// 组装好的客户端
pub struct Host {
    app: AppHandle,
    paths: AppPaths,
    settings: Mutex<ClientSettings>,
    log: Arc<FileLog>,
    policy: Arc<ClientPolicy>,
    lists: Arc<OriginLists>,
    clock: Arc<dyn Clock>,
    catalog: Arc<dyn PrinterCatalog>,
    engine: Option<Arc<dyn HtmlPrintEngine>>,
    renderer_problem: Option<String>,
    queue: JobQueue,
    access: Arc<AccessKeyGate>,
    server: Mutex<Option<PrintServer>>,
    problems: Mutex<Vec<String>>,
    info: ClientInfo,
    capabilities: ClientCapabilities,
    updates: Mutex<Option<Arc<UpdateService>>>,
    pages: Vec<ExtensionPage>,
    sections: Vec<DiagnosticsSection>,
}

/// 查不了打印机时的空目录
struct NoPrinters;

impl PrinterCatalog for NoPrinters {
    fn list(&self) -> std::io::Result<Vec<PrinterInfo>> {
        Ok(Vec::new())
    }

    fn get(&self, _name: &str) -> std::io::Result<Option<PrinterInfo>> {
        Ok(None)
    }

    fn default_printer_name(&self) -> std::io::Result<Option<String>> {
        Ok(None)
    }
}

/// 写进 welcome 的客户端信息与能力
struct Environment {
    info: ClientInfo,
    capabilities: ClientCapabilities,
}

impl ClientEnvironment for Environment {
    fn info(&self) -> ClientInfo {
        self.info.clone()
    }

    fn capabilities(&self) -> ClientCapabilities {
        self.capabilities.clone()
    }
}

/// 本机回环监听依次试的端口：策略固定了端口时用策略的，否则用户设了端口时只用它，都没有时用缺省的端口
fn effective_ports(policy: &ClientPolicy, settings: &ClientSettings) -> Vec<u16> {
    if !policy.ports.is_empty() {
        policy.ports.clone()
    } else if let Some(port) = settings.port {
        vec![port]
    } else {
        ServerOptions::default().ports
    }
}

impl Host {
    /// 读设置、日志、策略与名单，建渲染引擎与任务队列，开始监听与计划检查更新；有问题时记进 problems
    pub(crate) async fn start(app: AppHandle, extensions: Extensions) -> Arc<Host> {
        let paths = platform::app_paths();
        let clock: Arc<dyn Clock> = Arc::new(SystemClock::new(platform::local_offset));
        let bootstrap = xihan_print_client_core::log::MemoryLog::default();
        let settings = ClientSettings::load(&paths.settings_file(), &bootstrap);
        let log = Arc::new(FileLog::new(&paths.log_directory, settings.log_level, 14, clock.clone()));
        for (level, line) in bootstrap.lines() {
            log.write(level, &line, None);
        }
        let shared: SharedLog = log.clone();
        log.info(&format!("{PRODUCT_NAME} {VERSION} 启动（{} {}）", platform::os(), platform::arch()));
        let policy = Arc::new(ClientPolicy::load(&paths.policy_file, log.as_ref()));
        let lists = Arc::new(OriginLists::load(paths.origins_file(), log.as_ref()));
        let mut problems = Vec::new();

        let printing = match platform::printing() {
            Ok(printing) => Some(printing),
            Err(problem) => {
                log.warn(&format!("查不了打印机：{problem}"));
                problems.push(format!("查不了本机的打印机：{problem}"));
                None
            }
        };
        let (engine, renderer_problem) = match &printing {
            Some(printing) => {
                let options = platform::EngineOptions {
                    data_directory: paths.renderer_data_directory.clone(),
                    papers: printing.papers.clone(),
                    dialog: platform::print_dialog(),
                    render_timeout: RENDER_TIMEOUT,
                    log: shared.clone(),
                };
                match platform::create_engine(options).await {
                    Ok(engine) => (Some(engine), None),
                    Err(problem) => {
                        log.warn(&format!("渲染引擎不可用，HTML 打印与导出 PDF 不可用：{problem}"));
                        problems.push(format!("{problem}，HTML 打印与导出 PDF 暂不可用。"));
                        (None, Some(problem))
                    }
                }
            }
            None => (None, Some("查不了打印机".to_owned())),
        };
        let info = ClientInfo {
            version: VERSION.to_owned(),
            os: platform::os().to_owned(),
            arch: platform::arch().to_owned(),
            renderer: engine.as_ref().and_then(|engine| engine.version()),
        };
        let raw = printing.as_ref().and_then(|printing| printing.raw.clone());
        let capabilities = ClientCapabilities {
            html: engine.is_some(),
            raw: raw.is_some(),
            pdf: engine.is_some(),
            duplex: true,
            printer_status: true,
            extensions: extensions.capabilities.clone(),
        };
        let queue = JobQueue::new(engine.clone(), raw, JobQueueOptions::default(), clock.clone(), shared.clone());
        for observer in &extensions.observers {
            queue.add_observer(observer.clone());
        }
        if let Some(tracker) = &extensions.tracker {
            queue.set_completion_tracker(tracker.clone());
        }
        let catalog: Arc<dyn PrinterCatalog> = printing.as_ref().map(|printing| printing.catalog.clone()).unwrap_or_else(|| Arc::new(NoPrinters));
        let environment = Arc::new(Environment {
            info: info.clone(),
            capabilities: capabilities.clone(),
        });
        let handler = Arc::new(PrintRequestHandler::new(catalog.clone(), queue.clone(), environment.clone(), extensions.requests.clone()));
        let prompt = Arc::new(crate::consent::WindowConsent::new(app.clone()));
        let authorizer = Arc::new(Authorizer::new(lists.clone(), policy.clone(), prompt, Duration::from_secs(60), shared.clone()));
        let options = ServerOptions {
            ports: effective_ports(&policy, &settings),
            ..ServerOptions::default()
        };
        let ports = options.ports.clone();
        let access = Arc::new(AccessKeyGate::new(policy.access_key.clone().or_else(|| settings.access_key.clone())));
        let mut gates: Vec<Arc<dyn HandshakeGate>> = vec![access.clone()];
        gates.extend(extensions.gate.clone());
        let server = PrintServer::new(ServerParts {
            options,
            authorizer,
            environment,
            handler,
            gate: Arc::new(GateChain(gates)),
            clock: clock.clone(),
            log: shared.clone(),
        });
        {
            let queue = queue.clone();
            server.sessions().on_expired(move |session| queue.forget(session));
        }
        if let Err(error) = server.listen_loopback(platform::bind_listener) {
            let ports = ports.iter().map(u16::to_string).collect::<Vec<_>>().join("、");
            log.error(&format!("端口 {ports} 都不可用"), Some(&error));
            problems.push(format!("端口 {ports} 都被占用，网页暂时连不上客户端。"));
        }

        let host = Arc::new(Host {
            app,
            paths,
            settings: Mutex::new(settings),
            log,
            policy,
            lists,
            clock,
            catalog,
            engine,
            renderer_problem,
            queue,
            access,
            server: Mutex::new(Some(server)),
            problems: Mutex::new(problems),
            info,
            capabilities,
            updates: Mutex::new(None),
            pages: extensions.pages,
            sections: extensions.diagnostics,
        });
        let updates = UpdateService::start(host.clone());
        *host.updates.lock().unwrap() = Some(updates);
        {
            let app = host.app.clone();
            host.lists.on_changed(move || crate::windows::notify(&app, "origins-changed"));
        }
        for hook in extensions.on_start {
            hook(&host);
        }
        host
    }

    /// 不再接受连接，停掉任务队列与更新检查
    pub(crate) async fn stop(&self) {
        let server = self.server.lock().unwrap().take();
        if let Some(server) = server {
            server.stop().await;
        }
        if let Some(updates) = self.updates.lock().unwrap().take() {
            updates.stop();
        }
        self.queue.stop().await;
        self.log.info(&format!("{PRODUCT_NAME}退出"));
    }

    /// Tauri 应用
    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    /// 目录与文件位置
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// 日志
    pub fn log(&self) -> SharedLog {
        self.log.clone()
    }

    /// 时钟
    pub fn clock(&self) -> &Arc<dyn Clock> {
        &self.clock
    }

    /// 生效的策略
    pub fn policy(&self) -> &Arc<ClientPolicy> {
        &self.policy
    }

    /// 用户的来源名单
    pub fn lists(&self) -> &Arc<OriginLists> {
        &self.lists
    }

    /// 任务队列
    pub fn queue(&self) -> &JobQueue {
        &self.queue
    }

    /// 打印机查询
    pub fn catalog(&self) -> &Arc<dyn PrinterCatalog> {
        &self.catalog
    }

    /// 打印服务；退出后为 None
    pub fn with_server<T>(&self, use_server: impl FnOnce(&PrintServer) -> T) -> Option<T> {
        self.server.lock().unwrap().as_ref().map(use_server)
    }

    /// 本机回环监听的端口；没在监听时为 None
    pub fn port(&self) -> Option<u16> {
        self.with_server(|server| server.loopback_port()).flatten()
    }

    /// 客户端信息
    pub fn info(&self) -> &ClientInfo {
        &self.info
    }

    /// 客户端能力
    pub fn capabilities(&self) -> &ClientCapabilities {
        &self.capabilities
    }

    /// 给用户看的启动问题
    pub fn problems(&self) -> Vec<String> {
        self.problems.lock().unwrap().clone()
    }

    /// 主窗口里的扩展页
    pub fn pages(&self) -> &[ExtensionPage] {
        &self.pages
    }

    /// 当前设置的副本
    pub fn settings(&self) -> ClientSettings {
        self.settings.lock().unwrap().clone()
    }

    /// 改设置并存盘
    pub fn update_settings(&self, change: impl FnOnce(&mut ClientSettings)) -> std::io::Result<()> {
        let mut settings = self.settings.lock().unwrap();
        change(&mut settings);
        self.log.set_minimum(settings.log_level);
        settings.save(&self.paths.settings_file())
    }

    /// 本机回环监听依次试的端口：策略固定了端口时用策略的，否则用户设了端口时只用它，都没有时用缺省的端口
    pub fn ports(&self) -> Vec<u16> {
        effective_ports(&self.policy, &self.settings.lock().unwrap())
    }

    /// 端口是否由策略固定
    pub fn ports_locked(&self) -> bool {
        !self.policy.ports.is_empty()
    }

    /// 改用户设的端口（None 恢复缺省）：先换监听，换成了再存设置；换不成时监听与设置都不动，给出写给用户看的原因
    pub(crate) fn set_port(&self, port: Option<u16>) -> Result<Option<u16>, String> {
        if self.ports_locked() {
            return Err("端口由管理员策略设定，不能在这里改。".into());
        }
        if port.is_some_and(|port| port < MIN_USER_PORT) {
            return Err(format!("端口要在 {MIN_USER_PORT}–65535 之间。"));
        }
        let ports = match port {
            Some(port) => vec![port],
            None => ServerOptions::default().ports,
        };
        let listening = self
            .with_server(|server| server.rebind_loopback(&ports, platform::bind_listener))
            .ok_or_else(|| "客户端正在退出。".to_owned())?
            .map_err(|error| {
                let list = ports.iter().map(u16::to_string).collect::<Vec<_>>().join("、");
                self.log.warn(&format!("换不了端口 {list}：{error}"));
                format!("端口 {list} 不可用：{error}")
            })?;
        self.update_settings(|settings| settings.port = port)
            .map_err(|error| format!("端口已换成 {listening}，但设置没存下来：{error}"))?;
        self.problems.lock().unwrap().retain(|problem| !problem.contains("网页暂时连不上客户端"));
        self.log.info(&format!("监听端口改为 {listening}"));
        Ok(Some(listening))
    }

    /// 生效的访问密钥：策略设了时用策略的，否则用用户设的
    pub fn access_key(&self) -> Option<String> {
        self.policy.access_key.clone().or_else(|| self.settings.lock().unwrap().access_key.clone())
    }

    /// 访问密钥从哪来：策略或设置；没设时为 None
    pub fn access_key_source(&self) -> Option<&'static str> {
        if self.policy.access_key.is_some() {
            Some("策略")
        } else if self.settings.lock().unwrap().access_key.is_some() {
            Some("设置")
        } else {
            None
        }
    }

    /// 访问密钥是否由策略设定
    pub fn access_key_locked(&self) -> bool {
        self.policy.access_key.is_some()
    }

    /// 改用户设的访问密钥（None 为不要密钥）：存设置后立即生效，已建立的连接不断开；给出写给用户看的原因
    pub(crate) fn set_access_key(&self, key: Option<String>) -> Result<(), String> {
        if self.access_key_locked() {
            return Err("访问密钥由管理员策略设定，不能在这里改。".into());
        }
        if key.as_deref().is_some_and(|key| !is_access_key(key)) {
            return Err("访问密钥要 8–128 个字母、数字或符号，不含空格与中文。".into());
        }
        self.update_settings(|settings| settings.access_key = key.clone())
            .map_err(|error| format!("设置没存下来：{error}"))?;
        self.access.set(key.clone());
        self.log.info(if key.is_some() { "访问密钥已更新" } else { "访问密钥已清除" });
        Ok(())
    }

    /// 改日志级别并存设置
    pub(crate) fn set_log_level(&self, level: LogLevel) -> std::io::Result<()> {
        self.update_settings(|settings| settings.log_level = level)
    }

    /// 是否检查更新：策略与用户设置都允许时才查
    pub fn checks_for_updates(&self) -> bool {
        self.policy.check_for_updates && self.settings.lock().unwrap().check_for_updates
    }

    /// 更新检查
    pub(crate) fn updates(&self) -> Option<Arc<UpdateService>> {
        self.updates.lock().unwrap().clone()
    }

    /// 渲染引擎的说法：可用时为名称加版本（用着程序目录下的 WebView2 固定版运行时时注明），不可用时为原因
    pub fn renderer(&self) -> Result<String, String> {
        let fixed = platform::fixed_webview2_runtime()
            .is_some_and(|folder| std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some_and(|value| folder == std::path::Path::new(&value)));
        match &self.engine {
            Some(engine) => Ok(format!(
                "{} {}{}",
                engine.name(),
                engine.version().unwrap_or_default(),
                if fixed { "（固定版）" } else { "" }
            )),
            None => Err(self.renderer_problem.clone().unwrap_or_else(|| "没有渲染引擎".into())),
        }
    }

    /// 当前的诊断信息
    pub fn diagnostics_text(&self) -> String {
        let listening = self.with_server(|server| server.listening()).unwrap_or_default();
        let input = DiagnosticsInput {
            client: self.info.clone(),
            renderer: self.renderer(),
            listening: listening.into_iter().map(|(name, address)| (name, address.to_string())).collect(),
            policy: (*self.policy).clone(),
            policy_file_exists: self.paths.policy_file.exists(),
            user_port: self.settings.lock().unwrap().port,
            access_key_source: self.access_key_source().map(str::to_owned),
            allowed: self.lists.allowed(),
            denied: self.lists.denied(),
            recent_jobs: self.queue.recent(RECENT_JOB_COUNT),
            sections: self.sections.iter().map(|section| section()).collect(),
        };
        diagnostics::format(&input, self.clock.local_offset(self.clock.now()))
    }

    /// 导出诊断包
    pub(crate) fn export_diagnostics(&self, path: &std::path::Path) -> std::io::Result<()> {
        let _ = std::fs::remove_file(path);
        diagnostics::export(
            path,
            &self.diagnostics_text(),
            &self.paths.log_directory,
            &[self.paths.settings_file(), self.paths.origins_file()],
            &self.paths.policy_file,
        )?;
        self.log.info(&format!("导出诊断包 {}", path.display()));
        Ok(())
    }

    /// 给打印机印一张自检页，返回结果说明
    pub(crate) async fn test_print(&self, printer: &str) -> String {
        let Some(engine) = self.engine.clone() else {
            return format!("渲染引擎不可用，印不了自检页：{}", self.renderer_problem.clone().unwrap_or_default());
        };
        let lookup = printer.to_owned();
        let catalog = self.catalog.clone();
        let info = match tokio::task::spawn_blocking(move || catalog.get(&lookup)).await {
            Ok(Ok(Some(info))) => info,
            Ok(Ok(None)) => return format!("没有这台打印机：{printer}"),
            Ok(Err(error)) => return format!("查不了打印机：{error}"),
            Err(_) => return "查不了打印机".into(),
        };
        let (width, height) = selftest::paper_for(&info);
        let now = self.clock.now();
        let document = selftest::document(&self.info, engine.name(), &info.name, width, height, now, self.clock.local_offset(now));
        let cancel = xihan_print_client_core::cancel::Cancel::new();
        let printing = engine.print(Arc::new(document), info.name.clone(), PrintOptions::default(), cancel.clone());
        match tokio::time::timeout(Duration::from_secs(120), printing).await {
            Ok(Ok(_)) => {
                self.log.info(&format!("自检页已交给 {}", info.name));
                format!("自检页已交给「{}」的打印队列。", info.name)
            }
            Ok(Err(error)) => {
                self.log.warn(&format!("自检页失败：{error}"));
                format!("自检页没印成：{error}")
            }
            Err(_) => {
                cancel.cancel();
                "自检页超过 2 分钟没有交给打印池。".into()
            }
        }
    }
}
