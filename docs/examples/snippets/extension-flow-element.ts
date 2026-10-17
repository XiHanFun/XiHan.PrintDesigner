/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一个跨页的扩展元素：审批记录。每条记录一块，意见按元素宽度折行量出块高；每页开头重复一行表头。

// #region element
import type { ExtensionElementPrototype, TextStyle } from '@xihan-print/core'
import type { PrintDesignerExtension } from '@xihan-print/designer'
import { behaviorProperties, layoutProperties, property } from '@xihan-print/core'

const style: TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  lineThrough: false,
  color: '#000000',
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.4,
  letterSpacing: 0,
}

interface Approval {
  name: string
  comment: string
}

const approvals: ExtensionElementPrototype = {
  type: 'approvals',
  category: 'data',
  order: 9,
  flow: true,
  minSize: { width: 40, height: 10 },
  defaults: { type: 'approvals', width: 180, height: 20, field: 'approvals' },
  properties: [
    ...layoutProperties({ rotation: false }),
    property(['field'], 'data', { kind: 'dataField', kinds: ['list'] }),
    ...behaviorProperties(),
  ],
  // 每条记录一块：意见折行后的高度加上下各 2 mm；块不拆开，放不下就整块挪到下一页
  prepare: (element, context) => {
    const list = context.field(String(element.field))
    const items = (Array.isArray(list) ? list : []) as Approval[]
    return {
      repeat: { height: 8, data: ['审批人', '意见'] },
      blocks: items.map(item => ({
        height: context.measureText(item.comment, style, element.width - 40).height + 4,
        data: [item.name, item.comment],
      })),
    }
  },
}

export const approvalsExtension: PrintDesignerExtension = {
  id: '@acme/print-approvals',
  elements: [approvals],
  palette: { approvals: { label: '审批记录' } },
  renderers: {
    // 每页一段：data 是 { blocks, repeat }，blocks 是这一页的那几块
    approvals: (box, { document }) => {
      const { blocks, repeat } = box.data as { blocks: string[][], repeat: string[] }
      const table = document.createElement('table')
      table.style.width = '100%'
      for (const cells of [repeat, ...blocks]) {
        const row = table.insertRow()
        for (const text of cells)
          row.insertCell().textContent = text
      }
      return table
    },
  },
}
// #endregion element
