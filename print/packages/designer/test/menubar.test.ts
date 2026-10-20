/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { ExtensionElementPrototype, PrintDocument } from '@xihan-print/core'
import type { IconRecord } from '@xihan-ui/core'
import type { XhDesignerFrameElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage, getPaperSize, layoutProperties } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

/** 菜单栏里的一条：命令或子菜单。 */
interface MenubarItem {
  value: string
  label?: string
  icon?: IconRecord
  disabled?: boolean
  separatorBefore?: boolean
  tone?: string
  children?: MenubarItem[]
  checkboxValue?: string[]
  radioValue?: Record<string, string>
}

/** 菜单栏的 <xh-menubar>：按数据铺的菜单与勾选。 */
type MenubarHost = HTMLElement & { collection?: { value: string, label?: string, items?: MenubarItem[] }[], checkboxValue?: string[] }

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  designer.autoTour = false
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

function menubar(): MenubarHost {
  return designer.querySelector<MenubarHost>('xh-menubar')!
}

/** 一张菜单里的命令 id。 */
function items(menu: string): string[] {
  return menubar().collection!.find(node => node.value === menu)!.items!.map(item => item.value.slice(menu.length + 1))
}

/** 在菜单栏上选中一条：值是「菜单 id/命令 id」。 */
function choose(menu: string, id: string): void {
  menubar().dispatchEvent(new CustomEvent('item-select', { detail: { menu, value: `${menu}/${id}` } }))
}

/** 一张菜单里的一条。 */
function item(menu: string, id: string): MenubarItem {
  return menubar().collection!.find(node => node.value === menu)!.items!.find(entry => entry.value === `${menu}/${id}`)!
}

/** 子菜单里各条的值，去掉「菜单 id/命令 id/item:」前缀。 */
function children(menu: string, id: string): string[] {
  const prefix = `${menu}/${id}/item:`
  return item(menu, id).children!.map(child => child.value.slice(prefix.length))
}

function regions(): string[] {
  return frame().regions!.map(region => region.name)
}

