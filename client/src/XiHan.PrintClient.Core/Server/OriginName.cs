// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 来源的规范写法：协议加主机加非缺省端口，如 https://erp.example.com、http://localhost:5173
/// </summary>
public static class OriginName
{
    /// <summary>
    /// 把浏览器带的 Origin 头换成规范写法；只收 http 与 https，带路径、查询、用户信息或写成 null 的一律不收
    /// </summary>
    /// <param name="value">Origin 头的原值</param>
    /// <param name="origin">规范写法</param>
    public static bool TryNormalize(string? value, out string origin)
    {
        origin = string.Empty;
        if (string.IsNullOrWhiteSpace(value) || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
            return false;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return false;
        if (uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0 || uri.AbsolutePath != "/" || uri.Host.Length == 0)
            return false;
        if (value.TrimEnd().EndsWith('/'))
            return false;
        origin = uri.GetLeftPart(UriPartial.Authority);
        return true;
    }
}
