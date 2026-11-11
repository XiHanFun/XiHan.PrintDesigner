// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 客户端在响应与任务事件里给出的错误码与提醒码；连不上、断线、超时等只在浏览器端出现的错误码由 SDK 自己定义。
//! 每个码上面一行的文档注释会生成进文档站的「打印客户端 SDK」参考页。

/// 错误码
pub mod errors {
    /// 消息格式或字段不合法
    pub const BAD_REQUEST: &str = "BAD_REQUEST";

    /// 授权窗口还开着时又发了业务请求
    pub const CONSENT_PENDING: &str = "CONSENT_PENDING";

    /// 用户拒绝，或来源在拒绝名单
    pub const CONSENT_DENIED: &str = "CONSENT_DENIED";

    /// 授权窗口在期限内没人处理
    pub const CONSENT_TIMEOUT: &str = "CONSENT_TIMEOUT";

    /// 重连令牌过期或不属于这个来源，已当作新会话
    pub const SESSION_EXPIRED: &str = "SESSION_EXPIRED";

    /// 协议主版本不匹配
    pub const PROTOCOL_UNSUPPORTED: &str = "PROTOCOL_UNSUPPORTED";

    /// 客户端设了访问密钥，握手没带或带得不对；details.reason 为 missing 或 mismatch
    pub const ACCESS_DENIED: &str = "ACCESS_DENIED";

    /// 本机没有任何打印机
    pub const NO_PRINTERS: &str = "NO_PRINTERS";

    /// 指定的打印机不存在
    pub const PRINTER_NOT_FOUND: &str = "PRINTER_NOT_FOUND";

    /// 打印机脱机、暂停或出错
    pub const PRINTER_OFFLINE: &str = "PRINTER_OFFLINE";

    /// 打印机没有任务需要的纸张，且驱动不接受自定义尺寸
    pub const PAPER_UNSUPPORTED: &str = "PAPER_UNSUPPORTED";

    /// 超过消息上限或资源总量上限
    pub const DOCUMENT_TOO_LARGE: &str = "DOCUMENT_TOO_LARGE";

    /// 文档里引用了随任务带来的资源之外的地址
    pub const RESOURCE_BLOCKED: &str = "RESOURCE_BLOCKED";

    /// 渲染引擎载入或等待就绪失败
    pub const RENDER_FAILED: &str = "RENDER_FAILED";

    /// 渲染超时
    pub const RENDER_TIMEOUT: &str = "RENDER_TIMEOUT";

    /// 交给打印池失败
    pub const SPOOL_FAILED: &str = "SPOOL_FAILED";

    /// 导出 PDF 失败
    pub const PDF_FAILED: &str = "PDF_FAILED";

    /// 任务标识重复
    pub const JOB_DUPLICATE: &str = "JOB_DUPLICATE";

    /// 查无此任务
    pub const JOB_NOT_FOUND: &str = "JOB_NOT_FOUND";

    /// 同一会话排队的任务超过上限
    pub const QUEUE_FULL: &str = "QUEUE_FULL";

    /// 请求了客户端没有的能力
    pub const CAPABILITY_UNSUPPORTED: &str = "CAPABILITY_UNSUPPORTED";

    /// 未预期的异常
    pub const INTERNAL: &str = "INTERNAL";
}

/// 提醒码
pub mod warnings {
    /// 驱动没有报纸张能力，或读不出驱动会留下哪种纸，没有核对纸张就照常下发了
    pub const PAPER_UNCHECKED: &str = "PAPER_UNCHECKED";

    /// 按 fitToNearestPaper 把某组改用了最接近的纸张：比纸大的内容按 scale 等比缩小，比纸小的原大居中
    pub const PAPER_FITTED: &str = "PAPER_FITTED";
}
