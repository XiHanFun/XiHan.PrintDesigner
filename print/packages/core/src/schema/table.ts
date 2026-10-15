/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Color, Stroke, TextContent, ValueFormat } from './common'
import type {
  AggregateFunction,
  AggregateScope,
  BarcodeSymbology,
  HorizontalAlign,
  TableCellType,
  TableFooterPlacement,
  VerticalAlign,
} from './options'

/** 单元格样式。 */
export interface CellStyle {
  fontFamily?: string
  /** 字号，单位 pt。 */
  fontSize: number
  bold: boolean
  italic: boolean
  color: Color
  background?: Color
  /** 水平对齐，缺省跟随列的对齐方式。 */
  align?: HorizontalAlign
  verticalAlign: VerticalAlign
  /** 左右内边距，单位 mm。 */
  padding: number
}

/** 表体单元格显示行内字段。 */
export interface TableFieldCellContent {
  kind: 'field'
  /** 行对象内的字段路径。 */
  field: string
  format?: ValueFormat
  emptyText?: string
}

/** 表体单元格按行对象替换 `{{path}}` 占位。 */
export interface TableTemplateCellContent {
  kind: 'template'
  template: string
}

/** 表体单元格显示从 1 开始、跨页连续的行序号。 */
export interface TableRowNumberCellContent {
  kind: 'rowNumber'
}

/** 表体单元格以受限表达式计算，表达式中的变量为行对象的顶层字段。 */
export interface TableExpressionCellContent {
  kind: 'expression'
  /** 受限表达式源码。 */
  expression: string
  /** 计算结果的格式。 */
  format?: ValueFormat
}

/** 表体单元格内容来源。 */
export type TableCellContent
  = | TableFieldCellContent
    | TableTemplateCellContent
    | TableRowNumberCellContent
    | TableExpressionCellContent

/** 表格列。 */
export interface TableColumn {
  /** 列标识，在所属表格内唯一。 */
  id: string
  /** 表头文本。 */
  title: string
  /** 列宽，单位 mm。 */
  width: number
  align: HorizontalAlign
  content: TableCellContent
  cellType: TableCellType
  /** 条码码制，`cellType` 为 barcode 时必填。 */
  symbology?: BarcodeSymbology
}

/** 表头。 */
export interface TableHeader {
  visible: boolean
  /** 表格跨页时是否在每一页重复表头。 */
  repeat: boolean
  /** 表头行高，单位 mm。 */
  height: number
  style: CellStyle
}

/** 表体。 */
export interface TableBody {
  /** 行高，单位 mm；`autoHeight` 为 true 时作为最小行高。 */
  rowHeight: number
  /** 是否按内容撑高行。 */
  autoHeight: boolean
  style: CellStyle
}

/** 表尾单元格的汇总内容。 */
export interface AggregateCellContent {
  kind: 'aggregate'
  fn: AggregateFunction
  /** 参与汇总的行内字段路径；`fn` 为 count 时可省略，表示统计行数。 */
  field?: string
  scope: AggregateScope
  format?: ValueFormat
}

/** 表尾单元格内容：固定文本、根数据字段、根数据模板或汇总值。 */
export type TableFooterCellContent = TextContent | AggregateCellContent

/** 表尾单元格。 */
export interface TableFooterCell {
  /** 起始列的标识。 */
  columnId: string
  /** 向右跨越的列数，至少为 1。 */
  colSpan: number
  content: TableFooterCellContent
  /** 水平对齐，缺省跟随行样式再跟随起始列。 */
  align?: HorizontalAlign
}

/** 表尾行，可承载固定文字、根数据字段与汇总值。 */
export interface TableFooterRow {
  /** 行标识，在所属表格内唯一。 */
  id: string
  placement: TableFooterPlacement
  /** 行高，单位 mm。 */
  height: number
  style: CellStyle
  cells: TableFooterCell[]
}

/** 表格网格线。 */
export interface TableBorder {
  stroke: Stroke
  /** 是否画外框。 */
  outer: boolean
  /** 是否画行之间的横线。 */
  horizontal: boolean
  /** 是否画列之间的竖线。 */
  vertical: boolean
}
