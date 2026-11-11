// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 渲染页的地址：任务文档与资源经自定义 scheme `xihan-print://print.local/` 提供，其余地址一律拦下

/// 自定义 scheme
pub(super) const SCHEME: &str = "xihan-print";

/// 协议里任务文档所在的保留地址
const PROTOCOL_ORIGIN: &str = "https://print.local/";

/// 渲染页里任务文档所在的地址
pub(super) const ORIGIN: &str = "xihan-print://print.local/";

/// 任务文档的地址
pub(super) const DOCUMENT_URL: &str = "xihan-print://print.local/doc.html";

/// 一个请求该怎样回应
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Route<'a> {
    /// 任务文档
    Document,
    /// 随任务带来的资源，带资源编号
    Resource(&'a str),
    /// 保留地址下的其他路径，回 404
    NotFound,
    /// 任务以外的地址，带协议加主机
    Outside(String),
}

/// 把文档里的保留地址前缀换成渲染页的 scheme
pub(super) fn rewrite_html(html: &str) -> String {
    html.replace(PROTOCOL_ORIGIN, ORIGIN)
}

/// 按地址决定回应；? 与 # 之后的部分不计
pub(super) fn route(url: &str) -> Route<'_> {
    let base = url.split(['?', '#']).next().unwrap_or_default();
    match base.strip_prefix(ORIGIN) {
        Some("doc.html") => Route::Document,
        Some(rest) => match rest.strip_prefix("r/") {
            Some(id) if !id.is_empty() => Route::Resource(id),
            _ => Route::NotFound,
        },
        None => Route::Outside(origin(url)),
    }
}

/// 子框架的导航该怎样处理
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum FrameNavigation {
    /// 放行：任务里的地址与 about:
    Allow,
    /// 拦下不记：data:、blob:、javascript:
    Cancel,
    /// 拦下并记为任务以外的地址，带协议加主机
    Block(String),
}

/// 按地址决定子框架的导航
pub(super) fn frame_navigation(url: &str) -> FrameNavigation {
    if url.starts_with(ORIGIN) || url.starts_with("about:") {
        FrameNavigation::Allow
    } else if ["data:", "blob:", "javascript:"].iter().any(|scheme| url.starts_with(scheme)) {
        FrameNavigation::Cancel
    } else {
        FrameNavigation::Block(origin(url))
    }
}

/// 报给浏览器的被拦地址：协议加主机，不含路径、参数与用户信息；渲染页 scheme 下的其他主机按协议里的 https 报；没有主机的取前 64 个字符
pub(super) fn origin(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.chars().take(64).collect();
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    if host.is_empty() {
        return url.chars().take(64).collect();
    }
    let scheme = if scheme.eq_ignore_ascii_case(SCHEME) { "https" } else { scheme };
    format!("{scheme}://{host}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_the_document_and_resources() {
        assert_eq!(route("xihan-print://print.local/doc.html"), Route::Document);
        assert_eq!(route("xihan-print://print.local/r/0?v=1#x"), Route::Resource("0"));
        assert_eq!(route("xihan-print://print.local/r/"), Route::NotFound);
        assert_eq!(route("xihan-print://print.local/other.css"), Route::NotFound);
        assert_eq!(route("xihan-print://example.com/logo.png"), Route::Outside("https://example.com".into()));
    }

    #[test]
    fn reports_scheme_and_host_only() {
        assert_eq!(origin("https://user:secret@example.com:8443/logo.png?token=secret"), "https://example.com:8443");
        assert_eq!(origin("http://example.com"), "http://example.com");
        assert_eq!(origin("file:///etc/hosts"), "file:///etc/hosts");
    }

    #[test]
    fn rewrites_only_the_reserved_origin() {
        assert_eq!(
            rewrite_html("<img src='https://print.local/r/0'><p>https://example.com</p>"),
            "<img src='xihan-print://print.local/r/0'><p>https://example.com</p>"
        );
    }

    #[test]
    fn lets_frames_load_only_task_content() {
        assert_eq!(frame_navigation("xihan-print://print.local/r/0"), FrameNavigation::Allow);
        assert_eq!(frame_navigation("about:srcdoc"), FrameNavigation::Allow);
        assert_eq!(frame_navigation("data:text/html,x"), FrameNavigation::Cancel);
        assert_eq!(frame_navigation("xihan-print://example.com/"), FrameNavigation::Block("https://example.com".into()));
        assert_eq!(frame_navigation("https://print.local/r/0"), FrameNavigation::Block("https://print.local".into()));
    }
}
