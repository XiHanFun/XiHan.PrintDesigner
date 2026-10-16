/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { TableColumn, TableElement, TableFooterRow, TablePlanResult } from '../src'
import { describe, expect, it } from 'vitest'
import {
  applyOperation,
  createDocument,
  createElementRegistry,
  createPage,
  planInsertFooterRow,
  planInsertTableColumn,
  planMergeFooterCells,
  planMoveTableColumn,
  planRemoveFooterRow,
  planRemoveTableColumn,
  planResizeTableColumn,
  planSplitFooterCell,
  PrintOperationError,
  validateDocument,
} from '../src'

function column(id: string, width: number): TableColumn {
  return { id, title: id, width, align: 'left', content: { kind: 'field', field: id }, cellType: 'text' }
}

function footerRow(id: string, cells: [string, number][]): TableFooterRow {
  const table = createElementRegistry().createElement('table', { id: 'x', x: 0, y: 0 })
  return {
    id,
    placement: 'lastPage',
    height: 7,
    style: table.body.style,
    cells: cells.map(([columnId, colSpan]) => ({ columnId, colSpan, content: { kind: 'static', text: columnId } })),
  }
}

function tableOf(rows: TableFooterRow[] = [footerRow('sum', [['a', 2], ['c', 1]])]): TableElement {
  return createElementRegistry().createElement('table', {
    id: 't',
    x: 10,
    y: 10,
    overrides: { width: 180, dataField: 'items', columns: [column('a', 60), column('b', 60), column('c', 60)], footerRows: rows },
  })
}

/** 按计划执行 updateElement，返回修改后的表格，并确认修改后的模板没有 error 级问题。 */
function apply(table: TableElement, plan: TablePlanResult): TableElement {
  if (!plan.ok)
    throw new Error(plan.code)
  const page = createPage({ id: 'p' })
  page.elements = [table]
  const { document } = applyOperation(createDocument({ pages: [page] }), { type: 'updateElement', id: table.id, changes: plan.changes })
  const issues = validateDocument(document).issues.filter(issue => issue.severity === 'error')
  expect(issues).toEqual([])
  return document.pages[0]!.elements[0] as TableElement
}

function spans(table: TableElement, row = 0): [string, number][] {
  return table.footerRows[row]!.cells.map(cell => [cell.columnId, cell.colSpan])
}

describe('插入列', () => {
  it('跨过插入位置的表尾单元格多跨一列，缺省保持表格宽度、各列按比例缩放', () => {
    const next = apply(tableOf(), planInsertTableColumn(tableOf(), 1, column('n', 30)))
    expect(next.columns.map(item => item.id)).toEqual(['a', 'n', 'b', 'c'])
    expect(next.width).toBe(180)
    expect(next.columns.reduce((sum, item) => sum + item.width, 0)).toBeCloseTo(180, 10)
    expect(next.columns[1]!.width).toBeCloseTo(30 * 180 / 210, 10)
    expect(spans(next)).toEqual([['a', 3], ['c', 1]])
  })

  it('resize 时表格变宽、其余列不动；插在末尾时没有单元格要加长', () => {
    const next = apply(tableOf(), planInsertTableColumn(tableOf(), 3, column('n', 30), 'resize'))
    expect(next.width).toBe(210)
    expect(next.columns.map(item => item.width)).toEqual([60, 60, 60, 30])
    expect(spans(next)).toEqual([['a', 2], ['c', 1]])
  })

  it('列标识重复或位置越界时抛错', () => {
    expect(() => planInsertTableColumn(tableOf(), 0, column('b', 10))).toThrow(PrintOperationError)
    expect(() => planInsertTableColumn(tableOf(), 4, column('n', 10))).toThrow(PrintOperationError)
  })
})

describe('删除列', () => {
  it('删掉被跨过的列：跨列单元格缩短一列', () => {
    const next = apply(tableOf(), planRemoveTableColumn(tableOf(), 'b'))
    expect(next.columns.map(item => [item.id, item.width])).toEqual([['a', 90], ['c', 90]])
    expect(spans(next)).toEqual([['a', 1], ['c', 1]])
  })

  it('删掉跨列单元格的起始列：改由下一列起跨；只占这一列的单元格一并删除', () => {
    expect(spans(apply(tableOf(), planRemoveTableColumn(tableOf(), 'a')))).toEqual([['b', 1], ['c', 1]])
    const next = apply(tableOf(), planRemoveTableColumn(tableOf(), 'c', 'resize'))
    expect(next.width).toBe(120)
    expect(spans(next)).toEqual([['a', 2]])
  })

  it('只剩一列时拒绝', () => {
    const single = createElementRegistry().createElement('table', { id: 't', x: 0, y: 0, overrides: { width: 50, columns: [column('a', 50)] } })
    expect(planRemoveTableColumn(single, 'a')).toEqual({ ok: false, code: 'table.lastColumn' })
    expect(() => planRemoveTableColumn(single, 'z')).toThrow(PrintOperationError)
  })
})

