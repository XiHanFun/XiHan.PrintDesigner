// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient;

/// <summary>
/// 托盘程序的生命周期：托盘图标与菜单，退出时收起图标
/// </summary>
internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon _icon;

    /// <summary>
    /// 创建托盘图标与菜单
    /// </summary>
    public TrayContext()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("退出", null, (_, _) => ExitThread());
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "曦寒打印客户端",
            ContextMenuStrip = menu,
            Visible = true,
        };
    }

    /// <inheritdoc />
    protected override void ExitThreadCore()
    {
        _icon.Visible = false;
        _icon.Dispose();
        base.ExitThreadCore();
    }
}
