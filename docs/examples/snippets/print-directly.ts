/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 不显示预览，直接排版并调起浏览器的打印对话框。

// #region example
import type { PrintOutcome } from '@xihan-print/runtime'
import { printDocument } from '@xihan-print/runtime'
import { data, schema } from '../templates/delivery'

export async function printDelivery(): Promise<PrintOutcome> {
  // outcome.sheets 是送去打印的页数，outcome.diagnostics 是分页诊断
  const outcome = await printDocument(schema, data, { title: '送货单' })
  return outcome
}
// #endregion example
