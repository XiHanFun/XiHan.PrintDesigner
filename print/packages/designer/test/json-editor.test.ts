/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { JsonValue } from '@xihan-ui/core/json'
import type { XhDesignerJsonEditorElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner, printMenuLayout } from '../src'

const registry = createElementRegistry()

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10, name: 'title' } })]
  return createDocument({ pages: [page] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
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
})

function editor(): XhDesignerJsonEditorElement {
  return designer.querySelector('xh-designer-json-editor')!
}

function apply(value: JsonValue): void {
  editor().dispatchEvent(new CustomEvent('json-apply', { detail: { value }, bubbles: true }))
}

describe('编辑 JSON', () => {
  /** 在画布上按 Ctrl + Shift + J，返回按键有没有被设计器接走。 */
  function ctrlShiftJ(): boolean {
    const event = new KeyboardEvent('keydown', { key: 'J', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    designer.querySelector<HTMLElement>('[data-part="viewport"]')!.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** 在画布空白处右键，返回菜单里的条目。 */
  function blankMenu(): string[] {
    designer.querySelector<HTMLElement>('[data-part="viewport"]')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: 5000, clientY: 5000, bubbles: true, cancelable: true }))
    const content = designer.querySelector('[data-print-canvas-root] > [data-xh-part="positioner"] > [data-xh-part="content"]')!
    return Array.from(content.querySelectorAll('[data-xh-part="item"]'), item => item.getAttribute('value')!)
  }

  /** 菜单栏「编辑」菜单里的命令 id。 */
  function editMenu(): string[] {
    const menubar = designer.querySelector<HTMLElement & { collection?: { value: string, items?: { value: string }[] }[] }>('xh-menubar')!
    return menubar.collection!.find(menu => menu.value === 'edit')!.items!.map(item => item.value.slice('edit/'.length))
  }

  it('开发者模式开着时：ctrl / ⌘ + Shift + J 打开对话框，写出当前模板；空白处的右键菜单与「编辑」菜单末尾也有这一条', async () => {
    designer.settings = { 'general.developer': true }
    await designer.updateComplete
    expect(ctrlShiftJ()).toBe(true)
    await designer.updateComplete
    expect([editor().open, editor().value, editor().readonly]).toEqual([true, designer.schema, false])
    expect([printMenuLayout('blank', false).at(-1), blankMenu().at(-1), editMenu().at(-1)]).toEqual([['edit-json'], 'edit-json', 'edit-json'])
  })

  it('开发者模式关着时没有编辑 JSON：快捷键不接、空白处右键菜单与「编辑」菜单里都没有；openJsonEditor() 照样能打开', async () => {
    expect(ctrlShiftJ()).toBe(false)
    await designer.updateComplete
    expect([editor().open === true, blankMenu().includes('edit-json'), editMenu().includes('edit-json')]).toEqual([false, false, false])
    designer.openJsonEditor()
    await designer.updateComplete
    expect(editor().open).toBe(true)
  })

  it('按打印的校验报问题：说明与所在对象的名字取打印的文案；连页面列表都没有时只写说明', async () => {
    designer.openJsonEditor()
    const validate = editor().validate!
    expect(validate(designer.schema as unknown as JsonValue)).toEqual([])
    const broken = structuredClone(designer.schema) as unknown as { pages: { elements: { x: unknown }[] }[] }
    broken.pages[0]!.elements[0]!.x = 'left'
    const items = validate(broken as unknown as JsonValue)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.subject).toBe('Page 1 · Text title')
    expect(typeof items[0]!.message).toBe('string')
    const shapeless = validate({ name: 'x' })
    expect([shapeless.length > 0, shapeless.every(item => item.subject === undefined)]).toEqual([true, true])
  })

  it('应用时整份换上，记一步「编辑 JSON」，派发 schema-change；撤销回到原来那份', async () => {
    const before = designer.schema
    const kinds: string[] = []
    designer.addEventListener('schema-change', event => kinds.push((event as CustomEvent<{ kind: string }>).detail.kind))
    designer.commandLayout = { toolbar: [['undo']] }
    apply({ ...structuredClone(before), name: '入库单' } as unknown as JsonValue)
    await designer.updateComplete
    expect([designer.schema.name, kinds]).toEqual(['入库单', ['execute']])
    expect(designer.querySelector('[data-part="command-bar"] button[value="undo"]')!.getAttribute('aria-label')).toBe('Undo: Edit JSON')
    expect(designer.undo()).toBe(true)
    expect(designer.schema).toBe(before)
  })

  it('只读时只能看：对话框只读，应用不改模板', async () => {
    designer.readonly = true
    await designer.updateComplete
    designer.openJsonEditor()
    expect(editor().readonly).toBe(true)
    const before = designer.schema
    apply({ ...structuredClone(before), name: 'x' } as unknown as JsonValue)
    expect(designer.schema).toBe(before)
  })
})
