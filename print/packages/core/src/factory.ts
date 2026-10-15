/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PaperPresetName } from './paper'
import type { Edges } from './schema/common'
import type { PageBandSet, PaperSpec, PrintDocument, PrintPage } from './schema/document'
import type { PageOrientation, SingleSheetPreference } from './schema/options'
import { PAPER_PRESETS } from './paper'
import { PRINT_SCHEMA_VERSION } from './schema/document'
import { forEachElement } from './traverse'

/** 按预设名生成纸张。 */
export function createPaper(preset: PaperPresetName): PaperSpec {
  const size = PAPER_PRESETS[preset]
  return { preset, width: size.width, height: size.height }
}

/** 生成四边相等或逐边指定的边距。 */
export function createEdges(value: number | Edges): Edges {
  if (typeof value === 'number')
    return { top: value, right: value, bottom: value, left: value }
  return { top: value.top, right: value.right, bottom: value.bottom, left: value.left }
}

/** 生成只含空 default 带区的页眉或页脚。 */
export function createPageBandSet(singleSheet: SingleSheetPreference): PageBandSet {
  return { default: { height: 0, elements: [] }, singleSheet }
}

/** 页面模板创建选项。 */
export interface CreatePageOptions {
  id: string
  name?: string
  /** 纸张预设名或纸张，默认 A4。 */
  paper?: PaperPresetName | PaperSpec
  /** 默认纵向。 */
  orientation?: PageOrientation
  /** 四边相等的边距或逐边边距，默认 10 mm。 */
  margins?: number | Edges
}

/** 生成页面模板：页眉单页时优先首页变体，页脚单页时优先末页变体，页码接续上一页面模板。 */
export function createPage(options: CreatePageOptions): PrintPage {
  const paper = options.paper ?? 'A4'
  const page: PrintPage = {
    id: options.id,
    paper: typeof paper === 'string' ? createPaper(paper) : { ...paper },
    orientation: options.orientation ?? 'portrait',
    margins: createEdges(options.margins ?? 10),
    header: createPageBandSet('first'),
    footer: createPageBandSet('last'),
    elements: [],
    numbering: { continuous: true, start: 1 },
  }
  if (options.name !== undefined)
    page.name = options.name
  return page
}

/** 文档创建选项。 */
export interface CreateDocumentOptions {
  name?: string
  /** 页面模板，默认一张标识为 `page-1` 的 A4 纵向页面。 */
  pages?: PrintPage[]
}

/** 生成当前 schema 版本的文档。 */
export function createDocument(options: CreateDocumentOptions = {}): PrintDocument {
  const document: PrintDocument = {
    schemaVersion: PRINT_SCHEMA_VERSION,
    pages: options.pages ?? [createPage({ id: 'page-1' })],
  }
  if (options.name !== undefined)
    document.name = options.name
  return document
}

/** 收集文档中已使用的页面与元素标识。 */
export function collectDocumentIds(document: PrintDocument): Set<string> {
  const ids = new Set<string>()
  for (const page of document.pages)
    ids.add(page.id)
  forEachElement(document, location => ids.add(location.element.id))
  return ids
}

/** 生成文档内未被页面和元素使用的标识，形如 `${prefix}-${n}`，n 取已用最大序号加一。 */
export function createUniqueId(document: PrintDocument, prefix: string): string {
  const ids = collectDocumentIds(document)
  const head = `${prefix}-`
  let max = 0
  for (const id of ids) {
    if (!id.startsWith(head))
      continue
    const rest = id.slice(head.length)
    if (/^[1-9]\d*$/.test(rest))
      max = Math.max(max, Number(rest))
  }
  return `${prefix}-${max + 1}`
}
