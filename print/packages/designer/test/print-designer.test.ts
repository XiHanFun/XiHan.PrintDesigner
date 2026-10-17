/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { ExtensionElementPrototype, PrintDocument, PrintElement } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { IconRecord } from '@xihan-ui/core'
import type { Rect } from '@xihan-ui/designer-kit'
import type { DesignerGesturePhase, DesignerTransformKind, XhDesignerTransformElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { PrintDesignerExtension, XhPrintDesigner } from '../src'
import { behaviorProperties, createBuiltinElementPrototypes, createDocument, createElementRegistry, createPage, layoutProperties, property } from '@xihan-print/core'
import { printZhCN } from '@xihan-print/runtime/locale'
import { CLIPBOARD_FORMAT, clipboardMimeType, DesignerExtensionError } from '@xihan-ui/designer-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner, PRINT_DESIGNER_EXTENSION_ID } from '../src'

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

/** jsdom 没有 DataTransfer，剪贴板与拖放事件用的最小替身。 */
function clipboardData(files: readonly File[] = []): Pick<DataTransfer, 'getData' | 'setData' | 'files' | 'dropEffect'> {
  const store = new Map<string, string>()
  return { getData: type => store.get(type) ?? '', setData: (type, value) => void store.set(type, value), files: files as unknown as FileList, dropEffect: 'none' }
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
  it('扩展：赋值时合并查重，冲突抛错且保持原状；setup 在连上文档时调用，去掉、换引用或断开时清理；扩展的编辑器压过自带的', async () => {
    const calls: string[] = []
    const audit: PrintDesignerExtension = {
      id: '@acme/audit',
      setup: (context) => {
        calls.push(`setup:${context.designer === designer}`)
        return () => calls.push('cleanup')
      },
      rules: [document => document.pages.length > 0 ? [{ code: 'audit.checked', path: [], severity: 'warning' }] : []],
    }
    designer.extensions = [audit]
    expect(calls).toEqual(['setup:true'])
    expect(designer.validate().map(issue => issue.code)).toContain('audit.checked')

    const text = createBuiltinElementPrototypes().find(prototype => prototype.type === 'text')!
    let error: unknown
    try {
      designer.extensions = [audit, { id: '@acme/text', elements: [text] }]
    }
    catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'designer.extension-conflict', space: 'element-type', key: 'text' })
    expect(() => {
      designer.extensions = [{ id: PRINT_DESIGNER_EXTENSION_ID }]
    }).toThrow(DesignerExtensionError)
    expect([designer.extensions, calls]).toEqual([[audit], ['setup:true']])

    designer.extensions = [{ ...audit }]
    expect(calls).toEqual(['setup:true', 'cleanup', 'setup:true'])
    designer.remove()
    expect(calls.at(-1)).toBe('cleanup')
    document.body.append(designer)
    expect(calls.at(-1)).toBe('setup:true')

    const output = (): { element: HTMLElement } => ({ element: document.createElement('output') })
    designer.extensions = [{ id: '@acme/border', editors: { byControl: { borderSides: output } } }]
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    const panel = designer.querySelector('xh-designer-properties')!
    await panel.updateComplete
    expect(panel.querySelector('[data-path="box.border"] output')).not.toBeNull()
    expect(panel.querySelector('[data-path="box.border"] xh-tabs')).toBeNull()
  })

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

  it('扩展元素：物料面板列出它，画布按扩展的渲染画出；扩展去掉后元素留在文档里，画成占位并报未知类型', async () => {
    const seal: ExtensionElementPrototype = {
      type: 'seal',
      category: 'media',
      order: 9,
      flow: false,
      minSize: { width: 5, height: 5 },
      defaults: { type: 'seal', width: 30, height: 30, owner: '' },
      properties: [...layoutProperties({ rotation: false }), property(['owner'], 'content', { kind: 'text' }), ...behaviorProperties()],
      layout: element => ({ owner: String(element.owner ?? '') }),
    }
    const seals: PrintDesignerExtension = {
      id: '@acme/seal',
      elements: [seal],
      renderers: { seal: (box, { document }) => Object.assign(document.createElement('span'), { textContent: `印 ${(box.data as { owner: string }).owner}` }) },
    }
    designer.extensions = [seals]
    await designer.updateComplete
    const palette = designer.querySelector('xh-designer-palette')!
    expect(palette.groups!.find(group => group.id === 'media')!.items.map(item => item.id)).toEqual(['image', 'seal'])
    palette.dispatchEvent(new CustomEvent('item-activate', { detail: { id: 'seal', payload: undefined } }))
    const added = designer.schema.pages[0]!.elements.at(-1)! as unknown as { id: string, type: string }
    designer.execute([{ type: 'updateElement', id: added.id, changes: [{ path: ['owner'], value: '曦寒' }] }])
    await designer.updateComplete
    const frame = (): HTMLElement => designer.querySelector<HTMLElement>(`[data-part="box"][data-element-id="${added.id}"]`)!
    expect([added.type, frame().textContent, frame().hasAttribute('data-placeholder')]).toEqual(['seal', '印 曦寒', false])
    expect(designer.validate().map(issue => issue.code)).not.toContain('element.unknownType')

    designer.extensions = []
    await designer.updateComplete
    expect(designer.schema.pages[0]!.elements.at(-1)).toMatchObject({ id: added.id, type: 'seal', owner: '曦寒' })
    expect([frame().hasAttribute('data-placeholder'), frame().textContent]).toEqual([true, 'seal'])
    expect(designer.validate().map(issue => issue.code)).toContain('element.unknownType')
  })

  it('扩展的物料项：新分组排在内置分组之后，名称与图标随扩展给出，没给时显示类型名与分组名；分组重名或给别处的元素类型时抛错', async () => {
    const shape = (type: string, category: string): ExtensionElementPrototype => ({
      type,
      category,
      order: 1,
      flow: false,
      minSize: { width: 5, height: 5 },
      defaults: { type, width: 20, height: 20 },
      properties: [...layoutProperties({ rotation: false }), ...behaviorProperties()],
      layout: () => ({}),
    })
    const icon: IconRecord = { name: 'stamp', viewBox: '0 0 24 24', nodes: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } }] }
    const office: PrintDesignerExtension = {
      id: '@acme/office',
      elements: [shape('stamp', 'office'), shape('chart', 'charts')],
      palette: { stamp: { label: '印章', icon } },
      categories: { office: '办公' },
    }
    designer.extensions = [office]
    await designer.updateComplete
    const palette = designer.querySelector('xh-designer-palette')!
    expect(palette.groups!.map(group => [group.id, group.label])).toEqual([['text', 'Text'], ['media', 'Media'], ['data', 'Data'], ['shape', 'Shapes'], ['code', 'Codes'], ['office', '办公'], ['charts', 'charts']])
    expect(palette.groups!.slice(-2).map(group => group.items)).toEqual([[{ id: 'stamp', label: '印章', icon }], [{ id: 'chart', label: 'chart' }]])
    const stamp = designer.addElement('stamp')
    await designer.updateComplete
    expect(designer.querySelector(`[data-element-id="${stamp.id}"][aria-label]`)!.getAttribute('aria-label')).toBe(`印章 ${stamp.id}`)

    const thrown = (assign: () => void): unknown => {
      try {
        assign()
      }
      catch (error) {
        return error
      }
      return undefined
    }
    expect(thrown(() => (designer.extensions = [office, { id: '@acme/other', categories: { office: '办公室' } }]))).toMatchObject({ code: 'designer.extension-conflict', space: 'palette-category', key: 'office' })
    expect(thrown(() => (designer.extensions = [{ id: '@acme/other', categories: { media: '媒体' } }]))).toMatchObject({ space: 'palette-category', key: 'media' })
    expect(thrown(() => (designer.extensions = [office, { id: '@acme/other', palette: { stamp: { label: '章' } } }]))).toBeInstanceOf(TypeError)
    expect(designer.extensions).toEqual([office])
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
    const label = (field: Element): string | null => field.closest('[data-part="property"]')!.querySelector('[data-xh-part="label"]')!.textContent
    const border = (): unknown => (designer.schema.pages[0]!.elements[0] as { box?: { border?: unknown } }).box?.border
    expect([label(toggle('top')), toggle('top').checked]).toEqual(['Top border', false])
    expect(side('top').querySelector<HTMLElement>('[data-part="border-side-stroke"]')!.hidden).toBe(true)

    toggle('top').dispatchEvent(new CustomEvent('checked-change', { detail: { checked: true }, bubbles: true }))
    expect(border()).toEqual({ top: { width: 0.2, style: 'solid', color: '#000000' } })
    await designer.updateComplete
    await panel.updateComplete
    expect([toggle('top').checked, side('top').querySelector<HTMLElement>('[data-part="border-side-stroke"]')!.hidden]).toEqual([true, false])
    const width = side('top').querySelector('xh-number-field') as HTMLElement & { value?: string }
    expect([width.value, width.querySelector('[data-xh-part="suffix"]')!.textContent, label(width)]).toEqual(['0.2', 'mm', 'Width'])
    const style = side('top').querySelector('xh-select')!
    expect([label(style), Array.from(style.querySelectorAll('[data-xh-part="item-text"]'), item => item.textContent)]).toEqual(['Style', ['Solid', 'Dashed', 'Dotted', 'Double']])
    width.dispatchEvent(new CustomEvent('value-change', { detail: { value: '0.5', valueAsNumber: 0.5 }, bubbles: true }))
    style.dispatchEvent(new CustomEvent('value-change', { detail: { value: ['3'] }, bubbles: true }))
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
    expect((find('content.kind').control as { appearance?: string }).appearance).toBe('dropdown')
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

  it('值格式：种类下拉在不设格式、常用格式、值映射与表达式之间切换，各种类整体写入，只显示当前种类的编辑区', async () => {
    const panel = designer.querySelector('xh-designer-properties')!
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['content', 'kind'], value: 'field', targets: [{ kind: 'text', id: 'a' }], merge: 'm' } }))
    await designer.updateComplete
    await panel.updateComplete
    const settle = async (): Promise<void> => {
      await designer.updateComplete
      await panel.updateComplete
    }
    const editor = panel.querySelector<HTMLElement>('[data-path="content.format"] [data-part="value-format"]')!
    type Control = HTMLElement & { value?: unknown, collection?: { value: string, label: string }[], kinds?: unknown, clearable?: boolean, check?: unknown }
    const kindRow = editor.firstElementChild!
    const kind = kindRow.querySelector<Control>('xh-select')!
    const pick = (index: number): void => void kind.dispatchEvent(new CustomEvent('value-change', { detail: { value: [String(index)] }, bubbles: true }))
    const format = (): unknown => (designer.schema.pages[0]!.elements[0] as { content: { format?: unknown } }).content.format
    const visible = (): string[] => Array.from(editor.children as HTMLCollectionOf<HTMLElement>).filter(child => !child.hidden && child !== kindRow).map(child => child.dataset.part ?? child.localName)
    expect([kind.value, kindRow.querySelector('[data-xh-part="label"]')!.textContent, Array.from(kind.querySelectorAll('[data-xh-part="item-text"]'), item => item.textContent)])
      .toEqual([['0'], 'Format type', ['No format', 'Common format', 'Value map', 'Expression']])
    expect(visible()).toEqual([])

    pick(1)
    expect(format()).toEqual({ kind: 'number' })
    await settle()
    const input = editor.querySelector<Control>('xh-format-input')!
    expect([visible(), input.value, input.clearable]).toEqual([['xh-format-input'], { kind: 'number' }, false])
    input.dispatchEvent(new CustomEvent('value-change', { detail: { value: { kind: 'percent', decimals: 1 } }, bubbles: true }))
    expect(format()).toEqual({ kind: 'percent', decimals: 1 })

    pick(2)
    expect(format()).toEqual({ kind: 'map', entries: [] })
    await settle()
    expect(visible()).toEqual(['value-map'])
    const map = editor.querySelector<Control>('xh-field-array')!
    map.dispatchEvent(new CustomEvent('value-change', { detail: { value: [{ value: '', text: '' }], mutation: { type: 'insert', index: 0 } }, bubbles: true }))
    expect(format()).toEqual({ kind: 'map', entries: [{ value: '', text: '' }] })
    await settle()
    const cells = editor.querySelectorAll<Control>('[data-xh-part="table"] > [data-xh-part="item"] xh-text-field')
    expect(Array.from(cells, cell => cell.getAttribute('aria-label'))).toEqual(['Value of entry 1', 'Display text of entry 1'])
    cells[0]!.dispatchEvent(new CustomEvent('value-change', { detail: { value: 'M' }, bubbles: true }))
    cells[1]!.dispatchEvent(new CustomEvent('value-change', { detail: { value: '男' }, bubbles: true }))
    const fallback = editor.querySelector<Control>('[data-part="value-map"] > [data-part="property"] xh-text-field')!
    expect(fallback.closest('[data-part="property"]')!.querySelector('[data-xh-part="label"]')!.textContent).toBe('Text when nothing matches')
    fallback.dispatchEvent(new CustomEvent('value-change', { detail: { value: '未知' }, bubbles: true }))
    expect(format()).toEqual({ kind: 'map', entries: [{ value: 'M', text: '男' }], fallback: '未知' })

    pick(3)
    await settle()
    const expression = editor.querySelector<Control>('xh-expression-input')!
    expect([visible(), typeof expression.check]).toEqual([['xh-expression-input'], 'function'])
    expression.dispatchEvent(new CustomEvent('value-change', { detail: { value: 'value * 2' }, bubbles: true }))
    expect(format()).toEqual({ kind: 'expression', expression: 'value * 2' })

    pick(0)
    expect(format()).toBeUndefined()
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
    designer.extensions = [{ id: '@acme/columns', editors: { byControl: { tableColumns: host } } }]
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

  it('导入器：粘贴与拖放进来的外部内容交给第一个接下的导入器，元素挪到落点后按粘贴放下；出错或校验不通过时派发 import-error', async () => {
    const errors: { importer: string, error: unknown }[] = []
    designer.addEventListener('import-error', event => void errors.push((event as CustomEvent<{ importer: string, error: unknown }>).detail))
    const rect = (width = 20): PrintElement => registry.createElement('rect', { id: 'r', x: 0, y: 0, overrides: { width, height: 10 } })
    const seen: string[] = []
    designer.extensions = [{
      id: '@acme/import',
      importers: [
        {
          id: '@acme/import.html',
          accepts: source => source.mime === 'text/html',
          import: () => {
            throw new Error('boom')
          },
        },
        {
          id: '@acme/import.plain',
          accepts: source => source.mime === 'text/plain' || source.file !== undefined,
          import: async (source) => {
            seen.push(`${source.kind}:${source.mime}`)
            return { elements: [rect(source.text === 'bad' ? -1 : 20)] }
          },
        },
      ],
    }]
    const flush = async (): Promise<void> => {
      for (let index = 0; index < 4; index++)
        await Promise.resolve()
    }
    const paste = (text: string): Event => {
      const data = clipboardData()
      data.setData('text/plain', text)
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: data })
      viewport().dispatchEvent(event)
      return event
    }
    expect(paste('hello').defaultPrevented).toBe(true)
    await flush()
    const added = designer.schema.pages[0]!.elements.at(-1)!
    expect([added.type, added.x, designer.getSelection().elements]).toEqual(['rect', 95, [added.id]])

    const drop = Object.assign(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 50 * PX_PER_MM, clientY: 50 * PX_PER_MM }), {
      dataTransfer: clipboardData([new File(['x'], 'logo.png', { type: 'image/png' })]),
    })
    viewport().dispatchEvent(drop)
    await flush()
    expect([drop.defaultPrevented, designer.schema.pages[0]!.elements.at(-1)]).toEqual([true, expect.objectContaining({ type: 'rect', x: 40, y: 45 })])
    expect(seen).toEqual(['clipboard:text/plain', 'drop:image/png'])

    const count = designer.schema.pages[0]!.elements.length
    paste('bad')
    const html = clipboardData()
    html.setData('text/html', '<b>x</b>')
    viewport().dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: html }))
    await flush()
    expect(designer.schema.pages[0]!.elements).toHaveLength(count)
    expect(errors.map(error => [error.importer, error.error instanceof Error ? error.error.message : error.error]).sort()).toEqual([
      ['@acme/import.html', 'boom'],
      ['@acme/import.plain', '[xh-print] 导入器 @acme/import.plain 给出的元素没有通过校验'],
    ])
  })

  it('命令：扩展命令按 placement 追加到工具栏与右键菜单，快捷键在画布上生效；commandLayout 改写排列；表格菜单可取消', async () => {
    const runs: unknown[] = []
    designer.extensions = [{
      id: '@acme/hello',
      commands: [{
        id: '@acme/hello.run',
        label: ({ designer }) => `Hello ${designer.schema.pages[0]!.elements.length}`,
        placement: ['toolbar', 'menu:element'],
        shortcut: ['Mod', 'Shift', 'H'],
        enabled: ({ designer }) => !designer.readonly,
        run: context => void runs.push(context.designer),
      }],
    }]
    await designer.updateComplete
    const toolbarItems = (): string[] => Array.from(designer.querySelectorAll<HTMLButtonElement>('[data-part="toolbar"] button[data-xh-part="item"]'), item => item.value)
    expect(toolbarItems().slice(-4)).toEqual(['design', 'preview', 'print', '@acme/hello.run'])
    expect(designer.querySelector('[data-part="toolbar"] button[value="@acme/hello.run"]')!.textContent).toBe('Hello 2')
    expect(designer.querySelector('[data-part="toolbar"] button[value="grid"]')!.getAttribute('aria-pressed')).toBe('true')

    const content = designer.querySelector('[data-print-canvas-root] > [data-xh-part="positioner"] > [data-xh-part="content"]')!
    const menuItems = (): string[] => Array.from(content.querySelectorAll('[data-xh-part="item"]'), item => item.getAttribute('value')!)
    at(viewport(), 'contextmenu', 20, 35)
    expect(menuItems()).toEqual(['cut', 'copy', 'duplicate', 'delete', 'bring-to-front', 'bring-forward', 'send-backward', 'send-to-back', '@acme/hello.run'])
    expect(content.querySelector('[value="duplicate"] [data-xh-part="item-shortcut"]')!.textContent).toBe('Ctrl+D')
    designer.querySelector('xh-context-menu[data-print-canvas-menu]')!.dispatchEvent(new CustomEvent('select', { detail: { value: '@acme/hello.run' } }))
    expect(runs).toEqual([designer])
    key('H', { ctrlKey: true, shiftKey: true })
    expect(runs).toHaveLength(2)
    designer.readonly = true
    key('H', { ctrlKey: true, shiftKey: true })
    expect(runs).toHaveLength(2)
    designer.readonly = false

    designer.commandLayout = { 'toolbar': [['@acme/hello.run', 'undo']], 'menu:blank': [['zoom-to-fit']] }
    await designer.updateComplete
    expect(toolbarItems()).toEqual(['@acme/hello.run', 'undo'])
    at(viewport(), 'contextmenu', 150, 10)
    expect(menuItems()).toEqual(['zoom-to-fit'])

    designer.select({ elements: ['t'] })
    key('Enter')
    await designer.updateComplete
    const parts: unknown[] = []
    designer.addEventListener('table-contextmenu', (event) => {
      parts.push((event as CustomEvent<{ part: unknown }>).detail.part)
      event.preventDefault()
    }, { once: true })
    at(viewport(), 'contextmenu', 15, 62)
    expect(parts).toEqual([expect.objectContaining({ kind: 'column', elementId: 't' })])
    expect(menuItems()).toEqual(['zoom-to-fit'])
    at(viewport(), 'contextmenu', 15, 62)
    expect(menuItems()).toEqual(['insert-column-left', 'insert-column-right', 'remove-column', 'move-column-left', 'move-column-right', 'insert-footer-row-above', 'insert-footer-row-below', 'remove-footer-row', 'merge-cell-right', 'split-cell', 'exit-table-edit'])
  })

  it('扩展面板放进外框的命名区，状态变化时刷新、panels 能开关；区名重名时抛错；去掉扩展时撤掉', async () => {
    const updates: unknown[] = []
    let destroyed = 0
    const stamps: PrintDesignerExtension = {
      id: '@acme/stamps',
      panels: [{
        region: { name: 'acme-stamps', position: 'end', label: 'Stamps' },
        create: () => ({
          element: document.createElement('section'),
          update: context => void updates.push(context.designer.getSelection().elements),
          destroy: () => void destroyed++,
        }),
      }],
    }
    designer.extensions = [stamps]
    await designer.updateComplete
    const frame = designer.querySelector('xh-designer-frame')!
    const element = frame.querySelector('section[slot="acme-stamps"]')!
    expect(element).not.toBeNull()
    expect(frame.regions!.map(region => region.name)).toEqual(['toolbar', 'pages', 'palette', 'canvas', 'properties', 'issues', 'acme-stamps'])
    expect(frame.regions!.find(region => region.name === 'properties')!.label).toBe('Properties')
    designer.select({ elements: ['a'] })
    await designer.updateComplete
    expect(updates.at(-1)).toEqual(['a'])
    designer.panels = 'toolbar properties'
    await designer.updateComplete
    expect([frame.showsPanel('acme-stamps'), frame.showsPanel('properties')]).toEqual([false, true])
    designer.panels = undefined
    await designer.updateComplete
    expect(element.isConnected).toBe(true)

    const pages: PrintDesignerExtension = { id: '@acme/pages', panels: [{ region: { name: 'pages', position: 'start' }, create: () => ({ element: document.createElement('div') }) }] }
    expect(() => (designer.extensions = [stamps, pages])).toThrow(DesignerExtensionError)
    expect([designer.extensions, element.isConnected, destroyed]).toEqual([[stamps], true, 0])
    designer.extensions = []
    await designer.updateComplete
    expect([element.isConnected, destroyed]).toEqual([false, 1])
    expect(frame.regions!.map(region => region.name)).toEqual(['toolbar', 'pages', 'palette', 'canvas', 'properties', 'issues'])
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
