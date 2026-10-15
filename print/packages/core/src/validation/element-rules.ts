/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ElementValidationContext } from '../registry/types'
import type {
  BarCodeElement,
  EllipseElement,
  LineElement,
  MatrixCodeElement,
  RectElement,
  TableElement,
} from '../schema/elements'
import { canEncodeBarCode, canEncodeMatrixCode, fitMatrixCodeLevel } from '../codes'

/** 长度比较的容差，单位 mm。 */
export const LENGTH_TOLERANCE = 0.01

/** 表格规则：有列、列宽合计等于表格宽度、表尾单元格指向存在的列且不越界不重叠、正文区放得下表头加一行。 */
export function validateTableRules(element: TableElement, context: ElementValidationContext): void {
  const { columns } = element
  if (columns.length === 0) {
    context.report('table.noColumns', ['columns'])
  }
  else {
    const columnsWidth = columns.reduce((sum, column) => sum + column.width, 0)
    if (Math.abs(columnsWidth - element.width) > LENGTH_TOLERANCE)
      context.report('table.columnWidthMismatch', ['columns'], { width: element.width, columnsWidth })
  }

  const columnIndex = new Map(columns.map((column, index) => [column.id, index]))
  element.footerRows.forEach((row, rowIndex) => {
    const occupied = new Set<number>()
    row.cells.forEach((cell, cellIndex) => {
      const path = ['footerRows', rowIndex, 'cells', cellIndex]
      const start = columnIndex.get(cell.columnId)
      if (start === undefined) {
        context.report('table.unknownColumn', [...path, 'columnId'], { columnId: cell.columnId })
        return
      }
      const available = columns.length - start
      if (cell.colSpan > available)
        context.report('table.cellSpanOverflow', [...path, 'colSpan'], { colSpan: cell.colSpan, available })
      for (let index = start; index < start + Math.min(cell.colSpan, available); index++) {
        if (occupied.has(index)) {
          context.report('table.cellOverlap', path, { columnId: columns[index]?.id ?? cell.columnId })
          break
        }
        occupied.add(index)
      }
    })
  })

  if (context.bodyRect !== undefined) {
    const header = element.header.visible ? element.header.height : 0
    const footer = element.footerRows
      .filter(row => row.placement === 'everyPage')
      .reduce((sum, row) => sum + row.height, 0)
    const required = header + element.body.rowHeight + footer
    if (required > context.bodyRect.height + LENGTH_TOLERANCE)
      context.report('table.rowExceedsBody', [], { required, available: context.bodyRect.height })
  }
}

/** 直线规则：按方向取得的线长大于 0。 */
export function validateLineRules(element: LineElement, context: ElementValidationContext): void {
  const length = element.direction === 'horizontal'
    ? element.width
    : element.direction === 'vertical'
      ? element.height
      : Math.hypot(element.width, element.height)
  if (length <= 0)
    context.report('line.zeroLength', [])
}

/** 矩形与椭圆规则：至少有边线或非透明填充之一。 */
export function validateShapeRules(element: RectElement | EllipseElement, context: ElementValidationContext): void {
  const filled = element.fill !== undefined && element.fill !== 'transparent'
  if (element.stroke === undefined && !filled)
    context.report('shape.invisible', [])
}

/** 条码规则：固定内容非空且能按码制编码。 */
export function validateBarCodeRules(element: BarCodeElement, context: ElementValidationContext): void {
  if (element.content.kind !== 'static')
    return
  if (element.content.text.length === 0)
    context.report('value.empty', ['content', 'text'])
  else if (!canEncodeBarCode(element.format, element.content.text))
    context.report('barCode.invalidValue', ['content', 'text'], { format: element.format })
}

/** 二维码规则：纠错级别适用于码制，固定内容非空且能编码，除 PDF417 外元素框为正方形。 */
export function validateMatrixCodeRules(element: MatrixCodeElement, context: ElementValidationContext): void {
  const fit = fitMatrixCodeLevel(element.format, element.level)
  if (fit === 'invalid')
    context.report('matrixCode.invalidLevel', ['level'], { format: element.format, level: String(element.level) })
  else if (fit === 'ignored')
    context.report('matrixCode.levelIgnored', ['level'], { format: element.format })
  if (element.content.kind === 'static') {
    const { text } = element.content
    const level = fit === 'valid' ? element.level : undefined
    if (text.length === 0)
      context.report('value.empty', ['content', 'text'])
    else if (fit !== 'invalid' && !canEncodeMatrixCode(element.format, text, level))
      context.report('matrixCode.invalidValue', ['content', 'text'], { format: element.format })
  }
  if (element.format !== 'pdf417' && Math.abs(element.width - element.height) > LENGTH_TOLERANCE)
    context.report('matrixCode.notSquare', [], { width: element.width, height: element.height })
}
