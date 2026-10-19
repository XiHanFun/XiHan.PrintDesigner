/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 页面结构：把模板按页面模板分组，每页分页眉、正文、页脚，页眉页脚有几种带区时再按带区分；
// 同一容器里的元素按层级排，最上层排最前。

import type { ElementContainerRef, PageBandKey, PrintDocument, PrintElement, PrintPage } from '@xihan-print/core'
import type { IconRecord } from '@xihan-ui/core'
import type { DesignerOutlineNode } from '@xihan-ui/designer-shell'
import { getContainerElements, listPageBandKeys } from '@xihan-print/core'

/** 页面结构里各行的文字与图标。 */
export interface PrintOutlineLabels {
  /** 页面模板的名字。 */
  readonly page: (page: PrintPage, index: number) => string
  readonly region: (region: 'header' | 'body' | 'footer') => string
  readonly band: (key: PageBandKey) => string
  /** 元素的名字、副文本与图标。 */
  readonly element: (element: PrintElement) => { readonly label: string, readonly description?: string, readonly icon?: IconRecord }
}

/** 一个元素在页面结构里的位置：上级那一行、所在的容器与容器里的元素个数。 */
export interface PrintOutlinePlace {
  readonly parent: string
  readonly container: ElementContainerRef
  readonly count: number
}

export interface PrintOutline {
  readonly nodes: readonly DesignerOutlineNode[]
  /** 元素 id → 它在页面结构里的位置。 */
  readonly places: ReadonlyMap<string, PrintOutlinePlace>
}

function group(id: string, label: string, children: DesignerOutlineNode[]): DesignerOutlineNode {
  return { id, label, children, selectable: false, movable: false, deletable: false }
}

/** 按页面模板、区与带区排出页面结构；页眉、页脚一个元素都没有时不列，正文总列出。 */
export function printOutline(document: PrintDocument, labels: PrintOutlineLabels): PrintOutline {
  const places = new Map<string, PrintOutlinePlace>()
  const elementsOf = (page: PrintPage, container: ElementContainerRef, parent: string): DesignerOutlineNode[] => {
    const elements = getContainerElements(page, container) ?? []
    return [...elements].reverse().map((element) => {
      places.set(element.id, { parent, container, count: elements.length })
      const { label, description, icon } = labels.element(element)
      const fixed = element.locked === true
      return { id: element.id, label, ...(description === undefined ? {} : { description }), ...(icon === undefined ? {} : { icon }), movable: !fixed, deletable: !fixed }
    })
  }
  const nodes = document.pages.map((page, index) => {
    const pageId = `page:${page.id}`
    const bandsOf = (region: 'header' | 'footer'): DesignerOutlineNode | undefined => {
      const keys = listPageBandKeys(page[region])
      if (keys.every(key => (page[region][key]?.elements.length ?? 0) === 0))
        return undefined
      const regionId = `region:${page.id}:${region}`
      if (keys.length === 1)
        return group(regionId, labels.region(region), elementsOf(page, { pageId: page.id, region, band: 'default' }, regionId))
      return group(regionId, labels.region(region), keys.map((key) => {
        const bandId = `band:${page.id}:${region}:${key}`
        return group(bandId, labels.band(key), elementsOf(page, { pageId: page.id, region, band: key }, bandId))
      }))
    }
    const bodyId = `region:${page.id}:body`
    const regions = [
      bandsOf('header'),
      group(bodyId, labels.region('body'), elementsOf(page, { pageId: page.id, region: 'body' }, bodyId)),
      bandsOf('footer'),
    ].filter(node => node !== undefined)
    return group(pageId, labels.page(page, index), regions)
  })
  return { nodes, places }
}
