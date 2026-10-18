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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { definePrintDesigner, PRINT_CLIENT_DOWNLOAD_URL, PRINT_CLIENT_SETTINGS_SECTION, PRINT_SETTING_KEYS, PRINT_SETTINGS_SECTION } from '../src'

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
  return designer.querySelector<HTMLButtonElement>(`[data-part="command-bar"] button[value="${value}"]`)!
}

describe('设置', () => {
  it('openSettings 打开设置对话框：基础在前、打印在后，打印分区列出网格、吸附与边距线；没给 printClient 时没有打印方式', async () => {
    const designer = await mount()
    designer.openSettings(PRINT_SETTINGS_SECTION)
    await settle(designer)
    expect(pages()).toEqual(['general', 'print'])
    expect(Object.values(PRINT_SETTING_KEYS).map(key => row(key) !== null)).toEqual([false, true, true, true, true])
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

  it('工具栏显示方式取设置里的 general.toolbarDisplay，缺省只显示图标；换方式不重铺按钮，翻页条始终只显示图标', async () => {
    const designer = await mount()
    const shell = (): Element => designer.querySelector('[data-part="command-bar"] > xh-tooltip')!
    const strip = (): Element => designer.querySelector('[slot="canvas-end"]')!
    const undo = toolbarButton(designer, 'undo')
    expect([shell().getAttribute('data-display'), strip().getAttribute('data-display')]).toEqual(['icon', 'icon'])
    designer.settings = { 'general.toolbarDisplay': 'both' }
    await settle(designer)
    expect(shell().getAttribute('data-display')).toBe('both')
    designer.settings = { 'general.toolbarDisplay': 'text' }
    await settle(designer)
    expect([shell().getAttribute('data-display'), strip().getAttribute('data-display'), toolbarButton(designer, 'undo')]).toEqual(['text', 'icon', undo])
    designer.openSettings()
    await settle(designer)
    expect(row('general.toolbarDisplay')).not.toBeNull()
  })

  it('扩展登记的设置分区放进对话框；分区 id 与 print、printClient、general 或彼此重名时赋值即抛错', async () => {
    const section = { id: 'acme', label: 'Acme', order: 200, items: [{ path: ['token'], label: 'Token', control: { kind: 'text' as const, secret: true } }] }
    const designer = await mount(element => (element.extensions = [{ id: 'acme', settings: [section] }]))
    designer.openSettings('acme')
    await settle(designer)
    expect(pages()).toEqual(['general', 'print', 'acme'])
    expect(row('acme.token')!.querySelector('xh-password-input')).not.toBeNull()
    const before = designer.extensions
    for (const id of ['print', PRINT_CLIENT_SETTINGS_SECTION, 'general']) {
      const assign = (): unknown => (designer.extensions = [{ id: 'acme', settings: [{ ...section, id }] }])
      expect(assign).toThrow(DesignerExtensionError)
    }
    expect(designer.extensions).toBe(before)
  })
})

/** 一个假的打印客户端：connect 按给的结果连上或抛错，连上时派发 state；printSheets 只记次数。 */
function fakeClient(connect: () => Promise<void> = async () => {}): { readonly client: NonNullable<XhPrintDesigner['printClient']>, readonly printed: () => number } {
  const listeners = new Set<(state: string) => void>()
  let printed = 0
  const fake = {
    state: 'idle' as string,
    on: (type: string, listener: (state: string) => void) => {
      if (type === 'state')
        listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    connect: async () => {
      await connect()
      fake.state = 'open'
      for (const listener of listeners)
        listener('open')
      return {}
    },
    printSheets: (result: { readonly sheets: readonly unknown[] }) => {
      printed++
      return { id: 'j', status: undefined, done: Promise.resolve({ jobId: 'j', state: 'completed' as const, sheets: result.sheets.length }), onStatus: () => () => undefined, cancel: async () => false }
    },
  }
  return { client: fake as unknown as NonNullable<XhPrintDesigner['printClient']>, printed: () => printed }
}

describe('本地客户端', () => {
  function status(): { state: string, download: boolean, href: string | null } {
    const item = row('printClient.status')!
    const download = item.querySelector<HTMLElement>('[data-part="client-download"]')!
    return { state: item.querySelector('[data-part="client-state"]')!.textContent!.trim(), download: !download.hidden, href: download.querySelector('a')!.getAttribute('href') }
  }

  function test(): void {
    row('printClient.status')!.querySelector<HTMLButtonElement>('[data-part="client-test"] button')!.click()
  }

  it('给了 printClient：打印分区第一条是打印方式，缺省本地客户端；多出「本地客户端」一页，写未连接与下载链接', async () => {
    const { client } = fakeClient()
    const designer = await mount(element => (element.printClient = client))
    designer.openSettings(PRINT_CLIENT_SETTINGS_SECTION)
    await settle(designer)
    expect(pages()).toEqual(['general', 'print', 'printClient'])
    const via = row(PRINT_SETTING_KEYS.via)!
    expect([via.parentElement!.firstElementChild === via, via.querySelector('[aria-pressed="true"], [aria-checked="true"], [data-state="on"]')?.textContent?.trim()]).toEqual([true, 'Local client'])
    expect(status()).toEqual({ state: 'Not connected', download: true, href: PRINT_CLIENT_DOWNLOAD_URL })
    designer.clientDownloadUrl = 'https://intranet.example/print-client'
    await settle(designer)
    designer.openSettings(PRINT_CLIENT_SETTINGS_SECTION)
    await settle(designer)
    expect(status().href).toBe('https://intranet.example/print-client')
  })

  it('测试连接：连上了写已连接、收起下载链接；没找到客户端（CLIENT_UNAVAILABLE）写未安装，别的错误写未连接', async () => {
    let failure: { code: string } | undefined = { code: 'CLIENT_UNAVAILABLE' }
    const { client } = fakeClient(async () => {
      if (failure !== undefined)
        throw Object.assign(new Error(failure.code), failure)
    })
    const designer = await mount(element => (element.printClient = client))
    designer.openSettings(PRINT_CLIENT_SETTINGS_SECTION)
    await settle(designer)
    test()
    await vi.waitFor(() => expect(status().state).toBe('Not installed'))
    expect(status().download).toBe(true)
    failure = { code: 'CONSENT_DENIED' }
    test()
    await vi.waitFor(() => expect(status().state).toBe('Not connected'))
    failure = undefined
    test()
    await vi.waitFor(() => expect(status().state).toBe('Connected'))
    expect(status().download).toBe(false)
  })

  it('换掉 printClient：连接状态改订新的，旧的退订；设计器断开时也退订', async () => {
    const counted = (): { readonly client: NonNullable<XhPrintDesigner['printClient']>, readonly listeners: () => number } => {
      const listeners = new Set<() => void>()
      const fake = {
        state: 'idle',
        on: (_type: string, listener: () => void) => {
          listeners.add(listener)
          return () => void listeners.delete(listener)
        },
      }
      return { client: fake as unknown as NonNullable<XhPrintDesigner['printClient']>, listeners: () => listeners.size }
    }
    const first = counted()
    const designer = await mount(element => (element.printClient = first.client))
    designer.openSettings(PRINT_CLIENT_SETTINGS_SECTION)
    await settle(designer)
    // 状态栏一份、设置对话框的连接状态一份
    expect(first.listeners()).toBe(2)
    const second = counted()
    designer.printClient = second.client
    await settle(designer)
    expect([first.listeners(), second.listeners()]).toEqual([0, 2])
    designer.remove()
    expect(second.listeners()).toBe(0)
  })

  it('打印方式选浏览器：print() 不交给客户端，走浏览器的打印对话框', async () => {
    const observer = new MutationObserver((records) => {
      for (const node of records.flatMap(record => Array.from(record.addedNodes))) {
        if (node instanceof HTMLIFrameElement) {
          node.addEventListener('load', () => {
            const win = node.contentWindow!
            win.print = () => void win.dispatchEvent(new Event('afterprint'))
          })
        }
      }
    })
    observer.observe(document.body, { childList: true })
    try {
      const { client, printed } = fakeClient()
      const designer = await mount((element) => {
        element.printClient = client
        element.settings = { [PRINT_SETTING_KEYS.via]: 'browser' }
      })
      expect((await designer.print()).via).toBe('browser')
      designer.settings = {}
      await settle(designer)
      expect((await designer.print()).via).toBe('client')
      expect(printed()).toBe(1)
    }
    finally {
      observer.disconnect()
    }
  })
})