describe('移动列', () => {
  it('不拆开跨列单元格时按移动后的顺序排列', () => {
    expect(apply(tableOf(), planMoveTableColumn(tableOf(), 'c', 0)).columns.map(item => item.id)).toEqual(['c', 'a', 'b'])
    expect(planMoveTableColumn(tableOf(), 'a', 0)).toEqual({ ok: true, changes: [] })
  })

  it('会改变跨列单元格覆盖的列时拒绝', () => {
    expect(planMoveTableColumn(tableOf(), 'b', 2)).toEqual({ ok: false, code: 'table.columnSpanned' })
    expect(planMoveTableColumn(tableOf(), 'c', 1)).toEqual({ ok: false, code: 'table.columnSpanned' })
  })
})

describe('调整列宽', () => {
  it('缺省由右侧相邻列此消彼长，最后一列取左侧，两列都不小于下限', () => {
    expect(apply(tableOf(), planResizeTableColumn(tableOf(), 'a', 70)).columns.map(item => item.width)).toEqual([70, 50, 60])
    expect(apply(tableOf(), planResizeTableColumn(tableOf(), 'c', 40)).columns.map(item => item.width)).toEqual([60, 80, 40])
    expect(apply(tableOf(), planResizeTableColumn(tableOf(), 'a', 500)).columns.map(item => item.width)).toEqual([119, 1, 60])
    expect(apply(tableOf(), planResizeTableColumn(tableOf(), 'a', -5)).columns.map(item => item.width)).toEqual([1, 119, 60])
  })

  it('resize 时表格宽度随之变化', () => {
    const next = apply(tableOf(), planResizeTableColumn(tableOf(), 'b', 80, 'resize'))
    expect([next.width, next.columns.map(item => item.width)]).toEqual([200, [60, 80, 60]])
  })
})

describe('表尾行', () => {
  it('插入与删除表尾行，行标识重复时抛错', () => {
    const inserted = apply(tableOf(), planInsertFooterRow(tableOf(), 0, footerRow('page', [['a', 3]])))
    expect(inserted.footerRows.map(row => row.id)).toEqual(['page', 'sum'])
    expect(apply(inserted, planRemoveFooterRow(inserted, 'sum')).footerRows.map(row => row.id)).toEqual(['page'])
    expect(() => planInsertFooterRow(tableOf(), 0, footerRow('sum', []))).toThrow(PrintOperationError)
    expect(() => planRemoveFooterRow(tableOf(), 'none')).toThrow(PrintOperationError)
  })

  it('合并：与范围相交的单元格合成一个，保留最左边的内容；最左边留空时新建空白单元格', () => {
    const gapped = tableOf([footerRow('sum', [['a', 1], ['c', 1]])])
    const left = apply(gapped, planMergeFooterCells(gapped, 'sum', ['a', 'b']))
    expect(spans(left)).toEqual([['a', 2], ['c', 1]])
    expect(left.footerRows[0]!.cells[0]!.content).toEqual({ kind: 'static', text: 'a' })
    const right = apply(gapped, planMergeFooterCells(gapped, 'sum', ['b', 'c']))
    expect(spans(right)).toEqual([['a', 1], ['b', 2]])
    expect(right.footerRows[0]!.cells[1]!.content).toEqual({ kind: 'static', text: '' })
    expect(spans(apply(tableOf(), planMergeFooterCells(tableOf(), 'sum', ['b', 'c'])))).toEqual([['a', 3]])
  })

  it('范围只落在一个单元格里时拒绝合并；拆分把跨列单元格还原成一列', () => {
    expect(planMergeFooterCells(tableOf(), 'sum', ['a', 'b'])).toEqual({ ok: false, code: 'table.nothingToMerge' })
    expect(spans(apply(tableOf(), planSplitFooterCell(tableOf(), 'sum', 'a')))).toEqual([['a', 1], ['c', 1]])
    expect(planSplitFooterCell(tableOf(), 'sum', 'c')).toEqual({ ok: false, code: 'table.nothingToSplit' })
    expect(() => planSplitFooterCell(tableOf(), 'sum', 'b')).toThrow(PrintOperationError)
  })
})
