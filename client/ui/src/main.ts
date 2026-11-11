/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 主窗口：概览、打印机与自检页、网站名单、设置、诊断与关于；扩展登记的页面追加在页签末尾。

import type { CheckedElement, ValueElement } from './shared'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { button, byId, describe, element, nativeButton, setup } from './shared'

interface ExtensionPage {
  readonly id: string
  readonly title: string
  readonly url: string
}

interface Overview {
  readonly version: string
  readonly os: string
  readonly arch: string
  readonly renderer: string | null
  readonly rendererProblem: string | null
  readonly port: number | null
  readonly listening: readonly string[]
  readonly protocol: string
  readonly problems: readonly string[]
  readonly settingsDirectory: string
  readonly logDirectory: string
  readonly policyFile: string
  readonly policyFileExists: boolean
  readonly autostart: boolean
  readonly checkForUpdates: boolean
  readonly updatesAllowed: boolean
  readonly logLevel: string
  readonly pages: readonly ExtensionPage[]
  readonly update: string | null
}

interface Printer {
  readonly name: string
  readonly isDefault: boolean
  readonly status: string
  readonly location?: string
  readonly driver?: string
}

interface OriginItem {
  readonly origin: string
  readonly fromPolicy: boolean
}

interface Origins {
  readonly allowed: readonly OriginItem[]
  readonly denied: readonly OriginItem[]
}

interface CheckOutcome {
  readonly version: string | null
  readonly unreachable: boolean
}

const STATUS_NAMES: Readonly<Record<string, string>> = {
  ready: '就绪',
  paused: '暂停',
  offline: '脱机',
  error: '出错',
  paperOut: '缺纸',
  paperJam: '卡纸',
  busy: '忙',
  unknown: '状态不明',
}

setup()

const tabs = byId('tabs')

/** 描述列表里加一行。 */
function describeRow(list: HTMLElement, label: string, value: string): void {
  const item = element('div')
  item.dataset.xhPart = 'item'
  const term = element('dt', label)
  term.dataset.xhPart = 'label'
  const detail = element('dd', value)
  detail.dataset.xhPart = 'value'
  item.append(term, detail)
  list.append(item)
}

/** 一条提示：UI 的 alert 结构。 */
function alert(tone: 'warning' | 'info', title: string, action?: HTMLElement): HTMLElement {
  const host = document.createElement('xh-alert')
  host.setAttribute('tone', tone)
  const root = element('div')
  root.dataset.xhPart = 'root'
  const content = element('div')
  content.dataset.xhPart = 'content'
  const heading = element('div', title)
  heading.dataset.xhPart = 'title'
  content.append(heading)
  root.append(content)
  if (action !== undefined) {
    action.dataset.xhPart = 'action'
    root.append(action)
  }
  host.append(root)
  return host
}

async function renderOverview(): Promise<Overview> {
  const overview = await invoke<Overview>('overview')
  byId('problems').replaceChildren(...overview.problems.map(problem => alert('warning', problem)))
  byId('update-banner').replaceChildren(...(overview.update === null ? [] : [alert('info', `发现新版本 ${overview.update}`, button('查看', () => void invoke('open_update_window').catch(() => {}), 'link'))]))
  const list = byId('overview')
  list.replaceChildren()
  describeRow(list, '版本', overview.version)
  describeRow(list, '系统', `${overview.os} ${overview.arch}`)
  describeRow(list, '渲染', overview.renderer ?? `${overview.rendererProblem ?? '不可用'}，HTML 打印与导出 PDF 不可用`)
  describeRow(list, '监听', overview.listening.length > 0 ? overview.listening.join('、') : '没有可用端口，未在监听')
  describeRow(list, '协议', overview.protocol)

  const about = byId('about')
  about.replaceChildren()
  describeRow(about, '产品', `曦寒打印客户端 ${overview.version}`)
  describeRow(about, '设置', overview.settingsDirectory)
  describeRow(about, '日志', overview.logDirectory)
  describeRow(about, '策略', `${overview.policyFile}${overview.policyFileExists ? '' : '（没有这个文件）'}`)
  describeRow(about, '许可', 'MIT')

  const autostart = byId<CheckedElement>('autostart')
  autostart.checked = overview.autostart
  const updates = byId<CheckedElement>('check-updates')
  updates.checked = overview.checkForUpdates
  updates.disabled = !overview.updatesAllowed
  byId('updates-policy').hidden = overview.updatesAllowed
  byId<ValueElement<string[]>>('log-level').value = [overview.logLevel]
  return overview
}

async function renderPrinters(): Promise<void> {
  const state = byId('printers-state')
  const list = byId('printers')
  state.textContent = '正在查打印机…'
  try {
    const printers = await invoke<Printer[]>('printers')
    state.textContent = printers.length === 0 ? '本机没有打印机。' : ''
    list.replaceChildren(...printers.map((printer) => {
      const item = element('li')
      const name = element('span', undefined, 'name')
      name.append(element('strong', printer.isDefault ? `${printer.name}（默认）` : printer.name))
      const detail = [STATUS_NAMES[printer.status] ?? printer.status, printer.driver, printer.location].filter(Boolean).join(' · ')
      name.append(element('span', detail, 'muted'))
      const test = button('测试打印', () => {
        nativeButton(test).disabled = true
        state.textContent = `正在给「${printer.name}」打自检页…`
        invoke<string>('test_print', { printer: printer.name })
          .then((result) => { state.textContent = result })
          .catch((error: unknown) => { state.textContent = describe(error) })
          .finally(() => { nativeButton(test).disabled = false })
      })
      item.append(name, test)
      return item
    }))
  }
  catch (error) {
    state.textContent = describe(error)
  }
}

