// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 取更新清单与安装包用的 HTTP 客户端：系统的证书库与代理设置

use std::time::Duration;

use xihan_print_client_core::BoxFuture;
use xihan_print_client_core::updates::{HttpClient, HttpResponse};

/// 基于 reqwest 的 HTTP 客户端
pub(crate) struct ReqwestClient {
    client: reqwest::Client,
}

impl ReqwestClient {
    /// 建客户端，User-Agent 带上客户端版本
    pub(crate) fn new(version: &str) -> Result<ReqwestClient, String> {
        let client = reqwest::Client::builder()
            .user_agent(format!("XiHanPrint/{version}"))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(ReqwestClient { client })
    }
}

struct Response(reqwest::Response);

impl HttpResponse for Response {
    fn status(&self) -> u16 {
        self.0.status().as_u16()
    }

    fn chunk(&mut self) -> BoxFuture<'_, Result<Option<Vec<u8>>, String>> {
        Box::pin(async move { self.0.chunk().await.map(|chunk| chunk.map(|bytes| bytes.to_vec())).map_err(|error| error.to_string()) })
    }
}

impl HttpClient for ReqwestClient {
    fn get(&self, url: &str) -> BoxFuture<'_, Result<Box<dyn HttpResponse>, String>> {
        let request = self.client.get(url);
        Box::pin(async move {
            request
                .send()
                .await
                .map(|response| Box::new(Response(response)) as Box<dyn HttpResponse>)
                .map_err(|error| error.to_string())
        })
    }
}
