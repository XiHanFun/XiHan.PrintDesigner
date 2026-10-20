/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { XhDesignerSettingsElement, XhDesignerTourElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { PrintDesignerExtension, XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'
import { DESIGNER_TOUR_DONE_KEY } from '@xihan-ui/designer-shell'
import { afterEach, describe, expect, it } from 'vitest'
import { definePrintDesigner, PRINT_VERSION } from '../src'

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

let designer: XhPrintDesigner | undefined

afterEach(() => {
  designer?.remove()
  designer = undefined
})

async function mount(setup: (element: XhPrintDesigner) => void = () => {}): Promise<XhPrintDesigner> {
  definePrintDesigner()
  const element = document.createElement('xh-print-designer')
  element.measurer = measurer
  setup(element)
  document.body.append(element)
  element.schema = sample()
  await element.updateComplete
  await element.updateComplete
  designer = element
  return element
}

/** 给画布一个尺寸（jsdom 没有布局），再刷新一轮：像设计器从藏着到显示出来。 */
async function show(element: XhPrintDesigner): Promise<void> {
  const viewport = element.querySelector<HTMLElement>('[data-part="viewport"]')!
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
  element.requestUpdate()
  await element.updateComplete
  await element.updateComplete
}

function tour(element: XhPrintDesigner): XhDesignerTourElement {
  return element.querySelector('xh-designer-tour')!
}

function settings(element: XhPrintDesigner): XhDesignerSettingsElement {
  return element.querySelector('xh-designer-settings')!
}

describe('新手引导', () => {
  it('画布有了尺寸才自动开始，藏着时不开始；走完、跳过或关上后设置里记下 help.tourDone 并派发 settings-change', async () => {
    const element = await mount()
    expect(tour(element).running).toBe(false)
    await show(element)
    expect(tour(element).running).toBe(true)
    const keys: string[] = []
    element.addEventListener('settings-change', event => keys.push((event as CustomEvent<{ key: string }>).detail.key))
    tour(element).stop()
    tour(element).dispatchEvent(new CustomEvent('tour-end', { detail: { reason: 'skip', step: 0 }, bubbles: true }))
    expect([keys, element.settings?.[DESIGNER_TOUR_DONE_KEY]]).toEqual([[DESIGNER_TOUR_DONE_KEY], true])
  })

  it('设置里记过 help.tourDone 时不再自动开始', async () => {
    const element = await mount(el => (el.settings = { [DESIGNER_TOUR_DONE_KEY]: true }))
    await show(element)
    expect(tour(element).running).toBe(false)
  })

  it('autoTour 为 false 时不自动开始', async () => {
    const element = await mount(el => (el.autoTour = false))
    await show(element)
    expect(tour(element).running).toBe(false)
  })

  it('打印自己的几步排在通用步骤之后：页眉页脚、页面模板、字段物料与打印；startTour 与 start-tour 命令都能从头开始，预览态不开始', async () => {
    const element = await mount(el => (el.autoTour = false))
    expect(tour(element).steps!.map(step => step.id)).toEqual(['print.bands', 'print.pages', 'print.fields', 'print.print'])
    expect(tour(element).steps!.map(step => step.title)).toEqual(['Header and footer', 'Page templates', 'Field elements', 'Printing'])
    expect(element.startTour()).toBe(true)
    tour(element).stop()
    element.commandLayout = { toolbar: [['start-tour']] }
    await element.updateComplete
    element.querySelector<HTMLButtonElement>('[data-part="command-bar"] button[value="start-tour"]')!.click()
    expect(tour(element).running).toBe(true)
    tour(element).stop()
    element.commandLayout = undefined
    element.mode = 'preview'
    await element.updateComplete
    expect(element.startTour()).toBe(false)
  })

  it('同一页只开一个引导：别的设计器的引导开着时不自动开始；startTour() 先收起开着的那个', async () => {
    const first = await mount()
    const second = await mount()
    try {
      await show(first)
      expect(tour(first).running).toBe(true)
      await show(second)
      expect(tour(second).running).toBe(false)
      expect(second.startTour()).toBe(true)
      expect([tour(first).running, tour(second).running]).toEqual([false, true])
      tour(second).stop()
    }
    finally {
      first.remove()
    }
  })

  it('扩展的 tourSteps 并进来；步骤 id 重名或用了 shell. 前缀时赋值即抛错', async () => {
    const element = await mount(el => (el.autoTour = false))
    const stamps: PrintDesignerExtension = { id: '@acme/stamps', tourSteps: [{ id: '@acme/stamps.library', title: 'Stamps', description: 'Pick a stamp.', order: 200 }] }
    element.extensions = [stamps]
    await element.updateComplete
    expect(tour(element).steps!.map(step => step.id).at(-1)).toBe('@acme/stamps.library')
    const twin: PrintDesignerExtension = { id: '@acme/twin', tourSteps: [{ id: '@acme/stamps.library', title: 'x', description: 'x' }] }
    expect(() => (element.extensions = [stamps, twin])).toThrow(DesignerExtensionError)
    const shell: PrintDesignerExtension = { id: '@acme/shell', tourSteps: [{ id: 'shell.mine', title: 'x', description: 'x' }] }
    expect(() => (element.extensions = [shell])).toThrow(DesignerExtensionError)
  })
})

describe('帮助、快捷键与关于', () => {
  it('帮助页是几段说明与「开始引导」「帮助」两颗钮；按钮派发 settings-command 时关上对话框再跑命令', async () => {
    const element = await mount(el => (el.autoTour = false))
    const dialog = settings(element)
    expect(dialog.help!.notes).toHaveLength(4)
    expect(dialog.help!.actions!.map(action => [action.command, action.label])).toEqual([['start-tour', 'Start tour'], ['help', 'Help']])
    element.openSettings('help')
    await element.updateComplete
    dialog.dispatchEvent(new CustomEvent('settings-command', { detail: { command: 'start-tour' }, bubbles: true }))
    await element.updateComplete
    expect([dialog.open, tour(element).running]).toEqual([false, true])
  })

  it('快捷键表从命令表生成，打印自己那组末尾补上剪贴板三键、Backspace 删除与 Enter 编辑表格，保存是外壳命令归通用；通用里有 F10，方向键与 Esc 按打印的做法改写', async () => {
    const element = await mount(el => (el.autoTour = false))
    const groups = settings(element).shortcuts!.groups
    const designerRows = groups.find(group => group.id === 'designer')!.rows
    expect(designerRows.slice(-5)).toEqual([
      { label: 'Copy', keys: [['Mod', 'C']] },
      { label: 'Cut', keys: [['Mod', 'X']] },
      { label: 'Paste', keys: [['Mod', 'V']] },
      { label: 'Delete', keys: [['Backspace']] },
      { label: 'Edit table', keys: [['Enter']] },
    ])
    expect(designerRows.some(row => row.label === 'Save')).toBe(false)
    expect(groups.find(group => group.id === 'common')!.rows.find(row => row.label === 'Save')!.keys).toEqual([['Mod', 'S']])
    expect(groups.find(group => group.id === 'edit')!.rows.some(row => row.keys.some(keys => keys.join('+') === 'Mod+Z'))).toBe(true)
    expect(settings(element).shortcuts!.commonKeys!.map(key => [key.id, key.label])).toEqual([
      ['nudge', 'Move the selection; pan the canvas when nothing is selected'],
      ['nudgeLarge', undefined],
      ['pan', undefined],
      ['menubar', undefined],
      ['selectionToolbar', undefined],
      ['cancel', 'Cancel a drag, leave table editing, or clear the selection'],
    ])
  })

  it('关于页写打印设计器的版本与许可证，后面接扩展给的几行', async () => {
    const element = await mount((el) => {
      el.autoTour = false
      el.extensions = [{ id: '@acme/pro', about: [{ label: 'Acme Pro', value: '2.1.0' }] }]
    })
    expect(settings(element).about).toEqual({ product: 'Print designer', version: PRINT_VERSION, license: 'MIT', rows: [{ label: 'Acme Pro', value: '2.1.0' }] })
  })
})
