/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { LayoutSheet, PaginationResult } from '@xihan-print/core'
import type { Size } from '@xihan-ui/designer-kit'
import { renderBox } from './boxes'
import { mm, setStyles } from './css'
import { renderWatermark } from './watermark'

/** renderSheets 的选项。 */
export interface RenderSheetsOptions {
  /** 是否画只在预览中显示的元素，缺省 true；送去打印时为 false。 */
  readonly previewOnly?: boolean
}

/** 纸张尺寸对应的 CSS 具名页面，尺寸相同的输出页共用一个名字。 */
export function sheetPageName(size: Size): string {
  const part = (value: number): string => String(Math.round(value * 100) / 100).replace('.', '_')
  return `xh-print-${part(size.width)}x${part(size.height)}`
}

function renderSheet(doc: Document, sheet: LayoutSheet, options: RenderSheetsOptions): HTMLDivElement {
  const element = doc.createElement('div')
  element.dataset.part = 'sheet'
  element.dataset.pageId = sheet.pageId
  element.dataset.pageNumber = String(sheet.pageNumber)
  setStyles(element, {
    position: 'relative',
    width: mm(sheet.size.width),
    height: mm(sheet.size.height),
    overflow: 'hidden',
    page: sheetPageName(sheet.size),
  })
  for (const box of sheet.boxes) {
    if (box.previewOnly && options.previewOnly === false)
      continue
    element.append(renderBox(doc, box))
  }
  const watermark = sheet.watermark === undefined ? undefined : renderWatermark(doc, sheet.watermark)
  if (watermark !== undefined)
    element.append(watermark)
  return element
}

/**
 * 把分页结果渲染进 container：先清空 container，再按顺序放入每张输出页，返回这些输出页元素。
 * 输出页按纸张尺寸定宽高，元素按毫米绝对定位；只用标准 HTML 与 SVG，任何文档里都能渲染，
 * 不依赖自定义元素注册。
 */
export function renderSheets(result: PaginationResult, container: Element, options: RenderSheetsOptions = {}): HTMLDivElement[] {
  const doc = container.ownerDocument
  const sheets = result.sheets.map(sheet => renderSheet(doc, sheet, options))
  container.replaceChildren(...sheets)
  return sheets
}
