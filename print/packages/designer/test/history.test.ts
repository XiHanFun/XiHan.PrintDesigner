/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { XhDesignerFrameElement, XhDesignerHistoryElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import type { PrintEditor } from '../src/editor'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { definePrintDesigner } from '../src'

const editors: PrintEditor[] = []

vi.mock('../src/editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/editor')>()
  return {
    ...actual,
    createPrintEditor: (options: Parameters<typeof actual.createPrintEditor>[0]) => {
      const editor = actual.createPrintEditor(options)
      editors.push(editor)
      return editor
    },
  }
})

const registry = createElementRegistry()
const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [
    registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10, name: 'title' } }),
    registry.createElement('rect', { id: 'b', x: 80, y: 30 }),
  ]
  return createDocument({ pages: [page] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  editors.length = 0
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
})

function history(): PrintEditor['history'] {
  return editors.at(-1)!.history
}

function key(name: string, init: KeyboardEventInit = {}): void {
  designer.querySelector<HTMLElement>('[data-part="viewport"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))
}

function transform(phase: string, kind: string, rects: Record<string, { x: number, y: number, width: number, height: number, rotation?: number }>, copy?: boolean): void {
  const detail = { phase, kind, rects: new Map(Object.entries(rects)), guides: [], ...(copy === undefined ? {} : { copy }) }
  designer.querySelector('xh-designer-transform')!.dispatchEvent(new CustomEvent('transform', { detail }))
}

describe('撤销历史的说明', () => {
  it('没给说明的一步按操作写：删除、添加、粘贴都有「动作 + 对象」', async () => {
    designer.select({ elements: ['b'] })
    key('Delete')
    expect(history().undoLabel).toBe('Delete Rectangle b')
    designer.addElement('image', { x: 0, y: 0 })
    expect(history().undoLabel).toMatch(/^Add Image /)
  })

  it('拖动手势：移动、缩放、旋转各写各的，每帧重开事务也是同一句；按住 Alt 拖动写成复制', async () => {
    const rect = { x: 10, y: 30, width: 40, height: 10 }
    transform('start', 'move', { a: rect })
    transform('move', 'move', { a: { ...rect, x: 12 } })
    transform('end', 'move', { a: { ...rect, x: 15 } })
    expect([designer.schema.pages[0]!.elements[0]!.x, history().undoLabel]).toEqual([15, 'Move Text title'])
    transform('start', 'resize', { a: rect })
    transform('end', 'resize', { a: { ...rect, width: 60 } })
    expect(history().undoLabel).toBe('Resize Text title')
    transform('start', 'rotate', { a: rect })
    transform('end', 'rotate', { a: { ...rect, rotation: 30 } })
    expect(history().undoLabel).toBe('Rotate Text title')
    designer.select({ elements: ['a', 'b'] })
    transform('start', 'move', { a: rect, b: { x: 80, y: 30, width: 40, height: 20 } })
    transform('end', 'move', { a: { ...rect, y: 60 }, b: { x: 80, y: 60, width: 40, height: 20 } }, true)
    expect(history().undoLabel).toBe('Copy 2 elements')
  })

  it('属性面板里改一项写「修改『属性名』」，属性名与面板上的一致，换语言跟着变', async () => {
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    const panel = designer.querySelector('xh-designer-properties')!
    const descriptor = panel.targets![0]!.descriptors.find(item => item.path.join('.') === 'x')!
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['x'], value: 20, targets: [{ kind: 'text', id: 'a' }], merge: 'x' } }))
    expect(history().undoLabel).toBe(`Change “${panel.labelOf!(descriptor)}”`)
  })

  it('微移：连续按、选中不变时并成一步；换了选中就另起一步', async () => {
    designer.select({ elements: ['a'] })
    key('ArrowRight')
    key('ArrowRight')
    expect([history().undoCount, history().undoLabel]).toEqual([1, 'Move Text title'])
    designer.select({ elements: ['b'] })
    key('ArrowRight')
    expect([history().undoCount, history().undoLabel]).toEqual([2, 'Move Rectangle b'])
    designer.select({ elements: ['a'] })
    key('ArrowLeft')
    expect(history().undoCount).toBe(3)
  })

  it('ctrl+Y 是重做命令的第二快捷键', async () => {
    designer.select({ elements: ['a'] })
    key('ArrowRight')
    key('z', { ctrlKey: true })
    expect(designer.schema.pages[0]!.elements[0]!.x).toBe(10)
    key('y', { ctrlKey: true })
    expect(designer.schema.pages[0]!.elements[0]!.x).toBe(11)
  })
})

