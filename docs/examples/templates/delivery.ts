/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 送货单：A5 横向，页眉放标题，正文放客户、日期与明细表格，页脚放页码；明细多时表格续排到下一页。

// #region registry
import type { PrintDocument, TableColumn } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

const registry = createElementRegistry()
const textStyle = registry.get('text')!.defaults.style
// #endregion registry

// #region page
const page = createPage({ id: 'delivery', paper: 'A5', orientation: 'landscape', margins: 10 })

page.header.default = {
  height: 14,
  elements: [
    registry.createElement('text', {
      id: 'title',
      x: 10,
      y: 12,
      overrides: {
        width: 190,
        height: 10,
        content: { kind: 'static', text: '送货单' },
        style: { ...textStyle, fontSize: 16, bold: true, align: 'center' },
      },
    }),
  ],
}

page.footer.default = {
  height: 8,
  elements: [
    registry.createElement('pageNumber', {
      id: 'page-number',
      x: 80,
      y: 131,
      overrides: { width: 50, format: '第 {{$page}} 页 / 共 {{$pages}} 页' },
    }),
  ],
}
// #endregion page

// #region body
const money = { kind: 'number', decimals: 2, grouping: true } as const

function column(id: string, title: string, width: number, field: string, align: TableColumn['align'] = 'left'): TableColumn {
  return { id, title, width, align, content: { kind: 'field', field, format: money }, cellType: 'text' }
}

page.elements.push(
  registry.createElement('text', {
    id: 'customer',
    x: 10,
    y: 26,
    overrides: { width: 120, content: { kind: 'template', template: '客户：{{customer.name}}' } },
  }),
  registry.createElement('text', {
    id: 'date',
    x: 140,
    y: 26,
    overrides: {
      width: 60,
      content: { kind: 'field', field: 'date', format: { kind: 'date', pattern: 'yyyy年M月d日' } },
      style: { ...textStyle, align: 'right' },
    },
  }),
  registry.createElement('table', {
    id: 'items',
    x: 10,
    y: 36,
    overrides: {
      width: 190,
      dataField: 'items',
      columns: [
        { id: 'no', title: '序号', width: 14, align: 'center', content: { kind: 'rowNumber' }, cellType: 'text' },
        { id: 'name', title: '品名', width: 80, align: 'left', content: { kind: 'field', field: 'name' }, cellType: 'text' },
        { id: 'qty', title: '数量', width: 28, align: 'right', content: { kind: 'field', field: 'qty' }, cellType: 'text' },
        column('price', '单价', 34, 'price', 'right'),
        column('amount', '金额', 34, 'amount', 'right'),
      ],
      footerRows: [
        {
          id: 'total',
          placement: 'lastPage',
          height: 7,
          style: { ...registry.get('table')!.defaults.body.style, bold: true },
          cells: [
            { columnId: 'no', colSpan: 4, content: { kind: 'static', text: '合计' }, align: 'right' },
            { columnId: 'amount', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all', format: money } },
          ],
        },
      ],
    },
  }),
)
// #endregion body

// #region document
export const schema: PrintDocument = createDocument({ name: '送货单', pages: [page] })
// #endregion document

// #region data
const products = ['A4 复印纸', '中性笔', '订书机', '文件夹', '便利贴', '计算器']

export const data = {
  customer: { name: '曦寒商贸有限公司' },
  date: '2026-10-17',
  items: Array.from({ length: 18 }, (_, index) => {
    const qty = (index % 5) + 1
    const price = 12.5 + index * 3
    return { name: `${products[index % products.length]} ${index + 1} 号`, qty, price, amount: qty * price }
  }),
}
// #endregion data
