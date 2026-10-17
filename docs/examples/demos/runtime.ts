/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 运行时：设备巡检记录排成多页，状态行显示分页结果与诊断，按钮调整预览缩放。

import type { PrintPreviewEventMap } from '@xihan-print/runtime'
import { definePrintPreview } from '@xihan-print/runtime'
import { data, schema } from '../templates/inspection'

export function mount(host: HTMLElement): () => void {
  definePrintPreview()

  // #region events
  const preview = document.createElement('xh-print-preview')
  const status = document.createElement('p')

  preview.addEventListener('paginated', (event) => {
    const { sheets, diagnostics } = (event as PrintPreviewEventMap['paginated']).detail
    const notes = diagnostics.map(item => `${item.code}（${item.severity}）`).join('、')
    status.textContent = `共 ${sheets} 张输出页${notes === '' ? '，没有诊断' : `，诊断：${notes}`}`
  })
  preview.addEventListener('pagination-error', (event) => {
    const { code, issues } = (event as PrintPreviewEventMap['pagination-error']).detail
    status.textContent = `分页失败：${code}，校验问题 ${issues.length} 个`
  })

  preview.schema = schema
  preview.data = data
  // #endregion events

  // #region zoom
  const zoomOut = document.createElement('button')
  const zoomIn = document.createElement('button')
  zoomOut.type = 'button'
  zoomIn.type = 'button'
  zoomOut.textContent = '缩小'
  zoomIn.textContent = '放大'
  const zoomBy = (factor: number): void => {
    preview.zoom = Math.min(2, Math.max(0.5, (preview.zoom ?? 1) * factor))
  }
  zoomOut.addEventListener('click', () => zoomBy(1 / 1.25))
  zoomIn.addEventListener('click', () => zoomBy(1.25))
  // #endregion zoom

  host.append(zoomOut, zoomIn, status, preview)
  return () => host.replaceChildren()
}
