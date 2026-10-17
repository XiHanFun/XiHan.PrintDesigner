/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { Rect, Size } from '@xihan-ui/designer-kit'
import type { IssueSeverity, SchemaIssue, SchemaIssueTarget } from '@xihan-ui/designer-kit/schema'
import type { ExpressionEngine, ValueFormatter } from '@xihan-ui/expression'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { PrintCoreExtension } from '../extensions'
import type { BoxStyle, Color, Edges, Stroke, TextStyle } from '../schema/common'
import type { Watermark } from '../schema/document'
import type { BarCodeTextStyle } from '../schema/elements'
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
  TextAlign,
  VerticalAlign,
} from '../schema/options'
import type { CellStyle, TableBorder } from '../schema/table'
import type { ElementRegion } from '../traverse'
import type { IssueParams, ValidationIssue } from '../validation/issues'

/** 按文本样式排出的文字，长度单位 mm。 */
export interface TextMeasurement {
  /** 换行后的各行文字。 */
  lines: string[]
  /** 最宽一行的宽度。 */
  width: number
  /** 全部行的总高度。 */
  height: number
}

/** 分页选项。 */
export interface PaginateOptions {
  /**
   * 文字度量器，即 @xihan-ui/viz 的 TextMeasurer：按 CSS 像素量字宽，字号与可用宽度由 core 换算后交给它。
   * 浏览器里用 @xihan-ui/viz 的 createCanvasMeasurer(document)。
   */
  measurer: TextMeasurer
  /** 受限表达式接入点；模板含表达式而未提供时，表达式结果为空并给出诊断。 */
  expressionEngine?: ExpressionEngine
  /** 数字、百分比、日期、人民币大写格式的格式化器；模板用到这些格式而未提供时，显示原值并给出诊断。 */
  formatter?: ValueFormatter
  /** 交给格式化器的区域，只决定小数点与千分位符号。 */
  locale?: string
  /** 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称。 */
  timeZone?: string
  /** 输出页总数上限，缺省 1000；超出时停止排版并给出诊断。 */
  maxSheets?: number
  /** 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前；交给校验，与设计器、预览用同一份。 */
  extensions?: readonly PrintCoreExtension[]
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
  /** 元素类型：内置类型，或扩展登记的类型。 */
  elementType: string
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

/** 富文本一行里同一样式的一截文字：字号与字间距单位 pt。 */
export interface RichTextSpan {
  text: string
  /** 字体族，缺省使用运行时默认字体。 */
  fontFamily?: string
  /** 字号；上标与下标为缩小后的值。 */
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  lineThrough: boolean
  color: Color
  /** 文字底色。 */
  background?: Color
  letterSpacing: number
  /** 上标或下标。 */
  script?: 'super' | 'sub'
  /** 链接地址，已过 @xihan-ui/core/url 的 toSafeLinkHref。 */
  link?: string
}

/** 列表项的项目符号或序号。 */
export interface RichTextMarker {
  /** 距内容区左边的位置，单位 mm。 */
  x: number
  span: RichTextSpan
}

/** 富文本排出的一行，长度单位 mm。 */
export interface RichTextLine {
  /** 与上一行之间的段距；每段续排的第一行为 0。 */
  gap: number
  /** 行高：这一行里最大的字号乘以行高倍数。 */
  height: number
  /** 行首缩进，即列表的层级缩进。 */
  indent: number
  /** 水平对齐；两端对齐的块里，最后一行与换行之前的行取 left。 */
  align: TextAlign
  /** 这一行的文字；空行与分隔线没有文字。 */
  spans: RichTextSpan[]
  /** 列表项第一行的项目符号或序号。 */
  marker?: RichTextMarker
  /** 分隔线：这一行竖向居中画一条横线。 */
  divider?: { color: Color, width: number }
}

/** 富文本布局盒，跨页时每页一段。 */
export interface RichTextLayoutBox extends LayoutBoxBase {
  kind: 'richText'
  lines: RichTextLine[]
  /** 内容在元素框里的竖向对齐，取基准样式。 */
  verticalAlign: VerticalAlign
  box?: BoxStyle
  fragment: LayoutFragment
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
/** 扩展元素的布局盒：data 是原型的 layout 给出的数据，交给运行时层同一类型的渲染；类型没登记时为 null。 */
export interface ExtensionLayoutBox extends LayoutBoxBase {
  kind: 'extension'
  data: JsonValue
}

export type LayoutBox
  = | TextLayoutBox
    | ExtensionLayoutBox
    | RichTextLayoutBox
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

/**
 * 全部分页诊断码及其固定的严重程度：error 为按模板该画的内容没有画出或输出页被截断，
 * warning 为内容画出了但与设计有出入。与校验问题同名的诊断码严重程度相同。
 */
export const PAGINATION_DIAGNOSTIC_SEVERITIES = {
  'data.notArray': 'warning',
  'data.notScalar': 'warning',
  'format.unavailable': 'warning',
  'format.failed': 'warning',
  'expression.unavailable': 'warning',
  'expression.failed': 'error',
  'image.unsafeSource': 'error',
  'barCode.invalidValue': 'error',
  'matrixCode.invalidValue': 'error',
  'text.overflow': 'warning',
  'richText.droppedContent': 'warning',
  'richText.invalidData': 'error',
  'table.rowOverflow': 'warning',
  'element.overflow': 'warning',
  'layout.sheetLimit': 'error',
} as const satisfies Record<string, IssueSeverity>

/** 分页诊断码。 */
export type PaginationDiagnosticCode = keyof typeof PAGINATION_DIAGNOSTIC_SEVERITIES

/** 分页诊断所在的页面（kind 为 page）或元素（kind 为 element）。 */
export interface PaginationDiagnosticTarget extends SchemaIssueTarget {
  readonly kind: 'page' | 'element'
}

/**
 * 分页诊断：与校验问题同形的 @xihan-ui/designer-kit/schema 的 SchemaIssue，不含文案，严重程度与 target 总是给出。
 * path 从文档根算起，指到出问题的元素或页面；行下标、列标识、限额等与数据相关的信息在 params 里。
 * 同一位置的同一问题只报告一次。
 */
export type PaginationDiagnostic = SchemaIssue<PaginationDiagnosticCode> & {
  readonly severity: IssueSeverity
  readonly target: PaginationDiagnosticTarget
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
