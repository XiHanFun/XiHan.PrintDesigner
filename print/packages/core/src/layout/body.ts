/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintElement } from '../schema/elements'
import type { DiagnosticScope, LayoutContext } from './context'
import type { PreparedExtensionFlow } from './extension-flow'
import type { PreparedLongText } from './long-text'
import type { BodyGeometry, PlacedBox, Placement, SheetCursor } from './placement'
import type { PreparedRichText } from './rich-text'
import type { PreparedTable } from './table'
import type { LayoutBox } from './types'
import { LAYOUT_EPSILON } from './context'
import { placeExtensionFlow } from './extension-flow'
import { placeLongText } from './long-text'
import { bodyBottom, compareCursors, nextSheetTop } from './placement'
import { placeRichText } from './rich-text'
import { placeTable } from './table'

/** 已取值与测量的正文元素；scope 为元素的诊断定位。 */
export type BodyItem
  = | { kind: 'fixed', element: PrintElement, index: number, scope: DiagnosticScope, box: LayoutBox }
    | { kind: 'longText', element: PrintElement, index: number, scope: DiagnosticScope, prepared: PreparedLongText }
    | { kind: 'richText', element: PrintElement, index: number, scope: DiagnosticScope, prepared: PreparedRichText }
    | { kind: 'table', element: PrintElement, index: number, scope: DiagnosticScope, prepared: PreparedTable }
    | { kind: 'extension', element: PrintElement, index: number, scope: DiagnosticScope, prepared: PreparedExtensionFlow }

/** 正文排版结果。 */
export interface BodyLayout {
  /** 按元素层级顺序排列的布局盒。 */
  boxes: PlacedBox[]
  /** 正文内容占用的输出页数，至少为 1。 */
  sheetCount: number
  truncated: boolean
}

function startOf(item: BodyItem, placed: readonly { designBottom: number, end: SheetCursor }[]): { cursor: SheetCursor, displaced: boolean } {
  const { element } = item
  let cursor: SheetCursor = { sheet: 0, y: element.y }
  let displaced = false
  for (const anchor of placed) {
    if (anchor.designBottom > element.y + LAYOUT_EPSILON)
      continue
    const candidate = { sheet: anchor.end.sheet, y: anchor.end.y + element.y - anchor.designBottom }
    if (compareCursors(candidate, cursor) > LAYOUT_EPSILON) {
      cursor = candidate
      displaced = true
    }
  }
  return { cursor, displaced }
}

function placeFixed(
  item: Extract<BodyItem, { kind: 'fixed' }>,
  start: SheetCursor,
  displaced: boolean,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  const { element } = item
  let cursor = start
  if (displaced && cursor.y + element.height > bodyBottom(geometry.bodyRect(cursor.sheet)) + LAYOUT_EPSILON) {
    cursor = nextSheetTop(cursor.sheet, geometry)
    if (element.height > geometry.bodyRect(cursor.sheet).height + LAYOUT_EPSILON)
      context.report('element.overflow', scope)
  }
  if (cursor.sheet >= geometry.limit) {
    context.report('layout.sheetLimit', scope, { limit: geometry.limit })
    return { boxes: [], end: start, truncated: true }
  }
  return {
    boxes: [{ sheet: cursor.sheet, box: { ...item.box, y: cursor.y } }],
    end: { sheet: cursor.sheet, y: cursor.y + element.height },
    truncated: false,
  }
}

function placeFlow(
  item: Exclude<BodyItem, { kind: 'fixed' }>,
  start: SheetCursor,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  let cursor = start
  const body = geometry.bodyRect(cursor.sheet)
  if (cursor.y < body.y)
    cursor = { sheet: cursor.sheet, y: body.y }
  if (cursor.y >= bodyBottom(body) - LAYOUT_EPSILON)
    cursor = nextSheetTop(cursor.sheet, geometry)
  switch (item.kind) {
    case 'table':
      return placeTable(item.prepared, cursor, geometry, context, scope)
    case 'richText':
      return placeRichText(item.prepared, cursor, geometry, context, scope)
    case 'longText':
      return placeLongText(item.prepared, cursor, geometry, context, scope)
    case 'extension':
      return placeExtensionFlow(item.prepared, cursor, geometry, context, scope)
  }
}

/**
 * 按设计 top 依次排正文元素：每个元素取其上方各元素（设计底边不低于本元素设计顶边）的排后底边加设计间距中最靠后的位置，
 * 不在任何元素之下的元素留在首页设计位置；被下推的不跨页元素越过正文区底边时移到下一页正文区顶部；
 * 长文本、富文本、表格与跨页的扩展元素从起点续排到后续输出页。
 */
export function layoutBody(items: readonly BodyItem[], geometry: BodyGeometry, context: LayoutContext): BodyLayout {
  const order = [...items].sort((a, b) =>
    a.element.y - b.element.y || a.element.height - b.element.height || a.index - b.index,
  )
  const placed: { designBottom: number, end: SheetCursor }[] = []
  const results = new Map<number, Placement>()
  let truncated = false

  for (const item of order) {
    const { scope } = item
    const { cursor, displaced } = startOf(item, placed)
    const placement = item.kind === 'fixed'
      ? placeFixed(item, cursor, displaced, geometry, context, scope)
      : placeFlow(item, cursor, geometry, context, scope)
    truncated ||= placement.truncated
    results.set(item.index, placement)
    placed.push({ designBottom: item.element.y + item.element.height, end: placement.end })
  }

  const boxes = [...items]
    .sort((a, b) => a.index - b.index)
    .flatMap(item => results.get(item.index)?.boxes ?? [])
  const sheetCount = boxes.reduce((count, placedBox) => Math.max(count, placedBox.sheet + 1), 1)
  return { boxes, sheetCount, truncated }
}
