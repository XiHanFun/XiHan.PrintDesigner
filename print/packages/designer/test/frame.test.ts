/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { DiagnosticRecord } from '@xihan-ui/core'
import type { DesignerFrameRegion, XhDesignerFrameElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { onDiagnostic, resetDiagnostics, setDiagnosticsConsoleOutput, setDiagnosticsDedupe, setDiagnosticsLevel } from '@xihan-ui/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { definePrintDesigner, PRINT_DESIGNER_HELP_URL } from '../src'

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

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await settle()
})

afterEach(() => {
  designer.remove()
})

function frame(): XhDesignerFrameElement {
  return designer.querySelector('xh-designer-frame')!
}

/** 设计器更新完，再等外框按新的区铺好。 */
async function settle(): Promise<void> {
  await designer.updateComplete
  await frame().updateComplete
}

function region(name: string): DesignerFrameRegion {
  return frame().regions!.find(item => item.name === name)!
}

describe('外框卡片', () => {
  it('物料、属性与问题画成卡片：面板头写标题与帮助，属性面板的副标题是当前编辑的对象；零件不画自己的标题', async () => {
    expect(['palette', 'properties', 'issues'].map(name => [region(name).title, typeof region(name).help])).toEqual([
      ['Elements', 'string'],
      ['Properties', 'string'],
      ['Problems', 'string'],
    ])
    expect([region('toolbar').title, region('canvas').title]).toEqual([undefined, undefined])
    expect([region('palette').size, region('properties').size, region('issues').size]).toEqual([18, 24, 28])
    designer.select({ elements: ['a'] })
    await settle()
    expect(region('properties').subtitle).toBe('Text a')
    expect(frame().querySelector('[data-region="properties"] [data-part="panel-subtitle"]')!.textContent).toBe('Text a')
    const parts = ['xh-designer-palette', 'xh-designer-properties', 'xh-designer-issues'].map(tag => designer.querySelector<HTMLElement & { headless?: boolean }>(tag)!)
    expect(parts.map(element => element.headless)).toEqual([true, true, true])
  })

  it('点面板头的关闭钮收起这块面板：panels 换成外框剩下的区，设计器自己的标尺照原样，派发 panels-change', async () => {
    const seen: string[] = []
    designer.addEventListener('panels-change', event => seen.push((event as CustomEvent<{ panels: string }>).detail.panels))
    frame().querySelector<HTMLButtonElement>('[data-region="palette"] [data-part="panel-close"]')!.click()
    await settle()
    expect(seen).toEqual([designer.panels])
    const shown = designer.panels!.split(' ')
    expect(shown).toEqual(expect.arrayContaining(['toolbar', 'pages', 'properties', 'issues', 'rulers']))
    expect([shown.includes('palette'), frame().showsPanel('palette'), frame().showsPanel('properties')]).toEqual([false, false, true])

    designer.panels = 'toolbar properties issues'
    await settle()
    frame().querySelector<HTMLButtonElement>('[data-region="issues"] [data-part="panel-close"]')!.click()
    await settle()
    expect(designer.panels).toBe('toolbar properties')
    expect(designer.querySelector<HTMLElement>('xh-designer-ruler')!.hidden).toBe(true)
  })
})

describe('问题计数', () => {
  it('错误、警告数在问题卡片的面板头里，零件里不再有；条数照旧随校验变', async () => {
    designer.execute([{ type: 'moveElements', ids: ['a'], dx: 200, dy: 0 }])
    await Promise.resolve()
    await settle()
    const actions = frame().querySelector('[data-region="issues"] [data-part="panel-actions"]')!
    const summary = actions.querySelector('[data-part="filter"]')!
    expect(summary).not.toBeNull()
    expect(designer.querySelector('xh-designer-issues')!.querySelector('[data-part="filter"]')).toBeNull()
    expect(summary.textContent).toContain('1 warning')
  })
})

