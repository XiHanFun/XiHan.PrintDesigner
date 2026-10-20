/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

// 自动保存：开着时改了停手约一秒存成本机草稿，存完（markSaved）删掉；宿主装进同一个草稿键、和草稿不一样的模板时
// 问恢复还是丢弃，恢复整份换上、记一步撤销。

import type { PrintDocument } from '@xihan-print/core'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { DESIGNER_COMMANDS_EN_US } from '@xihan-ui/designer-shell'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { definePrintDesigner } from '../src'

const registry = createElementRegistry()
const KEY = 'xh-designer-draft:xh-print-designer:delivery'

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } })]
  return createDocument({ pages: [page] })
}

/** 草稿：比 sample 多一个矩形。 */
function withDraft(): PrintDocument {
  const document = sample()
  document.pages[0]!.elements.push(registry.createElement('rect', { id: 'r', x: 60, y: 60 }))
  return document
}

const mounted: XhPrintDesigner[] = []

async function mount(setup: (designer: XhPrintDesigner) => void = () => {}): Promise<XhPrintDesigner> {
  definePrintDesigner()
  const designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  designer.autoTour = false
  setup(designer)
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
  mounted.push(designer)
  return designer
}

afterEach(() => {
  vi.useRealTimers()
  for (const designer of mounted.splice(0))
    designer.remove()
  localStorage.clear()
  document.body.replaceChildren()
})

async function until<T>(read: () => T | null | undefined): Promise<T> {
  for (let round = 0; round < 100; round++) {
    const value = read()
    if (value)
      return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('等了 1 秒仍没到期望的状态')
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)
}

describe('自动保存', () => {
  it('开着时改了停手约一秒存成草稿，键是设计器种类加 draftKey；markSaved 后草稿删掉；关着时不存', async () => {
    const designer = await mount((element) => {
      element.draftKey = 'delivery'
      element.settings = { 'general.autoSave': true }
    })
    expect(designer.getAttribute('draft-key')).toBeNull()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    designer.addElement('rect', { x: 60, y: 60 })
    vi.advanceTimersByTime(999)
    expect(localStorage.getItem(KEY)).toBeNull()
    vi.advanceTimersByTime(1)
    expect((JSON.parse(localStorage.getItem(KEY)!) as { document: PrintDocument }).document).toEqual(designer.schema)
    designer.markSaved()
    expect(localStorage.getItem(KEY)).toBeNull()
    designer.settings = {}
    await designer.updateComplete
    designer.addElement('rect', { x: 80, y: 80 })
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('draft-key 写成 attribute 也认', async () => {
    const designer = await mount(element => element.setAttribute('draft-key', 'delivery'))
    expect(designer.draftKey).toBe('delivery')
  })

  it('宿主装进同一个键、和草稿不一样的模板时问「发现未保存的草稿」：恢复后模板换成草稿、记一步撤销', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), document: withDraft() }))
    const designer = await mount(element => (element.draftKey = 'delivery'))
    const restore = await until(() => button(DESIGNER_COMMANDS_EN_US.draftRestore))
    expect(document.body.textContent).toContain(DESIGNER_COMMANDS_EN_US.draftFoundDescription)
    restore.click()
    await until(() => designer.schema.pages[0]!.elements.some(element => element.id === 'r'))
    expect(designer.undo()).toBe(true)
    expect(designer.schema.pages[0]!.elements.map(element => element.id)).toEqual(['a'])
  })

  it('选丢弃：草稿删掉，模板照旧；草稿和装进的一样时不问、悄悄删掉', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), document: withDraft() }))
    const designer = await mount(element => (element.draftKey = 'delivery'))
    ;(await until(() => button(DESIGNER_COMMANDS_EN_US.draftDiscard))).click()
    await until(() => localStorage.getItem(KEY) === null)
    expect(designer.schema.pages[0]!.elements.map(element => element.id)).toEqual(['a'])
    designer.remove()
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), document: sample() }))
    await mount(element => (element.draftKey = 'delivery'))
    await until(() => localStorage.getItem(KEY) === null)
    expect(button(DESIGNER_COMMANDS_EN_US.draftRestore)).toBeUndefined()
  })
})