describe('菜单栏', () => {
  it('外框最上一条：文件、编辑、视图、插入、页面、帮助六张菜单；保存、导入字段、打印与设置在文件里，设计与预览、缩放、拖动、网格与吸附、面板与外观在视图里（外观子菜单是工具栏与状态栏两条显示开关），引导、帮助、快捷键与关于在帮助里', () => {
    expect(regions()[0]).toBe('menubar')
    expect(menubar().closest('[data-part="region"]')!.getAttribute('data-region')).toBe('menubar')
    expect(menubar().collection!.map(node => [node.value, node.label])).toEqual([['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['insert', 'Insert'], ['page', 'Page'], ['help', 'Help']])
    expect(items('file')).toEqual(['save', 'import-fields', 'print', 'settings'])
    expect(items('edit')).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'duplicate', 'select-all', 'edit-json'])
    expect(items('view')).toEqual(['design', 'preview', 'zoom-in', 'zoom-out', 'zoom-to-fit', 'zoom-to-actual', 'pan-tool', 'grid', 'snap', 'panels', 'appearance'])
    expect([item('view', 'grid').separatorBefore, item('view', 'panels').separatorBefore]).toEqual([true, true])
    expect(items('help')).toEqual(['start-tour', 'help', 'shortcuts', 'about'])
    expect(menubar().checkboxValue).toEqual(['view/design', 'view/snap'])
    const appearance = item('view', 'appearance')
    const toggles = ['show-toolbar', 'show-status-bar'].map(id => `view/appearance/command:${id}`)
    expect([appearance.label, appearance.icon?.name, item('view', 'panels').icon?.name]).toEqual(['Appearance', 'eye', 'panel-left'])
    expect([appearance.children!.map(child => child.value), appearance.checkboxValue]).toEqual([toggles, toggles])
  })

  it('选「视图 → 预览」切到预览态，预览态外框照样登记菜单栏，从「视图 → 设计」切回', async () => {
    choose('view', 'preview')
    await settle()
    expect([designer.mode, regions()]).toEqual(['preview', ['menubar', 'toolbar', 'canvas']])
    choose('view', 'design')
    await settle()
    expect(designer.mode).toBe('design')
  })

  it('「视图 → 外观」的显示开关改设置并派发 settings-change：关掉状态栏外框不登记它；菜单栏常开，设置里写 toolbar.menubar 也照样登记', async () => {
    const changes: [string, unknown][] = []
    designer.addEventListener('settings-change', event => changes.push([(event as CustomEvent<{ key: string }>).detail.key, (event as CustomEvent<{ value: unknown }>).detail.value]))
    choose('view', 'appearance/command:show-status-bar')
    await settle()
    expect([changes, regions().includes('status')]).toEqual([[['general.statusBar', false]], false])
    designer.settings = { ...designer.settings, 'toolbar.menubar': false }
    await settle()
    expect([regions()[0], menubar().closest('[data-part="parked"]')]).toEqual(['menubar', null])
    designer.mode = 'preview'
    await settle()
    expect(regions()).toEqual(['menubar', 'toolbar', 'canvas'])
  })

  it('「文件 → 保存」与画布上的 Ctrl / ⌘ + S 都走外壳的 save 命令，各派发一次 save；预览态也能从菜单保存', async () => {
    const saves: string[] = []
    designer.addEventListener('save', () => saves.push(designer.mode))
    choose('file', 'save')
    const viewport = designer.querySelector<HTMLElement>('[data-part="viewport"]')!
    const ctrlS = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    viewport.dispatchEvent(ctrlS)
    expect([saves, ctrlS.defaultPrevented]).toEqual([['design', 'design'], true])
    designer.mode = 'preview'
    await settle()
    choose('file', 'save')
    expect(saves).toEqual(['design', 'design', 'preview'])
  })

  it('「快捷键」「关于」打开设置对话框的那一页，「设置」打开对话框', async () => {
    type SettingsHost = HTMLElement & { open?: boolean, section?: string }
    const dialog = designer.querySelector<SettingsHost>('xh-designer-settings')!
    choose('help', 'shortcuts')
    await settle()
    expect([dialog.open, dialog.section]).toEqual([true, 'shortcuts'])
    choose('help', 'about')
    await settle()
    expect(dialog.section).toBe('about')
    dialog.open = false
    choose('file', 'settings')
    await settle()
    expect(dialog.open).toBe(true)
  })

  it('宿主命令写 placement menubar:file 进文件菜单，自成一组排在设置之前；commandLayout 的 menubar:<菜单> 整份改写，给空数组就不要这张菜单', async () => {
    designer.extensions = [{ id: '@acme/host', commands: [{ id: '@acme/host.back', label: 'Back to list', placement: ['menubar:file'], run: () => {} }] }]
    await settle()
    expect(items('file')).toEqual(['save', 'import-fields', 'print', '@acme/host.back', 'settings'])
    designer.commandLayout = { 'menubar:file': [['settings'], ['@acme/host.back']], 'menubar:help': [] }
    await settle()
    expect(items('file')).toEqual(['settings', '@acme/host.back'])
    expect(menubar().collection!.map(node => node.value)).toEqual(['file', 'edit', 'view', 'insert', 'page'])
  })

  it('宿主写在设计器上的 slot="menubar-end" 放到菜单栏右边一段，后来加的也一样', async () => {
    designer.remove()
    designer = document.createElement('xh-print-designer')
    designer.measurer = measurer
    designer.autoTour = false
    const title = document.createElement('span')
    title.slot = 'menubar-end'
    title.textContent = '送货单'
    designer.append(title)
    document.body.append(designer)
    designer.schema = sample()
    await settle()
    expect([title.parentElement!.getAttribute('data-zone'), title.closest('[data-region]')!.getAttribute('data-region')]).toEqual(['end', 'menubar'])
    const state = document.createElement('span')
    state.slot = 'menubar-end'
    designer.append(state)
    await Promise.resolve()
    await settle()
    expect(state.closest('[data-region]')!.getAttribute('data-region')).toBe('menubar')
  })

  it('画布有焦点时按 F10 把焦点交给菜单栏，再按 F10 回到画布', async () => {
    const viewport = designer.querySelector<HTMLElement>('[data-part="viewport"]')!
    viewport.focus()
    const f10 = (): void => void (document.activeElement ?? viewport).dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true }))
    f10()
    expect(menubar().contains(document.activeElement)).toBe(true)
    f10()
    expect(document.activeElement).toBe(viewport)
  })
})

