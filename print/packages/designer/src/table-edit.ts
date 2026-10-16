/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 表格编辑态：按设计态布局盒命中表格部位、算列边界，以及右键菜单里各项表格命令对应的 core 计划。

import type { TableColumn, TableElement, TableFooterRow, TableLayoutBox, TablePlanResult } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { Point } from '@xihan-ui/designer-kit'
import type { PrintTablePart } from './editor'
import {
  planInsertFooterRow,
  planInsertTableColumn,
  planMergeFooterCells,
  planMoveTableColumn,
  planRemoveFooterRow,
  planRemoveTableColumn,
  planSplitFooterCell,
} from '@xihan-print/core'
import { nextFreeId } from '@xihan-ui/designer-kit'

/** 表格编辑态的命令。 */
export type TableCommand
  = | 'insert-column-left'
    | 'insert-column-right'
    | 'remove-column'
    | 'move-column-left'
    | 'move-column-right'
    | 'insert-footer-row-above'
    | 'insert-footer-row-below'
    | 'remove-footer-row'
    | 'merge-cell-right'
    | 'split-cell'

/** 全部表格命令，按右键菜单里的顺序。 */
export const TABLE_COMMANDS: readonly TableCommand[] = [
  'insert-column-left',
  'insert-column-right',
  'remove-column',
  'move-column-left',
  'move-column-right',
  'insert-footer-row-above',
  'insert-footer-row-below',
  'remove-footer-row',
  'merge-cell-right',
  'split-cell',
]

/** 表格命令的计划与执行后要选中的部位；命令对当前部位不适用时为 undefined。 */
export interface TableCommandPlan {
  readonly plan: TablePlanResult
  readonly part?: PrintTablePart
}

/** 设计态布局盒里落在 point（纸张坐标，mm）上的表格部位：表头格为列，表体与补空行为表体，表尾格为表尾单元格，表尾行的空位为表尾行。 */
export function tablePartAt(box: TableLayoutBox, point: Point): PrintTablePart | undefined {
  const row = box.rows.find(item => point.y >= item.y && point.y < item.y + item.height)
  if (row === undefined)
    return undefined
  const cell = row.cells.find(item => point.x >= item.x && point.x < item.x + item.width)
  const elementId = box.elementId
  switch (row.role) {
    case 'header':
      return cell === undefined ? { kind: 'header', elementId } : { kind: 'column', elementId, columnId: cell.columnId }
    case 'footer':
      if (row.footerRowId === undefined)
        return undefined
      return cell === undefined
        ? { kind: 'footerRow', elementId, rowId: row.footerRowId }
        : { kind: 'footerCell', elementId, rowId: row.footerRowId, columnId: cell.columnId }
    default:
      return { kind: 'body', elementId }
  }
}

/** 列的右边界，纸张坐标的横坐标（mm），按列的顺序。 */
export function columnBoundaries(table: TableElement): { readonly column: TableColumn, readonly x: number }[] {
  let x = table.x
  return table.columns.map((column) => {
    x += column.width
    return { column, x }
  })
}

function newColumn(table: TableElement, near: TableColumn, t: PrintDesignerTranslations): TableColumn {
  const id = nextFreeId('col-', table.columns.map(column => column.id))
  return { id, title: t.newColumnTitle(table.columns.length + 1), width: near.width, align: near.align, content: { kind: 'field', field: '' }, cellType: 'text' }
}

function newFooterRow(table: TableElement): TableFooterRow {
  const id = nextFreeId('row-', table.footerRows.map(row => row.id))
  return { id, placement: 'lastPage', height: table.body.rowHeight, style: structuredClone(table.body.style), cells: [] }
}

/** 按当前部位求表格命令的计划；命令对这个部位不适用时为 undefined。 */
export function planTableCommand(table: TableElement, part: PrintTablePart | undefined, command: TableCommand, t: PrintDesignerTranslations): TableCommandPlan | undefined {
  if (part === undefined || part.elementId !== table.id)
    return undefined
  const columnIndex = 'columnId' in part ? table.columns.findIndex(column => column.id === part.columnId) : -1
  const rowIndex = 'rowId' in part ? table.footerRows.findIndex(row => row.id === part.rowId) : -1
  switch (command) {
    case 'insert-column-left':
    case 'insert-column-right': {
      if (part.kind !== 'column' || columnIndex < 0)
        return undefined
      const column = newColumn(table, table.columns[columnIndex]!, t)
      const index = command === 'insert-column-left' ? columnIndex : columnIndex + 1
      return { plan: planInsertTableColumn(table, index, column), part: { kind: 'column', elementId: table.id, columnId: column.id } }
    }
    case 'remove-column':
      return part.kind === 'column' && columnIndex >= 0 ? { plan: planRemoveTableColumn(table, part.columnId), part: { kind: 'body', elementId: table.id } } : undefined
    case 'move-column-left':
    case 'move-column-right': {
      const to = command === 'move-column-left' ? columnIndex - 1 : columnIndex + 1
      if (part.kind !== 'column' || columnIndex < 0 || to < 0 || to >= table.columns.length)
        return undefined
      return { plan: planMoveTableColumn(table, part.columnId, to), part }
    }
    case 'insert-footer-row-above':
    case 'insert-footer-row-below': {
      const row = newFooterRow(table)
      const at = rowIndex < 0 ? table.footerRows.length : command === 'insert-footer-row-above' ? rowIndex : rowIndex + 1
      if (command === 'insert-footer-row-above' && rowIndex < 0)
        return undefined
      return { plan: planInsertFooterRow(table, at, row), part: { kind: 'footerRow', elementId: table.id, rowId: row.id } }
    }
    case 'remove-footer-row':
      return rowIndex >= 0 && 'rowId' in part ? { plan: planRemoveFooterRow(table, part.rowId), part: { kind: 'body', elementId: table.id } } : undefined
    case 'merge-cell-right': {
      if (part.kind !== 'footerCell' || rowIndex < 0 || columnIndex < 0)
        return undefined
      const cell = table.footerRows[rowIndex]!.cells.find(item => item.columnId === part.columnId)!
      const next = table.columns[columnIndex + cell.colSpan]
      return next === undefined ? undefined : { plan: planMergeFooterCells(table, part.rowId, [part.columnId, next.id]), part }
    }
    case 'split-cell':
      return part.kind === 'footerCell' && rowIndex >= 0 ? { plan: planSplitFooterCell(table, part.rowId, part.columnId), part } : undefined
  }
}
