// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 来源授权的结论
/// </summary>
public enum ConsentDecision
{
    /// <summary>
    /// 允许
    /// </summary>
    Allowed,

    /// <summary>
    /// 拒绝，或来源在拒绝名单
    /// </summary>
    Denied,

    /// <summary>
    /// 授权窗口在期限内没人处理
    /// </summary>
    TimedOut,
}

/// <summary>
/// 来源授权：在允许名单里的立即放行，在拒绝名单里的立即拒绝，其余弹授权窗口等用户决定
/// </summary>
public interface IOriginAuthorizer
{
    /// <summary>
    /// 给出来源的授权结论；要弹授权窗口时先调用 notifyPending
    /// </summary>
    /// <param name="origin">规范写法的来源</param>
    /// <param name="notifyPending">弹窗前调用，通知浏览器正在等用户决定</param>
    /// <param name="cancellationToken">连接断开时取消</param>
    Task<ConsentDecision> AuthorizeAsync(string origin, Func<Task> notifyPending, CancellationToken cancellationToken);
}

/// <summary>
/// 客户端自身的信息与能力，写进 welcome
/// </summary>
public interface IClientEnvironment
{
    /// <summary>
    /// 客户端信息
    /// </summary>
    ClientInfo Info { get; }

    /// <summary>
    /// 客户端能力
    /// </summary>
    ClientCapabilities Capabilities { get; }
}

/// <summary>
/// 握手之后的业务请求由它处理：查打印机、受理任务、查与取消任务
/// </summary>
public interface IRequestHandler
{
    /// <summary>
    /// 处理一条请求，回复经 session 发出；不等任务执行完
    /// </summary>
    Task HandleAsync(ClientSession session, ClientRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// 会话重连后仍未结束的任务
    /// </summary>
    IReadOnlyList<string> UnfinishedJobs(ClientSession session);

    /// <summary>
    /// 会话重连、welcome 发出之后，补发这些任务的当前状态
    /// </summary>
    Task ReplayAsync(ClientSession session, CancellationToken cancellationToken);
}

/// <summary>
/// 日志级别
/// </summary>
public enum LogLevel
{
    /// <summary>
    /// 调试
    /// </summary>
    Debug,

    /// <summary>
    /// 一般信息
    /// </summary>
    Information,

    /// <summary>
    /// 警告
    /// </summary>
    Warning,

    /// <summary>
    /// 错误
    /// </summary>
    Error,
}

/// <summary>
/// 写日志
/// </summary>
public interface IClientLog
{
    /// <summary>
    /// 写一条日志；不写文档内容与原始指令内容
    /// </summary>
    void Write(LogLevel level, string message, Exception? exception = null);
}

/// <summary>
/// 不写日志
/// </summary>
public sealed class NullClientLog : IClientLog
{
    /// <summary>
    /// 共用实例
    /// </summary>
    public static NullClientLog Instance { get; } = new();

    /// <inheritdoc />
    public void Write(LogLevel level, string message, Exception? exception = null)
    {
    }
}
