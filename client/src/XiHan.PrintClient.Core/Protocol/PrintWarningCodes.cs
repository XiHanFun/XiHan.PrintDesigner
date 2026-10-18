// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 客户端在完成的任务里给出的提醒码
/// </summary>
public static class PrintWarningCodes
{
    /// <summary>
    /// 驱动没有报纸张能力，或读不出驱动会留下哪种纸，没有核对纸张就照常下发了
    /// </summary>
    public const string PaperUnchecked = "PAPER_UNCHECKED";

    /// <summary>
    /// 按 fitToNearestPaper 把某组改用了最接近的纸张：比纸大的内容按 scale 等比缩小，比纸小的原大居中
    /// </summary>
    public const string PaperFitted = "PAPER_FITTED";
}