describe('历史命令', () => {
  function toolbarItem(value: string): HTMLButtonElement {
    return designer.querySelector<HTMLButtonElement>(`[data-part="command-bar"] button[value="${value}"]`)!
  }

  function confirmDialog(): (HTMLElement & { open?: boolean, dialogRole?: string }) | undefined {
    return Array.from(document.querySelectorAll<HTMLElement & { open?: boolean, dialogRole?: string }>('xh-dialog')).find(dialog => dialog.dialogRole === 'alertdialog')
  }

  function confirmButtons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] [data-part="footer"] button'))
  }

  it('撤销、重做的名字带上下一步的说明，撤销了的那一步挪到重做上', async () => {
    designer.select({ elements: ['b'] })
    key('Delete')
    await designer.updateComplete
    expect([toolbarItem('undo').getAttribute('aria-label'), toolbarItem('redo').getAttribute('aria-label')]).toEqual(['Undo: Delete Rectangle b', 'Redo'])
    toolbarItem('undo').click()
    await designer.updateComplete
    expect([toolbarItem('undo').disabled, toolbarItem('redo').getAttribute('aria-label')]).toEqual([true, 'Redo: Delete Rectangle b'])
  })

  it('清空历史不上工具栏，经 commandLayout 放上去；先弹确认框，按确定才清空，模板与是否改过不变；只读时不可用', async () => {
    designer.commandLayout = { toolbar: [['undo', 'redo', 'clear-history']] }
    await designer.updateComplete
    expect(toolbarItem('clear-history').disabled).toBe(true)
    designer.select({ elements: ['b'] })
    key('Delete')
    await designer.updateComplete
    const schema = designer.schema
    toolbarItem('clear-history').click()
    await vi.waitFor(() => expect(confirmDialog()?.open).toBe(true))
    expect(confirmButtons()).toHaveLength(2)
    confirmButtons()[0]!.click()
    await vi.waitFor(() => expect(confirmDialog()!.open).toBe(false))
    expect(history().canUndo).toBe(true)

    toolbarItem('clear-history').click()
    await vi.waitFor(() => expect(confirmDialog()!.open).toBe(true))
    confirmButtons()[1]!.click()
    await vi.waitFor(() => expect(history().canUndo).toBe(false))
    await designer.updateComplete
    expect([designer.schema, designer.dirty, toolbarItem('undo').disabled, toolbarItem('clear-history').disabled]).toEqual([schema, true, true, true])

    designer.addElement('image', { x: 0, y: 0 })
    designer.readonly = true
    await designer.updateComplete
    expect([toolbarItem('clear-history').disabled, toolbarItem('undo').disabled]).toEqual([true, true])
  })
})

describe('历史记录面板', () => {
  function frame(): XhDesignerFrameElement {
    return designer.querySelector('xh-designer-frame')!
  }

  function panel(): XhDesignerHistoryElement {
    return designer.querySelector('xh-designer-history')!
  }

  it('缺省停在右栏属性下面、缺省隐藏；打开后列出各步的说明，面板头是清空历史', async () => {
    expect(frame().resolvedLayout.docks.end.slice(0, 2)).toEqual(['properties', 'history'])
    expect(frame().showsPanel('history')).toBe(false)
    designer.select({ elements: ['b'] })
    key('Delete')
    await designer.updateComplete
    frame().togglePanel('history')
    await designer.updateComplete
    expect(frame().showsPanel('history')).toBe(true)
    expect(panel().snapshot!.entries.map(entry => entry.label)).toEqual(['Delete Rectangle b'])
    expect(designer.querySelector('[slot="history-actions"] button[value="clear-history"]')).not.toBeNull()
  })

  it('选一步就跳过去；只读时零件只读、跳不过去', async () => {
    designer.select({ elements: ['b'] })
    key('Delete')
    designer.addElement('image', { x: 0, y: 0 })
    frame().togglePanel('history')
    await designer.updateComplete
    const { origin } = panel().snapshot!
    panel().dispatchEvent(new CustomEvent('history-go', { detail: { position: origin }, bubbles: true }))
    await designer.updateComplete
    expect([designer.schema.pages[0]!.elements.map(element => element.id), panel().snapshot!.position]).toEqual([['a', 'b'], origin])
    designer.readonly = true
    await designer.updateComplete
    expect(panel().readonly).toBe(true)
    panel().dispatchEvent(new CustomEvent('history-go', { detail: { position: panel().snapshot!.entries.at(-1)!.position }, bubbles: true }))
    expect(designer.schema.pages[0]!.elements).toHaveLength(2)
  })
})
