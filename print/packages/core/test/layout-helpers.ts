/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type {
  CellStyle,
  ExpressionEvaluator,
  LayoutBox,
  LayoutSheet,
  PaginateOptions,
  PaginationResult,
  PrintDocument,
  PrintElement,
  PrintPage,
  TableColumn,
  TableElement,
  TextMeasurer,
  TextMeasureRequest,
} from '../src'
import { createDocument, createElementRegistry, createPage, paginate } from '../src'

export const registry = createElementRegistry()

/** 假测量器：每个字符宽 `字号 × 0.2` mm，每行高 `字号 × 0.4 × 行高倍数` mm，按字符数断行。 */
export function createFakeMeasurer(calls: TextMeasureRequest[] = []): TextMeasurer {
  return {
    measure: (request) => {
      calls.push(request)
      const charWidth = request.fontSize * 0.2
      const perLine = Math.max(1, Math.floor(request.maxWidth / charWidth + 1e-9))
      const lines: string[] = []
      if (request.text.length > 0) {
        for (const paragraph of request.text.split('\n')) {
          const chars = Array.from(paragraph)
          if (!request.wrap || chars.length <= perLine) {
            lines.push(paragraph)
            continue
          }
          for (let index = 0; index < chars.length; index += perLine)
            lines.push(chars.slice(index, index + perLine).join(''))
        }
      }
      const width = lines.reduce((max, line) => Math.max(max, Array.from(line).length * charWidth), 0)
      return { lines, width, height: lines.length * request.fontSize * 0.4 * request.lineHeight }
    },
  }
}

/** 假求值器：按表达式源码查表求值，`fail` 求值失败。 */
export const fakeEvaluator: ExpressionEvaluator = {
  evaluate: (source, scope) => {
    switch (source) {
      case 'qty * price':
        return { ok: true, value: Number(scope.qty) * Number(scope.price) }
      case 'upper(name)':
        return { ok: true, value: String(scope.name).toUpperCase() }
      case 'value + 1':
        return { ok: true, value: Number(scope.value) + 1 }
      case 'obj':
        return { ok: true, value: { nested: true } }
      default:
        return { ok: false, diagnostics: [{ code: 'XH_EXPR_UNKNOWN', start: 0, end: source.length }] }
    }
  },
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value))
      deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

/** 100 × 100 mm、边距为 0、页眉页脚高度为 0 的页面，正文区为整张纸。 */
export function squarePage(id = 'p', elements: PrintElement[] = []): PrintPage {
  const page = createPage({ id, paper: { width: 100, height: 100 }, margins: 0 })
  page.elements = elements
  return page
}

export function documentOf(...pages: PrintPage[]): PrintDocument {
  return createDocument({ pages })
}

export function run(document: PrintDocument, data: unknown = {}, options: Partial<PaginateOptions> = {}): PaginationResult {
  return paginate(deepFreeze(document), deepFreeze(data), { measurer: createFakeMeasurer(), ...options })
}

export function cellStyle(overrides: Partial<CellStyle> = {}): CellStyle {
  return { fontSize: 10, bold: false, italic: false, color: '#000000', verticalAlign: 'middle', padding: 1, ...overrides }
}

/** 10 mm 表头、10 mm 行高、两列（name 60 mm、qty 40 mm）的表格，绑定 `items`。 */
export function simpleTable(id: string, y: number, overrides: Partial<TableElement> = {}): TableElement {
  const columns: TableColumn[] = [
    { id: 'name', title: '品名', width: 60, align: 'left', content: { kind: 'field', field: 'name' }, cellType: 'text' },
    { id: 'qty', title: '数量', width: 40, align: 'right', content: { kind: 'field', field: 'qty' }, cellType: 'text' },
  ]
  return registry.createElement('table', {
    id,
    x: 0,
    y,
    overrides: {
      width: 100,
      height: 20,
      dataField: 'items',
      columns,
      header: { visible: true, repeat: true, height: 10, style: cellStyle({ bold: true }) },
      body: { rowHeight: 10, autoHeight: false, style: cellStyle() },
      ...overrides,
    },
  })
}

export function itemsOf(count: number): { name: string, qty: number }[] {
  return Array.from({ length: count }, (_, index) => ({ name: `item-${index + 1}`, qty: index + 1 }))
}

export function boxesOf(sheet: LayoutSheet, elementId: string): LayoutBox[] {
  return sheet.boxes.filter(box => box.elementId === elementId)
}

export function boxOf<TKind extends LayoutBox['kind']>(sheet: LayoutSheet, elementId: string, kind: TKind): Extract<LayoutBox, { kind: TKind }> {
  const box = sheet.boxes.find(item => item.elementId === elementId)
  if (box === undefined || box.kind !== kind)
    throw new Error(`no ${kind} box for ${elementId} on sheet ${sheet.sheetIndex}`)
  return box as Extract<LayoutBox, { kind: TKind }>
}

export function textOf(sheet: LayoutSheet, elementId: string): string {
  return boxOf(sheet, elementId, 'text').lines.join('|')
}
