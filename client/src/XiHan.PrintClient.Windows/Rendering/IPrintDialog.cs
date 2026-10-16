// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Rendering;

/// <summary>
/// 系统打印对话框：在界面线程上调用，用户确认后给出选定的打印机与选项
/// </summary>
public interface IPrintDialog
{
    /// <summary>
    /// 以请求里的打印机与选项为初值弹出对话框；用户取消时返回 null
    /// </summary>
    Task<PrintDialogChoice?> AskAsync(string printer, PrintOptions options, int sheetCount, CancellationToken cancellationToken);
}

/// <summary>
/// 用户在打印对话框里选定的打印机与选项
/// </summary>
/// <param name="Printer">打印机名称</param>
/// <param name="Options">打印选项，Dialog 不再生效</param>
public sealed record PrintDialogChoice(string Printer, PrintOptions Options);