describe('翻页条', () => {
  function strip(): HTMLElement {
    return designer.querySelector<HTMLElement>('[slot="canvas-end"]')!
  }

  function button(value: string): HTMLButtonElement {
    return strip().querySelector<HTMLButtonElement>(`button[value="${value}"]`)!
  }

  /** 页码按钮上看得见的字与它的名字。 */
  function pageButton(): (string | null)[] {
    const item = button('page-menu')
    return [item.querySelector('[data-part="label"]')!.textContent, item.getAttribute('aria-label')]
  }

  async function twoPages(): Promise<void> {
    const second = createPage({ id: 'q', name: '明细页' })
    designer.schema = createDocument({ pages: [sample().pages[0]!, second] })
    await settle()
  }

  it('竖排落在画布区右侧中间：上一页、页码、下一页，新增、复制、删除页面；页码按钮上写「第几个 / 共几个」，名字再加页面名称', async () => {
    await twoPages()
    expect(strip().closest('[data-region="canvas"]')).not.toBeNull()
    expect(strip().getAttribute('data-orientation')).toBe('vertical')
    const groups = Array.from(strip().querySelectorAll('[data-xh-part="group"]'), group => Array.from(group.querySelectorAll('button'), item => item.value))
    expect(groups).toEqual([['previous-page', 'page-menu', 'next-page'], ['add-page', 'duplicate-page', 'remove-page']])
    expect(pageButton()).toEqual(['1 / 2', 'Page 1 / 2: Page 1'])
    expect([button('previous-page').disabled, button('next-page').disabled]).toEqual([true, false])
    button('next-page').click()
    await settle()
    expect(designer.activePageId).toBe('q')
    expect(pageButton()).toEqual(['2 / 2', 'Page 2 / 2: 明细页'])
    expect([button('previous-page').disabled, button('next-page').disabled, button('remove-page').getAttribute('data-tone')]).toEqual([false, true, 'danger'])
  })

  it('页码菜单：上半是全部页面模板（单选，当前那个打勾），下半是上移、下移；选中一项切过去', async () => {
    await twoPages()
    button('page-menu').click()
    await settle()
    const menu = document.querySelector('[aria-label="Page 1 / 2: Page 1"][role="menu"]')!
    const items = Array.from(menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'), item => [item.getAttribute('role'), item.textContent?.trim(), item.getAttribute('aria-checked')])
    expect(items).toEqual([
      ['menuitemradio', 'Page 1', 'true'],
      ['menuitemradio', '明细页', 'false'],
      ['menuitem', 'Move page up', null],
      ['menuitem', 'Move page down', null],
    ])
    menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]!.click()
    await settle()
    expect(designer.activePageId).toBe('q')
  })

  it('复制页面：放在当前页之后并切过去，元素换了新 id，可以撤销；只读时增、复制、删、移都不可用，翻页照常', async () => {
    await twoPages()
    button('duplicate-page').click()
    await settle()
    expect(designer.schema.pages.map(page => page.id)).toEqual(['p', 'page-1', 'q'])
    expect([designer.activePageId, designer.schema.pages[1]!.elements.map(element => element.id)]).toEqual(['page-1', ['text-1']])
    designer.undo()
    await settle()
    expect(designer.schema.pages.map(page => page.id)).toEqual(['p', 'q'])
    designer.readonly = true
    await settle()
    expect(['previous-page', 'next-page', 'add-page', 'duplicate-page', 'remove-page'].map(value => button(value).disabled)).toEqual([true, false, true, true, true])
  })

  it('预览态与 panels 不含 pages 时翻页条收起；收起面板时 pages 照原样留着', async () => {
    designer.mode = 'preview'
    await settle()
    expect(strip().hidden).toBe(true)
    designer.mode = 'design'
    designer.panels = 'toolbar palette properties issues'
    await settle()
    expect(strip().hidden).toBe(true)
    designer.panels = undefined
    await settle()
    frame().querySelector<HTMLButtonElement>('[data-region="palette"] [data-part="panel-close"]')!.click()
    await settle()
    expect([designer.panels!.split(' ').includes('pages'), strip().hidden]).toEqual([true, false])
  })
})

