/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { ExtensionFlowBlock, FlowExtensionElementPrototype } from '../registry/types'
import type { ExtensionElement, PrintElement } from '../schema/elements'
import type { DiagnosticScope, LayoutContext } from './context'
import type { BodyGeometry, Placement, SheetCursor } from './placement'
import type { ExtensionLayoutBox } from './types'
import { getFieldValue } from '../data'
import { boxBase, measureText } from './boxes'
import { LAYOUT_EPSILON } from './context'
import { bodyBottom, isAtBodyTop, nextSheetTop } from './placement'

/** 已取值的跨页扩展元素。 */
export interface PreparedExtensionFlow {
  element: ExtensionElement
  blocks: readonly ExtensionFlowBlock[]
  repeat: ExtensionFlowBlock | undefined
}

/** 元素是不是登记了的跨页扩展元素。 */
export function isFlowExtension(element: PrintElement, context: LayoutContext): boolean {
  const prototype = context.elements.get(element.type)
  return prototype?.flow === true && typeof prototype.prepare === 'function'
}

function checkBlock(block: ExtensionFlowBlock, type: string): ExtensionFlowBlock {
  if (!Number.isFinite(block.height) || block.height < 0)
    throw new TypeError(`[xh-print] 扩展元素 ${type} 的 prepare 给出的块高度要是不小于 0 的有限数，实际是 ${block.height}`)
  return block
}

/** 按登记的原型的 prepare 取值；块高度不是不小于 0 的有限数时抛 TypeError。 */
export function prepareExtensionFlow(element: ExtensionElement, context: LayoutContext): PreparedExtensionFlow {
  const prepare = context.elements.get(element.type)!.prepare as FlowExtensionElementPrototype['prepare']
  const content = prepare(element, {
    data: context.data,
    region: 'body',
    field: path => getFieldValue(context.data, path),
    measureText: (text, style, width) => measureText(context, text, style, width, true),
  })
  return {
    element,
    blocks: content.blocks.map(block => checkBlock(block, element.type)),
    repeat: content.repeat === undefined ? undefined : checkBlock(content.repeat, element.type),
  }
}

/**
 * 从起点开始排跨页扩展元素：块依次排进正文区，放不下的块整块挪到下一页，每段开头放重复块。
 * 只有一段时高度不小于设计高度（以当页剩余空间为限）；一块比整页正文区还高时照样放下并报 element.overflow。
 */
export function placeExtensionFlow(
  prepared: PreparedExtensionFlow,
  start: SheetCursor,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  const { element, blocks, repeat } = prepared
  const repeatHeight = repeat?.height ?? 0
  const boxes: Placement['boxes'] = []
  let cursor = start
  let index = 0

  const pushBox = (from: number, to: number, height: number): void => {
    const data: JsonValue = { blocks: blocks.slice(from, to).map(block => block.data), repeat: repeat?.data ?? null }
    const box: ExtensionLayoutBox = { ...boxBase(element, 'body'), y: cursor.y, height, kind: 'extension', data, fragment: { index: boxes.length, last: false } }
    boxes.push({ sheet: cursor.sheet, box })
  }

  const heightOf = (from: number, to: number): number => blocks.slice(from, to).reduce((sum, block) => sum + block.height, repeatHeight)

  while (cursor.sheet < geometry.limit) {
    const available = bodyBottom(geometry.bodyRect(cursor.sheet)) - cursor.y
    const rest = heightOf(index, blocks.length)
    if (rest <= available + LAYOUT_EPSILON) {
      const height = boxes.length === 0 ? Math.max(rest, Math.min(element.height, available)) : rest
      pushBox(index, blocks.length, height)
      const last = boxes.at(-1)!.box as ExtensionLayoutBox
      last.fragment!.last = true
      return { boxes, end: { sheet: cursor.sheet, y: cursor.y + height }, truncated: false }
    }
    let fit = index
    let used = repeatHeight
    while (fit < blocks.length && used + blocks[fit]!.height <= available + LAYOUT_EPSILON) {
      used += blocks[fit]!.height
      fit++
    }
    if (fit === index && !isAtBodyTop(cursor, geometry)) {
      cursor = nextSheetTop(cursor.sheet, geometry)
      continue
    }
    if (fit === index) {
      context.report('element.overflow', scope)
      fit = index + 1
      used = heightOf(index, fit)
    }
    pushBox(index, fit, used)
    index = fit
    if (index >= blocks.length) {
      const last = boxes.at(-1)!.box as ExtensionLayoutBox
      last.fragment!.last = true
      return { boxes, end: { sheet: cursor.sheet, y: cursor.y + used }, truncated: false }
    }
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
