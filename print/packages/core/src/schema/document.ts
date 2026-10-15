/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonObject } from '../json'
import type { PaperPresetName } from '../paper'
import type { Color, Edges } from './common'
import type { PrintElement } from './elements'
import type { PageOrientation, SingleSheetPreference } from './options'

/** 当前模板 schema 版本。 */
export const PRINT_SCHEMA_VERSION = 1

/** 模板 schema 版本号类型。 */
export type PrintSchemaVersion = typeof PRINT_SCHEMA_VERSION

/** 纸张。宽高为纵向尺寸，单位 mm；横向时宽高互换。 */
export interface PaperSpec {
  /** 来源预设，自定义纸张不填。 */
  preset?: PaperPresetName
  width: number
  height: number
}

/** 页眉或页脚的一个带区。 */
export interface PageBand {
  /** 带区高度，单位 mm。 */
  height: number
  /** 带区内的元素，坐标相对纸张左上角。 */
  elements: PrintElement[]
}

/**
 * 页眉或页脚：`default` 为常规带区，其余为按输出页命中的变体。
 * 命中顺序为首页、末页、奇偶页，都未命中时使用 `default`。
 */
export interface PageBandSet {
  default: PageBand
  first?: PageBand
  last?: PageBand
  odd?: PageBand
  even?: PageBand
  /** 输出页既是首页又是末页且两种变体都存在时采用哪一个。 */
  singleSheet: SingleSheetPreference
}

/** 页码编号规则。 */
export interface PageNumbering {
  /** 是否接续上一页面模板的页码；为 false 或没有上一页面模板时从 `start` 开始。 */
  continuous: boolean
  /** 起始页码。 */
  start: number
}

/** 平铺文字水印。 */
export interface Watermark {
  /** 水印文字，支持 `{{path}}` 占位。 */
  text: string
  fontFamily?: string
  /** 字号，单位 pt。 */
  fontSize: number
  color: Color
  /** 不透明度，0 到 1。 */
  opacity: number
  /** 逆时针旋转角度。 */
  rotation: number
  /** 相邻水印的水平间距，单位 mm。 */
  gapX: number
  /** 相邻水印的垂直间距，单位 mm。 */
  gapY: number
}

/**
 * 页面模板：一份页面模板按数据量排出一张或多张输出页。
 * 页眉位于上边距之下，页脚位于下边距之上，两者之间为正文区。
 */
export interface PrintPage {
  /** 页面标识，在整份文档内唯一。 */
  id: string
  name?: string
  paper: PaperSpec
  orientation: PageOrientation
  /** 页边距，单位 mm。 */
  margins: Edges
  header: PageBandSet
  footer: PageBandSet
  /** 正文元素，坐标相对纸张左上角。 */
  elements: PrintElement[]
  numbering: PageNumbering
  watermark?: Watermark
  meta?: JsonObject
}

/** 打印模板文档。 */
export interface PrintDocument {
  schemaVersion: PrintSchemaVersion
  name?: string
  pages: PrintPage[]
  meta?: JsonObject
}
