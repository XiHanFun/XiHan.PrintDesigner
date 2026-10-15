/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { FormatSpec } from '@xihan-ui/expression'
import type { StrokeStyle, TextAlign, VerticalAlign } from './options'

/** 颜色：`#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。 */
export type Color = string

/** 四边距离，单位 mm。 */
export interface Edges {
  top: number
  right: number
  bottom: number
  left: number
}

/** 描边。 */
export interface Stroke {
  /** 线宽，单位 mm。 */
  width: number
  style: StrokeStyle
  color: Color
}

/** 四边边框，缺省的一边不画线。 */
export interface BorderSides {
  top?: Stroke
  right?: Stroke
  bottom?: Stroke
  left?: Stroke
}

/** 元素外框样式。 */
export interface BoxStyle {
  /** 背景色，缺省为透明。 */
  background?: Color
  border?: BorderSides
  /** 内边距，单位 mm。 */
  padding?: Edges
}

/** 文本样式。 */
export interface TextStyle {
  /** 字体族，缺省使用运行时默认字体。 */
  fontFamily?: string
  /** 字号，单位 pt。 */
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  lineThrough: boolean
  color: Color
  align: TextAlign
  verticalAlign: VerticalAlign
  /** 行高，字号的倍数。 */
  lineHeight: number
  /** 字间距，单位 pt。 */
  letterSpacing: number
}

/** 值映射的一项：数据值（按字符串比较）与显示文本。 */
export interface ValueMapEntry {
  value: string
  text: string
}

/** 值映射格式：按数据值查表显示文本。 */
export interface MapFormat {
  kind: 'map'
  entries: ValueMapEntry[]
  /** 未命中任何映射时显示的文本，缺省显示原值。 */
  fallback?: string
}

/** 表达式格式：以受限表达式把值转成显示文本，表达式中以 `value` 引用待格式化的值。 */
export interface ExpressionFormat {
  kind: 'expression'
  /** 受限表达式源码。 */
  expression: string
}

/**
 * 值格式：数字、百分比、日期与人民币大写即 @xihan-ui/expression 的 FormatSpec，交给注入的格式化器；
 * 值映射在本包内完成，表达式格式经表达式接入点。
 */
export type ValueFormat = FormatSpec | MapFormat | ExpressionFormat

/** 固定文本。 */
export interface StaticTextContent {
  kind: 'static'
  text: string
}

/** 绑定单个数据字段。 */
export interface FieldTextContent {
  kind: 'field'
  /** 字段路径，写法同 @xihan-ui/core/json 的 formatJsonPath，如 `customer.name`、`items[0].qty`。 */
  field: string
  format?: ValueFormat
  /** 字段值为空时显示的文本。 */
  emptyText?: string
}

/** 含 `{{path}}` 占位的文本模板，占位按数据字段替换。 */
export interface TemplateTextContent {
  kind: 'template'
  template: string
}

/** 以受限表达式计算的文本，表达式中的变量为数据对象的顶层字段。 */
export interface ExpressionTextContent {
  kind: 'expression'
  /** 受限表达式源码。 */
  expression: string
  /** 计算结果的格式。 */
  format?: ValueFormat
}

/** 文本内容来源。 */
export type TextContent = StaticTextContent | FieldTextContent | TemplateTextContent | ExpressionTextContent

/** 固定地址的图片。 */
export interface StaticImageSource {
  kind: 'static'
  /** 图片地址：http(s)、data:image、blob 或相对地址。 */
  url: string
}

/** 从数据字段读取图片地址。 */
export interface FieldImageSource {
  kind: 'field'
  field: string
}

/** 图片来源。 */
export type ImageSource = StaticImageSource | FieldImageSource
