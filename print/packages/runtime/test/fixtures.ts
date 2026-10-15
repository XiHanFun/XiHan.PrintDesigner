/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintDocument, PrintElement, PrintPage } from '@xihan-print/core'
import type { TextMeasurer } from '@xihan-ui/viz'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

export const registry = createElementRegistry()

/** 假度量器：每个字符宽「字号（pt）× 0.2」mm，按 CSS 像素交回；略收一点，整倍数宽度不被浮点误差挤到下一行。 */
export function createFakeMeasurer(): TextMeasurer {
  return {
    version: 0,
    measure: (text, font) => ({ width: Array.from(text).length * font.size * 0.75 * 0.2 * 96 / 25.4 * (1 - 1e-9), ascent: font.size * 0.8, descent: font.size * 0.2 }),
  }
}

/** 一页 A4，正文里放给定的元素。 */
export function pageOf(id: string, elements: PrintElement[], options: Parameters<typeof createPage>[0] = { id }): PrintPage {
  const page = createPage({ ...options, id })
  page.elements = elements
  return page
}

export function documentOf(...pages: PrintPage[]): PrintDocument {
  return createDocument({ pages })
}

/** 一段固定文字。 */
export function textElement(id: string, text: string, x = 10, y = 20): PrintElement {
  return registry.createElement('text', { id, x, y, overrides: { content: { kind: 'static', text } } })
}

/** 取第 index 张输出页里某个元素的外框。 */
export function boxIn(container: Element, elementId: string, index = 0): HTMLElement {
  const sheet = container.querySelectorAll('[data-part="sheet"]')[index]
  const box = sheet?.querySelector<HTMLElement>(`[data-part="box"][data-element-id="${elementId}"]`)
  if (box === null || box === undefined)
    throw new Error(`missing box ${elementId}`)
  return box
}
