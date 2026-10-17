/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器：打开送货单，给出可绑定的字段树与示例数据；按 Ctrl / ⌘ + S 时由宿主保存并标记为已保存。

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

  // #region save
  const status = document.createElement('p')
  status.textContent = '没有修改'
  designer.addEventListener('dirty-change', (event) => {
    const { dirty } = (event as PrintDesignerEventMap['dirty-change']).detail
    status.textContent = dirty ? '有未保存的修改，在画布上按 Ctrl / ⌘ + S 保存' : '已保存'
  })
  designer.addEventListener('save', () => {
    // 把 designer.schema 交给后端保存，成功后标记为已保存
    designer.markSaved()
  })
  // #endregion save

  host.append(status, designer)
  return () => host.replaceChildren()
}
