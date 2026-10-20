/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { XhDesignerFrameElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
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

/** 菜单栏的 <xh-menubar>：按数据铺的菜单与勾选。 */
type MenubarHost = HTMLElement & { collection?: { value: string, label?: string, items?: { value: string, children?: { value: string }[] }[] }[], checkboxValue?: string[] }

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

function regions(): string[] {
  return frame().regions!.map(region => region.name)
}

describe('菜单栏', () => {
  it('外框最上一条：文件、编辑、视图、帮助四张菜单；保存与设置在文件里，设计与预览、缩放、拖动、面板与显示开关在视图里，引导、帮助、快捷键与关于在帮助里', () => {
    expect(regions()[0]).toBe('menubar')
    expect(menubar().closest('[data-part="region"]')!.getAttribute('data-region')).toBe('menubar')
    expect(menubar().collection!.map(node => [node.value, node.label])).toEqual([['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['help', 'Help']])
    expect(items('file')).toEqual(['save', 'settings'])
    expect(items('edit')).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'duplicate', 'select-all', 'edit-json'])
    expect(items('view')).toEqual(['design', 'preview', 'zoom-in', 'zoom-out', 'zoom-to-fit', 'zoom-to-actual', 'pan-tool', 'panels', 'show-toolbar', 'show-status-bar', 'show-menubar'])
    expect(items('help')).toEqual(['start-tour', 'help', 'shortcuts', 'about'])
    expect(menubar().checkboxValue).toEqual(['view/design', 'view/show-toolbar', 'view/show-status-bar', 'view/show-menubar'])
  })

  it('选「视图 → 预览」切到预览态，预览态外框照样登记菜单栏，从「视图 → 设计」切回', async () => {
    choose('view', 'preview')
    await settle()
    expect([designer.mode, regions()]).toEqual(['preview', ['menubar', 'toolbar', 'canvas']])
    choose('view', 'design')
    await settle()
    expect(designer.mode).toBe('design')
  })

  it('显示开关改设置并派发 settings-change：关掉状态栏外框不登记它，关掉菜单栏外框也不登记菜单栏', async () => {
    const changes: [string, unknown][] = []
    designer.addEventListener('settings-change', event => changes.push([(event as CustomEvent<{ key: string }>).detail.key, (event as CustomEvent<{ value: unknown }>).detail.value]))
    choose('view', 'show-status-bar')
    await settle()
    expect([changes, regions().includes('status')]).toEqual([[['general.statusBar', false]], false])
    choose('view', 'show-menubar')
    await settle()
    expect([changes.at(-1), regions().includes('menubar'), menubar().closest('[data-part="parked"]') !== null]).toEqual([['toolbar.menubar', false], false, true])
    designer.mode = 'preview'
    await settle()
    expect(regions()).toEqual(['toolbar', 'canvas'])
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
    expect(items('file')).toEqual(['save', '@acme/host.back', 'settings'])
    designer.commandLayout = { 'menubar:file': [['settings'], ['@acme/host.back']], 'menubar:help': [] }
    await settle()
    expect(items('file')).toEqual(['settings', '@acme/host.back'])
    expect(menubar().collection!.map(node => node.value)).toEqual(['file', 'edit', 'view'])
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
