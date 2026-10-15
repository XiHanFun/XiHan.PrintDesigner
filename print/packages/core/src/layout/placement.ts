/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect } from '@xihan-ui/designer-kit'
import type { LayoutBox } from './types'
import { LAYOUT_EPSILON } from './context'

/** 正文中的位置：输出页序号与纸张上的纵坐标。 */
export interface SheetCursor {
  sheet: number
  y: number
}

/** 正文区几何：按输出页序号给出正文区，`limit` 为可用的输出页数。 */
export interface BodyGeometry {
  bodyRect: (sheet: number) => Rect
  limit: number
}

/** 放到某张输出页上的布局盒。 */
export interface PlacedBox {
  sheet: number
  box: LayoutBox
}

/** 一个正文元素的排版结果。 */
export interface Placement {
  boxes: PlacedBox[]
  /** 元素排完后所占位置的下沿。 */
  end: SheetCursor
  /** 是否因输出页数上限而没有排完。 */
  truncated: boolean
}

/** 比较两个位置的先后。 */
export function compareCursors(a: SheetCursor, b: SheetCursor): number {
  return a.sheet === b.sheet ? a.y - b.y : a.sheet - b.sheet
}

/** 取正文区下沿。 */
export function bodyBottom(rect: Rect): number {
  return rect.y + rect.height
}

/** 判断位置是否位于该页正文区顶部。 */
export function isAtBodyTop(cursor: SheetCursor, geometry: BodyGeometry): boolean {
  return cursor.y <= geometry.bodyRect(cursor.sheet).y + LAYOUT_EPSILON
}

/** 下一页正文区顶部。 */
export function nextSheetTop(sheet: number, geometry: BodyGeometry): SheetCursor {
  return { sheet: sheet + 1, y: geometry.bodyRect(sheet + 1).y }
}
