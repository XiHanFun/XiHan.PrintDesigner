// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 客户端在响应与任务事件里给出的错误码；连不上、断线、超时等只在浏览器端出现的错误码由 SDK 自己定义
/// </summary>
public static class PrintErrorCodes
{
    /// <summary>
    /// 消息格式或字段不合法
    /// </summary>
    public const string BadRequest = "BAD_REQUEST";

    /// <summary>
    /// 授权窗口还开着时又发了业务请求
    /// </summary>
    public const string ConsentPending = "CONSENT_PENDING";

    /// <summary>
    /// 用户拒绝，或来源在拒绝名单
    /// </summary>
    public const string ConsentDenied = "CONSENT_DENIED";

    /// <summary>
    /// 授权窗口在期限内没人处理
    /// </summary>
    public const string ConsentTimeout = "CONSENT_TIMEOUT";

    /// <summary>
    /// 重连令牌过期或不属于这个来源，已当作新会话
    /// </summary>
    public const string SessionExpired = "SESSION_EXPIRED";

    /// <summary>
    /// 协议主版本不匹配
    /// </summary>
    public const string ProtocolUnsupported = "PROTOCOL_UNSUPPORTED";

    /// <summary>
    /// 本机没有任何打印机
    /// </summary>
    public const string NoPrinters = "NO_PRINTERS";

    /// <summary>
    /// 指定的打印机不存在
    /// </summary>
    public const string PrinterNotFound = "PRINTER_NOT_FOUND";

    /// <summary>
    /// 打印机脱机、暂停或出错
    /// </summary>
    public const string PrinterOffline = "PRINTER_OFFLINE";

    /// <summary>
    /// 打印机没有任务需要的纸张，且驱动不接受自定义尺寸
    /// </summary>
    public const string PaperUnsupported = "PAPER_UNSUPPORTED";

    /// <summary>
    /// 超过消息上限或资源总量上限
    /// </summary>
    public const string DocumentTooLarge = "DOCUMENT_TOO_LARGE";

    /// <summary>
    /// 文档里引用了随任务带来的资源之外的地址
    /// </summary>
    public const string ResourceBlocked = "RESOURCE_BLOCKED";

    /// <summary>
    /// 渲染引擎载入或等待就绪失败
    /// </summary>
    public const string RenderFailed = "RENDER_FAILED";

    /// <summary>
    /// 渲染超时
    /// </summary>
    public const string RenderTimeout = "RENDER_TIMEOUT";

    /// <summary>
    /// 交给打印池失败
    /// </summary>
    public const string SpoolFailed = "SPOOL_FAILED";

    /// <summary>
    /// 导出 PDF 失败
    /// </summary>
    public const string PdfFailed = "PDF_FAILED";

    /// <summary>
    /// 任务标识重复
    /// </summary>
    public const string JobDuplicate = "JOB_DUPLICATE";

    /// <summary>
    /// 查无此任务
    /// </summary>
    public const string JobNotFound = "JOB_NOT_FOUND";

    /// <summary>
    /// 同一会话排队的任务超过上限
    /// </summary>
    public const string QueueFull = "QUEUE_FULL";

    /// <summary>
    /// 请求了客户端没有的能力
    /// </summary>
    public const string CapabilityUnsupported = "CAPABILITY_UNSUPPORTED";

    /// <summary>
    /// 未预期的异常
    /// </summary>
    public const string Internal = "INTERNAL";
}
