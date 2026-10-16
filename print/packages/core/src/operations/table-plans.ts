/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 表格结构修改的计划：生成 updateElement 的属性修改；增删、移动列时同步修正表尾单元格的起始列与跨列数。

import type { JsonValue } from '@xihan-ui/core/json'
import type { TableCell } from '@xihan-ui/designer-kit'
import type { TableElement } from '../schema/elements'
import type { TableColumn, TableFooterCell, TableFooterRow } from '../schema/table'
import type { PropertyChange } from './types'
import { planCellMerge, planTableLineInsert, planTableLineRemove } from '@xihan-ui/designer-kit'
import { scaleTableColumns } from '../registry/builtins'
import { PrintOperationError } from './errors'

/** 调整列宽时每列的最小宽度，单位 mm。 */
export const MIN_TABLE_COLUMN_WIDTH = 1

/** 计划不能执行的原因：只剩一列、移动会拆开跨列的表尾单元格、所选范围只有一个单元格、单元格本来就不跨列。 */
export type TablePlanRefusal = 'table.lastColumn' | 'table.columnSpanned' | 'table.nothingToMerge' | 'table.nothingToSplit'

/** 计划结果：成功时给出 updateElement 的属性修改。 */
export type TablePlanResult
  = | { readonly ok: true, readonly changes: PropertyChange[] }
    | { readonly ok: false, readonly code: TablePlanRefusal }

/** 列宽怎样跟着变：keep 保持表格宽度、各列按比例缩放；resize 改变表格宽度、其余列不动。 */
export type TableColumnFit = 'keep' | 'resize'

function columnIndexOf(table: TableElement, columnId: string): number {
  const index = table.columns.findIndex(column => column.id === columnId)
  if (index < 0)
    throw new PrintOperationError('value.invalid', { columnId })
  return index
}

function rowIndexOf(table: TableElement, rowId: string): number {
  const index = table.footerRows.findIndex(row => row.id === rowId)
  if (index < 0)
    throw new PrintOperationError('value.invalid', { rowId })
  return index
}

function checkIndex(index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max)
    throw new PrintOperationError('index.outOfRange', { index, max })
}

/** 表尾行的单元格换成单行网格，单元格 id 是它在行里的下标；指向不存在的列的单元格不参与。 */
function gridOf(row: TableFooterRow, columns: readonly TableColumn[]): TableCell[] {
  const positions = new Map(columns.map((column, index) => [column.id, index]))
  return row.cells.flatMap((cell, index) => {
    const column = positions.get(cell.columnId)
    return column === undefined ? [] : [{ id: String(index), row: 0, column, rowSpan: 1, columnSpan: cell.colSpan }]
  })
}

function ok(changes: PropertyChange[]): TablePlanResult {
  return { ok: true, changes }
}

function widthChanges(table: TableElement, columns: TableColumn[], fit: TableColumnFit, delta: number): PropertyChange[] {
  if (fit === 'keep')
    return [{ path: ['columns'], value: scaleTableColumns(columns, table.width) as unknown as JsonValue }]
  return [{ path: ['columns'], value: columns as unknown as JsonValue }, { path: ['width'], value: table.width + delta }]
}

function footerChange(table: TableElement, rows: TableFooterRow[]): PropertyChange[] {
  return rows.some((row, index) => row !== table.footerRows[index]) ? [{ path: ['footerRows'], value: rows as unknown as JsonValue }] : []
}

/**
 * 在第 index 列之前插入一列（index 等于列数时追加在末尾）；跨过插入位置的表尾单元格多跨一列，其余表尾行在新列处留空。
 * 列标识重复或 index 越界时抛 PrintOperationError。
 */
export function planInsertTableColumn(table: TableElement, index: number, column: TableColumn, fit: TableColumnFit = 'keep'): TablePlanResult {
  checkIndex(index, table.columns.length)
  if (table.columns.some(item => item.id === column.id))
    throw new PrintOperationError('id.duplicate', { id: column.id })
  const columns = [...table.columns.slice(0, index), column, ...table.columns.slice(index)]
  const rows = table.footerRows.map((row) => {
    const plan = planTableLineInsert({ rows: 1, columns: table.columns.length }, gridOf(row, table.columns), 'column', index)
    const spans = new Map(plan.updates.map(cell => [Number(cell.id), cell.columnSpan]))
    let changed = false
    const cells = row.cells.map((cell, cellIndex) => {
      const span = spans.get(cellIndex)
      if (span === undefined || span === cell.colSpan)
        return cell
      changed = true
      return { ...cell, colSpan: span }
    })
    return changed ? { ...row, cells } : row
  })
  return ok([...widthChanges(table, columns, fit, column.width), ...footerChange(table, rows)])
}