describe('插入菜单', () => {
  const ELEMENTS = ['text', 'longText', 'richText', 'pageNumber', 'image', 'table', 'line', 'rect', 'ellipse', 'barCode', 'matrixCode']

  it('按物料分组各成一组列出每种元素，文字与图标同物料，最后一组是页眉与页脚；只读与预览态时不可用', async () => {
    expect(items('insert')).toEqual([...ELEMENTS.map(type => `insert:${type}`), 'header-variants', 'footer-variants'])
    expect([item('insert', 'insert:text').label, item('insert', 'insert:text').icon?.name, item('insert', 'insert:matrixCode').label]).toEqual(['Text', 'type', '2D code'])
    expect(['insert:image', 'insert:table', 'insert:line', 'insert:barCode', 'header-variants'].map(id => item('insert', id).separatorBefore)).toEqual([true, true, true, true, true])
    expect([item('insert', 'header-variants').label, item('insert', 'footer-variants').label]).toEqual(['Header', 'Footer'])
    designer.readonly = true
    await settle()
    expect(item('insert', 'insert:rect').disabled).toBe(true)
    designer.readonly = false
    designer.mode = 'preview'
    await settle()
    expect(item('insert', 'insert:rect').disabled).toBe(true)
  })

  it('选一种元素：与点物料一样放在视口中央并选中，记一步撤销；工具栏上没有插入钮', async () => {
    choose('insert', 'insert:rect')
    await settle()
    const added = designer.schema.pages[0]!.elements.at(-1)!
    expect([added.type, designer.getSelection().elements]).toEqual(['rect', [added.id]])
    designer.undo()
    expect(designer.schema.pages[0]!.elements.map(element => element.id)).toEqual(['a'])
    expect(designer.querySelector('[data-part="command-bar"] button[value^="insert:"]')).toBeNull()
  })

  it('页眉、页脚是子菜单：已有的变体单选、当前的打勾，没有的写「新增变体」，不是常规时末尾是删除；选中切过去、新增或删除，只读时新增与删除不可用', async () => {
    expect(children('insert', 'header-variants')).toEqual(['show:default', 'add:first', 'add:last', 'add:odd', 'add:even'])
    const header = item('insert', 'header-variants')
    expect([header.radioValue, header.children![1]!.label, header.children![1]!.separatorBefore]).toEqual([{ 'band-variant': 'insert/header-variants/item:show:default' }, 'Add variant · First page', true])
    choose('insert', 'header-variants/item:add:first')
    await settle()
    expect(designer.schema.pages[0]!.header.first).toBeDefined()
    expect(children('insert', 'header-variants')).toEqual(['show:default', 'show:first', 'add:last', 'add:odd', 'add:even', 'remove'])
    expect([item('insert', 'header-variants').radioValue, item('insert', 'header-variants').children!.at(-1)!.tone]).toEqual([{ 'band-variant': 'insert/header-variants/item:show:first' }, 'danger'])
    choose('insert', 'header-variants/item:show:default')
    await settle()
    expect(item('insert', 'header-variants').radioValue).toEqual({ 'band-variant': 'insert/header-variants/item:show:default' })
    choose('insert', 'header-variants/item:show:first')
    choose('insert', 'header-variants/item:remove')
    await settle()
    expect(designer.schema.pages[0]!.header.first).toBeUndefined()
    designer.readonly = true
    await settle()
    expect(item('insert', 'footer-variants').children!.filter(child => child.disabled).map(child => child.value.slice('insert/footer-variants/item:'.length))).toEqual(['add:first', 'add:last', 'add:odd', 'add:even'])
  })

  it('扩展登记的元素也有插入命令，排在它的物料分组里；扩展自己登记了 insert:<元素类型> 的命令时抛错', async () => {
    const stamp: ExtensionElementPrototype = {
      type: 'stamp',
      category: 'acme',
      order: 1,
      flow: false,
      minSize: { width: 5, height: 5 },
      defaults: { type: 'stamp', width: 30, height: 30 },
      properties: layoutProperties({ rotation: false }),
      layout: () => ({}),
    }
    designer.extensions = [{ id: '@acme/stamp', elements: [stamp], renderers: { stamp: (_box, { document }) => document.createElement('span') }, palette: { stamp: { label: 'Stamp' } }, categories: { acme: 'Acme' } }]
    await settle()
    expect(items('insert').slice(-3)).toEqual(['insert:stamp', 'header-variants', 'footer-variants'])
    expect([item('insert', 'insert:stamp').label, item('insert', 'insert:stamp').separatorBefore]).toEqual(['Stamp', true])
    expect(() => (designer.extensions = [{ id: '@acme/own', commands: [{ id: 'insert:text', label: 'Text', run: () => {} }] }])).toThrow(DesignerExtensionError)
  })
})

