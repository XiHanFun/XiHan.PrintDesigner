/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEngine, FormatSpec } from '@xihan-ui/expression'
import type { FontSpec, TextMeasurer } from '@xihan-ui/viz'
import type {
  CellStyle,
  LayoutBox,
  LayoutSheet,
  PaginateOptions,
  PaginationResult,
  PrintDocument,
  PrintElement,
  PrintPage,
  TableColumn,
  TableElement,
} from '../src'
import { createDocument, createElementRegistry, createPage, paginate } from '../src'

export const registry = createElementRegistry()

/** 度量器收到的一次请求。 */
export interface MeasureCall {
  text: string
  font: FontSpec
}

/**
 * 假度量器：每个字符宽「字号（pt）× 0.2」mm，按 CSS 像素交回；略收一点，整倍数宽度不被浮点误差挤到下一行。
 * 记下每次量的文字与字体。
 */
export function createFakeMeasurer(calls: MeasureCall[] = []): TextMeasurer {
  return {
    version: 0,
    measure: (text, font) => {
      calls.push({ text, font })
      const charWidth = font.size * 0.75 * 0.2 * 96 / 25.4 * (1 - 1e-9)
      return { width: Array.from(text).length * charWidth, ascent: font.size * 0.8, descent: font.size * 0.2 }
    },
  }
}

function numbersOf(scope: Readonly<Record<string, unknown>>): number[] {
  return (scope.$values as unknown[])
    .filter(value => value !== null && value !== '')
    .map(Number)
    .filter(Number.isFinite)
}

const FAKE_EXPRESSIONS: Record<string, (scope: Readonly<Record<string, unknown>>) => unknown> = {
  'SUM($values)': scope => numbersOf(scope).reduce((sum, value) => sum + value, 0),
  'AVG($values)': (scope) => {
    const numbers = numbersOf(scope)
    return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length
  },
  'MIN($values)': scope => numbersOf(scope).length === 0 ? null : Math.min(...numbersOf(scope)),
  'MAX($values)': scope => numbersOf(scope).length === 0 ? null : Math.max(...numbersOf(scope)),
  'qty * price': scope => Number(scope.qty) * Number(scope.price),
  'upper(name)': scope => String(scope.name).toUpperCase(),
  'value + 1': scope => Number(scope.value) + 1,
  'obj': () => ({ nested: true }),
}

/** 假表达式接入点：按源码查表求值；`fail` 编译通过但求值失败，其余未登记的源码编译失败。 */
export function createFakeEngine(compiled: string[] = []): ExpressionEngine {
  return {
    compile: (source) => {
      compiled.push(source)
      if (source === 'fail')
        return { ok: true, references: [], evaluate: () => ({ ok: false, issue: { code: 'XH_EXPR_FUNCTION_FAILED', start: 0, end: 4 } }) }
      const fn = FAKE_EXPRESSIONS[source]
      if (fn === undefined)
        return { ok: false, issues: [{ code: 'XH_EXPR_UNKNOWN_FUNCTION', start: 0, end: source.length }] }
      return { ok: true, references: [], evaluate: scope => ({ ok: true, value: fn(scope) }) }
    },
  }
}

export const fakeEngine = createFakeEngine()

/** 假格式化器：输出 `格式种类:原值`。 */
export function fakeFormatter(value: unknown, spec: FormatSpec): string {
  return `${spec.kind}:${String(value)}`
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
  return { fontSize: 10, bold: false, italic: false, color: '#000000', verticalAlign: 'middle', padding: 1, lineHeight: 4, ...overrides }
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
      body: { rowHeight: 10, rowHeightMode: 'fixed', style: cellStyle() },
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
