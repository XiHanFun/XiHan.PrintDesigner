/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Edges } from '../schema/common'
import type { LongTextElement } from '../schema/elements'
import type { DiagnosticScope, LayoutContext } from './context'
import type { BodyGeometry, Placement, SheetCursor } from './placement'
import type { TextLayoutBox } from './types'
import { boxBase, measureText, paddingOf } from './boxes'
import { contentText } from './content'
import { LAYOUT_EPSILON } from './context'
import { bodyBottom, isAtBodyTop, nextSheetTop } from './placement'

/** 已测量的长文本。 */
export interface PreparedLongText {
  element: LongTextElement
  lines: string[]
  /** 单行高度，单位 mm。 */
  lineHeight: number
  padding: Edges
}

/** 取值并按元素宽度换行测量。 */
export function prepareLongText(element: LongTextElement, context: LayoutContext, scope: DiagnosticScope): PreparedLongText {
  const padding = paddingOf(element)
  const text = contentText(element.content, context.data, context, scope)
  const measurement = measureText(context, text, element.style, element.width - padding.left - padding.right, true)
  const lineHeight = measurement.lines.length === 0 ? 0 : measurement.height / measurement.lines.length
  return { element, lines: measurement.lines, lineHeight, padding }
}

/**
 * 从起点开始排长文本，按整行切分到后续输出页；每段各带上下内边距。
 * 只有一段时高度不小于设计高度（以当页剩余空间为限）。
 */
export function placeLongText(
  prepared: PreparedLongText,
  start: SheetCursor,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  const { element, lines, lineHeight, padding } = prepared
  const verticalPadding = padding.top + padding.bottom
  const boxes: Placement['boxes'] = []
  let cursor = start
  let index = 0

  const pushBox = (from: number, to: number, y: number, height: number): void => {
    const box: TextLayoutBox = {
      ...boxBase(element, 'body'),
      y,
      height,
      kind: 'text',
      lines: lines.slice(from, to),
      style: element.style,
      overflow: 'clip',
      rotation: 0,
      fragment: { index: boxes.length, last: false },
    }
    if (element.box !== undefined)
      box.box = element.box
    boxes.push({ sheet: cursor.sheet, box })
  }

  const finish = (height: number): Placement => {
    pushBox(index, lines.length, cursor.y, height)
    const last = boxes.at(-1)?.box
    if (last?.kind === 'text' && last.fragment !== undefined)
      last.fragment.last = true
    return { boxes, end: { sheet: cursor.sheet, y: cursor.y + height }, truncated: false }
  }

  while (cursor.sheet < geometry.limit) {
    const available = bodyBottom(geometry.bodyRect(cursor.sheet)) - cursor.y
    const remaining = lines.length - index
    const contentHeight = remaining * lineHeight + verticalPadding
    if (contentHeight <= available + LAYOUT_EPSILON)
      return finish(boxes.length === 0 ? Math.max(contentHeight, Math.min(element.height, available)) : contentHeight)

    const fit = remaining === 0 ? 0 : Math.floor((available - verticalPadding + LAYOUT_EPSILON) / lineHeight)
    if (fit <= 0 && !isAtBodyTop(cursor, geometry)) {
      cursor = nextSheetTop(cursor.sheet, geometry)
      continue
    }
    if (fit <= 0) {
      context.report('element.overflow', scope)
      if (remaining <= 1)
        return finish(contentHeight)
    }
    const count = Math.max(fit, 1)
    pushBox(index, index + count, cursor.y, count * lineHeight + verticalPadding)
    index += count
    cursor = nextSheetTop(cursor.sheet, geometry)
  }

  context.report('layout.sheetLimit', scope, { limit: geometry.limit })
  const last = boxes.at(-1)
  return {
    boxes,
    end: last === undefined ? start : { sheet: last.sheet, y: last.box.y + last.box.height },
    truncated: true,
  }
}