/**
 * 删除一列：只占这一列的表尾单元格删除，跨过它的缩短一列，从它起跨的改由下一列起跨。只剩一列时拒绝。
 * 列标识不存在时抛 PrintOperationError。
 */
export function planRemoveTableColumn(table: TableElement, columnId: string, fit: TableColumnFit = 'keep'): TablePlanResult {
  const index = columnIndexOf(table, columnId)
  if (table.columns.length <= 1)
    return { ok: false, code: 'table.lastColumn' }
  const removed = table.columns[index]!
  const columns = table.columns.filter(column => column !== removed)
  const rows = table.footerRows.map((row) => {
    const plan = planTableLineRemove({ rows: 1, columns: table.columns.length }, gridOf(row, table.columns), 'column', index)
    const dropped = new Set(plan.removed.map(Number))
    const updates = new Map(plan.updates.map(cell => [Number(cell.id), cell]))
    let changed = dropped.size > 0
    const cells = row.cells.flatMap((cell, cellIndex): TableFooterCell[] => {
      if (dropped.has(cellIndex))
        return []
      const update = updates.get(cellIndex)
      if (update === undefined || update.columnSpan === cell.colSpan)
        return [cell]
      changed = true
      return [{ ...cell, colSpan: update.columnSpan, columnId: cell.columnId === columnId ? columns[update.column]!.id : cell.columnId }]
    })
    return changed ? { ...row, cells } : row
  })
  return ok([...widthChanges(table, columns, fit, -removed.width), ...footerChange(table, rows)])
}

/**
 * 把一列移到第 index 位（按移动后的顺序数）。移动会让某个跨列的表尾单元格覆盖的列变化时拒绝。
 * 列标识不存在或 index 越界时抛 PrintOperationError。
 */
export function planMoveTableColumn(table: TableElement, columnId: string, index: number): TablePlanResult {
  const from = columnIndexOf(table, columnId)
  checkIndex(index, table.columns.length - 1)
  if (from === index)
    return ok([])
  const before = table.columns.map(column => column.id)
  const after = before.filter(id => id !== columnId)
  after.splice(index, 0, columnId)
  for (const row of table.footerRows) {
    for (const cell of row.cells) {
      const start = before.indexOf(cell.columnId)
      if (start < 0 || cell.colSpan <= 1)
        continue
      const covered = new Set(before.slice(start, start + cell.colSpan))
      const moved = after.indexOf(cell.columnId)
      const now = after.slice(moved, moved + cell.colSpan)
      if (now.length !== covered.size || now.some(id => !covered.has(id)))
        return { ok: false, code: 'table.columnSpanned' }
    }
  }
  const byId = new Map(table.columns.map(column => [column.id, column]))
  return ok([{ path: ['columns'], value: after.map(id => byId.get(id)!) as unknown as JsonValue }])
}

/**
 * 把一列调到 width 宽，不小于 MIN_TABLE_COLUMN_WIDTH。keep 时由右侧相邻列（最后一列取左侧）此消彼长，
 * 相邻列也不小于下限，表格宽度不变；resize 时表格随之变宽或变窄。只有一列时总是改变表格宽度。
 */
export function planResizeTableColumn(table: TableElement, columnId: string, width: number, fit: TableColumnFit = 'keep'): TablePlanResult {
  const index = columnIndexOf(table, columnId)
  if (!Number.isFinite(width))
    throw new PrintOperationError('value.invalid', { width })
  const column = table.columns[index]!
  let target = Math.max(width, MIN_TABLE_COLUMN_WIDTH)
  const neighborIndex = index + 1 < table.columns.length ? index + 1 : index - 1
  if (fit === 'resize' || neighborIndex < 0) {
    const columns = table.columns.map(item => item === column ? { ...item, width: target } : item)
    return ok([{ path: ['columns'], value: columns as unknown as JsonValue }, { path: ['width'], value: table.width + target - column.width }])
  }
  const neighbor = table.columns[neighborIndex]!
  target = Math.min(target, column.width + neighbor.width - MIN_TABLE_COLUMN_WIDTH)
  const delta = target - column.width
  if (delta === 0)
    return ok([])
  const columns = table.columns.map((item) => {
    if (item === column)
      return { ...item, width: target }
    if (item === neighbor)
      return { ...item, width: neighbor.width - delta }
    return item
  })
  return ok([{ path: ['columns'], value: columns as unknown as JsonValue }])
}

