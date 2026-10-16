// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Windows;

namespace XiHan.PrintClient;

/// <summary>
/// 程序入口
/// </summary>
internal static class Program
{
    /// <summary>
    /// 启动托盘程序；已有实例在运行时，手动启动的把它的设置窗口带到前台，开机自启的直接退出
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        var autoStarted = args.Contains(AutoStart.Argument, StringComparer.OrdinalIgnoreCase);
        using var instance = SingleInstance.TryAcquire();
        if (instance is null)
        {
            if (!autoStarted)
                SingleInstance.SignalAsync().GetAwaiter().GetResult();
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext(instance, quiet: autoStarted));
    }
}
