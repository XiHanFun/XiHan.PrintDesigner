/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 页面设置与表格部位（列、表头、表体、表尾行、表尾格）的属性描述，路径相对页面模板或该部位。

import type { PropertyDescriptor } from './types'
import { BAR_CODE_FORMATS } from '@xihan-ui/headless'
import {
  HORIZONTAL_ALIGNS,
  PAGE_ORIENTATIONS,
  SINGLE_SHEET_PREFERENCES,
  TABLE_CELL_TYPES,
  TABLE_FOOTER_PLACEMENTS,
  TABLE_ROW_HEIGHT_MODES,
} from '../schema/options'
import { PAGE_BAND_KEYS } from '../traverse'
import { choices, property } from './properties'

function bandProperties(region: 'header' | 'footer'): PropertyDescriptor[] {
  return [
    ...PAGE_BAND_KEYS.map(key => key === 'default'
      ? property([region, key, 'height'], 'bands', { kind: 'number', unit: 'mm', min: 0, step: 0.1 })
      : property([region, key, 'height'], 'bands', { kind: 'number', unit: 'mm', min: 0, step: 0.1 }, { optional: true, visibleWhen: { path: [region, key], filled: true } })),
    property([region, 'singleSheet'], 'bands', { kind: 'select', options: choices(SINGLE_SHEET_PREFERENCES) }),
  ]
}

/** 页面设置的属性描述，路径相对页面模板；页眉页脚各变体的高度只在该变体存在时显示。 */
export function pageProperties(): PropertyDescriptor[] {
  return [
    property(['name'], 'page', { kind: 'text' }, { optional: true }),
    property(['paper'], 'paper', { kind: 'paper' }),
    property(['orientation'], 'paper', { kind: 'select', options: choices(PAGE_ORIENTATIONS) }),
    property(['margins'], 'paper', { kind: 'sides', unit: 'mm', min: 0, step: 0.1 }),
    ...bandProperties('header'),
    ...bandProperties('footer'),
    property(['numbering', 'continuous'], 'numbering', { kind: 'boolean' }),
    property(['numbering', 'start'], 'numbering', { kind: 'number', unit: 'count', min: 0, step: 1, integer: true }),
    property(['watermark'], 'watermark', { kind: 'watermark' }, { optional: true }),
  ]
}

/** 表格列的属性描述，路径相对列；条码码制只在单元格类型为条码时显示。 */
export function tableColumnProperties(): PropertyDescriptor[] {
  return [
    property(['title'], 'content', { kind: 'text' }),
    property(['content'], 'content', { kind: 'cellContent' }),
    property(['cellType'], 'content', { kind: 'select', options: choices(TABLE_CELL_TYPES) }),
    property(['barCodeFormat'], 'code', { kind: 'select', options: choices(BAR_CODE_FORMATS) }, { optional: true, visibleWhen: { path: ['cellType'], equals: 'barCode' } }),
    property(['width'], 'layout', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }),
    property(['align'], 'layout', { kind: 'select', options: choices(HORIZONTAL_ALIGNS) }),
  ]
}

/** 表头的属性描述，路径相对表头；表头隐藏时只显示「是否显示」。 */
export function tableHeaderProperties(): PropertyDescriptor[] {
  const visible = { path: ['visible'], equals: true }
  return [
    property(['visible'], 'table', { kind: 'boolean' }),
    property(['repeat'], 'table', { kind: 'boolean' }, { visibleWhen: visible }),
    property(['height'], 'table', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }, { visibleWhen: visible }),
    property(['style'], 'table', { kind: 'cellStyle' }, { visibleWhen: visible }),
  ]
}

/** 表体的属性描述，路径相对表体。 */
export function tableBodyProperties(): PropertyDescriptor[] {
  return [
    property(['rowHeight'], 'table', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }),
    property(['rowHeightMode'], 'table', { kind: 'select', options: choices(TABLE_ROW_HEIGHT_MODES) }),
    property(['style'], 'table', { kind: 'cellStyle' }),
  ]
}

/** 表尾行的属性描述，路径相对表尾行；单元格另按表尾格编辑。 */
export function tableFooterRowProperties(): PropertyDescriptor[] {
  return [
    property(['placement'], 'table', { kind: 'select', options: choices(TABLE_FOOTER_PLACEMENTS) }),
    property(['height'], 'table', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }),
    property(['style'], 'table', { kind: 'cellStyle' }),
  ]
}

/** 表尾单元格的属性描述，路径相对单元格。 */
export function tableFooterCellProperties(): PropertyDescriptor[] {
  return [
    property(['content'], 'content', { kind: 'footerCellContent' }),
    property(['colSpan'], 'layout', { kind: 'number', unit: 'count', min: 1, step: 1, integer: true }),
    property(['align'], 'layout', { kind: 'select', options: choices(HORIZONTAL_ALIGNS) }, { optional: true }),
  ]
}
