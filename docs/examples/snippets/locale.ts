/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 界面语言：UI 与打印同一语言的语言包合并后全局生效，预览与设计器都跟着换；这里以中文为例。

// #region example
import { printZhCN } from '@xihan-print/runtime/locale'
import { mergeXhConfig, setXhConfig } from '@xihan-ui/web-components'
import { zhCN } from '@xihan-ui/web-components/locale'

setXhConfig(mergeXhConfig(zhCN, printZhCN))
// #endregion example
