/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { CLIPBOARD_FORMAT, clipboardMimeType } from '@xihan-ui/designer-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner } from '../src'

const registry = createElementRegistry()
const PX_PER_MM = 96 / 25.4

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5 * (1 - 1e-9), ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [
    registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10, content: { kind: 'field', field: 'name' } } }),
    registry.createElement('table', { id: 't', x: 10, y: 60, overrides: { dataField: 'items' } }),
  ]
  return createDocument({ pages: [page] })
}

/** 在纸张坐标（mm）处派发鼠标事件；jsdom 里画布原点就是视口原点，缩放为实际尺寸。 */
function at(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x * PX_PER_MM, clientY: y * PX_PER_MM, button: 0 }))
}

/** jsdom 没有 DataTransfer，剪贴板事件用的最小替身。 */
function clipboardData(): Pick<DataTransfer, 'getData' | 'setData'> {
  const store = new Map<string, string>()
  return { getData: type => store.get(type) ?? '', setData: (type, value) => void store.set(type, value) }
}

let designer: XhPrintDesigner
let events: string[]

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  events = []
  for (const type of ['schema-change', 'selection-change', 'dirty-change', 'page-change', 'mode-change', 'save'])
    designer.addEventListener(type, event => events.push(type === 'schema-change' ? `${type}:${(event as CustomEvent<{ kind: string }>).detail.kind}` : type))
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
})

function viewport(): HTMLElement {
  return designer.querySelector<HTMLElement>('[data-part="viewport"]')!
}

function key(name: string, init: KeyboardEventInit = {}): void {
  viewport().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))
}