describe('工具栏末组', () => {
  function toolbarItem(value: string): HTMLButtonElement {
    return designer.querySelector<HTMLButtonElement>(`[data-part="command-bar"] button[value="${value}"]`)!
  }

  it('末组是 designer-shell 内置的面板、设置与帮助：设置打开设置对话框，帮助在新窗口打开文档站的设计器一页', async () => {
    const groups = Array.from(designer.querySelectorAll('[data-part="command-bar"] [data-xh-part="group"]'), group => Array.from(group.querySelectorAll('button'), button => button.value))
    expect(groups.at(-1)).toEqual(['panels', 'settings', 'help'])
    expect(['panels', 'settings', 'help'].map(value => [toolbarItem(value).disabled, toolbarItem(value).hasAttribute('data-icon')])).toEqual([[false, true], [false, true], [false, true]])
    toolbarItem('settings').click()
    await designer.updateComplete
    expect(designer.querySelector<HTMLElement & { open?: boolean }>('xh-designer-settings')!.open).toBe(true)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      toolbarItem('help').click()
      expect(open).toHaveBeenCalledWith(PRINT_DESIGNER_HELP_URL, '_blank', 'noopener,noreferrer')
    }
    finally {
      open.mockRestore()
    }
  })

  it('「面板」点开一张锚在按钮上的菜单，列出物料、属性与问题，勾选的显示；点一项开关它并派发 panels-change', async () => {
    const button = toolbarItem('panels')
    button.click()
    await settle()
    type MenuHost = HTMLElement & { open?: boolean, anchor?: HTMLElement | null, collection?: readonly { value: string }[], checkboxValue?: readonly string[] }
    const menu = designer.querySelector<MenuHost>('[data-part="command-bar"] xh-menu')!
    expect([menu.open, menu.anchor]).toEqual([true, button])
    expect(menu.collection!.map(item => item.value)).toEqual(['item:palette', 'item:properties', 'item:issues'])
    expect(menu.checkboxValue).toEqual(['item:palette', 'item:properties', 'item:issues'])
    const seen: string[] = []
    designer.addEventListener('panels-change', event => seen.push((event as CustomEvent<{ panels: string }>).detail.panels))
    document.querySelector<HTMLElement>('[data-scope="menu"][data-part="item"][data-value="item:palette"]')!.click()
    await settle()
    expect(seen).toEqual([designer.panels])
    expect(designer.panels!.split(' ')).toEqual(expect.arrayContaining(['pages', 'rulers']))
    expect([designer.panels!.split(' ').includes('palette'), frame().showsPanel('palette')]).toEqual([false, false])
    expect(menu.checkboxValue).toEqual(['item:properties', 'item:issues'])
    document.querySelector<HTMLElement>('[data-scope="menu"][data-part="item"][data-value="item:palette"]')!.click()
    await settle()
    expect([designer.panels!.split(' ').includes('palette'), frame().showsPanel('palette')]).toEqual([true, true])
  })
})

