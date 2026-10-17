/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 快速开始：把送货单交给 <xh-print-preview> 预览，点按钮调起浏览器的打印对话框。

// #region setup
import { definePrintPreview } from '@xihan-print/runtime'
import { data, schema } from '../templates/delivery'
import '@xihan-ui/styles/index.css'
import '@xihan-print/runtime/style.css'

definePrintPreview()
// #endregion setup

export function mount(host: HTMLElement): () => void {
  // #region render
  const preview = document.createElement('xh-print-preview')
  preview.schema = schema
  preview.data = data
  // #endregion render

  // #region print
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '打印'
  button.addEventListener('click', () => preview.print({ title: '送货单' }))
  // #endregion print

  host.append(button, preview)
  return () => host.replaceChildren()
}
