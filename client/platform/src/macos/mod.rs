// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! macOS 的平台实现：目录位置、LaunchAgents 开机自启，以及 WKWebView 把各组输出页渲染成 PDF、PDFKit 合并、经 CUPS 下发的 HTML 通道

pub(crate) mod autostart;
mod delegates;
mod main_thread;
mod page;
mod pdf;
mod renderer;
mod scripts;
mod urls;

use std::path::PathBuf;
use std::sync::Arc;

use objc2_foundation::NSHomeDirectory;
use xihan_print_client_core::paths::AppPaths;
use xihan_print_client_core::printing::HtmlPrintEngine;

use crate::unix::PdfPipelineEngine;

/// 产品在各个系统目录下共用的子目录
const PRODUCT_DIRECTORY: &str = "XiHanFun/PrintClient";

/// 客户端在本机读写的目录与文件：设置在 ~/Library/Application Support，日志在 ~/Library/Logs，渲染数据与更新在 ~/Library/Caches，策略在 /Library/Application Support
pub(crate) fn app_paths() -> AppPaths {
    let home = PathBuf::from(NSHomeDirectory().to_string());
    let library = home.join("Library");
    let settings = library.join("Application Support").join(PRODUCT_DIRECTORY);
    let caches = library.join("Caches").join(PRODUCT_DIRECTORY);
    AppPaths {
        data_directory: settings.join("data"),
        settings_directory: settings,
        log_directory: library.join("Logs").join(PRODUCT_DIRECTORY),
        renderer_data_directory: caches.join("webkit"),
        update_directory: caches.join("updates"),
        policy_file: PathBuf::from("/Library/Application Support").join(PRODUCT_DIRECTORY).join("policy.json"),
    }
}

/// 建 HTML 通道的渲染引擎：WKWebView 渲染器加 CUPS；本机没有 CUPS 时只能导出 PDF，打印时报 PRINTER_OFFLINE
pub(crate) async fn create_engine(options: crate::EngineOptions) -> Result<Arc<dyn HtmlPrintEngine>, String> {
    let renderer = renderer::WebKitRenderer::create(&options.data_directory, options.log.clone()).await?;
    let cups = match crate::unix::open_cups() {
        Ok(cups) => Some(cups),
        Err(reason) => {
            options.log.warn(&format!("打不开 CUPS，HTML 通道只能导出 PDF：{reason}"));
            None
        }
    };
    Ok(Arc::new(PdfPipelineEngine::new(Arc::new(renderer), cups, options)))
}
