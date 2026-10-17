/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一个扩展面板：放在右侧，列出选中元素的标识，选择变化时刷新。

// #region example
import type { PrintDesignerExtension } from '@xihan-print/designer'

export const selectionPanel: PrintDesignerExtension = {
  id: '@acme/print-selection',
  panels: [{
    region: { name: 'acme-selection', position: 'end', label: '选中' },
    create: ({ designer }) => {
      const element = designer.ownerDocument.createElement('section')
      const render = (ids: readonly string[]): void => {
        element.textContent = ids.length === 0 ? '没有选中' : ids.join('、')
      }
      render(designer.getSelection().elements)
      return { element, update: context => render(context.designer.getSelection().elements) }
    },
  }],
}
// #endregion example