describe('状态栏', () => {
  function item(slot: string, index = 0): { label: string | null, value: string | null, tone: string | null, element: HTMLElement } {
    const element = designer.querySelectorAll<HTMLElement>(`[slot="${slot}"]`)[index]!
    const label = element.querySelector<HTMLElement>('[data-part="status-label"]')!
    const value = element.querySelector<HTMLElement>('[data-part="status-value"]')!
    return { label: label.hidden ? null : label.textContent, value: value.textContent, tone: value.getAttribute('data-tone'), element }
  }

  it('左段：没有选中写页面与元素个数，选中一个写种类与位置尺寸，选中多个写个数', async () => {
    expect([item('status-start').label, item('status-start').value]).toEqual(['Page 1', '1 element'])
    designer.select({ elements: ['a'] })
    await settle()
    expect([item('status-start').label, item('status-start').value]).toEqual(['Text', 'X 10 · Y 30 · 40 × 10 mm'])
    designer.addElement('rect', { x: 120, y: 120 })
    designer.select({ elements: ['a', 'rect-1'] })
    await settle()
    expect([item('status-start').label, item('status-start').value]).toEqual([null, '2 elements selected'])
  })

  it('右段：缩放写百分比，点了回到实际尺寸；视口一变当场刷新', async () => {
    const zoom = (): ReturnType<typeof item> => item('status-end', 1)
    expect(zoom().label).toBe('Zoom')
    designer.setViewport({ x: 0, y: 0, zoom: 2 })
    expect(zoom().value).toBe('200%')
    designer.setViewport({ x: 0, y: 0, zoom: 1 })
    expect(zoom().value).toBe('100%')
    // jsdom 里视口没有尺寸，zoomToActual 什么都不做，只核对点了会调它
    const actual = vi.spyOn(designer, 'zoomToActual')
    zoom().element.querySelector('button')!.click()
    expect(actual).toHaveBeenCalledOnce()
  })

  it('右段：给了 printClient 才显示连接状态，状态变了当场刷新；换掉客户端时退订旧的', async () => {
    const client = (initial: string): { state: string, emit: (state: string) => void, listeners: number, on: (type: string, listener: () => void) => () => void } => {
      const listeners = new Set<() => void>()
      const fake = {
        state: initial,
        get listeners() { return listeners.size },
        emit(state: string) {
          fake.state = state
          listeners.forEach(listener => listener())
        },
        on(_type: string, listener: () => void) {
          listeners.add(listener)
          return () => void listeners.delete(listener)
        },
      }
      return fake
    }
    const status = (): ReturnType<typeof item> => item('status-end', 0)
    expect(status().element.hidden).toBe(true)
    const first = client('idle')
    designer.printClient = first as never
    await settle()
    expect([status().element.hidden, status().label, status().value]).toEqual([false, 'Print client', 'Not connected'])
    first.emit('open')
    expect([status().value, status().tone]).toEqual(['Connected', 'success'])
    first.emit('reconnecting')
    expect([status().value, status().tone]).toEqual(['Reconnecting', 'warning'])
    const second = client('connecting')
    designer.printClient = second as never
    await settle()
    // 状态栏一份、设置对话框「本地客户端」一页的连接状态一份
    expect([first.listeners, second.listeners, status().value]).toEqual([0, 2, 'Connecting'])
    designer.printClient = undefined
    await settle()
    expect([second.listeners, status().element.hidden]).toEqual([0, true])
  })

  it('设置里关掉状态栏时外框收起状态栏，收起别的面板时 status 照原样留着，再打开状态栏又回来', async () => {
    designer.settings = { 'general.statusBar': false }
    await settle()
    expect(frame().showsPanel('status')).toBe(false)
    frame().querySelector<HTMLButtonElement>('[data-region="palette"] [data-part="panel-close"]')!.click()
    await settle()
    expect(designer.panels!.split(' ')).toEqual(expect.arrayContaining(['status', 'pages', 'rulers']))
    designer.settings = {}
    await settle()
    expect([frame().showsPanel('status'), frame().showsPanel('palette')]).toEqual([true, false])
  })
})

describe('顶栏', () => {
  function header(): HTMLElement | null {
    return designer.querySelector<HTMLElement>('[slot="header-center"]')
  }

  function insert(type: string): HTMLButtonElement {
    return header()!.querySelector<HTMLButtonElement>(`button[value="insert:${type}"]`)!
  }

  it('中段是叠放的插入钮：文本、图片、条码、二维码、表格、线条，钮上图标下面写元素名，名字是「添加…」', async () => {
    expect(header()!.closest('[data-region="header"]')).not.toBeNull()
    expect(header()!.getAttribute('data-display')).toBe('stacked')
    const buttons = Array.from(header()!.querySelectorAll<HTMLButtonElement>('button[data-xh-part="item"]'))
    expect(buttons.map(button => button.value)).toEqual(['insert:text', 'insert:image', 'insert:barCode', 'insert:matrixCode', 'insert:table', 'insert:line'])
    expect(buttons.map(button => button.querySelector('[data-part="label"]')!.textContent)).toEqual(['Text', 'Image', 'Barcode', '2D code', 'Table', 'Line'])
    expect(insert('text').getAttribute('aria-label')).toBe('Add "Text"')
    expect(buttons.every(button => button.hasAttribute('data-icon'))).toBe(true)
    expect(header()!.querySelector('[data-xh-part="root"]')!.getAttribute('aria-label')).toBe('Insert elements')
  })

  it('点了把这种元素加到视口中央并选中；只读时不可用', async () => {
    insert('table').click()
    await settle()
    const added = designer.schema.pages[0]!.elements.at(-1)!
    expect([added.type, designer.getSelection().elements]).toEqual(['table', [added.id]])
    designer.readonly = true
    await settle()
    expect(insert('table').disabled).toBe(true)
  })

  it('commandLayout 把 header 排空、或处于预览态时，插入钮从外框里拿掉，顶栏收起', async () => {
    designer.commandLayout = { header: [] }
    await settle()
    expect(header()).toBeNull()
    designer.commandLayout = undefined
    await settle()
    expect(header()).not.toBeNull()
    designer.mode = 'preview'
    await settle()
    expect(header()).toBeNull()
  })
})

