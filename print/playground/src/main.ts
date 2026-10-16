/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 开发预览页：注册 UI 元素与打印预览，装上示例模板并接好模板切换、缩放、打印与语言包开关。

import type { PrintPreviewEventMap } from '@xihan-print/runtime'
import { definePrintPreview } from '@xihan-print/runtime'
import { printZhCN } from '@xihan-print/runtime/locale'
import { mergeXhConfig, setXhConfig } from '@xihan-ui/web-components'
import { defineXhElements } from '@xihan-ui/web-components/define'
import { zhCN } from '@xihan-ui/web-components/locale'
import { createSamples } from './samples'
import '@xihan-ui/styles/index.css'
import '@xihan-print/runtime/style.css'

defineXhElements()
definePrintPreview()

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2]

const samples = createSamples()
const preview = document.querySelector('xh-print-preview')!
const status = document.querySelector<HTMLElement>('#status')!
let current = samples[0]!
let zoomIndex = ZOOM_STEPS.indexOf(1)
let outcome = ''

function onPreview<K extends keyof PrintPreviewEventMap>(type: K, listener: (event: PrintPreviewEventMap[K]) => void): void {
  preview.addEventListener(type, event => listener(event as PrintPreviewEventMap[K]))
}

/** 状态行：分页结果、缩放，以及预览区与首张输出页的可访问名。 */
function refreshStatus(): void {
  const region = preview.querySelector('[data-part="viewport"]')?.getAttribute('aria-label') ?? ''
  const sheet = preview.querySelector('[data-part="sheet"]')?.getAttribute('aria-label') ?? ''
  const zoom = `${Math.round(ZOOM_STEPS[zoomIndex]! * 100)}%`
  status.textContent = `${current.title}：${outcome}；缩放 ${zoom}；可访问名「${region}」「${sheet}」`
}

onPreview('paginated', (event) => {
  const { sheets, diagnostics } = event.detail
  const notes = diagnostics.length > 0 ? `，诊断 ${diagnostics.map(item => item.code).join('、')}` : ''
  outcome = `共 ${sheets} 张输出页${notes}`
  refreshStatus()
})
onPreview('pagination-error', (event) => {
  const { code, issues } = event.detail
  outcome = `分页失败 ${code}${issues.length > 0 ? `（${issues.map(issue => issue.code).join('、')}）` : ''}`
  refreshStatus()
})

function show(id: string): void {
  current = samples.find(sample => sample.id === id) ?? current
  preview.schema = current.schema
  preview.data = current.data
}

function zoom(index: number): void {
  zoomIndex = Math.min(Math.max(index, 0), ZOOM_STEPS.length - 1)
  preview.zoom = ZOOM_STEPS[zoomIndex]
  refreshStatus()
}

document.querySelector('#samples')!.addEventListener('value-change', (event) => {
  const { value } = (event as CustomEvent<{ value: string | string[] | null }>).detail
  if (typeof value === 'string')
    show(value)
})

document.querySelector('[aria-label="预览操作"]')!.addEventListener('click', (event) => {
  const item = (event.target as Element).closest<HTMLButtonElement>('button[value]')
  switch (item?.value) {
    case 'zoom-out':
      zoom(zoomIndex - 1)
      break
    case 'zoom-in':
      zoom(zoomIndex + 1)
      break
    case 'actual':
      zoom(ZOOM_STEPS.indexOf(1))
      break
    case 'print':
      preview.print({ title: current.title }).catch((error: unknown) => {
        outcome = `打印失败 ${error instanceof Error ? error.message : String(error)}`
        refreshStatus()
      })
      break
  }
})

document.querySelector('#zh')!.addEventListener('checked-change', (event) => {
  const { checked } = (event as CustomEvent<{ checked: boolean }>).detail
  setXhConfig(checked ? mergeXhConfig(zhCN, printZhCN) : {})
  void preview.updateComplete.then(refreshStatus)
})

show(current.id)