function originList(items: readonly OriginItem[]): HTMLElement[] {
  if (items.length === 0)
    return [element('li', '（无）', 'muted')]
  return items.map((item) => {
    const row = element('li')
    row.append(element('span', item.fromPolicy ? `${item.origin}（策略）` : item.origin, 'name'))
    if (!item.fromPolicy) {
      const remove = button('删除', () => void invoke('forget_origin', { origin: item.origin }).then(renderOrigins), 'ghost')
      nativeButton(remove).setAttribute('aria-label', `删除 ${item.origin}`)
      row.append(remove)
    }
    return row
  })
}

async function renderOrigins(): Promise<void> {
  const origins = await invoke<Origins>('origins')
  byId('allowed').replaceChildren(...originList(origins.allowed))
  byId('denied').replaceChildren(...originList(origins.denied))
}

async function renderDiagnostics(): Promise<void> {
  byId('report').textContent = await invoke<string>('diagnostics_text')
}

function addExtensionPages(pages: readonly ExtensionPage[]): void {
  const list = byId('tab-list')
  const indicator = list.querySelector('[data-xh-part="indicator"]')
  const root = list.parentElement!
  for (const page of pages) {
    const trigger = element('button', page.title)
    trigger.dataset.xhPart = 'trigger'
    trigger.setAttribute('value', page.id)
    list.insertBefore(trigger, indicator)
    const content = element('section', undefined, 'page')
    content.dataset.xhPart = 'content'
    content.setAttribute('value', page.id)
    const frame = element('iframe', undefined, 'extension')
    frame.title = page.title
    frame.src = page.url
    content.append(frame)
    root.append(content)
  }
}

function navigate(page: string): void {
  if (page === '')
    return
  const trigger = Array.from(byId('tab-list').querySelectorAll<HTMLButtonElement>('[data-xh-part="trigger"]')).find(item => item.getAttribute('value') === page)
  trigger?.click()
}

function wireSettings(): void {
  const state = byId('settings-state')
  const autostart = byId<CheckedElement>('autostart')
  autostart.addEventListener('checked-change', (event) => {
    const { checked } = (event as CustomEvent<{ checked: boolean }>).detail
    invoke<boolean>('set_autostart', { enabled: checked })
      .then((enabled) => { autostart.checked = enabled })
      .catch((error: unknown) => {
        autostart.checked = !checked
        state.textContent = describe(error)
      })
  })
  const updates = byId<CheckedElement>('check-updates')
  updates.addEventListener('checked-change', (event) => {
    const { checked } = (event as CustomEvent<{ checked: boolean }>).detail
    invoke('set_check_for_updates', { enabled: checked })
      .then(() => { updates.checked = checked })
      .catch((error: unknown) => { state.textContent = describe(error) })
  })
  const level = byId<ValueElement<string[]>>('log-level')
  level.addEventListener('value-change', (event) => {
    const value = (event as CustomEvent<{ value: string[] }>).detail.value[0]
    if (value === undefined)
      return
    invoke('set_log_level', { level: value })
      .then(() => { level.value = [value] })
      .catch((error: unknown) => { state.textContent = describe(error) })
  })
  const check = button('立即检查更新', () => {
    nativeButton(check).disabled = true
    state.textContent = '正在检查更新…'
    invoke<CheckOutcome>('check_updates')
      .then((outcome) => {
        state.textContent = outcome.version !== null ? `发现新版本 ${outcome.version}。` : outcome.unreachable ? '取不到更新信息，请稍后再试。' : '已是最新版本。'
        if (outcome.version !== null)
          void invoke('open_update_window')
      })
      .catch((error: unknown) => { state.textContent = describe(error) })
      .finally(() => { nativeButton(check).disabled = false })
  })
  byId('settings-actions').append(button('打开日志目录', () => void invoke('open_logs').catch((error: unknown) => { state.textContent = describe(error) })), check)
}

function wireDiagnostics(): void {
  const copy = button('复制', () => {
    void navigator.clipboard.writeText(byId('report').textContent ?? '')
  })
  byId('diagnostics-actions').append(button('刷新', () => void renderDiagnostics()), copy, button('导出诊断包…', () => void invoke('export_diagnostics'), 'solid'))
}

async function start(): Promise<void> {
  byId('printers-refresh').append(button('刷新', () => void renderPrinters(), 'ghost'))
  wireSettings()
  wireDiagnostics()
  const overview = await renderOverview()
  addExtensionPages(overview.pages)
  navigate(location.hash.slice(1))
  tabs.addEventListener('value-change', (event) => {
    const value = (event as CustomEvent<{ value: string | null }>).detail.value
    if (value === 'printers')
      void renderPrinters()
    else if (value === 'origins')
      void renderOrigins()
    else if (value === 'diagnostics')
      void renderDiagnostics()
    else if (value === 'overview')
      void renderOverview()
  })
  await listen<string>('navigate', event => navigate(event.payload))
  await listen('origins-changed', () => void renderOrigins())
  await listen('update-found', () => void renderOverview())
  window.addEventListener('focus', () => void renderOverview())
}

void start()
