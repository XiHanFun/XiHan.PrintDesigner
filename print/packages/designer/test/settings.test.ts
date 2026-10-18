/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { XhDesignerTransformElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { PrintDesignerContext, PrintDesignerExtension, XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { definePrintDesigner, PRINT_SETTING_KEYS, PRINT_SETTINGS_SECTION } from '../src'

const registry = createElementRegistry()

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [
    registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } }),
    registry.createElement('text', { id: 'b', x: 80, y: 30, overrides: { width: 40, height: 10 } }),
  ]
  return createDocument({ pages: [page] })
}

const mounted: XhPrintDesigner[] = []

async function mount(prepare?: (designer: XhPrintDesigner) => void): Promise<XhPrintDesigner> {
  definePrintDesigner()
  const designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  prepare?.(designer)
  document.body.append(designer)
  designer.schema = sample()
  mounted.push(designer)
  await settle(designer)
  return designer
}

afterEach(() => {
  for (const designer of mounted.splice(0))
    designer.remove()
  localStorage.clear()
})

async function settle(designer: XhPrintDesigner): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await designer.updateComplete
    await designer.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>('xh-designer-settings')!.updateComplete
    await Promise.resolve()
  }
}

function row(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-setting="${key}"]`)
}

function pages(): string[] {
  return Array.from(document.querySelectorAll('xh-tabs [data-xh-part="list"] > button'), button => button.getAttribute('value')!)
}

function toggle(key: string, checked: boolean): void {
  row(key)!.querySelector('xh-switch')!.dispatchEvent(new CustomEvent('checked-change', { detail: { checked }, bubbles: true }))
}

function toolbarButton(designer: XhPrintDesigner, value: string): HTMLButtonElement {
  return designer.querySelector<HTMLButtonElement>(`[data-part="toolbar"] button[value="${value}"]`)!
}

describe('设置', () => {
  it('openSettings 打开设置对话框：基础在前、画布在后，画布分区列出网格、吸附与边距线', async () => {
    const designer = await mount()
    designer.openSettings(PRINT_SETTINGS_SECTION)
    await settle(designer)
    expect(pages()).toEqual(['general', 'print'])
    expect(Object.values(PRINT_SETTING_KEYS).map(key => row(key) !== null)).toEqual([true, true, true, true])
    expect(row('general.theme')).not.toBeNull()
    expect([PRINT_SETTINGS_SECTION, Object.values(PRINT_SETTING_KEYS).every(key => key.startsWith(`${PRINT_SETTINGS_SECTION}.`))]).toEqual(['print', true])
  })

  it('settingsPolicy 隐藏条目或整个分区，锁定的只读', async () => {
    const designer = await mount((element) => {
      element.settingsPolicy = { 'general': 'hidden', 'print.snap': 'locked' }
    })
    designer.openSettings()
    await settle(designer)
    expect(pages()).toEqual(['print'])
    expect(row('print.snap')!.querySelector('xh-field')!.hasAttribute('read-only')).toBe(true)
  })

  it('在对话框里关掉边距线：settings 换成新的一份、派发 settings-change，边距线收起；赋回 settings 显示', async () => {
    const designer = await mount()
    designer.openSettings()
    await settle(designer)
    const margins = (): boolean => designer.querySelector('[data-part="margins"]') !== null
    expect(margins()).toBe(true)
    const changes: unknown[] = []
    designer.addEventListener('settings-change', event => changes.push((event as CustomEvent).detail))
    toggle(PRINT_SETTING_KEYS.showMargins, false)
    await settle(designer)
    expect(changes).toEqual([{ key: 'print.showMargins', value: false, settings: { 'print.showMargins': false } }])
    expect([designer.settings, margins()]).toEqual([{ 'print.showMargins': false }, false])
    designer.settings = {}
    await settle(designer)
    expect(margins()).toBe(true)
  })

  it('工具栏的网格、吸附开关改的是设置：网格开了画出网格线，派发 settings-change', async () => {
    const designer = await mount()
    const grid = (): HTMLElement => designer.querySelector<HTMLElement>('[data-part="grid"]')!
    const changes: string[] = []
    designer.addEventListener('settings-change', event => changes.push((event as CustomEvent<{ key: string }>).detail.key))
    expect([grid().hidden, toolbarButton(designer, 'grid').getAttribute('aria-pressed')]).toEqual([true, 'false'])
    toolbarButton(designer, 'grid').click()
    await settle(designer)
    expect([grid().hidden, toolbarButton(designer, 'grid').getAttribute('aria-pressed'), designer.settings]).toEqual([false, 'true', { 'print.showGrid': true }])
    expect(grid().style.getPropertyValue('--xh-print-designer-grid')).toMatch(/mm$/)
    toolbarButton(designer, 'snap').click()
    await settle(designer)
    expect([toolbarButton(designer, 'snap').getAttribute('aria-pressed'), designer.settings]).toEqual(['false', { 'print.showGrid': true, 'print.snap': false }])
    expect(changes).toEqual(['print.showGrid', 'print.snap'])
  })

  it('网格间距：新建元素与吸附按它对齐；写 0 不吸附网格；关掉吸附对齐后只吸网格', async () => {
    const designer = await mount(element => (element.settings = { [PRINT_SETTING_KEYS.gridSize]: 5 }))
    const added = designer.addElement('rect', { x: 52, y: 52 })
    expect([added.x % 5, added.y % 5]).toEqual([0, 0])
    const overlay = designer.querySelector<XhDesignerTransformElement>('xh-designer-transform')!
    expect(overlay.getSnap!('move')).toMatchObject({ grid: 5 })
    expect(overlay.getSnap!('move')!.targets.length).toBeGreaterThan(0)
    designer.settings = { [PRINT_SETTING_KEYS.gridSize]: 0, [PRINT_SETTING_KEYS.snap]: false }
    await settle(designer)
    expect(overlay.getSnap!('move')).toBeUndefined()
    designer.settings = { [PRINT_SETTING_KEYS.snap]: false }
    await settle(designer)
    expect(overlay.getSnap!('move')).toEqual({ targets: [], grid: 1 })
  })

  it('命令与扩展从上下文的 settings 读到缺省值与写了的值', async () => {
    const seen: PrintDesignerContext['settings'][] = []
    const probe: PrintDesignerExtension = { id: 'probe', commands: [{ id: 'probe.read', label: 'Read', placement: ['toolbar'], run: context => void seen.push(context.settings) }] }
    const designer = await mount((element) => {
      element.extensions = [probe]
      element.settings = { [PRINT_SETTING_KEYS.gridSize]: 2 }
    })
    toolbarButton(designer, 'probe.read').click()
    expect(seen[0]).toMatchObject({ 'print.showGrid': false, 'print.gridSize': 2, 'print.snap': true, 'print.showMargins': true })
  })

  it('主题与主题色落在设计器元素上：亮暗写 data-theme，预设主题色写 data-brand，跟随页面时去掉', async () => {
    const designer = await mount((element) => {
      element.brands = [{ value: 'green', color: '#16a34a' }]
      element.settings = { 'general.theme': 'dark' }
    })
    expect(designer.getAttribute('data-theme')).toBe('dark')
    designer.settings = { 'general.brand': 'green' }
    await designer.updateComplete
    expect([designer.getAttribute('data-theme'), designer.getAttribute('data-brand')]).toEqual(['light', 'green'])
    designer.settings = {}
    await designer.updateComplete
    expect([designer.hasAttribute('data-theme'), designer.hasAttribute('data-brand')]).toEqual([false, false])
  })

  it('给了 settingsStorageKey：没赋 settings 时从存储读，对话框里改了就写回；读出的不是对象时派发 settings-storage-error', async () => {
    localStorage.setItem('print-settings', JSON.stringify({ 'print.snap': false }))
    const designer = await mount(element => (element.settingsStorageKey = 'print-settings'))
    expect(designer.settings).toEqual({ 'print.snap': false })
    designer.openSettings()
    await settle(designer)
    toggle(PRINT_SETTING_KEYS.showGrid, true)
    expect(JSON.parse(localStorage.getItem('print-settings')!)).toEqual({ 'print.snap': false, 'print.showGrid': true })

    localStorage.setItem('broken', '[1]')
    const errors: unknown[] = []
    await mount((element) => {
      element.addEventListener('settings-storage-error', event => errors.push((event as CustomEvent).detail))
      element.settingsStorageKey = 'broken'
    })
    expect(errors).toEqual([expect.objectContaining({ operation: 'read', key: 'broken' })])
  })

  it('扩展登记的设置分区放进对话框；分区 id 与 print、general 或彼此重名时赋值即抛错', async () => {
    const section = { id: 'acme', label: 'Acme', order: 200, items: [{ path: ['token'], label: 'Token', control: { kind: 'text' as const, secret: true } }] }
    const designer = await mount(element => (element.extensions = [{ id: 'acme', settings: [section] }]))
    designer.openSettings('acme')
    await settle(designer)
    expect(pages()).toEqual(['general', 'print', 'acme'])
    expect(row('acme.token')!.querySelector('xh-password-input')).not.toBeNull()
    const before = designer.extensions
    for (const id of ['print', 'general']) {
      const assign = (): unknown => (designer.extensions = [{ id: 'acme', settings: [{ ...section, id }] }])
      expect(assign).toThrow(DesignerExtensionError)
    }
    expect(designer.extensions).toBe(before)
  })
})
