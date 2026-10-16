// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core;

/// <summary>
/// 客户端在本机读写的目录与文件位置
/// </summary>
public interface IAppPaths
{
    /// <summary>
    /// 用户设置所在的目录：允许名单、拒绝名单与界面设置
    /// </summary>
    string SettingsDirectory { get; }

    /// <summary>
    /// 日志目录
    /// </summary>
    string LogDirectory { get; }

    /// <summary>
    /// 渲染引擎的用户数据目录
    /// </summary>
    string RendererDataDirectory { get; }

    /// <summary>
    /// 管理员下发的策略文件，不存在即没有策略
    /// </summary>
    string PolicyFile { get; }
}
