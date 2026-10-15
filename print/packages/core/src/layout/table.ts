/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Decimal } from '../decimal'
import type { TableElement } from '../schema/elements'
import type {
  AggregateCellContent,
  CellStyle,
  TableCellContent,
  TableColumn,
  TableFooterRow,
} from '../schema/table'
import type { DiagnosticScope, LayoutContext } from './context'
import type { BodyGeometry, Placement, SheetCursor } from './placement'
import type { TableCellLayout, TableLayoutBox, TableRowLayout } from './types'
import { checkBarcodeValue } from '../barcode'
import { getFieldValue } from '../data'
import { addDecimals, compareDecimals, decimalToNumber, decimalToString, toDecimal, zeroDecimal } from '../decimal'
import { isEmptyValue } from '../format'
import { measureQrCapacity } from '../qrcode'
import { ptToMm } from '../units'
import { isSafeImageUrl } from '../validation/controls'
import { boxBase } from './boxes'
import { contentText, expressionText, templateText, valueText } from './content'
import { LAYOUT_EPSILON } from './context'
import { bodyBottom, isAtBodyTop, nextSheetTop } from './placement'

interface PreparedColumn {
  column: TableColumn
  x: number
  width: number
}

/** 位置待定的表格行。 */
interface RowTemplate {
  role: TableRowLayout['role']
  dataIndex?: number
  footerRowId?: string
  height: number
  style: CellStyle
  cells: TableCellLayout[]
}

/** 已取值与测量的表格。 */
export interface PreparedTable {
  element: TableElement
  columns: PreparedColumn[]
  header?: RowTemplate
  rows: RowTemplate[]
  data: unknown[]
}

/** 按单元格样式换行测量；文字高度为行数乘以样式中的行高，不取测量器给出的高度。 */
function cellLines(context: LayoutContext, text: string, style: CellStyle, width: number): { lines: string[], height: number } {
  const request = {
    text,
    fontSize: style.fontSize,
    bold: style.bold,
    italic: style.italic,
    letterSpacing: 0,
    lineHeight: style.lineHeight / ptToMm(style.fontSize),
    maxWidth: Math.max(0, width - style.padding * 2),
    wrap: true,
  }
  const { lines } = context.measure(style.fontFamily === undefined ? request : { ...request, fontFamily: style.fontFamily })
  return { lines, height: lines.length * style.lineHeight }
}

function bodyCellText(content: TableCellContent, row: unknown, index: number, context: LayoutContext, scope: DiagnosticScope): string {
  switch (content.kind) {
    case 'field':
      return valueText(getFieldValue(row, content.field), content.format, content.emptyText, context, scope)
    case 'template':
      return templateText(content.template, row, context, scope)
    case 'rowNumber':
      return String(index + 1)
    case 'expression':
      return expressionText(content.expression, content.format, row, context, scope)
  }
}

function cellLayout(prepared: PreparedColumn, colSpan: number, width: number, align: TableCellLayout['align'], text: string): TableCellLayout {
  const cell: TableCellLayout = {
    columnId: prepared.column.id,
    colSpan,
    x: prepared.x,
    width,
    align,
    cellType: prepared.column.cellType,
    text,
    lines: [],
  }
  if (prepared.column.symbology !== undefined)
    cell.symbology = prepared.column.symbology
  return cell
}

function bodyRow(table: TableElement, columns: PreparedColumn[], row: unknown, index: number, context: LayoutContext, scope: DiagnosticScope): RowTemplate {
  const style = table.body.style
  let height = table.body.rowHeight
  const cells = columns.map((prepared) => {
    const { column } = prepared
    let text = bodyCellText(column.content, row, index, context, scope)
    const cell = cellLayout(prepared, 1, prepared.width, style.align ?? column.align, text)
    switch (column.cellType) {
      case 'text': {
        const measured = cellLines(context, text, style, prepared.width)
        cell.lines = measured.lines
        if (table.body.rowHeightMode === 'minimum')
          height = Math.max(height, measured.height)
        break
      }
      case 'image':
        if (text.trim().length > 0 && !isSafeImageUrl(text)) {
          context.report('image.unsafeSource', scope, { columnId: column.id })
          text = ''
          cell.text = ''
        }
        break
      case 'barcode': {
        const reason = column.symbology === undefined ? undefined : checkBarcodeValue(column.symbology, text)
        if (reason !== undefined)
          context.report('barcode.invalidValue', scope, { columnId: column.id, symbology: column.symbology ?? '', reason })
        break
      }
      case 'qrcode': {
        const capacity = measureQrCapacity(text, 'M')
        if (capacity.length > capacity.max)
          context.report('qrcode.capacityExceeded', scope, { columnId: column.id, ...capacity })
        break
      }
    }
    return cell
  })
  return { role: 'body', dataIndex: index, height, style, cells }
}

