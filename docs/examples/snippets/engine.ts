/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 换一个表达式引擎：提供当前时间，让 TODAY()、NOW() 可用；再登记一个宿主函数 MASK_PHONE。

// #region example
import type { XhPrintPreview } from '@xihan-print/runtime'
import { createExpressionEngine, ExprDate } from '@xihan-ui/expression'

export function useEngine(preview: XhPrintPreview): void {
  preview.expressionEngine = createExpressionEngine({
    now: () => {
      const date = new Date()
      return ExprDate.fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds())
    },
    functions: [
      {
        name: 'MASK_PHONE',
        minArgs: 1,
        maxArgs: 1,
        call: ([phone], context) => {
          if (phone === null)
            return null
          if (typeof phone !== 'string')
            return context.typeMismatch(0)
          return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone
        },
      },
    ],
  })
}
// #endregion example
