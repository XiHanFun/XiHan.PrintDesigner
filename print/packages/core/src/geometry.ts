/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect, Size } from '@xihan-ui/designer-kit'
import type { PageBand, PageBandSet, PrintPage } from './schema/document'
import type { ElementBase } from './schema/elements'
import type { PageBandKey } from './schema/options'

/** 输出页在所属页面模板中的位置。 */
export interface SheetPosition {
  /** 是否为该页面模板排出的第一张输出页。 */
  isFirst: boolean
  /** 是否为该页面模板排出的最后一张输出页。 */
  isLast: boolean
  /** 该输出页的页码。 */
  pageNumber: number
}

/** 取页面按方向换算后的纸张尺寸。 */
export function getPaperSize(page: Pick<PrintPage, 'paper' | 'orientation'>): Size {
  const { width, height } = page.paper
  return page.orientation === 'landscape' ? { width: height, height: width } : { width, height }
}

/** 取页边距以内的内容区。 */
export function getContentRect(page: Pick<PrintPage, 'paper' | 'orientation' | 'margins'>): Rect {
  const paper = getPaperSize(page)
  const { top, right, bottom, left } = page.margins
  return {
    x: left,
    y: top,
    width: paper.width - left - right,
    height: paper.height - top - bottom,
  }
}

/** 取页眉或页脚带区在纸张上的矩形。 */
export function getBandRect(
  page: Pick<PrintPage, 'paper' | 'orientation' | 'margins'>,
  region: 'header' | 'footer',
  band: Pick<PageBand, 'height'>,
): Rect {
  const content = getContentRect(page)
  const y = region === 'header' ? content.y : content.y + content.height - band.height
  return { x: content.x, y, width: content.width, height: band.height }
}

/** 取给定页眉、页脚带区之间的正文区。 */
export function getBodyRect(
  page: Pick<PrintPage, 'paper' | 'orientation' | 'margins'>,
  header: Pick<PageBand, 'height'>,
  footer: Pick<PageBand, 'height'>,
): Rect {
  const content = getContentRect(page)
  return {
    x: content.x,
    y: content.y + header.height,
    width: content.width,
    height: content.height - header.height - footer.height,
  }
}

/** 按输出页位置选出页眉或页脚应使用的带区键。 */
export function resolvePageBandKey(set: PageBandSet, sheet: SheetPosition): PageBandKey {
  const first = sheet.isFirst && set.first !== undefined
  const last = sheet.isLast && set.last !== undefined
  if (first && last)
    return set.singleSheet
  if (first)
    return 'first'
  if (last)
    return 'last'
  const parity = Math.abs(sheet.pageNumber) % 2 === 1 ? 'odd' : 'even'
  if (set[parity] !== undefined)
    return parity
  return 'default'
}

/** 取页眉或页脚中指定键的带区。 */
export function getPageBand(set: PageBandSet, key: PageBandKey): PageBand | undefined {
  return set[key]
}

/** 按输出页位置选出页眉或页脚应使用的带区。 */
export function resolvePageBand(set: PageBandSet, sheet: SheetPosition): PageBand {
  return set[resolvePageBandKey(set, sheet)] ?? set.default
}

/** 取元素框。 */
export function getElementRect(element: Pick<ElementBase<string>, 'x' | 'y' | 'width' | 'height'>): Rect {
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}
