/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计态排版：一份页面模板的每个元素都按设计坐标排出一个布局盒，供设计器的画布显示；不分页、不下推。
// 不给示例数据时，字段显示为 {path} 占位，表达式显示为 =源码，汇总显示为 函数(字段)，按字段取地址的图片留空，表格示意若干行。

import type { JsonObject, JsonValue } from '@xihan-ui/core/json'
import type { RichBlock } from '@xihan-ui/core/rich-text'
import type { PrintPage } from '../schema/document'
import type { ExtensionElement, PrintElement, TableElement } from '../schema/elements'
import type { PageBandKey } from '../schema/options'
import type { TableCellContent, TableColumn, TableFooterCell } from '../schema/table'
import type { ElementRegion } from '../traverse'
import type { DiagnosticScope, LayoutContext, PendingDiagnostic } from './context'
import type { BodyGeometry } from './placement'
import type { LayoutBox, LayoutWatermark, PaginateOptions, PaginationDiagnostic } from './types'
import { getJsonAt, isPlainObject, parseJsonPath, setJsonAt } from '@xihan-ui/core/json'
import { parseTextTemplate } from '@xihan-ui/core/template'
import { withSeverity } from '@xihan-ui/designer-kit/schema'
import { fillPageNumber, layoutFixedElement, pageNumberBox } from './boxes'
import { templateText } from './content'
import { createLayoutContext, elementScope, pageScope } from './context'
import { isFlowExtension, placeExtensionFlow, prepareExtensionFlow } from './extension-flow'
import { placeLongText, prepareLongText } from './long-text'
import { placeRichText, prepareRichText } from './rich-text'
import { placeTable, prepareTable } from './table'
import { PAGINATION_DIAGNOSTIC_SEVERITIES, PrintLayoutError } from './types'

/** 表格缺省示意的数据行数。 */
export const DESIGN_SAMPLE_ROWS = 1

/** 设置了补空行的表格在设计态示意的空行数。 */
export const DESIGN_FILLER_ROWS = 2

/** 设计态排版的选项：度量器、表达式引擎、格式化器、区域与时区同分页。 */
export interface DesignLayoutOptions extends Omit<PaginateOptions, 'maxSheets'> {
  /** 示例数据；给出时按数据取值，不给时字段显示 {path} 占位。 */
  sampleData?: unknown
  /** 页眉、页脚显示哪个变体，缺省 default；变体不存在时用 default。 */
  bands?: { header?: PageBandKey, footer?: PageBandKey }
  /** 表格示意的数据行数，缺省 DESIGN_SAMPLE_ROWS。 */
  sampleRows?: number
  /** 页面模板在文档里的下标，用于诊断的 path，缺省 0。 */
  pageIndex?: number
}

/** 设计态排版结果：各区的布局盒按元素层级排列，坐标为设计坐标。 */
export interface DesignLayout {
  header: LayoutBox[]
  body: LayoutBox[]
  footer: LayoutBox[]
  /** 占位已替换的水印。 */
  watermark?: LayoutWatermark
  diagnostics: PaginationDiagnostic[]
}

/** 每个元素单独排的几何：正文区就是元素自己所在的一整列，足够高，只排一张。 */
function designGeometry(element: PrintElement): BodyGeometry {
  return { bodyRect: () => ({ x: element.x, y: element.y, width: element.width, height: Number.MAX_SAFE_INTEGER }), limit: 1 }
}

function placeholder(path: string): string {
  return `{${path}}`
}

/** 在 data 的 path 处写入占位；路径含数组下标或与已写入的值冲突时跳过。 */
function putPlaceholder(data: JsonObject, path: string): JsonObject {
  try {
    const segments = parseJsonPath(path)
    if (segments.some(segment => typeof segment === 'number') || getJsonAt(data, segments) !== undefined)
      return data
    return setJsonAt(data, segments, placeholder(path), { createMissing: true }).root
  }
  catch {
    return data
  }
}

function templatePaths(template: string): string[] {
  return parseTextTemplate(template).segments.flatMap(segment => segment.kind === 'path' ? [segment.source] : [])
}

/** 文本内容来源里引用的数据路径。 */
function contentPaths(content: { kind: string, field?: string, template?: string }): string[] {
  if (content.kind === 'field' && content.field !== undefined)
    return [content.field]
  if (content.kind === 'template' && content.template !== undefined)
    return templatePaths(content.template)
  return []
}

