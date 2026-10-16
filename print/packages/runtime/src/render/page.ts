/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PaginationResult } from '@xihan-print/core'
import type { Size } from '@xihan-ui/designer-kit'
import { mm } from './css'
import { sheetPageName } from './sheets'

/** 打印文档的基础样式：去掉页边距，每张输出页之后分页，背景照原样打印。 */
export const PRINT_CSS = `html, body { margin: 0; padding: 0; background: none; }
[data-part="sheet"] { break-after: page; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
[data-part="sheet"]:last-child { break-after: auto; }`

/** 每种纸张尺寸一条具名 @page 规则，页边距为 0：边距已排进输出页。 */
export function pageRules(result: PaginationResult): string {
  const sizes = new Map<string, Size>()
  for (const sheet of result.sheets)
    sizes.set(sheetPageName(sheet.size), sheet.size)
  const rules = ['@page { margin: 0; }']
  for (const [name, size] of sizes)
    rules.push(`@page ${name} { size: ${mm(size.width)} ${mm(size.height)}; margin: 0; }`)
  return rules.join('\n')
}
