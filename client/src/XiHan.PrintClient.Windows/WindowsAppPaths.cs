// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core;

namespace XiHan.PrintClient.Windows;

/// <summary>
/// Windows 上的目录：设置在 %AppData%，日志与渲染数据在 %LocalAppData%，策略在 %ProgramData%，都在 XiHanFun\PrintClient 下
/// </summary>
public sealed class WindowsAppPaths : IAppPaths
{
    private const string Vendor = "XiHanFun";
    private const string Product = "PrintClient";

    /// <summary>
    /// 按当前用户的系统目录创建
    /// </summary>
    public WindowsAppPaths()
        : this(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData))
    {
    }

    /// <summary>
    /// 按给定的三个根目录创建
    /// </summary>
    /// <param name="roaming">对应 %AppData%</param>
    /// <param name="local">对应 %LocalAppData%</param>
    /// <param name="machine">对应 %ProgramData%</param>
    public WindowsAppPaths(string roaming, string local, string machine)
    {
        SettingsDirectory = Path.Combine(roaming, Vendor, Product);
        LogDirectory = Path.Combine(local, Vendor, Product, "logs");
        RendererDataDirectory = Path.Combine(local, Vendor, Product, "webview");
        UpdateDirectory = Path.Combine(local, Vendor, Product, "updates");
        PolicyFile = Path.Combine(machine, Vendor, Product, "policy.json");
    }

    /// <inheritdoc />
    public string SettingsDirectory { get; }

    /// <inheritdoc />
    public string LogDirectory { get; }

    /// <inheritdoc />
    public string RendererDataDirectory { get; }

    /// <inheritdoc />
    public string UpdateDirectory { get; }

    /// <inheritdoc />
    public string PolicyFile { get; }
}
