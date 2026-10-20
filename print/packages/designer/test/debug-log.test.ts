/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { definePrintDesigner } from '../src'

const registry = createElementRegistry()

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } })]
  return createDocument({ pages: [page] })
}

let designer: XhPrintDesigner
let titles: string[]

beforeEach(async () => {
  titles = []
  vi.spyOn(console, 'groupCollapsed').mockImplementation((title?: unknown) => void titles.push(String(title)))
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  designer.autoTour = false
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
  vi.restoreAllMocks()
})

/** 预览元素重新分页完。 */
async function previewSettled(): Promise<void> {
  await designer.updateComplete
  await designer.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>('xh-print-preview')!.updateComplete
}

describe('调试日志', () => {
  it('开发者模式与渲染日志都开着时，每次重画在控制台记一组「[xh-print-designer] render · update: 改动的属性」带耗时；关掉开发者模式就不记', async () => {
    designer.settings = { 'general.developer': true, 'general.debugRender': true }
    await designer.updateComplete
    titles.length = 0
    designer.readonly = true
    await designer.updateComplete
    expect(titles.some(title => /^\[xh-print-designer\] render · update: readonly \d+\.\d ms$/.test(title))).toBe(true)
    designer.settings = { 'general.developer': false, 'general.debugRender': true }
    await designer.updateComplete
    titles.length = 0
    designer.readonly = false
    await designer.updateComplete
    expect(titles).toEqual([])
  })

  it('分页日志开着时，切到预览报分页的每一步；渲染日志开着时，预览的分页与生成 DOM 两个环节各记一组', async () => {
    designer.settings = { 'general.developer': true, 'general.debugPagination': true, 'general.debugRender': true }
    await designer.updateComplete
    titles.length = 0
    designer.mode = 'preview'
    await previewSettled()
    expect(titles.filter(title => title.startsWith('[xh-print-designer] pagination · '))).toEqual([
      '[xh-print-designer] pagination · 页面模板 p 开始排，首页页码 1',
      '[xh-print-designer] pagination · 页面模板 p 排完，共 1 页',
    ])
    expect(['phase: paginate', 'phase: render'].map(phase => titles.some(title => title.startsWith(`[xh-print-designer] render · ${phase} `)))).toEqual([true, true])
  })

  it('开发者模式关着时，分页与渲染日志写了 true 也不记', async () => {
    designer.settings = { 'general.debugPagination': true, 'general.debugRender': true }
    await designer.updateComplete
    titles.length = 0
    designer.mode = 'preview'
    await previewSettled()
    expect(titles).toEqual([])
  })
})