describe('页面设置', () => {
  type SetupPanel = HTMLElement & { targets?: readonly { kind: string, descriptors: readonly { group: string, path: readonly unknown[] }[] }[], readonly?: boolean }

  function button(): HTMLButtonElement {
    return designer.querySelector<HTMLButtonElement>('[data-part="command-bar"] button[value="page-setup"]')!
  }

  it('工具栏上的弹层命令：点开锚在按钮上的弹层，里面只列纸张一组（纸张、方向、页边距），改了记一步撤销', async () => {
    expect([button().hasAttribute('data-icon'), button().getAttribute('aria-label')]).toEqual([true, 'Page settings'])
    button().click()
    await settle()
    const panel = document.querySelector<SetupPanel>('[data-part="page-setup"]')!
    expect(panel).not.toBeNull()
    expect(panel.targets![0]!.kind).toBe('page')
    expect(new Set(panel.targets![0]!.descriptors.map(descriptor => descriptor.group))).toEqual(new Set(['paper']))
    expect(panel.targets![0]!.descriptors.some(descriptor => descriptor.path[0] === 'orientation')).toBe(true)
    panel.dispatchEvent(new CustomEvent('property-change', { detail: { path: ['orientation'], value: 'landscape', targets: [{ kind: 'page', id: 'p' }], merge: 'orientation' }, bubbles: true }))
    panel.dispatchEvent(new CustomEvent('property-commit', { bubbles: true }))
    await settle()
    expect(designer.schema.pages[0]!.orientation).toBe('landscape')
    designer.undo()
    expect(designer.schema.pages[0]!.orientation).toBe('portrait')
  })

  it('只读时照常打开、字段只读；预览态不可用', async () => {
    designer.readonly = true
    await settle()
    button().click()
    await settle()
    expect(document.querySelector<SetupPanel>('[data-part="page-setup"]')!.readonly).toBe(true)
    designer.readonly = false
    designer.mode = 'preview'
    await settle()
    expect(button().disabled).toBe(true)
  })
})