/** 取表格数据并测量表头与全部数据行。 */
export function prepareTable(table: TableElement, context: LayoutContext, scope: DiagnosticScope): PreparedTable {
  let offset = table.x
  const columns = table.columns.map((column) => {
    const prepared = { column, x: offset, width: column.width }
    offset += column.width
    return prepared
  })

  const source = getFieldValue(context.data, table.dataField)
  if (!Array.isArray(source))
    context.report('data.notArray', scope, { field: table.dataField })
  const data: unknown[] = Array.isArray(source) ? source : []

  const prepared: PreparedTable = {
    element: table,
    columns,
    rows: data.map((row, index) => bodyRow(table, columns, row, index, context, scope)),
    data,
  }
  if (table.header.visible) {
    const style = table.header.style
    prepared.header = {
      role: 'header',
      height: table.header.height,
      style,
      cells: columns.map((column) => {
        const cell = cellLayout(column, 1, column.width, style.align ?? column.column.align, column.column.title)
        cell.cellType = 'text'
        delete cell.symbology
        cell.lines = cellLines(context, column.column.title, style, column.width).lines
        return cell
      }),
    }
  }
  return prepared
}

function aggregateValue(content: AggregateCellContent, rows: readonly unknown[]): unknown {
  if (content.fn === 'count' && content.field === undefined)
    return rows.length
  const values = content.field === undefined ? [] : rows.map(row => getFieldValue(row, content.field as string))
  if (content.fn === 'count')
    return values.filter(value => !isEmptyValue(value)).length
  const numbers = values.map(toDecimal).filter((value): value is Decimal => value !== undefined)
  const sum = numbers.reduce(addDecimals, zeroDecimal())
  switch (content.fn) {
    case 'sum':
      return decimalToString(sum)
    case 'avg':
      return numbers.length === 0 ? undefined : decimalToNumber(sum) / numbers.length
    case 'min':
    case 'max': {
      if (numbers.length === 0)
        return undefined
      const direction = content.fn === 'min' ? -1 : 1
      const extreme = numbers.reduce((best, value) => compareDecimals(value, best) * direction > 0 ? value : best)
      return decimalToString(extreme)
    }
  }
}

interface SliceRange {
  start: number
  end: number
}

function footerRow(
  prepared: PreparedTable,
  row: TableFooterRow,
  range: SliceRange,
  context: LayoutContext,
  scope: DiagnosticScope,
): RowTemplate {
  const { columns, data } = prepared
  const indexOf = new Map(columns.map((column, index) => [column.column.id, index]))
  const cells = row.cells.map((cell) => {
    const start = indexOf.get(cell.columnId) ?? 0
    const spanned = columns.slice(start, start + cell.colSpan)
    const first = columns[start] as PreparedColumn
    const width = spanned.reduce((sum, column) => sum + column.width, 0)
    let text: string
    if (cell.content.kind === 'aggregate') {
      const rows = cell.content.scope === 'all'
        ? data
        : data.slice(cell.content.scope === 'page' ? range.start : 0, range.end)
      text = valueText(aggregateValue(cell.content, rows), cell.content.format, undefined, context, scope)
    }
    else {
      text = contentText(cell.content, context.data, context, scope)
    }
    const layout = cellLayout(first, spanned.length, width, cell.align ?? row.style.align ?? first.column.align, text)
    layout.cellType = 'text'
    delete layout.symbology
    layout.lines = cellLines(context, text, row.style, width).lines
    return layout
  })
  return { role: 'footer', footerRowId: row.id, height: row.height, style: row.style, cells }
}

