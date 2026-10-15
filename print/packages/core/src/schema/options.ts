/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 页面方向取值。 */
export const PAGE_ORIENTATIONS = ['portrait', 'landscape'] as const

/** 页面方向：portrait 纵向，landscape 横向（宽高互换）。 */
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number]

/** 页眉页脚的页面变体键。 */
export const PAGE_BAND_VARIANTS = ['first', 'last', 'odd', 'even'] as const

/** 页眉页脚变体：first 首页、last 末页、odd 奇数页、even 偶数页（按页码奇偶）。 */
export type PageBandVariant = (typeof PAGE_BAND_VARIANTS)[number]

/** 页眉页脚的全部带区键，`default` 为未命中任何变体时使用的带区。 */
export type PageBandKey = 'default' | PageBandVariant

/** 文本水平对齐取值。 */
export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const

/** 文本水平对齐。 */
export type TextAlign = (typeof TEXT_ALIGNS)[number]

/** 单元格水平对齐取值。 */
export const HORIZONTAL_ALIGNS = ['left', 'center', 'right'] as const

/** 单元格水平对齐。 */
export type HorizontalAlign = (typeof HORIZONTAL_ALIGNS)[number]

/** 垂直对齐取值。 */
export const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const

/** 垂直对齐。 */
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number]

/** 线型取值。 */
export const STROKE_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const

/** 线型。 */
export type StrokeStyle = (typeof STROKE_STYLES)[number]

/** 固定尺寸文本的溢出处理取值。 */
export const TEXT_OVERFLOWS = ['clip', 'shrink', 'visible'] as const

/** 固定尺寸文本的溢出处理：clip 裁切，shrink 缩小字号以容纳，visible 允许溢出显示。 */
export type TextOverflow = (typeof TEXT_OVERFLOWS)[number]

/** 图片适配方式取值。 */
export const IMAGE_FITS = ['contain', 'cover', 'fill', 'none'] as const

/** 图片在元素框内的适配方式。 */
export type ImageFit = (typeof IMAGE_FITS)[number]

/** 直线方向取值。 */
export const LINE_DIRECTIONS = ['horizontal', 'vertical', 'diagonalDown', 'diagonalUp'] as const

/**
 * 直线在元素框内的走向：horizontal 沿垂直中线，vertical 沿水平中线，
 * diagonalDown 左上到右下，diagonalUp 左下到右上。
 */
export type LineDirection = (typeof LINE_DIRECTIONS)[number]

/** 一维条码码制取值。 */
export const BARCODE_SYMBOLOGIES = ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf14'] as const

/** 一维条码码制。 */
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number]

/** 二维码纠错等级取值。 */
export const QR_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const

/** 二维码纠错等级。 */
export type QrErrorCorrectionLevel = (typeof QR_ERROR_CORRECTION_LEVELS)[number]

/** 表格汇总函数取值。 */
export const AGGREGATE_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'] as const

/** 表格汇总函数。 */
export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number]

/** 表格汇总范围取值。 */
export const AGGREGATE_SCOPES = ['page', 'cumulative', 'all'] as const

/** 表格汇总范围：page 本页数据，cumulative 截至本页的累计数据，all 全部数据。 */
export type AggregateScope = (typeof AGGREGATE_SCOPES)[number]

/** 表尾行出现位置取值。 */
export const TABLE_FOOTER_PLACEMENTS = ['everyPage', 'lastPage'] as const

/** 表尾行出现位置：everyPage 表格所跨的每一页，lastPage 仅表格结束的那一页。 */
export type TableFooterPlacement = (typeof TABLE_FOOTER_PLACEMENTS)[number]

/** 表体行高模式取值。 */
export const TABLE_ROW_HEIGHT_MODES = ['fixed', 'minimum'] as const

/** 表体行高模式：fixed 每行固定为设定的行高，minimum 以设定的行高为下限、按单元格内容撑高。 */
export type TableRowHeightMode = (typeof TABLE_ROW_HEIGHT_MODES)[number]

/** 表格列单元格的呈现类型取值。 */
export const TABLE_CELL_TYPES = ['text', 'image', 'barcode', 'qrcode'] as const

/** 表格列单元格的呈现类型。 */
export type TableCellType = (typeof TABLE_CELL_TYPES)[number]

/** 同一输出页既是首页又是末页时优先采用的变体取值。 */
export const SINGLE_SHEET_PREFERENCES = ['first', 'last'] as const

/** 同一输出页既是首页又是末页时优先采用的变体。 */
export type SingleSheetPreference = (typeof SINGLE_SHEET_PREFERENCES)[number]