/** 富文本块里行内字段的路径。 */
function richFieldPaths(blocks: readonly RichBlock[]): string[] {
  return blocks.flatMap((block) => {
    if (block.type === 'list')
      return block.items.flatMap(item => richFieldPaths(item.blocks))
    if (block.type === 'divider')
      return []
    return block.runs.flatMap(run => run.type === 'field' ? [run.field] : [])
  })
}

/** 元素在根数据上引用的路径，表格的行内字段除外。 */
function rootPaths(element: PrintElement): string[] {
  switch (element.type) {
    case 'text':
    case 'longText':
    case 'barCode':
    case 'matrixCode':
      return contentPaths(element.content)
    case 'image':
      return element.source.kind === 'field' ? [element.source.field] : []
    case 'richText':
      return element.content.kind === 'static' ? richFieldPaths(element.content.document.blocks) : []
    case 'table':
      return element.footerRows.flatMap(row => row.cells.flatMap(cell => cell.content.kind === 'aggregate' ? [] : contentPaths(cell.content)))
    default:
      return []
  }
}

function placeholderRow(columns: readonly TableColumn[]): JsonObject {
  let row: JsonObject = {}
  for (const column of columns) {
    for (const path of contentPaths(column.content))
      row = putPlaceholder(row, path)
  }
  return row
}

function placeholderData(elements: readonly PrintElement[], watermark: string | undefined, rows: number): JsonObject {
  let data: JsonObject = {}
  for (const element of elements) {
    for (const path of rootPaths(element))
      data = putPlaceholder(data, path)
  }
  for (const path of watermark === undefined ? [] : templatePaths(watermark))
    data = putPlaceholder(data, path)
  for (const element of elements) {
    if (element.type !== 'table')
      continue
    try {
      const segments = parseJsonPath(element.dataField)
      const row = placeholderRow(element.columns)
      data = setJsonAt(data, segments, Array.from<JsonValue>({ length: rows }).fill(row), { createMissing: true }).root
    }
    catch {}
  }
  return data
}

function designCellContent(content: TableCellContent): TableCellContent {
  return content.kind === 'expression' ? { kind: 'template', template: `=${content.expression}` } : content
}

function designFooterCell(cell: TableFooterCell): TableFooterCell {
  const { content } = cell
  if (content.kind === 'aggregate')
    return { ...cell, content: { kind: 'static', text: `${content.fn}(${content.field ?? ''})` } }
  if (content.kind === 'expression')
    return { ...cell, content: { kind: 'static', text: `=${content.expression}` } }
  return cell
}

/**
 * 把元素换成设计态用的形状：不给示例数据时表达式与汇总换成源码文字、图片不按字段取地址、富文本字段显示 {path} 占位；
 * 表格的补空行改为示意固定行数。
 */
function designElement(element: PrintElement, placeholders: boolean, rows: number): PrintElement {
  if (element.type === 'table') {
    const table: TableElement = { ...element }
    if (element.fillEmptyRows)
      table.maxRowsPerPage = rows + DESIGN_FILLER_ROWS
    else
      delete table.maxRowsPerPage
    if (placeholders) {
      table.columns = element.columns.map(column => ({ ...column, content: designCellContent(column.content) }))
      table.footerRows = element.footerRows.map(row => ({ ...row, cells: row.cells.map(designFooterCell) }))
    }
    return table
  }
  if (placeholders && element.type === 'image' && element.source.kind === 'field')
    return { ...element, source: { kind: 'static', url: '' } }
  if (placeholders && element.type === 'richText' && element.content.kind === 'field') {
    const text = placeholder(element.content.field)
    return { ...element, content: { kind: 'static', document: { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text }] }] } } }
  }
  if (placeholders && 'content' in element && element.content.kind === 'expression')
    return { ...element, content: { kind: 'static', text: `=${element.content.expression}` } } as PrintElement
  return element
}

/** 示例数据里表格的数据只取前 rows 行。 */
function sampleData(data: unknown, elements: readonly PrintElement[], rows: number): unknown {
  if (!isPlainObject(data))
    return data
  let result = data as JsonObject
  for (const element of elements) {
    if (element.type !== 'table')
      continue
    try {
      const segments = parseJsonPath(element.dataField)
      const list = getJsonAt(result, segments)
      if (Array.isArray(list) && list.length > rows)
        result = setJsonAt(result, segments, list.slice(0, rows) as JsonValue).root
    }
    catch {}
  }
  return result
}

