/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PageBandSet, PrintDocument, PrintPage } from './schema/document'
import type { PrintElement } from './schema/elements'
import type { PageBandKey } from './schema/options'

/** 元素所在区域：正文、页眉或页脚。 */
export type ElementRegion = 'body' | 'header' | 'footer'

/** 元素容器：页面正文，或页眉、页脚中的某个带区。 */
export type ElementContainerRef
  = | { pageId: string, region: 'body' }
    | { pageId: string, region: 'header' | 'footer', band: PageBandKey }

/** 元素在文档中的位置。 */
export interface ElementLocation {
  element: PrintElement
  page: PrintPage
  pageIndex: number
  container: ElementContainerRef
  /** 元素在容器中的下标，越靠后层级越高。 */
  index: number
  /** 元素从文档根开始的 JSON 路径。 */
  path: (string | number)[]
}

/** 页眉页脚带区键，按 default、first、last、odd、even 的顺序。 */
export const PAGE_BAND_KEYS: readonly PageBandKey[] = ['default', 'first', 'last', 'odd', 'even']

/** 列出页眉或页脚中已存在的带区键。 */
export function listPageBandKeys(set: PageBandSet): PageBandKey[] {
  return PAGE_BAND_KEYS.filter(key => set[key] !== undefined)
}

/** 取容器的元素数组；页面或带区不存在时返回 undefined。 */
export function getContainerElements(page: PrintPage, container: ElementContainerRef): PrintElement[] | undefined {
  if (container.region === 'body')
    return page.elements
  return page[container.region][container.band]?.elements
}

/** 取容器元素数组相对页面的 JSON 路径。 */
export function getContainerPath(container: ElementContainerRef): (string | number)[] {
  return container.region === 'body' ? ['elements'] : [container.region, container.band, 'elements']
}

/** 列出页面上的全部容器，按正文、页眉、页脚的顺序。 */
export function listContainers(page: PrintPage): ElementContainerRef[] {
  const containers: ElementContainerRef[] = [{ pageId: page.id, region: 'body' }]
  for (const region of ['header', 'footer'] as const) {
    for (const band of listPageBandKeys(page[region]))
      containers.push({ pageId: page.id, region, band })
  }
  return containers
}

/** 按页面、正文、页眉、页脚的顺序遍历全部元素。 */
export function forEachElement(document: PrintDocument, visit: (location: ElementLocation) => void): void {
  document.pages.forEach((page, pageIndex) => {
    for (const container of listContainers(page)) {
      const elements = getContainerElements(page, container) ?? []
      const base = ['pages', pageIndex, ...getContainerPath(container)]
      elements.forEach((element, index) => {
        visit({ element, page, pageIndex, container, index, path: [...base, index] })
      })
    }
  })
}

/** 按标识查找元素。 */
export function findElement(document: PrintDocument, id: string): ElementLocation | undefined {
  let found: ElementLocation | undefined
  forEachElement(document, (location) => {
    if (found === undefined && location.element.id === id)
      found = location
  })
  return found
}

/** 按标识查找页面及其下标。 */
export function findPage(document: PrintDocument, pageId: string): { page: PrintPage, index: number } | undefined {
  const index = document.pages.findIndex(page => page.id === pageId)
  const page = document.pages[index]
  return page === undefined ? undefined : { page, index }
}
