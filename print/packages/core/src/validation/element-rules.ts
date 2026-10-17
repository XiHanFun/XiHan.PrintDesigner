/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { RichBlock } from '@xihan-ui/core/rich-text'
import type { TableCell } from '@xihan-ui/designer-kit'
import type { ElementValidationContext } from '../registry/types'
import type {
  BarCodeElement,
  EllipseElement,
  LineElement,
  MatrixCodeElement,
  RectElement,
  RichTextElement,
  TableElement,
} from '../schema/elements'
import { checkTableCells } from '@xihan-ui/designer-kit'
import { checkBarCodeValue, matrixCodeLevelFit } from '@xihan-ui/headless'
import { barCodeIssueParams, checkMatrixCodeContent, matrixCodeIssueParams } from '../codes'

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
    const cells: TableCell[] = []
    row.cells.forEach((cell, cellIndex) => {
      const column = columnIndex.get(cell.columnId)
      if (column === undefined)
        context.report('table.unknownColumn', ['footerRows', rowIndex, 'cells', cellIndex, 'columnId'], { columnId: cell.columnId })
      else
        cells.push({ id: String(cellIndex), row: 0, column, rowSpan: 1, columnSpan: cell.colSpan })
    })
    // 表尾行是单行网格：越界与重叠按 designer-kit 的判据，没铺满的列允许留空
    for (const issue of checkTableCells({ rows: 1, columns: columns.length }, cells)) {
      if (issue.code !== 'out-of-bounds' && issue.code !== 'overlap')
        continue
      const cellIndex = Number(issue.id)
      const cell = row.cells[cellIndex]!
      const path = ['footerRows', rowIndex, 'cells', cellIndex]
      if (issue.code === 'out-of-bounds')
        context.report('table.cellSpanOverflow', [...path, 'colSpan'], { colSpan: cell.colSpan, available: columns.length - columnIndex.get(cell.columnId)! })
      else
        context.report('table.cellOverlap', path, { columnId: cell.columnId })
    }
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
  const { text } = element.content
  const issue = checkBarCodeValue(element.format, text)
  if (text.length === 0)
    context.report('empty', ['content', 'text'])
  else if (issue !== undefined)
    context.report('barCode.invalidValue', ['content', 'text'], barCodeIssueParams(element.format, issue))
}

/** 二维码规则：纠错级别适用于码制，固定内容非空且能编码，除 PDF417 外元素框为正方形。 */
export function validateMatrixCodeRules(element: MatrixCodeElement, context: ElementValidationContext): void {
  const fit = matrixCodeLevelFit(element.format, element.level)
  if (fit === 'invalid')
    context.report('matrixCode.invalidLevel', ['level'], { format: element.format, level: String(element.level) })
  else if (fit === 'ignored')
    context.report('matrixCode.levelIgnored', ['level'], { format: element.format })
  if (element.content.kind === 'static') {
    const { text } = element.content
    const issue = fit === 'invalid' ? undefined : checkMatrixCodeContent(element.format, text, element.level)
    if (text.length === 0)
      context.report('empty', ['content', 'text'])
    else if (issue !== undefined)
      context.report('matrixCode.invalidValue', ['content', 'text'], matrixCodeIssueParams(element.format, issue))
  }
  if (element.format !== 'pdf417' && Math.abs(element.width - element.height) > LENGTH_TOLERANCE)
    context.report('matrixCode.notSquare', [], { width: element.width, height: element.height })
}

/** 块里有没有要显示的东西：非空白文字、行内字段、分隔线或列表项。 */
function hasRichContent(blocks: readonly RichBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'list')
      return block.items.length > 0
    if (block.type === 'divider')
      return true
    return block.runs.some(run => run.type === 'field' || (run.type === 'text' && run.text.trim() !== ''))
  })
}

/** 富文本规则：模板里写死的文档要有内容。 */
export function validateRichTextRules(element: RichTextElement, context: ElementValidationContext): void {
  if (element.content.kind === 'static' && !hasRichContent(element.content.document.blocks))
    context.report('richText.empty', ['content', 'document'])
}
