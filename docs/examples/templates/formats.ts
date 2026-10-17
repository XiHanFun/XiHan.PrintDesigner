/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 数据绑定与格式化：每行左边是说明，右边是同一份数据按不同的内容来源与格式显示出来的结果。

import type { TextContent, TextElement } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

const registry = createElementRegistry()
const textStyle = registry.get('text')!.defaults.style

// #region rows
const rows: [label: string, content: TextContent][] = [
  ['数字', { kind: 'field', field: 'amount', format: { kind: 'number', decimals: 2, grouping: true } }],
  ['百分比', { kind: 'field', field: 'rate', format: { kind: 'percent', decimals: 1 } }],
  ['日期', { kind: 'field', field: 'signedAt', format: { kind: 'date', pattern: 'yyyy年M月d日 HH:mm' } }],
  ['人民币大写', { kind: 'field', field: 'paid', format: { kind: 'rmb-upper' } }],
  ['中文数字', { kind: 'field', field: 'qty', format: { kind: 'numeral', style: 'cn-upper' } }],
  ['值映射', {
    kind: 'field',
    field: 'status',
    format: { kind: 'map', entries: [{ value: 'pending', text: '待发货' }, { value: 'shipped', text: '已发货' }], fallback: '未知' },
  }],
  ['表达式格式', { kind: 'field', field: 'qty', format: { kind: 'expression', expression: 'IF(value >= 3, \'多件\', \'单件\')' } }],
  ['空值', { kind: 'field', field: 'remark', emptyText: '无' }],
  ['占位模板', { kind: 'template', template: '{{customer.name}}（{{customer.city}}）' }],
  ['表达式', { kind: 'expression', expression: 'qty * price', format: { kind: 'number', decimals: 2 } }],
]
// #endregion rows

const page = createPage({ id: 'formats', paper: 'A6', orientation: 'landscape', margins: 8 })
page.elements = rows.flatMap(([label, content], index): TextElement[] => [
  registry.createElement('text', {
    id: `label-${index}`,
    x: 8,
    y: 8 + index * 8.5,
    overrides: { width: 36, height: 8, content: { kind: 'static', text: label }, style: { ...textStyle, color: '#666666' } },
  }),
  registry.createElement('text', {
    id: `value-${index}`,
    x: 46,
    y: 8 + index * 8.5,
    overrides: { width: 94, height: 8, content },
  }),
])

export const schema = createDocument({ name: '格式示例', pages: [page] })

// #region data
export const data = {
  amount: 1234567.891,
  rate: 0.1234,
  signedAt: '2026-10-17 08:30:00',
  paid: 1001.5,
  qty: 3,
  price: 19.9,
  status: 'shipped',
  remark: '',
  customer: { name: '曦寒商贸', city: '杭州' },
}
// #endregion data
