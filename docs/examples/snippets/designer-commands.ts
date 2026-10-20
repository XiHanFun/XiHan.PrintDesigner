/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一条扩展命令：锁定选中的元素，出现在工具栏与元素的右键菜单里，Ctrl / ⌘ + Shift + L 触发；再把它排进工具栏的最前面。
// 宿主的命令同样写成扩展，挂进菜单栏的文件菜单。

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

// #region menubar
// 宿主自己的「新建」「返回列表」挂进文件菜单，新建同时上工具栏；再把文件菜单排成新建与保存、返回列表、设置三组
export function hostCommands(designer: XhPrintDesigner, actions: { readonly create: () => void, readonly back: () => void }): void {
  designer.extensions = [{
    id: '@acme/host',
    commands: [
      { id: '@acme/host.new', label: '新建', placement: ['menubar:file', 'toolbar'], run: actions.create },
      { id: '@acme/host.back', label: '返回列表', placement: ['menubar:file'], run: actions.back },
    ],
  }]
  designer.commandLayout = { 'menubar:file': [['@acme/host.new', 'save'], ['@acme/host.back'], ['settings']] }
}
// #endregion menubar
