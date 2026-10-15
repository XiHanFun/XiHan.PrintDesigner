/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { CellStyle, PrintDocument, TableColumn, TableElement } from '../src'
import { createDocument, createElementRegistry, createPage } from '../src'

const registry = createElementRegistry()

function cellStyle(overrides: Partial<CellStyle> = {}): CellStyle {
  return { fontSize: 10.5, bold: false, italic: false, color: '#000000', verticalAlign: 'middle', padding: 1, ...overrides }
}

function column(id: string, width: number, content: TableColumn['content'], align: TableColumn['align'] = 'left'): TableColumn {
  return { id, title: id, width, align, content, cellType: 'text' }
}

/** 出库单表格：序号、品名、数量、金额四列，每页小计与末页合计两行表尾。 */
export function createSampleTable(id = 'items'): TableElement {
  return registry.createElement('table', {
    id,
    x: 10,
    y: 70,
    overrides: {
      width: 190,
      dataField: 'items',
      columns: [
        column('no', 15, { kind: 'rowNumber' }, 'center'),
        column('name', 95, { kind: 'template', template: '{{name}} {{spec}}' }),
        column('qty', 40, { kind: 'field', field: 'qty', format: { kind: 'number', decimals: 0, thousands: false } }, 'right'),
        column('amount', 40, { kind: 'field', field: 'amount', format: { kind: 'number', decimals: 2, thousands: true, prefix: '¥' } }, 'right'),
      ],
      footerRows: [
        {
          id: 'subtotal',
          placement: 'everyPage',
          height: 7,
          style: cellStyle({ bold: true }),
          cells: [
            { columnId: 'no', colSpan: 2, content: { kind: 'static', text: '本页小计' }, align: 'center' },
            { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'page' } },
            { columnId: 'amount', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'page' } },
          ],
        },
        {
          id: 'total',
          placement: 'lastPage',
          height: 7,
          style: cellStyle({ bold: true }),
          cells: [
            { columnId: 'no', colSpan: 2, content: { kind: 'template', template: '合计（{{order.no}}）' } },
            { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'all' } },
            {
              columnId: 'amount',
              colSpan: 1,
              content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all', format: { kind: 'chineseAmount' } },
            },
          ],
        },
      ],
      maxRowsPerPage: 20,
      fillEmptyRows: true,
    },
  })
}

/** 覆盖全部内置元素、页眉页脚变体与水印的合法文档，校验结果没有任何问题。 */
export function createSampleDocument(): PrintDocument {
  const page = createPage({ id: 'page-1', name: '出库单' })
  page.header.default = {
    height: 20,
    elements: [
      registry.createElement('text', {
        id: 'title',
        x: 10,
        y: 12,
        overrides: { width: 190, height: 10, content: { kind: 'static', text: '出库单' } },
      }),
    ],
  }
  page.header.first = {
    height: 30,
    elements: [
      registry.createElement('image', {
        id: 'logo',
        x: 10,
        y: 12,
        overrides: { width: 20, height: 15, source: { kind: 'static', url: 'https://example.com/logo.png' } },
      }),
      registry.createElement('text', {
        id: 'first-title',
        x: 40,
        y: 15,
        overrides: { width: 120, height: 12, content: { kind: 'field', field: 'order.title' } },
      }),
    ],
  }
  page.footer.default = {
    height: 10,
    elements: [registry.createElement('pageNumber', { id: 'page-number', x: 90, y: 279 })],
  }
  page.footer.last = {
    height: 25,
    elements: [
      registry.createElement('text', {
        id: 'signature',
        x: 10,
        y: 265,
        overrides: { width: 80, height: 8, content: { kind: 'template', template: '经办人：{{order.operator}}' } },
      }),
      registry.createElement('line', { id: 'signature-line', x: 110, y: 273, overrides: { width: 60 } }),
    ],
  }
  page.elements = [
    registry.createElement('rect', { id: 'frame', x: 10, y: 30, overrides: { width: 190, height: 35 } }),
    registry.createElement('text', {
      id: 'customer',
      x: 12,
      y: 42,
      overrides: { width: 100, content: { kind: 'field', field: 'customer.name', emptyText: '-' } },
    }),
    registry.createElement('barcode', { id: 'order-barcode', x: 120, y: 32 }),
    registry.createElement('qrcode', {
      id: 'order-qrcode',
      x: 175,
      y: 37,
      overrides: { content: { kind: 'field', field: 'order.url' } },
    }),
    registry.createElement('ellipse', {
      id: 'stamp',
      x: 150,
      y: 50,
      overrides: { width: 15, height: 10, fill: '#ff000033' },
    }),
    createSampleTable(),
    registry.createElement('line', { id: 'divider', x: 10, y: 95, overrides: { width: 190 } }),
    registry.createElement('longText', {
      id: 'remark',
      x: 10,
      y: 100,
      overrides: { width: 190, content: { kind: 'field', field: 'remark' } },
    }),
  ]
  page.watermark = {
    text: '{{status}}',
    fontSize: 48,
    color: '#cccccc',
    opacity: 0.3,
    rotation: 30,
    gapX: 40,
    gapY: 40,
  }

  const label = createPage({ id: 'label', paper: { width: 100, height: 60 }, margins: 2 })
  label.numbering = { continuous: false, start: 1 }
  label.elements = [
    registry.createElement('text', {
      id: 'label-name',
      x: 5,
      y: 5,
      overrides: { width: 90, height: 10, content: { kind: 'template', template: '{{sku}} - {{name}}' } },
    }),
    registry.createElement('text', {
      id: 'label-price',
      x: 70,
      y: 20,
      overrides: {
        width: 25,
        height: 10,
        content: {
          kind: 'expression',
          expression: 'price * qty',
          format: { kind: 'number', decimals: 2, thousands: true },
        },
      },
    }),
    registry.createElement('barcode', {
      id: 'label-barcode',
      x: 5,
      y: 20,
      overrides: { width: 60, height: 20, symbology: 'ean13', content: { kind: 'static', text: '4006381333931' } },
    }),
  ]

  return createDocument({ name: '出库单', pages: [page, label] })
}
