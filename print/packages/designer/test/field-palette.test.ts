/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { DataField } from '@xihan-ui/designer-kit'
import { describe, expect, it } from 'vitest'
import { fieldPaletteNodes, fieldPlacement } from '../src/field-palette'

const defaults = { tableWidth: 180, barCodeFormat: 'code128' } as const

const fields: DataField[] = [
  { name: 'no', label: '单号', kind: 'value' },
  { name: 'customer', label: '客户', kind: 'object', children: [
    { name: 'name', label: '名称', kind: 'value' },
    { name: 'logo', kind: 'value', content: 'image' },
  ] },
  { name: 'items', label: '明细', kind: 'list', children: [
    { name: 'sku', label: '货号', kind: 'value', content: 'barcode' },
    { name: 'product', kind: 'object', children: [{ name: 'name', label: '品名', kind: 'value' }] },
    { name: 'qty', kind: 'value', type: 'number' },
    { name: 'lots', kind: 'list', children: [{ name: 'code', kind: 'value' }] },
  ] },
  { name: 'trace', kind: 'value', content: 'qrcode' },
]

describe('fieldPlacement', () => {
  it('value 字段按 content 生成文本、图片、条码或二维码，绑定字段路径，有名称时带上名称', () => {
    expect(fieldPlacement(fields[0]!, ['no'], defaults)).toEqual({ type: 'text', overrides: { name: '单号', content: { kind: 'field', field: 'no' } } })
    expect(fieldPlacement(fields[1]!.children![1]!, ['customer', 'logo'], defaults)).toEqual({ type: 'image', overrides: { source: { kind: 'field', field: 'customer.logo' } } })
    expect(fieldPlacement(fields[3]!, ['trace'], defaults)).toEqual({ type: 'matrixCode', overrides: { content: { kind: 'field', field: 'trace' } } })
    expect(fieldPlacement({ name: 'sku', kind: 'value', content: 'barcode' }, ['sku'], defaults)?.type).toBe('barCode')
  })

  it('list 字段生成表格：dataField 指向它，各列取它的 value 子字段（进入对象、不进入嵌套的数组），列宽均分', () => {
    const placed = fieldPlacement(fields[2]!, ['items'], defaults)!
    expect(placed.type).toBe('table')
    expect(placed.overrides.dataField).toBe('items')
    expect(placed.overrides.name).toBe('明细')
    const columns = placed.overrides.columns as { title: string, width: number, content: unknown, cellType: string, barCodeFormat?: string }[]
    expect(columns.map(column => [column.title, column.content, column.cellType, column.barCodeFormat])).toEqual([
      ['货号', { kind: 'field', field: 'sku' }, 'barCode', 'code128'],
      ['品名', { kind: 'field', field: 'product.name' }, 'text', undefined],
      ['qty', { kind: 'field', field: 'qty' }, 'text', undefined],
    ])
    expect(columns.reduce((sum, column) => sum + column.width, 0)).toBeCloseTo(180, 6)
  })

  it('没有 value 子字段的 list 只指定 dataField，列沿用缺省；object 字段不生成元素', () => {
    expect(fieldPlacement({ name: 'rows', kind: 'list', children: [] }, ['rows'], defaults)).toEqual({ type: 'table', overrides: { dataField: 'rows' } })
    expect(fieldPlacement(fields[1]!, ['customer'], defaults)).toBeUndefined()
  })
})

describe('fieldPaletteNodes', () => {
  it('按字段树列出条目：根上与对象里的字段可以放上画布，数组的子字段只作浏览、路径相对数组的一个元素', () => {
    const nodes = fieldPaletteNodes(fields, defaults)
    const flat = (list: readonly ReturnType<typeof fieldPaletteNodes>[number][], depth = 0): string[] =>
      list.flatMap(node => [`${'  '.repeat(depth)}${node.id} ${node.label} ${node.path} ${node.placement?.type ?? '-'}`, ...flat(node.children ?? [], depth + 1)])
    expect(flat(nodes)).toEqual([
      'field:no 单号 no text',
      'field:customer 客户 customer -',
      '  field:customer.name 名称 customer.name text',
      '  field:customer.logo logo customer.logo image',
      'field:items 明细 items table',
      '  field:items.sku 货号 sku -',
      '  field:items.product product product -',
      '    field:items.product.name 品名 product.name -',
      '  field:items.qty qty qty -',
      '  field:items.lots lots lots -',
      '    field:items.lots.code code code -',
      'field:trace trace trace matrixCode',
    ])
  })
})
