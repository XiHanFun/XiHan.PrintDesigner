/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器：打开送货单，给出可绑定的字段树与示例数据；模板标题放在菜单栏正中、保存状态放在状态栏右端，选「文件 → 保存」或按 Ctrl / ⌘ + S 时由宿主保存并标记为已保存。

// #region setup
import type { PrintDesignerEventMap } from '@xihan-print/designer'
import type { DataField } from '@xihan-ui/designer-kit'
import { definePrintDesigner } from '@xihan-print/designer'
import { data, schema } from '../templates/delivery'
import '@xihan-ui/styles/index.css'
import '@xihan-ui/designer-shell/style.css'
import '@xihan-print/runtime/style.css'
import '@xihan-print/designer/style.css'

definePrintDesigner()
// #endregion setup

// #region fields
const fields: DataField[] = [
  { name: 'customer', label: '客户', kind: 'object', children: [{ name: 'name', label: '名称', kind: 'value' }] },
  { name: 'date', label: '日期', kind: 'value' },
  {
    name: 'items',
    label: '明细',
    kind: 'list',
    children: [
      { name: 'name', label: '品名', kind: 'value' },
      { name: 'qty', label: '数量', kind: 'value' },
      { name: 'price', label: '单价', kind: 'value' },
      { name: 'amount', label: '金额', kind: 'value' },
    ],
  },
]
// #endregion fields

export function mount(host: HTMLElement): () => void {
  // #region render
  const designer = document.createElement('xh-print-designer')
  designer.schema = schema
  designer.fields = fields
  designer.sampleData = data
  designer.data = data
  // #endregion render
  // 文档页上不自动开始新手引导，示例里从「帮助」菜单开始
  designer.autoTour = false
  // 这一页有两个设计器：各写一个草稿键，打开自动保存时两边的草稿不串
  designer.draftKey = 'docs-delivery'

  // #region save
  // 写成设计器的子元素：slot="menubar-center" 的标题在菜单栏正中，slot="status-end" 的保存状态在状态栏右端
  const title = document.createElement('span')
  title.slot = 'menubar-center'
  title.textContent = '送货单'
  const status = document.createElement('span')
  status.slot = 'status-end'
  status.textContent = '没有修改'
  designer.append(title, status)
  designer.addEventListener('dirty-change', (event) => {
    const { dirty } = (event as PrintDesignerEventMap['dirty-change']).detail
    status.textContent = dirty ? '有未保存的修改，选「文件 → 保存」或按 Ctrl / ⌘ + S' : '已保存'
  })
  designer.addEventListener('save', () => {
    // 把 designer.schema 交给后端保存，成功后标记为已保存
    designer.markSaved()
  })
  // #endregion save

  host.append(designer)
  return () => host.replaceChildren()
}
