// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using Microsoft.Win32;

namespace XiHan.PrintClient.Windows;

/// <summary>
/// 开机自启：当前用户 Run 键下的一项，值为启动命令
/// </summary>
public sealed class AutoStart
{
    /// <summary>
    /// 当前用户的 Run 键
    /// </summary>
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    /// <summary>
    /// Run 键下这一项的名字
    /// </summary>
    public const string ValueName = "XiHanPrint";

    /// <summary>
    /// 自启时附带的参数
    /// </summary>
    public const string Argument = "--autostart";

    private readonly string _keyPath;

    /// <summary>
    /// 以程序路径创建；keyPath 缺省为当前用户的 Run 键
    /// </summary>
    public AutoStart(string executablePath, string keyPath = RunKey)
    {
        Command = $"\"{executablePath}\" {Argument}";
        _keyPath = keyPath;
    }

    /// <summary>
    /// 写进 Run 键的启动命令
    /// </summary>
    public string Command { get; }

    /// <summary>
    /// Run 键里是否有指向本程序的这一项
    /// </summary>
    public bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(_keyPath);
            return key?.GetValue(ValueName) is string value && string.Equals(value, Command, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// 打开或关掉开机自启
    /// </summary>
    public void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(_keyPath, writable: true);
        if (enabled)
            key.SetValue(ValueName, Command, RegistryValueKind.String);
        else
            key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
