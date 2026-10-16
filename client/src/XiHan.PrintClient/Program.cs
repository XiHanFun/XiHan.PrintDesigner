// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient;

/// <summary>
/// 程序入口
/// </summary>
internal static class Program
{
    /// <summary>
    /// 启动托盘程序
    /// </summary>
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext());
    }
}