describe('<xh-print-designer>', () => {
  it('装载模板后按设计态排版画出元素，派发 load 与 page-change', () => {
    expect(events).toContain('schema-change:load')
    expect(events).toContain('page-change')
    const nodes = Array.from(designer.querySelectorAll<HTMLElement>('[data-part="elements"] > [data-element-id]'), node => node.dataset.elementId)
    expect(nodes).toEqual(['a', 't'])
    expect(designer.querySelector('[data-element-id="a"]')!.textContent).toBe('{name}')
    expect(designer.querySelectorAll('[data-part="band-menu"]')).toHaveLength(2)
    expect(designer.querySelector<HTMLElement>('[data-part="paper"]')!.style.width).toBe('210mm')
  })

  it('点选元素、方向键微移（按网格，Shift 为 10 mm）、撤销与删除', async () => {
    at(viewport(), 'pointerdown', 20, 35)
    expect(designer.getSelection()).toEqual({ elements: ['a'] })
    await designer.updateComplete
    expect(designer.querySelectorAll('[data-part="selection"]')).toHaveLength(1)
    key('ArrowRight')
    key('ArrowDown', { shiftKey: true })
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 11, y: 40 })
    key('z', { ctrlKey: true })
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 10, y: 30 })
    key('Delete')
    expect(designer.schema.pages[0]!.elements.map(element => element.id)).toEqual(['t'])
    expect(events.filter(event => event.startsWith('schema-change'))).toEqual(['schema-change:load', 'schema-change:execute', 'schema-change:execute', 'schema-change:undo', 'schema-change:execute'])
    expect(designer.dirty).toBe(true)
    key('s', { ctrlKey: true })
    expect(events.at(-1)).toBe('save')
  })

  it('复制写入系统剪贴板，粘贴换新 id；别的内容粘进来时忽略', () => {
    designer.select({ elements: ['a'] })
    const copied = clipboardData()
    viewport().dispatchEvent(Object.assign(new Event('copy', { bubbles: true, cancelable: true }), { clipboardData: copied }))
    const text = copied.getData(clipboardMimeType('print'))
    expect(JSON.parse(text)).toMatchObject({ format: CLIPBOARD_FORMAT, product: 'print', version: 1, payload: { region: 'body' } })
    const pasted = clipboardData()
    pasted.setData('text/plain', text)
    viewport().dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: pasted }))
    expect(designer.getSelection().elements).toEqual(['text-1'])
    const other = clipboardData()
    other.setData('text/plain', 'hello')
    viewport().dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: other }))
    expect(designer.schema.pages[0]!.elements).toHaveLength(3)
  })

  it('选中表格后回车进入表格编辑态：点表头选中列，Esc 退出', async () => {
    designer.select({ elements: ['t'] })
    key('Enter')
    await designer.updateComplete
    expect(designer.getSelection().tablePart).toEqual({ kind: 'body', elementId: 't' })
    expect(designer.querySelectorAll('[data-part="column-handle"]')).toHaveLength(3)
    at(viewport(), 'pointerdown', 15, 62)
    expect(designer.getSelection().tablePart).toMatchObject({ kind: 'column', elementId: 't' })
    key('Escape')
    await designer.updateComplete
    expect(designer.getSelection()).toEqual({ elements: ['t'] })
    expect(designer.querySelectorAll('[data-part="column-handle"]')).toHaveLength(0)
  })

  it('表格画得比设计高度高时，超出部分盖半透明层并画出设计高度的边界；点在超出区域里命中下面的元素', async () => {
    const page = createPage({ id: 'p' })
    const table = registry.createElement('table', { id: 't', x: 10, y: 60, overrides: { height: 20, dataField: 'items' } })
    table.footerRows = [{ id: 'sum', placement: 'lastPage', height: 10, style: table.body.style, cells: [] }]
    page.elements = [table, registry.createElement('text', { id: 'remark', x: 10, y: 82, overrides: { width: 60, height: 8 } })]
    designer.schema = createDocument({ pages: [page] })
    await designer.updateComplete
    const overflow = designer.querySelector<HTMLElement>('[data-part="design-overflow"]')!
    expect([overflow.style.top, overflow.style.height]).toEqual(['80mm', '5mm'])
    expect(overflow.previousElementSibling!.getAttribute('data-element-id')).toBe('t')
    expect(designer.querySelector<HTMLElement>('[data-part="design-bound"]')!.style.top).toBe('80mm')
    at(viewport(), 'pointerdown', 20, 84)
    expect(designer.getSelection()).toEqual({ elements: ['remark'] })
  })

  it('页面页签与带区变体：新增页面切过去，变体菜单列出现有与可新增的变体', async () => {
    const add = designer.querySelector<HTMLButtonElement>('[data-part="pages"] button[value="add-page"]')!
    add.click()
    expect([designer.schema.pages.length, designer.activePageId]).toEqual([2, 'page-1'])
    await designer.updateComplete
    expect(designer.querySelectorAll('[data-part="pages"] xh-toggle-group button')).toHaveLength(2)
    const values = Array.from(designer.querySelectorAll('[data-part="band-menu"][data-region="footer"] [value]'), item => item.getAttribute('value'))
    expect(values).toEqual(['show:default', 'add:first', 'add:last', 'add:odd', 'add:even'])
  })

  it('切到预览态时用 <xh-print-preview> 显示当前模板，派发 mode-change；只读时不能删除', async () => {
    designer.mode = 'preview'
    await designer.updateComplete
    const preview = designer.querySelector('xh-print-preview')!
    expect(preview.schema).toBe(designer.schema)
    expect(designer.querySelector<HTMLElement>('[data-part="preview"]')!.hidden).toBe(false)
    expect(events).toContain('mode-change')
    designer.mode = 'design'
    designer.readonly = true
    await designer.updateComplete
    designer.select({ elements: ['a'] })
    expect(designer.deleteSelection()).toBe(false)
  })

  it('视口：缺省按实际尺寸换算，setViewport 与 getViewport 互逆', () => {
    designer.setViewport({ x: 5, y: 6, zoom: 2 })
    expect(designer.getViewport()).toEqual({ x: 5, y: 6, zoom: 2 })
    const point = designer.clientToWorld(5 + 10 * 2 * PX_PER_MM, 6)
    expect(point.x).toBeCloseTo(10, 10)
    expect(point.y).toBeCloseTo(0, 10)
  })
})
