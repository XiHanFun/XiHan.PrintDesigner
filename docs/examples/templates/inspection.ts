/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设备巡检记录：首页用带标题的页眉变体，其余页用窄页眉；说明文字是长文本，表格排在它下面、随它下推，
// 表格跨页时重复表头、每页末尾统计本页项数；落款排在表格之后；整页平铺水印。

import type { MapFormat, PrintDocument, TableColumn } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

const registry = createElementRegistry()
const textStyle = registry.get('text')!.defaults.style
const cellStyle = registry.get('table')!.defaults.body.style

const page = createPage({ id: 'inspection', paper: 'A5', margins: 10 })

// #region bands
page.header.first = {
  height: 16,
  elements: [
    registry.createElement('text', {
      id: 'title',
      x: 10,
      y: 12,
      overrides: { width: 128, height: 10, content: { kind: 'static', text: '设备巡检记录' }, style: { ...textStyle, fontSize: 15, bold: true, align: 'center' } },
    }),
  ],
}
page.header.default = {
  height: 8,
  elements: [
    registry.createElement('text', {
      id: 'running-title',
      x: 10,
      y: 10,
      overrides: { width: 128, height: 6, content: { kind: 'template', template: '设备巡检记录 · {{site}}' }, style: { ...textStyle, fontSize: 8, color: '#666666' } },
    }),
  ],
}
page.footer.default = {
  height: 8,
  elements: [
    registry.createElement('pageNumber', {
      id: 'page-number',
      x: 49,
      y: 193,
      overrides: { width: 50, format: '第 {{$page}} 页 / 共 {{$pages}} 页' },
    }),
  ],
}
page.watermark = { text: '{{site}} 内部使用', fontSize: 16, color: '#999999', opacity: 0.12, rotation: 30, gapX: 25, gapY: 25 }
// #endregion bands

// #region body
const results: MapFormat = { kind: 'map', entries: [{ value: 'ok', text: '正常' }, { value: 'watch', text: '待观察' }, { value: 'fault', text: '异常' }] }

const columns: TableColumn[] = [
  { id: 'no', title: '序号', width: 12, align: 'center', content: { kind: 'rowNumber' }, cellType: 'text' },
  { id: 'device', title: '设备', width: 46, align: 'left', content: { kind: 'field', field: 'device' }, cellType: 'text' },
  { id: 'item', title: '项目', width: 40, align: 'left', content: { kind: 'field', field: 'item' }, cellType: 'text' },
  { id: 'result', title: '结果', width: 30, align: 'center', content: { kind: 'field', field: 'result', format: results }, cellType: 'text' },
]

page.elements = [
  registry.createElement('longText', {
    id: 'notes',
    x: 10,
    y: 30,
    overrides: { width: 128, height: 20, content: { kind: 'field', field: 'notes' }, style: { ...textStyle, lineHeight: 1.6 } },
  }),
  registry.createElement('table', {
    id: 'checks',
    x: 10,
    y: 56,
    overrides: {
      width: 128,
      dataField: 'checks',
      columns,
      footerRows: [
        {
          id: 'page-count',
          placement: 'everyPage',
          height: 7,
          style: { ...cellStyle, bold: true },
          cells: [
            { columnId: 'no', colSpan: 3, content: { kind: 'static', text: '本页项数' }, align: 'right' },
            { columnId: 'result', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'page' } },
          ],
        },
      ],
    },
  }),
  registry.createElement('text', {
    id: 'sign',
    x: 10,
    y: 82,
    overrides: { width: 128, content: { kind: 'template', template: '检查人：{{inspector}}　　日期：{{date}}' }, style: { ...textStyle, align: 'right' } },
  }),
]
// #endregion body

export const schema: PrintDocument = createDocument({ name: '设备巡检记录', pages: [page] })

// #region data
const devices = ['1 号空压机', '2 号空压机', '冷却塔', '配电柜 A', '配电柜 B', '消防水泵']
const items = ['运行声音', '温度', '压力', '接地与线缆', '防护罩']
const states = ['ok', 'ok', 'watch', 'ok', 'fault', 'ok', 'ok']

export const data = {
  site: '一号厂房',
  inspector: '张工',
  date: '2026-10-17',
  notes: [
    '巡检说明：',
    '1. 每班开机前与停机后各巡检一次，异常项当班报修。',
    '2. 温度与压力以设备面板读数为准，超出铭牌范围记为异常。',
    '3. 待观察项须在下次巡检时复查，连续两次待观察按异常处理。',
    '4. 配电柜巡检须两人同行，不得打开带电部分的防护罩。',
  ].join('\n'),
  checks: devices.flatMap((device, d) => items.map((item, i) => ({ device, item, result: states[(d * items.length + i) % states.length] }))),
}
// #endregion data
