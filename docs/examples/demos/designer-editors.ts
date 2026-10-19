/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 自定义属性编辑器：字体只能从本单位装好的几种里选；只显示工具栏与属性面板，打开时选中取件码文字。

// #region editor
import type { DesignerPropertyEditor } from '@xihan-ui/designer-shell'
import { definePrintDesigner, PRINT_DESIGNER_PANELS } from '@xihan-print/designer'
import { schema } from '../templates/minimal'

const FONTS = ['宋体', '黑体', '楷体', '仿宋']

const fontEditor: DesignerPropertyEditor = (initial) => {
  let context = initial
  const select = document.createElement('select')
  select.dataset.xhPart = 'control'
  select.append(new Option('缺省字体', ''), ...FONTS.map(font => new Option(font, font)))
  const sync = (): void => {
    select.value = typeof context.value === 'string' ? context.value : ''
    select.disabled = context.readonly
  }
  select.addEventListener('change', () => {
    context.setValue(select.value === '' ? undefined : select.value)
    context.commit()
  })
  sync()
  return {
    element: select,
    update: (next) => {
      context = next
      sync()
    },
  }
}
// #endregion editor

export function mount(host: HTMLElement): () => void {
  definePrintDesigner()
  // #region use
  const designer = document.createElement('xh-print-designer')
  designer.defaultLayout = { version: 1, hidden: [PRINT_DESIGNER_PANELS.palette, PRINT_DESIGNER_PANELS.issues, PRINT_DESIGNER_PANELS.pages] }
  designer.extensions = [{ id: '@acme/print-fonts', editors: { byPath: { 'style.fontFamily': fontEditor } } }]
  designer.schema = schema
  // #endregion use
  designer.autoTour = false
  host.append(designer)
  designer.select({ elements: ['pickup-code'] })
  return () => host.replaceChildren()
}
