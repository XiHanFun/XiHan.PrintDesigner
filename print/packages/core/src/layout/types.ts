/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEngine, FormatOptions, FormatSpec } from '@xihan-ui/expression'
import type { Rect } from '../geometry'
import type { Size } from '../paper'
import type { ElementRegistry } from '../registry/registry'
import type { BoxStyle, Color, Edges, Stroke, TextStyle } from '../schema/common'
import type { Watermark } from '../schema/document'
import type { BarCodeTextStyle, PrintElementType } from '../schema/elements'
import type {
  BarCodeFormat,
  HorizontalAlign,
  ImageFit,
  LineDirection,
  MatrixCodeFormat,
  MatrixCodeLevel,
  PageBandKey,
  PageOrientation,
  TableCellType,
} from '../schema/options'
import type { CellStyle, TableBorder } from '../schema/table'
import type { ElementRegion } from '../traverse'
import type { IssueParams, ValidationIssue } from '../validation/issues'

/** 文本测量请求。 */
export interface TextMeasureRequest {
  text: string
  fontFamily?: string
  /** 字号，单位 pt。 */
  fontSize: number
  bold: boolean
  italic: boolean
  /** 字间距，单位 pt。 */
  letterSpacing: number
  /** 行高，字号的倍数。 */
  lineHeight: number
  /** 可用宽度，单位 mm。 */
  maxWidth: number
  /** 是否在可用宽度处自动换行；为 false 时只在换行符处断行。 */
  wrap: boolean
}

/** 文本测量结果，长度单位 mm。 */
export interface TextMeasurement {
  /** 换行后的各行文字。 */
  lines: string[]
  /** 最宽一行的宽度。 */
  width: number
  /** 全部行的总高度。 */
  height: number
}

/** 文本测量器，由宿主或上层包按实际字体实现。 */
export interface TextMeasurer {
  measure: (request: TextMeasureRequest) => TextMeasurement
}

/**
 * 值格式化器：按 @xihan-ui/expression 的格式说明把值转成显示文本，签名与其 formatValue 相同；
 * 格式说明或值不合法时抛出 TypeError，message 为问题码。
 */
export type ValueFormatter = (value: unknown, spec: FormatSpec, options: FormatOptions) => string

/** 分页选项。 */
export interface PaginateOptions {
  measurer: TextMeasurer
  /** 受限表达式接入点；模板含表达式而未提供时，表达式结果为空并给出诊断。 */
  expressions?: ExpressionEngine
  /** 数字、百分比、日期、人民币大写格式的格式化器；模板用到这些格式而未提供时，显示原值并给出诊断。 */
  format?: ValueFormatter
  /** 交给格式化器的区域，只决定小数点与千分位符号。 */
  locale?: string
  /** 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称。 */
  timeZone?: string
  /** 输出页总数上限，缺省 1000；超出时停止排版并给出诊断。 */
  maxSheets?: number
  /** 元素类型登记表，默认为内置元素的登记表。 */
  registry?: ElementRegistry
}

/** 跨页续排元素的分段位置。 */
export interface LayoutFragment {
  /** 分段序号，从 0 开始。 */
  index: number
  /** 是否为最后一段。 */
  last: boolean
}

/** 布局盒共有的字段。坐标相对纸张左上角，单位 mm。 */
export interface LayoutBoxBase {
  elementId: string
  elementType: PrintElementType
  region: ElementRegion
  x: number
  y: number
  width: number
  height: number
  /** 是否只在预览中显示、不参与打印。 */
  previewOnly: boolean
}

/** 文本、长文本与页码的布局盒。 */
export interface TextLayoutBox extends LayoutBoxBase {
  kind: 'text'
  /** 已换行的各行文字。 */
  lines: string[]
  /** 文字样式；固定尺寸文本缩小字号以容纳时，字号为缩小后的值。 */
  style: TextStyle
  /** 内容超出元素框时是否裁切。 */
  overflow: 'clip' | 'visible'
  rotation: number
  box?: BoxStyle
  /** 长文本跨页时的分段位置。 */
  fragment?: LayoutFragment
}

/** 图片布局盒。 */
export interface ImageLayoutBox extends LayoutBoxBase {
  kind: 'image'
  /** 图片地址；数据中的地址为空或不安全时为空串。 */
  src: string
  fit: ImageFit
  rotation: number
  box?: BoxStyle
}

/** 直线布局盒。 */
export interface LineLayoutBox extends LayoutBoxBase {
  kind: 'line'
  direction: LineDirection
  stroke: Stroke
}

/** 矩形布局盒。 */
export interface RectLayoutBox extends LayoutBoxBase {
  kind: 'rect'
  stroke?: Stroke
  fill?: Color
  radius: number
  rotation: number
}

