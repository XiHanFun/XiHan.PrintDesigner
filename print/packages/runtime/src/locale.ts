/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印产品的中文文案：与 UI 的语言包一起交给 mergeXhConfig，再经 setXhConfig 或 <xh-config> 生效。

import type { XhConfig } from '@xihan-ui/web-components'

/** 打印预览的中文文案。 */
export const printZhCN: XhConfig = {
  translations: {
    'xh-print-preview': {
      label: '打印预览',
      sheetLabel: (position: number, count: number) => `第 ${position} 页，共 ${count} 页`,
    },
  },
}
