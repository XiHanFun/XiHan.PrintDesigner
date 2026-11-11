/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 新版提示窗口：版本与发布说明；能自动安装时下载、校验后运行安装包，不能时打开下载地址。

import type { ValueElement } from './shared'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { button, byId, describe, nativeButton, setup } from './shared'

interface Offer {
  readonly version: string
  readonly current: string
  readonly notes: string | null
  readonly size: number
  readonly installable: boolean
  readonly url: string
}

interface Progress {
  readonly bytes: number
  readonly total: number
}

setup()

async function start(): Promise<void> {
  const offer = await invoke<Offer | null>('update_offer')
  const state = byId('state')
  const actions = byId('actions')
  const later = button('以后再说', () => void getCurrentWindow().close())
  if (offer === null) {
    byId('title').textContent = '没有可以安装的新版本'
    actions.append(later)
    return
  }
  byId('title').textContent = `新版本 ${offer.version}（当前 ${offer.current}）`
  byId('notes').textContent = offer.notes ?? '没有发布说明。'
  const download = button('打开下载页', () => void invoke('open_download').catch((error: unknown) => { state.textContent = describe(error) }))
  if (!offer.installable) {
    state.textContent = '这个版本不能自动安装，请下载安装包后手动安装。'
    actions.append(download, later)
    return
  }
  const progress = byId<ValueElement<number>>('progress')
  await listen<Progress>('update-progress', (event) => {
    progress.value = Math.min(100, Math.round(event.payload.bytes * 100 / Math.max(1, event.payload.total)))
  })
  const install = button('下载并安装', () => {
    nativeButton(install).disabled = true
    progress.hidden = false
    state.textContent = '正在下载…'
    invoke('install_update')
      .then(() => { state.textContent = '校验通过，正在启动安装…' })
      .catch((error: unknown) => {
        state.textContent = describe(error)
        nativeButton(install).disabled = false
      })
  }, 'solid')
  actions.append(install, download, later)
}

void start()