/** 椭圆布局盒。 */
export interface EllipseLayoutBox extends LayoutBoxBase {
  kind: 'ellipse'
  stroke?: Stroke
  fill?: Color
  rotation: number
}

/** 一维条码布局盒。 */
export interface BarCodeLayoutBox extends LayoutBoxBase {
  kind: 'barCode'
  format: BarCodeFormat
  /** 条码内容。 */
  value: string
  showText: boolean
  textStyle: BarCodeTextStyle
  color: Color
  rotation: number
}

/** 二维码布局盒。 */
export interface MatrixCodeLayoutBox extends LayoutBoxBase {
  kind: 'matrixCode'
  format: MatrixCodeFormat
  value: string
  /** 纠错级别，缺省取码制的默认值。 */
  level?: MatrixCodeLevel
  color: Color
  background?: Color
  quietZone: number
  rotation: number
}

/** 表格单元格布局，坐标相对纸张左上角。 */
export interface TableCellLayout {
  columnId: string
  colSpan: number
  x: number
  width: number
  align: HorizontalAlign
  cellType: TableCellType
  /** 单元格文本；图片单元格为地址，条码与二维码单元格为编码内容。 */
  text: string
  /** 文本单元格换行后的各行文字，其余类型为空数组。 */
  lines: string[]
  /** 条码单元格的码制。 */
  barCodeFormat?: BarCodeFormat
}

/** 表格行布局：表头、数据行、补空行或表尾行。 */
export interface TableRowLayout {
  role: 'header' | 'body' | 'filler' | 'footer'
  /** 数据行在全部数据中的下标。 */
  dataIndex?: number
  /** 表尾行的标识。 */
  footerRowId?: string
  y: number
  height: number
  style: CellStyle
  cells: TableCellLayout[]
}

/** 表格布局盒，跨页时每页一段。 */
export interface TableLayoutBox extends LayoutBoxBase {
  kind: 'table'
  border: TableBorder
  rows: TableRowLayout[]
  fragment: LayoutFragment
}

/** 布局盒。 */
export type LayoutBox
  = | TextLayoutBox
    | ImageLayoutBox
    | LineLayoutBox
    | RectLayoutBox
    | EllipseLayoutBox
    | BarCodeLayoutBox
    | MatrixCodeLayoutBox
    | TableLayoutBox

/** 输出页选中的页眉或页脚带区。 */
export interface LayoutBand {
  key: PageBandKey
  rect: Rect
}

/** 已替换占位的水印。 */
export type LayoutWatermark = Watermark

/** 一张输出页。 */
export interface LayoutSheet {
  /** 所属页面模板的标识。 */
  pageId: string
  /** 在所属页面模板排出的输出页中的序号，从 0 开始。 */
  sheetIndex: number
  pageNumber: number
  /** 所在页码编号段的总页数。 */
  totalPages: number
  /** 按方向换算后的纸张尺寸。 */
  size: Size
  orientation: PageOrientation
  margins: Edges
  header: LayoutBand
  footer: LayoutBand
  body: Rect
  /** 按页眉、正文、页脚的顺序，各区域内按元素层级排列。 */
  boxes: LayoutBox[]
  watermark?: LayoutWatermark
}

/** 分页诊断码。 */
export type PaginationDiagnosticCode
  = | 'data.notArray'
    | 'data.notScalar'
    | 'format.unavailable'
    | 'format.failed'
    | 'expression.unavailable'
    | 'expression.failed'
    | 'image.unsafeSource'
    | 'barCode.invalidValue'
    | 'matrixCode.invalidValue'
    | 'text.overflow'
    | 'table.rowOverflow'
    | 'element.overflow'
    | 'layout.sheetLimit'

/** 分页诊断：只含诊断码、定位与参数，不含文案；同一元素的同一问题只报告一次。 */
export interface PaginationDiagnostic {
  code: PaginationDiagnosticCode
  pageId: string
  elementId?: string
  params?: IssueParams
}

/** 分页结果。 */
export interface PaginationResult {
  sheets: LayoutSheet[]
  diagnostics: PaginationDiagnostic[]
}

/** 分页无法进行的原因：文档有 error 级校验问题、选项不合法、测量器或格式化器返回了不合法的结果。 */
export type PrintLayoutErrorCode = 'document.invalid' | 'option.invalid' | 'measurer.invalidResult' | 'formatter.invalidResult'

/** 分页无法进行时抛出的错误。 */
export class PrintLayoutError extends Error {
  readonly code: PrintLayoutErrorCode
  readonly params: IssueParams
  /** 文档不合法时的校验问题。 */
  readonly issues: readonly ValidationIssue[]

  constructor(code: PrintLayoutErrorCode, params: IssueParams = {}, issues: readonly ValidationIssue[] = []) {
    super(`${code} ${JSON.stringify(params)}`)
    this.name = 'PrintLayoutError'
    this.code = code
    this.params = params
    this.issues = issues
  }
}
