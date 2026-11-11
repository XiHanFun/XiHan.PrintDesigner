/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 授权窗口：写明来源，等用户选允许、仅这次或拒绝；Esc 与关掉窗口都算这次拒绝。

import type { CheckedElement } from './shared'
import { invoke } from '@tauri-apps/api/core'
import { button, byId, nativeButton, setup } from './shared'

interface ConsentDetails {
  readonly origin: string
  readonly timeoutSeconds: number
}

setup()

function answer(choice: 'allow' | 'once' | 'deny' | 'deny-always'): void {
  void invoke('consent_answer', { choice })
}

async function start(): Promise<void> {
  const details = await invoke<ConsentDetails | null>('consent_details')
  if (details === null) {
    answer('deny')
    return
  }
  byId('origin').textContent = details.origin
  byId('timeout').textContent = `${details.timeoutSeconds} 秒内不处理视为这次不允许。`
  let remember = false
  byId<CheckedElement>('remember').addEventListener('checked-change', (event) => {
    remember = (event as CustomEvent<{ checked: boolean }>).detail.checked
  })
  const allow = button('允许', () => answer('allow'), 'solid')
  const once = button('仅这次', () => answer('once'))
  const deny = button('拒绝', () => answer(remember ? 'deny-always' : 'deny'))
  byId('choices').append(allow, once, deny)
  nativeButton(allow).focus()
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape')
      answer(remember ? 'deny-always' : 'deny')
  })
}

void start()
