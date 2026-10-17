/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一条扩展命令：锁定选中的元素，出现在工具栏与元素的右键菜单里，Ctrl / ⌘ + Shift + L 触发；再把它排进工具栏的最前面。

// #region example
import type { PrintDesignerExtension, XhPrintDesigner } from '@xihan-print/designer'
import { PRINT_TOOLBAR_LAYOUT } from '@xihan-print/designer'

export const lockExtension: PrintDesignerExtension = {
  id: '@acme/print-lock',
  commands: [{
    id: '@acme/print-lock.lock',
    label: '锁定',
    placement: ['toolbar', 'menu:element'],
    shortcut: ['Mod', 'Shift', 'L'],
    enabled: ({ designer }) => !designer.readonly && designer.getSelection().elements.length > 0,
    run: ({ designer }) => {
      designer.execute(designer.getSelection().elements.map(id => ({ type: 'updateElement', id, changes: [{ path: ['locked'], value: true }] })))
    },
  }],
}
// #endregion example

// #region layout
export function lockFirst(designer: XhPrintDesigner): void {
  designer.extensions = [lockExtension]
  designer.commandLayout = { toolbar: [['@acme/print-lock.lock'], ...PRINT_TOOLBAR_LAYOUT] }
}
// #endregion layout
