/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 字段物料：把宿主给的字段树列成物料条目，放上画布时按字段的种类与内容生成绑好字段的元素。
// value 字段按 content 生成文本、图片、条码或二维码；list 字段生成表格，dataField 指向它，各列取它的 value 子字段；
// object 字段只作分组；list 的子字段相对数组的一个元素，只作浏览。

import type { BarCodeFormat, TableCellType, TableColumn } from '@xihan-print/core'
import type { JsonPath } from '@xihan-ui/core/json'
import type { DataField, DataFieldContent } from '@xihan-ui/designer-kit'
import { scaleTableColumns } from '@xihan-print/core'
import { formatJsonPath } from '@xihan-ui/core/json'
import { listDataFields } from '@xihan-ui/designer-kit'

/** 字段生成的元素种类。 */
export type FieldElementType = 'text' | 'image' | 'barCode' | 'matrixCode' | 'table'

/** 放下一个字段时新建的元素：种类与压在缺省值之上的几项。 */
export interface FieldPlacement {
  readonly type: FieldElementType
  readonly overrides: Readonly<Record<string, unknown>>
}

/** 字段物料的一个条目：placement 缺省时只作浏览。 */
export interface FieldPaletteNode {
  /** 条目 id：field: 加从字段树根算起的路径，在物料面板内唯一。 */
  readonly id: string
  readonly label: string
  /** 字段路径；list 子字段相对数组的一个元素。 */
  readonly path: string
  readonly placement?: FieldPlacement
  readonly children?: readonly FieldPaletteNode[]
}

/** 生成表格时用到的缺省值：表格宽度（mm）与条码列的码制。 */
export interface FieldPlacementDefaults {
  readonly tableWidth: number
  readonly barCodeFormat: BarCodeFormat
}

const VALUE_ELEMENTS: Readonly<Record<DataFieldContent, Exclude<FieldElementType, 'table'>>> = {
  text: 'text',
  image: 'image',
  barcode: 'barCode',
  qrcode: 'matrixCode',
}

const CELL_TYPES: Readonly<Record<DataFieldContent, TableCellType>> = {
  text: 'text',
  image: 'image',
  barcode: 'barCode',
  qrcode: 'matrixCode',
}

/** 字段物料条目的 id 前缀，与元素种类的 id 区分开。 */
export const FIELD_ITEM_PREFIX = 'field:'

function labelOf(field: DataField): string {
  return field.label ?? field.name
}

function named(field: DataField, overrides: Record<string, unknown>): Record<string, unknown> {
  return field.label === undefined ? overrides : { name: field.label, ...overrides }
}

/** 表格的列：list 的 value 子字段（进入对象、不进入嵌套的数组），列宽均分表格宽度。 */
function tableColumns(field: DataField, defaults: FieldPlacementDefaults): TableColumn[] {
  const entries = listDataFields(field.children ?? [], { kinds: ['value'] })
  const width = defaults.tableWidth / Math.max(1, entries.length)
  const columns = entries.map(({ text, field: child }, index): TableColumn => {
    const cellType = CELL_TYPES[child.content ?? 'text']
    return {
      id: `col-${index + 1}`,
      title: labelOf(child),
      width,
      align: 'left',
      content: { kind: 'field', field: text },
      cellType,
      ...(cellType === 'barCode' ? { barCodeFormat: defaults.barCodeFormat } : {}),
    }
  })
  return scaleTableColumns(columns, defaults.tableWidth)
}

/** 一个字段放上画布时新建的元素；object 字段没有对应的元素。 */
export function fieldPlacement(field: DataField, path: JsonPath, defaults: FieldPlacementDefaults): FieldPlacement | undefined {
  const text = formatJsonPath(path)
  if (field.kind === 'object')
    return undefined
  if (field.kind === 'list') {
    const columns = tableColumns(field, defaults)
    return { type: 'table', overrides: named(field, columns.length === 0 ? { dataField: text } : { dataField: text, columns }) }
  }
  const type = VALUE_ELEMENTS[field.content ?? 'text']
  const binding = { kind: 'field', field: text }
  return { type, overrides: named(field, type === 'image' ? { source: binding } : { content: binding }) }
}

/** 字段树换成物料条目：根上与对象里的字段可以放上画布，数组的子字段只作浏览。 */
export function fieldPaletteNodes(fields: readonly DataField[], defaults: FieldPlacementDefaults): FieldPaletteNode[] {
  const visit = (level: readonly DataField[], prefix: JsonPath, placeable: boolean, idPrefix: JsonPath): FieldPaletteNode[] => level.map((field) => {
    const path = [...prefix, field.name]
    const idPath = [...idPrefix, field.name]
    const placement = placeable ? fieldPlacement(field, path, defaults) : undefined
    const children = field.kind === 'value'
      ? undefined
      : field.kind === 'list'
        ? visit(field.children ?? [], [], false, idPath)
        : visit(field.children ?? [], path, placeable, idPath)
    return {
      id: `${FIELD_ITEM_PREFIX}${formatJsonPath(idPath)}`,
      label: labelOf(field),
      path: formatJsonPath(path),
      ...(placement === undefined ? {} : { placement }),
      ...(children === undefined ? {} : { children }),
    }
  })
  return visit(fields, [], true, [])
}