describe('格式工具条', () => {
  function bar(): HTMLElement | null {
    return designer.querySelector<HTMLElement>('xh-designer-transform [slot="toolbar"]')
  }

  function button(value: string): HTMLButtonElement {
    return bar()!.querySelector<HTMLButtonElement>(`button[value="${value}"]`)!
  }

  function style(): Record<string, unknown> {
    return (designer.schema.pages[0]!.elements.find(element => element.id === 'a') as unknown as { style: Record<string, unknown> }).style
  }

  it('选中文字类元素时放进变换覆盖层：字号，粗体、斜体、下划线、删除线，左中右对齐；选中别的或没有选中时拿掉', async () => {
    expect(bar()).toBeNull()
    designer.select({ elements: ['a'] })
    await settle()
    const groups = Array.from(bar()!.querySelectorAll('[data-xh-part="group"]'), group => Array.from(group.querySelectorAll('button'), item => item.value))
    expect(groups).toEqual([['font-size'], ['text-bold', 'text-italic', 'text-underline', 'text-line-through'], ['text-align-left', 'text-align-center', 'text-align-right']])
    expect(bar()!.querySelector('[data-xh-part="root"]')!.getAttribute('aria-label')).toBe('Text format')
    expect([button('text-bold').getAttribute('aria-label'), button('text-align-center').getAttribute('aria-label')]).toEqual(['Bold', 'Center text'])
    const rect = designer.addElement('rect', { x: 120, y: 120 })
    designer.select({ elements: [rect.id] })
    await settle()
    expect(bar()).toBeNull()
  })

  it('开关与对齐写进文字样式，全都是这样时按下；点了记一步撤销', async () => {
    designer.select({ elements: ['a'] })
    await settle()
    button('text-bold').click()
    await settle()
    expect([style().bold, button('text-bold').getAttribute('aria-pressed')]).toEqual([true, 'true'])
    button('text-align-center').click()
    await settle()
    expect([style().align, button('text-align-center').getAttribute('aria-pressed'), button('text-align-left').getAttribute('aria-pressed')]).toEqual(['center', 'true', 'false'])
    designer.undo()
    designer.undo()
    expect([style().bold, style().align]).toEqual([false, 'left'])
  })

  it('字号是菜单命令：按钮上写当前字号，名字是「字号：当前字号」；列出常用字号，当前的打勾，选中一项写进去', async () => {
    designer.select({ elements: ['a'] })
    await settle()
    const size = String(style().fontSize)
    expect([button('font-size').querySelector('[data-part="label"]')!.textContent, button('font-size').getAttribute('aria-label')]).toEqual([size, `Font size: ${size}`])
    button('font-size').click()
    await settle()
    const menu = document.querySelector(`[role="menu"][aria-label="Font size: ${size}"]`)!
    const current = menu.querySelector('[role="menuitemradio"][aria-checked="true"]')
    expect(current?.textContent?.trim()).toBe(String(style().fontSize))
    Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(item => item.textContent?.trim() === '14')!.click()
    await settle()
    expect(style().fontSize).toBe(14)
  })

  it('只读时拿掉；在画布上按 Alt+F10 把焦点交给工具条', async () => {
    designer.select({ elements: ['a'] })
    await settle()
    const viewport = designer.querySelector<HTMLElement>('[data-part="viewport"]')!
    viewport.focus()
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }))
    expect(bar()!.contains(document.activeElement)).toBe(true)
    designer.readonly = true
    await settle()
    expect(bar()).toBeNull()
  })
})

describe('对齐与层级菜单', () => {
  it('工具栏上「对齐与分布」「层级」是菜单，条目就是对应的内置命令；没选中时不可用，选中后执行条目', async () => {
    const button = (value: string): HTMLButtonElement => designer.querySelector<HTMLButtonElement>(`[data-part="command-bar"] button[value="${value}"]`)!
    expect([button('align-menu').disabled, button('layer-menu').disabled]).toEqual([true, true])
    expect(designer.querySelector('[data-part="command-bar"] button[value="align-left"]')).toBeNull()
    const rect = designer.addElement('rect', { x: 120, y: 120 })
    designer.select({ elements: ['a', rect.id] })
    await settle()
    expect([button('align-menu').disabled, button('layer-menu').disabled]).toEqual([false, false])
    button('align-menu').click()
    await settle()
    const menu = document.querySelector('[role="menu"][aria-label="Align and distribute"]')!
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map(item => item.textContent?.trim())).toEqual(['Align left', 'Align centers horizontally', 'Align right', 'Align top', 'Align centers vertically', 'Align bottom', 'Distribute horizontally', 'Distribute vertically'])
    items[0]!.click()
    await settle()
    const left = designer.schema.pages[0]!.elements.filter(element => element.id === 'a' || element.id === rect.id).map(element => element.x)
    expect(new Set(left).size).toBe(1)
  })
})

describe('短文字', () => {
  it('翻页条、顶栏与格式工具条上看得见的短文字都在按钮的名字里：不报 designer-commands 告警', async () => {
    const seen: DiagnosticRecord[] = []
    resetDiagnostics()
    setDiagnosticsConsoleOutput(false)
    setDiagnosticsLevel('warn')
    setDiagnosticsDedupe(false)
    const off = onDiagnostic(record => void seen.push(record))
    try {
      designer.schema = createDocument({ pages: [sample().pages[0]!, createPage({ id: 'q', name: '明细页' })] })
      await settle()
      designer.select({ elements: ['a'] })
      await settle()
      expect(designer.querySelector('[data-xh-part="item"][value="font-size"]')).not.toBeNull()
      expect(seen.filter(record => record.scope === 'designer-commands').map(record => record.detail)).toEqual([])
    }
    finally {
      off()
      resetDiagnostics()
    }
  })
})