function layoutElement(element: PrintElement, region: ElementRegion, context: LayoutContext, scope: DiagnosticScope): LayoutBox | undefined {
  switch (element.type) {
    case 'pageNumber': {
      const box = pageNumberBox(element, region)
      fillPageNumber(box, element, { current: 1, total: 1 }, context, scope)
      return box
    }
    case 'longText':
      return region === 'body' ? placeLongText(prepareLongText(element, context, scope), { sheet: 0, y: element.y }, designGeometry(element), context, scope).boxes[0]?.box : undefined
    case 'richText':
      return region === 'body' ? placeRichText(prepareRichText(element, context, scope), { sheet: 0, y: element.y }, designGeometry(element), context, scope).boxes[0]?.box : undefined
    case 'table':
      return region === 'body' ? placeTable(prepareTable(element, context, scope), { sheet: 0, y: element.y }, designGeometry(element), context, scope).boxes[0]?.box : undefined
    default:
      if (!isFlowExtension(element, context))
        return layoutFixedElement(element, region, context, scope)
      return region === 'body' ? placeExtensionFlow(prepareExtensionFlow(element as unknown as ExtensionElement, context), { sheet: 0, y: element.y }, designGeometry(element), context, scope).boxes[0]?.box : undefined
  }
}

/**
 * 按设计坐标排出页面模板的每个元素，页眉页脚取 options.bands 指定的变体。跨页元素不分页：
 * 长文本、富文本与跨页的扩展元素按内容撑高，表格排表头、示意行、补空行与全部表尾行，高度都不小于设计高度。
 * 测量或格式化结果不合法时抛 PrintLayoutError；页面模板本身不合法时结果不保证有意义，先用 validateDocument 校验。
 */
export function layoutDesign(page: PrintPage, options: DesignLayoutOptions): DesignLayout {
  if (typeof options?.measurer?.measure !== 'function')
    throw new PrintLayoutError('option.invalid', { option: 'measurer' })
  const rows = options.sampleRows ?? DESIGN_SAMPLE_ROWS
  if (!Number.isInteger(rows) || rows < 0)
    throw new PrintLayoutError('option.invalid', { option: 'sampleRows' })
  const pageIndex = options.pageIndex ?? 0
  const headerKey = options.bands?.header ?? 'default'
  const footerKey = options.bands?.footer ?? 'default'
  const header = page.header[headerKey] ?? page.header.default
  const footer = page.footer[footerKey] ?? page.footer.default
  const resolvedHeaderKey: PageBandKey = page.header[headerKey] === undefined ? 'default' : headerKey
  const resolvedFooterKey: PageBandKey = page.footer[footerKey] === undefined ? 'default' : footerKey
  const all = [...header.elements, ...page.elements, ...footer.elements]
  const placeholders = options.sampleData === undefined
  const data = placeholders ? placeholderData(all, page.watermark?.text, rows) : sampleData(options.sampleData, all, rows)

  const pending: PendingDiagnostic[] = []
  const contextOptions: Parameters<typeof createLayoutContext>[2] = {
    formatOptions: {
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    },
  }
  if (options.expressionEngine !== undefined)
    contextOptions.expressionEngine = options.expressionEngine
  if (options.formatter !== undefined)
    contextOptions.formatter = options.formatter
  if (options.extensions !== undefined)
    contextOptions.extensions = options.extensions
  const context = createLayoutContext(data, options.measurer, contextOptions, pending)

  const layoutRegion = (elements: readonly PrintElement[], region: ElementRegion, elementsPath: (string | number)[]): LayoutBox[] =>
    elements.flatMap((element, index) => {
      const box = layoutElement(designElement(element, placeholders, rows), region, context, elementScope(elementsPath, index, element))
      return box === undefined ? [] : [box]
    })

  const result: DesignLayout = {
    header: layoutRegion(header.elements, 'header', ['pages', pageIndex, 'header', resolvedHeaderKey, 'elements']),
    body: layoutRegion(page.elements, 'body', ['pages', pageIndex, 'elements']),
    footer: layoutRegion(footer.elements, 'footer', ['pages', pageIndex, 'footer', resolvedFooterKey, 'elements']),
    diagnostics: [],
  }
  if (page.watermark !== undefined)
    result.watermark = { ...page.watermark, text: templateText(page.watermark.text, data, context, pageScope(pageIndex, page)) }
  result.diagnostics = withSeverity(pending, PAGINATION_DIAGNOSTIC_SEVERITIES) as PaginationDiagnostic[]
  return result
}