/** 在第 index 个表尾行之前插入一行（index 等于行数时追加）。行标识重复或 index 越界时抛 PrintOperationError。 */
export function planInsertFooterRow(table: TableElement, index: number, row: TableFooterRow): TablePlanResult {
  checkIndex(index, table.footerRows.length)
  if (table.footerRows.some(item => item.id === row.id))
    throw new PrintOperationError('id.duplicate', { id: row.id })
  return ok([{ path: ['footerRows'], value: [...table.footerRows.slice(0, index), row, ...table.footerRows.slice(index)] as unknown as JsonValue }])
}

/** 删除一个表尾行。行标识不存在时抛 PrintOperationError。 */
export function planRemoveFooterRow(table: TableElement, rowId: string): TablePlanResult {
  const index = rowIndexOf(table, rowId)
  return ok([{ path: ['footerRows'], value: table.footerRows.filter((_, rowIndex) => rowIndex !== index) as unknown as JsonValue }])
}

/**
 * 合并表尾行里 columnIds 覆盖的列范围：与范围相交的单元格（含留空的列）合成一个，合并后的范围扩到它们的并集；
 * 保留最左边那个单元格的内容，最左边是留空的列时新建空白单元格。范围里只有一个单元格时拒绝。
 */
export function planMergeFooterCells(table: TableElement, rowId: string, columnIds: readonly string[]): TablePlanResult {
  const rowIndex = rowIndexOf(table, rowId)
  const row = table.footerRows[rowIndex]!
  const indexes = columnIds.map(id => columnIndexOf(table, id))
  const first = Math.min(...indexes)
  const last = Math.max(...indexes)
  const cells = gridOf(row, table.columns)
  const covered = new Set(cells.flatMap(cell => Array.from({ length: cell.columnSpan }, (_, offset) => cell.column + offset)))
  const grid = [...cells, ...table.columns.flatMap((_, column) => covered.has(column) ? [] : [{ id: `gap:${column}`, row: 0, column, rowSpan: 1, columnSpan: 1 }])]
  const chosen = grid.filter(cell => cell.column <= last && cell.column + cell.columnSpan > first)
  const plan = planCellMerge(grid, chosen.map(cell => cell.id))
  if (!plan.ok)
    return { ok: false, code: 'table.nothingToMerge' }
  const anchor = grid.find(cell => cell.id === plan.anchor)!
  const absorbed = new Set(plan.absorbed)
  const merged: TableFooterCell = anchor.id.startsWith('gap:')
    ? { columnId: table.columns[anchor.column]!.id, colSpan: plan.columnSpan, content: { kind: 'static', text: '' } }
    : { ...row.cells[Number(anchor.id)]!, colSpan: plan.columnSpan }
  const kept = row.cells.filter((_, index) => !absorbed.has(String(index)) && String(index) !== anchor.id)
  const positions = new Map(table.columns.map((column, index) => [column.id, index]))
  const next = [...kept, merged].sort((a, b) => (positions.get(a.columnId) ?? Infinity) - (positions.get(b.columnId) ?? Infinity))
  const rows = table.footerRows.map((item, index) => index === rowIndex ? { ...item, cells: next } : item)
  return ok([{ path: ['footerRows'], value: rows as unknown as JsonValue }])
}

/** 把表尾行里从 columnId 起跨的单元格拆成只占一列，空出来的列留空。单元格本来只占一列时拒绝。 */
export function planSplitFooterCell(table: TableElement, rowId: string, columnId: string): TablePlanResult {
  const rowIndex = rowIndexOf(table, rowId)
  const row = table.footerRows[rowIndex]!
  const cellIndex = row.cells.findIndex(cell => cell.columnId === columnId)
  if (cellIndex < 0)
    throw new PrintOperationError('value.invalid', { columnId })
  if (row.cells[cellIndex]!.colSpan <= 1)
    return { ok: false, code: 'table.nothingToSplit' }
  return ok([{ path: ['footerRows', rowIndex, 'cells', cellIndex, 'colSpan'], value: 1 }])
}