function fillerRow(prepared: PreparedTable): RowTemplate {
  const { element, columns } = prepared
  const style = element.body.style
  return {
    role: 'filler',
    height: element.body.rowHeight,
    style,
    cells: columns.map(column => cellLayout(column, 1, column.width, style.align ?? column.column.align, '')),
  }
}

function sumHeights(rows: readonly { height: number }[]): number {
  return rows.reduce((sum, row) => sum + row.height, 0)
}

/**
 * 从起点开始按行排表格：数据行不跨页拆分，行高按固定或最小行高模式确定；每段可重复表头，每段带每页表尾行，最后一段另带末页表尾行；
 * 按每页最大行数与补空行设置补齐。只有一段时高度不小于设计高度（以当页剩余空间为限）。
 */
export function placeTable(
  prepared: PreparedTable,
  start: SheetCursor,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  const { element, header, rows } = prepared
  const max = element.maxRowsPerPage
  const everyPage = element.footerRows.filter(row => row.placement === 'everyPage')
  const everyPageHeight = sumHeights(everyPage)
  const lastPageHeight = sumHeights(element.footerRows.filter(row => row.placement === 'lastPage'))
  const boxes: Placement['boxes'] = []
  let cursor = start
  let index = 0

  while (cursor.sheet < geometry.limit) {
    const available = bodyBottom(geometry.bodyRect(cursor.sheet)) - cursor.y
    const fresh = isAtBodyTop(cursor, geometry)
    const headerHeight = header !== undefined && (boxes.length === 0 || element.header.repeat) ? header.height : 0
    const space = available - headerHeight - everyPageHeight

    const stop = max === undefined ? rows.length : Math.min(rows.length, index + max)
    let count = 0
    let used = 0
    while (index + count < stop) {
      const height = (rows[index + count] as RowTemplate).height
      const finalRow = index + count + 1 === rows.length
      if (used + height + (finalRow ? lastPageHeight : 0) > space + LAYOUT_EPSILON)
        break
      used += height
      count++
    }

    const remaining = rows.length - index
    if (count === 0 && remaining > 0) {
      if (!fresh) {
        cursor = nextSheetTop(cursor.sheet, geometry)
        continue
      }
      context.report('table.rowOverflow', scope, { dataIndex: index })
      count = 1
      used = (rows[index] as RowTemplate).height
    }
    else if (remaining === 0 && lastPageHeight > space + LAYOUT_EPSILON && !fresh) {
      cursor = nextSheetTop(cursor.sheet, geometry)
      continue
    }

    const range = { start: index, end: index + count }
    const final = range.end === rows.length
    const filler = fillerRow(prepared)
    let fillers = 0
    if (element.fillEmptyRows && filler.height > 0) {
      const room = space - used - (final ? lastPageHeight : 0)
      const byHeight = Math.floor((room + LAYOUT_EPSILON) / filler.height)
      fillers = Math.max(0, max === undefined ? byHeight : Math.min(max - count, byHeight))
    }

    const templates: RowTemplate[] = []
    if (headerHeight > 0 && header !== undefined)
      templates.push(header)
    templates.push(...rows.slice(range.start, range.end))
    for (let filled = 0; filled < fillers; filled++)
      templates.push(filler)
    for (const row of element.footerRows) {
      if (row.placement === 'everyPage' || final)
        templates.push(footerRow(prepared, row, range, context, scope))
    }

    let y = cursor.y
    const layoutRows = templates.map((template) => {
      const row: TableRowLayout = { ...template, y }
      y += template.height
      return row
    })
    const contentHeight = y - cursor.y
    const height = final && boxes.length === 0 ? Math.max(contentHeight, Math.min(element.height, available)) : contentHeight
    const box: TableLayoutBox = {
      ...boxBase(element, 'body'),
      y: cursor.y,
      height,
      kind: 'table',
      border: element.border,
      rows: layoutRows,
      fragment: { index: boxes.length, last: final },
    }
    boxes.push({ sheet: cursor.sheet, box })
    index = range.end
    if (final)
      return { boxes, end: { sheet: cursor.sheet, y: cursor.y + height }, truncated: false }
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
