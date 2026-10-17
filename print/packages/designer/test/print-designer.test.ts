/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { Rect } from '@xihan-ui/designer-kit'
import type { DesignerGesturePhase, DesignerTransformKind, XhDesignerTransformElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { printZhCN } from '@xihan-print/runtime/locale'
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

function overlay(): XhDesignerTransformElement {
  return designer.querySelector('xh-designer-transform')!
}

function transform(phase: DesignerGesturePhase, kind: DesignerTransformKind, rects: Record<string, Rect>, copy?: boolean): void {
  overlay().dispatchEvent(new CustomEvent('transform', { detail: { phase, kind, rects: new Map(Object.entries(rects)), guides: [], ...(copy === undefined ? {} : { copy }) } }))
}

function key(name: string, init: KeyboardEventInit = {}): void {
  viewport().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))
}

describe('<xh-print-designer>', () => {
  it('自己注册用到的库内元素：宿主不必全量注册 web-components，工具栏、页签、按钮与菜单都升级', () => {
    for (const tag of ['xh-toolbar', 'xh-toggle-group', 'xh-button', 'xh-menu', 'xh-context-menu'])
      expect(customElements.get(tag), tag).toBeDefined()
    const trigger = designer.querySelector('[data-part="band-menu"] > xh-button > button')!
    expect([trigger.getAttribute('data-scope'), trigger.getAttribute('aria-haspopup')]).toEqual(['button', 'menu'])
  })

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
    expect(overlay().items).toEqual([expect.objectContaining({ id: 'a', rect: { x: 10, y: 30, width: 40, height: 10 }, handles: true, rotatable: true })])
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

  it('变换覆盖层：拖动中按新矩形重排、松手记一步撤销，取消时还原；缩放、旋转与 Alt 复制', async () => {
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    expect(overlay().viewport).toEqual({ x: 0, y: 0, zoom: PX_PER_MM })
    transform('start', 'move', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('move', 'move', { a: { x: 12, y: 33, width: 40, height: 10 } })
    transform('move', 'move', { a: { x: 15, y: 35, width: 40, height: 10 } })
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 15, y: 35 })
    transform('end', 'move', { a: { x: 15, y: 35, width: 40, height: 10 } })
    expect(events.filter(event => event.startsWith('schema-change'))).toEqual(['schema-change:load', 'schema-change:execute'])
    designer.undo()
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 10, y: 30 })

    transform('start', 'resize', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('move', 'resize', { a: { x: 10, y: 30, width: 50, height: 12 } })
    transform('cancel', 'resize', { a: { x: 10, y: 30, width: 40, height: 10 } })
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ width: 40, height: 10 })

    transform('start', 'rotate', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('end', 'rotate', { a: { x: 10, y: 30, width: 40, height: 10, rotation: -90 } })
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ rotation: 270 })

    transform('start', 'move', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('end', 'move', { a: { x: 10, y: 50, width: 40, height: 10 } }, true)
    expect(designer.schema.pages[0]!.elements.map(element => [element.id, element.y])).toEqual([['a', 30], ['t', 60], ['text-1', 50]])
    expect(designer.getSelection().elements).toEqual(['text-1'])
  })

  it('跨区拖动：元素中心落进页眉即改放到页眉当前带区，记一步撤销；表格这类跨页元素留在正文；Alt 复制同样改区', async () => {
    const document = sample()
    document.pages[0]!.header.default.height = 20
    designer.schema = document
    await designer.updateComplete
    const ids = (): [string[], string[]] => [designer.schema.pages[0]!.header.default.elements.map(element => element.id), designer.schema.pages[0]!.elements.map(element => element.id)]
    designer.select({ elements: ['a'] })
    transform('start', 'move', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('move', 'move', { a: { x: 10, y: 12, width: 40, height: 10 } })
    expect(ids()).toEqual([['a'], ['t']])
    transform('end', 'move', { a: { x: 10, y: 12, width: 40, height: 10 } })
    expect(designer.schema.pages[0]!.header.default.elements[0]).toMatchObject({ id: 'a', y: 12 })
    expect(designer.getSelection().elements).toEqual(['a'])
    designer.undo()
    expect(ids()).toEqual([[], ['a', 't']])
    transform('start', 'move', { t: { x: 10, y: 60, width: 190, height: 20 } })
    transform('end', 'move', { t: { x: 10, y: 12, width: 190, height: 20 } })
    expect(ids()).toEqual([[], ['a', 't']])
    expect(designer.schema.pages[0]!.elements[1]).toMatchObject({ id: 't', y: 12 })
    transform('start', 'move', { a: { x: 10, y: 30, width: 40, height: 10 } })
    transform('end', 'move', { a: { x: 10, y: 12, width: 40, height: 10 } }, true)
    expect(ids()).toEqual([['text-1'], ['a', 't']])
  })

  it('框选按方向选中元素，Shift 追加；表格编辑态与只读时覆盖层没有可变换的选中项', async () => {
    overlay().dispatchEvent(new CustomEvent('marquee', { detail: { phase: 'end', rect: { x: 5, y: 25, width: 50, height: 20 }, mode: 'contain', additive: false } }))
    expect(designer.getSelection().elements).toEqual(['a'])
    overlay().dispatchEvent(new CustomEvent('marquee', { detail: { phase: 'end', rect: { x: 0, y: 55, width: 20, height: 10 }, mode: 'intersect', additive: true } }))
    expect(designer.getSelection().elements).toEqual(['a', 't'])
    designer.select({ elements: ['t'] })
    key('Enter')
    await designer.updateComplete
    expect(overlay().items).toEqual([])
    key('Escape')
    designer.readonly = true
    await designer.updateComplete
    expect(overlay().readonly).toBe(true)
  })

  it('标尺：参考线经 guides-change 写回页面模板、可撤销，选中范围画在标尺上；panels 不含 rulers 时画布不进标尺框', async () => {
    const ruler = designer.querySelector('xh-designer-ruler')!
    const guides = (x: number[]): CustomEvent => new CustomEvent('guides-change', { detail: { guides: { x, y: [] }, change: { type: x.length > 0 ? 'add' : 'remove', axis: 'x', index: 0 } } })
    expect([ruler.contains(viewport()), ruler.guides]).toEqual([true, { x: [], y: [] }])
    ruler.dispatchEvent(guides([20]))
    expect(designer.schema.pages[0]!.guides).toEqual({ x: [20], y: [] })
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    expect([ruler.guides, ruler.highlight]).toEqual([{ x: [20], y: [] }, { x: 10, y: 30, width: 40, height: 10 }])
    ruler.dispatchEvent(guides([]))
    expect(designer.schema.pages[0]!.guides).toBeUndefined()
    designer.undo()
    expect(designer.schema.pages[0]!.guides).toEqual({ x: [20], y: [] })
    designer.panels = 'toolbar pages'
    await designer.updateComplete
    expect([ruler.hidden, ruler.contains(viewport()), viewport().isConnected]).toEqual([true, false, true])
  })

  it('物料面板按登记表分组列出元素，激活即加到视口中央；面板里的按键不触发画布快捷键，只读时不加', async () => {
    const palette = designer.querySelector('xh-designer-palette')!
    expect(palette.closest('[data-region="palette"]')).not.toBeNull()
    expect(palette.groups!.map(group => group.id)).toEqual(['text', 'media', 'data', 'shape', 'code'])
    expect(palette.groups![0]!.items.map(item => [item.id, item.label])).toEqual([['text', 'Text'], ['longText', 'Long text'], ['richText', 'Rich text'], ['pageNumber', 'Page number']])
    palette.dispatchEvent(new CustomEvent('item-activate', { detail: { id: 'rect', payload: undefined } }))
    const added = designer.schema.pages[0]!.elements.at(-1)!
    expect([added.type, designer.getSelection().elements]).toEqual(['rect', [added.id]])
    palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    expect(designer.schema.pages[0]!.elements).toHaveLength(3)
    designer.readonly = true
    await designer.updateComplete
    expect(palette.readonly).toBe(true)
    palette.dispatchEvent(new CustomEvent('item-activate', { detail: { id: 'rect', payload: undefined } }))
    expect(designer.schema.pages[0]!.elements).toHaveLength(3)
  })

  it('问题列表：校验问题配上文案与所在对象，点选即选中元素，悬停时框出元素；中文语言包带问题文案', async () => {
    designer.execute([{ type: 'moveElements', ids: ['a'], dx: 200, dy: 0 }])
    await Promise.resolve()
    await designer.updateComplete
    const list = designer.querySelector('xh-designer-issues')!
    expect(list.closest('[data-region="issues"]')).not.toBeNull()
    const item = list.items!.find(entry => entry.issue.code === 'element.outsidePaper')!
    expect([item.message, item.subject]).toEqual(['Extends beyond the paper', 'Page 1 · Text a'])
    designer.select({ elements: [] })
    list.dispatchEvent(new CustomEvent('issue-activate', { detail: { issue: item.issue, index: 0 } }))
    expect(designer.getSelection().elements).toEqual(['a'])
    list.dispatchEvent(new CustomEvent('issue-hover', { detail: { issue: item.issue } }))
    expect(overlay().hover).toEqual({ x: 210, y: 30, width: 40, height: 10 })
    list.dispatchEvent(new CustomEvent('issue-hover', { detail: { issue: undefined } }))
    expect(overlay().hover).toBeUndefined()
    const zh = printZhCN.translations!['xh-print-designer'] as PrintDesignerTranslations
    expect(zh.issue(item.issue)).toBe('超出纸张')
    expect(zh.issue({ code: 'out-of-range', path: [], params: { min: 0, max: 360 } })).toBe('应不小于 0、不大于 360')
  })

  it('属性面板：没选中时编辑页面设置，选中元素时编辑元素，连续输入并成一步撤销；校验问题落到字段上', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    const change = (path: (string | number)[], value: unknown, kind: string, id: string): void => {
      panel.dispatchEvent(new CustomEvent('property-change', { detail: { path, value, targets: [{ kind, id }], merge: `prop:${id}:${path.join('.')}` } }))
    }
    expect(panel.closest('[data-region="properties"]')).not.toBeNull()
    expect([panel.targets!.map(target => target.kind), panel.heading]).toEqual([['page'], 'Page settings'])
    expect(panel.targets![0]!.descriptors.map(descriptor => descriptor.control.kind)).not.toContain('paper')
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    expect([panel.targets!.map(target => [target.kind, target.id]), panel.heading]).toEqual([[['text', 'a']], 'Text a'])
    const fontSize = panel.targets![0]!.descriptors.find(descriptor => descriptor.path.join('.') === 'style.fontSize')!
    expect([panel.labelOf!(fontSize), panel.unitLabel!('pt'), panel.groupLabel!('text')]).toEqual(['Font size', 'pt', 'Text'])
    change(['x'], 12, 'text', 'a')
    change(['x'], 15, 'text', 'a')
    panel.dispatchEvent(new CustomEvent('property-commit', { detail: { path: ['x'] } }))
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 15 })
    designer.undo()
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ x: 10 })
    change(['width'], -1, 'text', 'a')
    await Promise.resolve()
    await designer.updateComplete
    expect(panel.errors).toContainEqual({ target: { kind: 'text', id: 'a' }, path: ['width'], message: 'Must be at least 0' })
  })

  it('复合属性拆开：页边距用内建的四边距离、整体写入，可选的线前面有开关，开时写入缺省值、关时删掉', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    const target = (): { kind: string, id: string, value: unknown, descriptors: readonly { path: readonly (string | number)[] }[] } => panel.targets![0]!
    const paths = (): string[] => target().descriptors.map(descriptor => descriptor.path.join('.'))
    const change = (path: (string | number)[], value: unknown): void => {
      const { kind, id } = target()
      panel.dispatchEvent(new CustomEvent('property-change', { detail: { path, value, targets: [{ kind, id }], merge: 'm' } }))
    }
    const label = (path: string): string => panel.labelOf!(target().descriptors.find(descriptor => descriptor.path.join('.') === path)! as never)
    expect(target().descriptors.find(descriptor => descriptor.path.join('.') === 'margins')).toMatchObject({ control: { kind: 'sides', unit: 'mm', min: 0 } })
    expect([paths().some(path => path.startsWith('margins.')), label('margins')]).toEqual([false, 'Margins'])
    change(['margins'], { top: 10, right: 10, bottom: 10, left: 15 })
    expect(designer.schema.pages[0]!.margins.left).toBe(15)

    designer.execute([{ type: 'addElement', container: { pageId: 'p', region: 'body' }, element: registry.createElement('rect', { id: 'r', x: 100, y: 100 }) }])
    designer.select({ elements: ['r'] })
    await designer.updateComplete
    expect(paths()).toEqual(expect.arrayContaining(['$view.present:stroke', 'stroke.width', 'stroke.style', 'stroke.color']))
    expect([label('$view.present:stroke'), label('stroke.width')]).toEqual(['Stroke', 'Stroke · Width'])
    const hadStroke = (target().value as { $view: Record<string, boolean> }).$view['present:stroke']
    change(['$view', 'present:stroke'], !hadStroke)
    expect((designer.schema.pages[0]!.elements.at(-1) as { stroke?: unknown }).stroke).toEqual(hadStroke ? undefined : { width: 0.2, style: 'solid', color: '#000000' })
  })

  it('四边边框：四个页签，每边一个开关，开时照已有的边或缺省的线写入，线宽、线型与颜色只改这一边，四边都关掉时清除边框', async () => {
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    const panel = designer.querySelector('xh-designer-properties')!
    await panel.updateComplete
    const row = panel.querySelector<HTMLElement>('[data-part="property"][data-path="box.border"]')!
    const tabs = row.querySelector<HTMLElement & { collection?: { value: string, label: string }[] }>('xh-tabs[data-part="border-sides"]')!
    expect(row.getAttribute('role')).toBe('group')
    expect(tabs.collection!.map(item => item.label)).toEqual(['Top', 'Right', 'Bottom', 'Left'])
    const side = (name: string): HTMLElement => tabs.querySelector<HTMLElement>(`[data-part="border-side"][slot="panel:${name}"]`)!
    const toggle = (name: string): HTMLElement & { checked?: boolean } => side(name).querySelector('xh-switch')!
    const border = (): unknown => (designer.schema.pages[0]!.elements[0] as { box?: { border?: unknown } }).box?.border
    expect([toggle('top').querySelector('[data-xh-part="text"]')!.textContent, toggle('top').checked]).toEqual(['Top border', false])
    expect(side('top').querySelector<HTMLElement>('[data-part="border-side-stroke"]')!.hidden).toBe(true)

    toggle('top').dispatchEvent(new CustomEvent('checked-change', { detail: { checked: true }, bubbles: true }))
    expect(border()).toEqual({ top: { width: 0.2, style: 'solid', color: '#000000' } })
    await designer.updateComplete
    await panel.updateComplete
    expect([toggle('top').checked, side('top').querySelector<HTMLElement>('[data-part="border-side-stroke"]')!.hidden]).toEqual([true, false])
    const width = side('top').querySelector('xh-number-field') as HTMLElement & { value?: string }
    expect([width.value, width.querySelector('[data-xh-part="suffix"]')!.textContent, width.querySelector('[data-xh-part="label"]')!.textContent]).toEqual(['0.2', 'mm', 'Width'])
    width.dispatchEvent(new CustomEvent('value-change', { detail: { value: '0.5', valueAsNumber: 0.5 }, bubbles: true }))
    side('top').querySelector('xh-select')!.dispatchEvent(new CustomEvent('value-change', { detail: { value: ['double'] }, bubbles: true }))
    expect(border()).toEqual({ top: { width: 0.5, style: 'double', color: '#000000' } })
    await designer.updateComplete
    await panel.updateComplete

    toggle('left').dispatchEvent(new CustomEvent('checked-change', { detail: { checked: true }, bubbles: true }))
    side('left').querySelector('xh-color-field')!.dispatchEvent(new CustomEvent('value-change', { detail: { value: '#ff0000' }, bubbles: true }))
    expect(border()).toEqual({ top: { width: 0.5, style: 'double', color: '#000000' }, left: { width: 0.5, style: 'double', color: '#ff0000' } })
    await designer.updateComplete
    await panel.updateComplete

    toggle('top').dispatchEvent(new CustomEvent('checked-change', { detail: { checked: false }, bubbles: true }))
    await designer.updateComplete
    await panel.updateComplete
    toggle('left').dispatchEvent(new CustomEvent('checked-change', { detail: { checked: false }, bubbles: true }))
    expect(border()).toBeUndefined()
  })

  it('纸张：选预设整体写入，改宽高时去掉预设，选自定义只去掉预设；水印前面有开关，分项按「水印 · 分项」命名', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    const target = (): { kind: string, id: string, value: unknown, descriptors: readonly { path: readonly (string | number)[] }[] } => panel.targets![0]!
    const change = (path: (string | number)[], value: unknown): void => {
      const { kind, id } = target()
      panel.dispatchEvent(new CustomEvent('property-change', { detail: { path, value, targets: [{ kind, id }], merge: `m${path.join('.')}` } }))
    }
    const view = (): Record<string, unknown> => (target().value as { $view: Record<string, unknown> }).$view
    const label = (path: string): string => panel.labelOf!(target().descriptors.find(descriptor => descriptor.path.join('.') === path)! as never)
    expect([view()['paper:paper'], label('$view.paper:paper'), label('paper.width')]).toEqual(['A4', 'Paper · Size', 'Paper · Width'])
    change(['$view', 'paper:paper'], 'A5')
    expect(designer.schema.pages[0]!.paper).toEqual({ preset: 'A5', width: 148, height: 210 })
    change(['paper', 'width'], 150)
    expect(designer.schema.pages[0]!.paper).toEqual({ width: 150, height: 210 })
    await designer.updateComplete
    expect(view()['paper:paper']).toBe('custom')
    change(['$view', 'paper:paper'], 'A4')
    change(['$view', 'paper:paper'], 'custom')
    expect(designer.schema.pages[0]!.paper).toEqual({ width: 210, height: 297 })

    expect(view()['present:watermark']).toBe(false)
    change(['$view', 'present:watermark'], true)
    expect(designer.schema.pages[0]!.watermark).toMatchObject({ text: '', opacity: 0.1 })
    await designer.updateComplete
    expect(label('watermark.opacity')).toBe('Watermark · Opacity')
    change(['watermark', 'text'], '样稿')
    expect(designer.schema.pages[0]!.watermark!.text).toBe('样稿')
  })

  it('内容类：先选来源种类再按种类显示输入，切换种类整体换成缺省对象；字段用内建的绑定字段，字段树交给面板，表格列从数组字段往下列', async () => {
    designer.fields = [
      { name: 'name', label: 'Name', kind: 'value' },
      { name: 'items', kind: 'list', children: [{ name: 'qty', kind: 'value' }] },
    ]
    const panel = designer.querySelector('xh-designer-properties')!
    interface Target { kind: string, id: string, descriptors: readonly { path: readonly (string | number)[], control: { kind: string, options?: readonly { value: unknown, label?: string }[], kinds?: readonly string[], base?: readonly (string | number)[] }, visibleWhen?: unknown }[] }
    const target = (): Target => panel.targets![0]! as unknown as Target
    const find = (path: string): Target['descriptors'][number] => target().descriptors.find(descriptor => descriptor.path.join('.') === path)!
    const change = (path: (string | number)[], value: unknown): void => {
      const { kind, id } = target()
      panel.dispatchEvent(new CustomEvent('property-change', { detail: { path, value, targets: [{ kind, id }], merge: `m${path.join('.')}` } }))
    }
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    expect(find('content.kind').control.options!.map(option => option.value)).toEqual(['static', 'field', 'template', 'expression'])
    expect(find('content.field').control).toEqual({ kind: 'dataField', kinds: ['value'] })
    expect(panel.dataFields).toBe(designer.fields)
    expect([panel.labelOf!(find('content.kind') as never), panel.labelOf!(find('content.template') as never)]).toEqual(['Content', 'Content · Template'])
    change(['content', 'kind'], 'template')
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ content: { kind: 'template', template: '' } })

    designer.select({ elements: ['t'] })
    await designer.updateComplete
    expect(find('dataField').control).toEqual({ kind: 'dataField', kinds: ['list'] })
    key('Enter')
    const table = designer.schema.pages[0]!.elements[1] as { columns: { id: string }[] }
    designer.select({ elements: ['t'], tablePart: { kind: 'column', elementId: 't', columnId: table.columns[0]!.id } })
    await designer.updateComplete
    expect(find('content.field').control).toEqual({ kind: 'dataField', kinds: ['value'], base: ['items'] })
  })

  it('富文本：画布按设计态排出的行画出，字段显示 {path} 占位；面板只切来源，字段来源再选字段与内容格式', async () => {
    const page = createPage({ id: 'p' })
    page.elements = [registry.createElement('richText', { id: 'r', x: 10, y: 30, overrides: { content: { kind: 'field', field: 'notice.body', source: 'html' } } })]
    designer.schema = createDocument({ pages: [page] })
    await designer.updateComplete
    const box = designer.querySelector<HTMLElement>('[data-element-id="r"]')!
    expect(box.dataset.kind).toBe('richText')
    expect(box.textContent).toBe('{notice.body}')

    const panel = designer.querySelector('xh-designer-properties')!
    interface Target { kind: string, id: string, descriptors: readonly { path: readonly (string | number)[], control: { kind: string, options?: readonly { value: unknown }[] } }[] }
    const target = (): Target => panel.targets![0]! as unknown as Target
    designer.select({ elements: ['r'] })
    await designer.updateComplete
    const contentPaths = target().descriptors.map(descriptor => descriptor.path.join('.')).filter(path => path.startsWith('content'))
    expect(contentPaths).toEqual(['content.kind', 'content.field', 'content.source'])
    const options = (path: string): unknown[] => target().descriptors.find(descriptor => descriptor.path.join('.') === path)!.control.options!.map(option => option.value)
    expect([options('content.kind'), options('content.source')]).toEqual([['static', 'field'], ['html', 'document']])
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['content', 'kind'], value: 'static', targets: [{ kind: 'element', id: 'r' }] } }))
    expect(designer.schema.pages[0]!.elements[0]).toMatchObject({ content: { kind: 'static', document: { blocks: [{ type: 'paragraph', runs: [] }] } } })
  })

  it('二维码纠错级别按码制显示下拉或数字，换码制时去掉级别', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    interface Target { kind: string, id: string, descriptors: readonly { path: readonly (string | number)[], control: { kind: string, min?: number, max?: number, options?: readonly { value: unknown }[] }, visibleWhen?: unknown }[] }
    const target = (): Target => panel.targets![0]! as unknown as Target
    designer.execute([
      { type: 'addElement', container: { pageId: 'p', region: 'body' }, element: registry.createElement('matrixCode', { id: 'q', x: 120, y: 120, overrides: { format: 'qr', level: 'H' } }) },
      { type: 'addElement', container: { pageId: 'p', region: 'body' }, element: registry.createElement('pageNumber', { id: 'n', x: 120, y: 200 }) },
    ])
    designer.select({ elements: ['q'] })
    await designer.updateComplete
    const levels = target().descriptors.filter(descriptor => descriptor.path.join('.') === 'level')
    expect(levels.map(descriptor => [descriptor.control.kind, descriptor.visibleWhen])).toEqual([
      ['select', { path: ['format'], equals: 'qr' }],
      ['number', { path: ['format'], equals: 'pdf417' }],
      ['number', { path: ['format'], equals: 'aztec' }],
    ])
    expect([levels[0]!.control.options!.map(option => option.value), levels[2]!.control.min, levels[2]!.control.max]).toEqual([['L', 'M', 'Q', 'H'], 5, 95])
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['format'], value: 'pdf417', targets: [{ kind: 'matrixCode', id: 'q' }], merge: 'm' } }))
    const code = designer.schema.pages[0]!.elements.find(element => element.id === 'q')!
    expect([(code as { format: string }).format, 'level' in code]).toEqual(['pdf417', false])
  })

  it('页码格式：一行文本，行尾的菜单把变量插到光标处，下面按第 1 页、共 3 页显示示例，数字写法取 numeral', async () => {
    designer.execute([{ type: 'addElement', container: { pageId: 'p', region: 'body' }, element: registry.createElement('pageNumber', { id: 'n', x: 120, y: 200, overrides: { format: '第 {{$page}} 页', numeral: 'cn-lower' } }) }])
    designer.select({ elements: ['n'] })
    await designer.updateComplete
    const editor = designer.querySelector<HTMLElement>('[data-part="page-number-format"]')!
    const field = editor.querySelector('xh-text-field') as HTMLElement & { value?: string, updateComplete: Promise<unknown> }
    const input = field.querySelector('input')!
    await field.updateComplete
    expect([field.value, input.getAttribute('aria-label')]).toEqual(['第 {{$page}} 页', 'Format'])
    expect(editor.querySelector('[data-xh-part="description"]')!.textContent).toBe('Preview: 第 一 页')

    input.setSelectionRange(input.value.length, input.value.length)
    const menu = editor.querySelector('xh-menu')!
    menu.dispatchEvent(new CustomEvent('select', { detail: { value: '$pages' }, bubbles: true }))
    await designer.updateComplete
    await field.updateComplete
    const element = designer.schema.pages[0]!.elements.find(item => item.id === 'n') as { format: string }
    expect(element.format).toBe('第 {{$page}} 页{{$pages}}')
    expect(editor.querySelector('[data-xh-part="description"]')!.textContent).toBe('Preview: 第 一 页三')
  })

  it('表格的列与表尾行列成条目，点一下进入表格编辑态并选中该部位；宿主给了编辑器时用宿主的', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    designer.select({ elements: ['t'] })
    await designer.updateComplete
    await panel.updateComplete
    const list = panel.querySelector('[data-path="columns"] [data-part="part-list"]')!
    const table = designer.schema.pages[0]!.elements[1] as { columns: { id: string }[] }
    expect(list.querySelectorAll('[data-part="part-item"]')).toHaveLength(table.columns.length)
    list.querySelectorAll<HTMLButtonElement>('[data-part="part-item"] button')[1]!.click()
    expect(designer.getSelection().tablePart).toEqual({ kind: 'column', elementId: 't', columnId: table.columns[1]!.id })
    await designer.updateComplete
    expect(designer.querySelectorAll('[data-part="column-handle"]').length).toBeGreaterThan(0)

    key('Escape')
    const host = (): { element: HTMLElement } => ({ element: document.createElement('output') })
    designer.editors = { byControl: { tableColumns: host } }
    designer.select({ elements: ['t'] })
    await designer.updateComplete
    await panel.updateComplete
    expect(panel.querySelector('[data-path="columns"] output')).not.toBeNull()
    expect(panel.querySelector('[data-path="footerRows"] [data-part="part-list"]')).not.toBeNull()
  })

  it('属性面板：表格编辑态下编辑选中的部位，修改写回整张表格', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    designer.select({ elements: ['t'] })
    key('Enter')
    designer.select({ elements: ['t'], tablePart: { kind: 'header', elementId: 't' } })
    await designer.updateComplete
    expect([panel.targets!.map(target => target.kind), panel.heading]).toEqual([['table-header'], 'Table t · Header'])
    const id = panel.targets![0]!.id
    const height = panel.targets![0]!.descriptors.find(descriptor => descriptor.path.join('.') === 'height')!
    expect(panel.labelOf!(height)).toBe('Row height')
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['height'], value: 9, targets: [{ kind: 'table-header', id }], merge: 'm' } }))
    expect((designer.schema.pages[0]!.elements[1] as { header: { height: number } }).header.height).toBe(9)
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

  it('外框按 panels 显示工具栏与页面页签，画布总是显示', async () => {
    const region = (name: string): Element | null => designer.querySelector(`[data-part="frame"] [data-part="region"][data-region="${name}"]`)
    expect(region('toolbar')!.contains(designer.querySelector('[data-part="toolbar"]'))).toBe(true)
    expect(region('pages')).not.toBeNull()
    expect(region('canvas')!.contains(viewport())).toBe(true)
    designer.panels = 'pages'
    await designer.updateComplete
    expect([region('toolbar'), region('pages') !== null]).toEqual([null, true])
    designer.panels = ''
    await designer.updateComplete
    expect([region('pages'), region('canvas') !== null]).toEqual([null, true])
  })

  it('切到预览态时用 <xh-print-preview> 显示当前模板，派发 mode-change；只读时不能删除', async () => {
    designer.mode = 'preview'
    await designer.updateComplete
    expect(designer.querySelector('[data-part="frame"] [data-region="pages"]')).toBeNull()
    expect(designer.querySelector('[data-part="frame"] [data-region="toolbar"]')).not.toBeNull()
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

describe('打印客户端', () => {
  it('给了 printClient 时 print() 经预览交给客户端，带上打印选项', async () => {
    const calls: Array<{ sheets: number, printer: string | undefined }> = []
    const client = {
      printSheets: (result: { readonly sheets: readonly unknown[] }, options: { readonly printer?: string } = {}) => {
        calls.push({ sheets: result.sheets.length, printer: options.printer })
        return { id: 'j', status: undefined, done: Promise.resolve({ jobId: 'j', state: 'completed' as const, sheets: result.sheets.length }), onStatus: () => () => undefined, cancel: async () => false }
      },
    }
    designer.printClient = client as unknown as NonNullable<XhPrintDesigner['printClient']>

    const outcome = await designer.print({ printer: 'Office' })

    expect(outcome).toMatchObject({ sheets: 1, via: 'client' })
    expect(calls).toEqual([{ sheets: 1, printer: 'Office' }])
  })
})