describe('页面菜单', () => {
  it('纸张、方向与页面设置，翻页，增删复制页面，上移下移；纸张与方向是单选子菜单，当前的打勾', () => {
    expect(items('page')).toEqual(['page-paper', 'page-orientation', 'page-properties', 'previous-page', 'next-page', 'add-page', 'duplicate-page', 'remove-page', 'move-page-up', 'move-page-down'])
    expect([item('page', 'page-paper').label, item('page', 'page-orientation').label, item('page', 'page-properties').label]).toEqual(['Paper', 'Orientation', 'Page settings'])
    expect(children('page', 'page-paper')).toEqual(['A3', 'A4', 'A5', 'A6', 'B4', 'B5', 'Letter', 'Legal'])
    expect(item('page', 'page-paper').radioValue).toEqual({ paper: 'page/page-paper/item:A4' })
    expect([children('page', 'page-orientation'), item('page', 'page-orientation').children!.map(child => child.label)]).toEqual([['portrait', 'landscape'], ['Portrait', 'Landscape']])
    expect(item('page', 'page-orientation').radioValue).toEqual({ orientation: 'page/page-orientation/item:portrait' })
  })

  it('选纸张或方向写进当前页面模板，各记一步撤销；只读时子菜单不可用', async () => {
    choose('page', 'page-paper/item:A5')
    await settle()
    expect([designer.schema.pages[0]!.paper, item('page', 'page-paper').radioValue]).toEqual([{ preset: 'A5', width: 148, height: 210 }, { paper: 'page/page-paper/item:A5' }])
    choose('page', 'page-orientation/item:landscape')
    await settle()
    expect(getPaperSize(designer.schema.pages[0]!)).toEqual({ width: 210, height: 148 })
    designer.undo()
    expect(designer.schema.pages[0]!.orientation).toBe('portrait')
    designer.undo()
    expect(designer.schema.pages[0]!.paper.preset).toBe('A4')
    designer.readonly = true
    await settle()
    expect([item('page', 'page-paper').disabled, item('page', 'page-orientation').disabled, item('page', 'page-properties').disabled]).toEqual([true, true, undefined])
  })

  it('「页面设置」取消选择，在属性面板里编辑当前页面模板；属性面板藏着时把它显示出来，宿主藏掉属性面板时不可用', async () => {
    designer.select({ elements: ['a'] })
    frame().setPanelVisible('properties', false)
    await settle()
    choose('page', 'page-properties')
    await settle()
    const panel = designer.querySelector<HTMLElement & { targets?: readonly { kind: string }[] }>('xh-designer-properties[data-part="properties"]')!
    expect([designer.getSelection().elements, frame().showsPanel('properties'), panel.targets!.map(target => target.kind)]).toEqual([[], true, ['page']])
    designer.settingsPolicy = { 'layout.panels.properties': 'hidden' }
    await settle()
    expect(item('page', 'page-properties').disabled).toBe(true)
  })
})
