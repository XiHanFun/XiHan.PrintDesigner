/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonObject } from '../json'
import type { BoxStyle, Color, ImageSource, Stroke, TextContent, TextStyle } from './common'
import type {
  BarCodeFormat,
  ImageFit,
  LineDirection,
  MatrixCodeFormat,
  MatrixCodeLevel,
  TextOverflow,
} from './options'
import type { TableBody, TableBorder, TableColumn, TableFooterRow, TableHeader } from './table'

/** 全部元素共有的字段。坐标相对纸张左上角，单位 mm。 */
export interface ElementBase<TType extends string> {
  /** 元素标识，在整份文档内唯一。 */
  id: string
  type: TType
  /** 设计器中显示的名称。 */
  name?: string
  x: number
  y: number
  width: number
  height: number
  /** 是否锁定，锁定的元素在设计器中不可拖动与缩放。 */
  locked?: boolean
  /** 是否只在设计与预览中显示、不参与打印。 */
  previewOnly?: boolean
  /** 宿主附加数据。 */
  meta?: JsonObject
}

/** 固定尺寸的文本。 */
export interface TextElement extends ElementBase<'text'> {
  content: TextContent
  style: TextStyle
  /** 是否自动换行。 */
  wrap: boolean
  overflow: TextOverflow
  /** 绕中心顺时针旋转的角度。 */
  rotation: number
  box?: BoxStyle
}

/** 随内容纵向延展并可跨页续排的长文本。 */
export interface LongTextElement extends ElementBase<'longText'> {
  content: TextContent
  style: TextStyle
  box?: BoxStyle
}

/** 绑定数组数据、随行数延展并可跨页续排的表格。 */
export interface TableElement extends ElementBase<'table'> {
  /** 数组数据的字段路径。 */
  dataField: string
  columns: TableColumn[]
  header: TableHeader
  body: TableBody
  footerRows: TableFooterRow[]
  /** 每页最多显示的数据行数，缺省按可用高度排满。 */
  maxRowsPerPage?: number
  /** 数据行不足时是否用空行补齐到每页最大行数或可用高度。 */
  fillEmptyRows: boolean
  border: TableBorder
}

/** 图片。 */
export interface ImageElement extends ElementBase<'image'> {
  source: ImageSource
  fit: ImageFit
  rotation: number
  box?: BoxStyle
}

/** 直线，走向由元素框和方向共同决定。 */
export interface LineElement extends ElementBase<'line'> {
  direction: LineDirection
  stroke: Stroke
}

/** 矩形。 */
export interface RectElement extends ElementBase<'rect'> {
  /** 边线，缺省不画边。 */
  stroke?: Stroke
  /** 填充色，缺省不填充。 */
  fill?: Color
  /** 圆角半径，单位 mm。 */
  radius: number
  rotation: number
}

/** 椭圆，内切于元素框。 */
export interface EllipseElement extends ElementBase<'ellipse'> {
  stroke?: Stroke
  fill?: Color
  rotation: number
}

/** 条码下方文字的样式。 */
export interface BarCodeTextStyle {
  fontFamily?: string
  /** 字号，单位 pt。 */
  fontSize: number
}

/** 一维条码。 */
export interface BarCodeElement extends ElementBase<'barCode'> {
  /** 码制，取值见 @xihan-ui/headless 的 BAR_CODE_FORMATS。 */
  format: BarCodeFormat
  content: TextContent
  /** 是否在条码下方显示编码文字。 */
  showText: boolean
  textStyle: BarCodeTextStyle
  color: Color
  rotation: number
}

/** 二维码：QR、Data Matrix、PDF417、Aztec。 */
export interface MatrixCodeElement extends ElementBase<'matrixCode'> {
  format: MatrixCodeFormat
  content: TextContent
  /** 纠错级别：qr 为 L / M / Q / H，pdf417 为 0–8，aztec 为纠错码字至少占的百分比 5–95，data-matrix 没有级别；缺省取码制的默认值。 */
  level?: MatrixCodeLevel
  color: Color
  background?: Color
  /** 四周静区宽度，单位为模块数。 */
  quietZone: number
  rotation: number
}

/** 页码。 */
export interface PageNumberElement extends ElementBase<'pageNumber'> {
  /** 页码格式，`{current}` 替换为当前页码，`{total}` 替换为总页数。 */
  format: string
  style: TextStyle
  box?: BoxStyle
}

/** 内置元素。 */
export type PrintElement
  = | TextElement
    | LongTextElement
    | TableElement
    | ImageElement
    | LineElement
    | RectElement
    | EllipseElement
    | BarCodeElement
    | MatrixCodeElement
    | PageNumberElement

/** 内置元素类型。 */
export type PrintElementType = PrintElement['type']

/** 按类型取元素接口。 */
export type PrintElementOf<TType extends PrintElementType> = Extract<PrintElement, { type: TType }>

/** 内置元素类型列表。 */
export const PRINT_ELEMENT_TYPES: readonly PrintElementType[] = [
  'text',
  'longText',
  'table',
  'image',
  'line',
  'rect',
  'ellipse',
  'barCode',
  'matrixCode',
  'pageNumber',
]
