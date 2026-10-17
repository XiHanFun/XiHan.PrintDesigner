/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 停电检修通知：正文是模板里写死的富文本，带行内字段、加粗、颜色、有序列表与分隔线；
// 补充说明来自数据里的 HTML，按白名单换成富文本，排在正文之后、随它下推。

import type { PrintDocument, RichTextContent } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

const registry = createElementRegistry()
const baseStyle = registry.get('richText')!.defaults.style

// #region static
const notice: RichTextContent = {
  kind: 'static',
  document: {
    blocks: [
      { type: 'heading', level: 1, align: 'center', runs: [{ type: 'text', text: '停电检修通知' }] },
      {
        type: 'paragraph',
        runs: [
          { type: 'text', text: '因供电线路检修，' },
          { type: 'field', field: 'building', marks: { bold: true } },
          { type: 'text', text: '将于 ' },
          { type: 'field', field: 'start', format: { kind: 'date', pattern: 'M 月 d 日 HH:mm' }, marks: { color: '#c0392b' } },
          { type: 'text', text: ' 起停电，预计持续 ' },
          { type: 'field', field: 'hours' },
          { type: 'text', text: ' 小时。请提前做好以下准备：' },
        ],
      },
      {
        type: 'list',
        ordered: true,
        items: [
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '保存正在编辑的文件，关闭电脑与显示器。' }] }] },
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '冰箱里的易腐物品', marks: { bold: true } }, { type: 'text', text: '请当天带走。' }] }] },
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '电梯暂停运行，请走楼梯。' }] }] },
        ],
      },
      { type: 'divider' },
      { type: 'paragraph', align: 'right', runs: [{ type: 'text', text: '物业服务中心', marks: { italic: true } }] },
    ],
  },
}
// #endregion static

const page = createPage({ id: 'notice', paper: 'A5', margins: 12 })

// #region elements
page.elements = [
  registry.createElement('richText', {
    id: 'body',
    x: 12,
    y: 12,
    overrides: { width: 124, height: 40, content: notice, style: { ...baseStyle, fontSize: 11 } },
  }),
  registry.createElement('richText', {
    id: 'remark',
    x: 12,
    y: 58,
    overrides: { width: 124, height: 20, content: { kind: 'field', field: 'remark', source: 'html' }, style: { ...baseStyle, fontSize: 10, color: '#444444' } },
  }),
]
// #endregion elements

export const schema: PrintDocument = createDocument({ name: '停电检修通知', pages: [page] })

// #region data
export const data = {
  building: '3 号楼',
  start: '2026-10-24 08:30:00',
  hours: 4,
  remark: '<h3>补充说明</h3><p>如有<strong>医疗设备</strong>等不能断电的情况，请在 <u>10 月 22 日前</u>联系物业登记。</p><script>track()</script>',
}
// #endregion data
