// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Consent;

/// <summary>
/// 用户在授权窗口里的选择
/// </summary>
public enum ConsentChoice
{
    /// <summary>
    /// 允许，并记进允许名单
    /// </summary>
    Allow,

    /// <summary>
    /// 只放行这次连接
    /// </summary>
    AllowOnce,

    /// <summary>
    /// 拒绝这次
    /// </summary>
    Deny,

    /// <summary>
    /// 拒绝，并记进拒绝名单不再询问
    /// </summary>
    DenyAlways,
}

/// <summary>
/// 授权窗口：写明来源，等用户选择；取消时关掉窗口并抛出 <see cref="OperationCanceledException"/>
/// </summary>
public interface IConsentPrompt
{
    /// <summary>
    /// 弹出授权窗口并等用户选择
    /// </summary>
    Task<ConsentChoice> AskAsync(string origin, CancellationToken cancellationToken);
}

/// <summary>
/// 来源授权：策略预先放行的、用户允许名单里的立即放行，拒绝名单里的立即拒绝；其余在策略允许时弹授权窗口，
/// 同一来源同一时刻只弹一个窗口，同时连上来的连接共用这一次的结论
/// </summary>
public sealed class OriginAuthorizer : IOriginAuthorizer
{
    private readonly OriginLists _lists;
    private readonly ClientPolicy _policy;
    private readonly IConsentPrompt _prompt;
    private readonly TimeSpan _timeout;
    private readonly IClientLog _log;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, Task<ConsentDecision>> _asking = new(StringComparer.Ordinal);

    /// <summary>
    /// 创建授权；timeout 是授权窗口等用户的期限，缺省 60 秒
    /// </summary>
    public OriginAuthorizer(OriginLists lists, ClientPolicy policy, IConsentPrompt prompt, TimeSpan? timeout = null, IClientLog? log = null)
    {
        _lists = lists;
        _policy = policy;
        _prompt = prompt;
        _timeout = timeout ?? TimeSpan.FromSeconds(60);
        _log = log ?? NullClientLog.Instance;
    }

    /// <inheritdoc />
    public async Task<ConsentDecision> AuthorizeAsync(string origin, Func<Task> notifyPending, CancellationToken cancellationToken)
    {
        if (_policy.AllowedOrigins.Contains(origin, StringComparer.Ordinal) || _lists.IsAllowed(origin))
            return ConsentDecision.Allowed;
        if (_lists.IsDenied(origin) || !_policy.PromptForUnknownOrigins)
            return ConsentDecision.Denied;

        Task<ConsentDecision> asking;
        lock (_gate)
        {
            if (!_asking.TryGetValue(origin, out asking!))
            {
                asking = AskAsync(origin);
                _asking[origin] = asking;
            }
        }
        await notifyPending().ConfigureAwait(false);
        return await asking.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<ConsentDecision> AskAsync(string origin)
    {
        await Task.Yield();
        try
        {
            using var timeout = new CancellationTokenSource(_timeout);
            var choice = await _prompt.AskAsync(origin, timeout.Token).ConfigureAwait(false);
            _log.Write(LogLevel.Information, $"授权窗口：{origin} → {choice}");
            switch (choice)
            {
                case ConsentChoice.Allow:
                    _lists.Allow(origin);
                    return ConsentDecision.Allowed;
                case ConsentChoice.AllowOnce:
                    return ConsentDecision.Allowed;
                case ConsentChoice.DenyAlways:
                    _lists.Deny(origin);
                    return ConsentDecision.Denied;
                default:
                    return ConsentDecision.Denied;
            }
        }
        catch (OperationCanceledException)
        {
            _log.Write(LogLevel.Information, $"授权窗口超时：{origin}");
            return ConsentDecision.TimedOut;
        }
        finally
        {
            lock (_gate)
                _asking.Remove(origin);
        }
    }
}
