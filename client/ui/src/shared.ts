/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 三个窗口共用的部分：注册 UI 元素、中文语言包，以及按 UI 的部件结构造按钮、开关等节点。

import { setXhConfig } from '@xihan-ui/web-components'
import {
  defineXhElement,
  XhAlertElement,
  XhButtonElement,
  XhCheckboxElement,
  XhDescriptionsElement,
  XhPasswordInputElement,
  XhProgressElement,
  XhSelectElement,
  XhSwitchElement,
  XhTabsElement,
  XhTextFieldElement,
} from '@xihan-ui/web-components/define'
import { zhCN } from '@xihan-ui/web-components/locale'
import '@xihan-ui/styles/index.css'
import './style.css'

/** 开关、复选框这类带 checked 的元素。 */
export type CheckedElement = HTMLElement & { checked?: boolean, disabled?: boolean }

/** 选择器、页签这类带 value 的元素。 */
export type ValueElement<V> = HTMLElement & { value?: V, disabled?: boolean }

/** 注册用到的 UI 元素并设中文语言包。 */
export function setup(): void {
  defineXhElement('xh-alert', XhAlertElement)
  defineXhElement('xh-button', XhButtonElement)
  defineXhElement('xh-checkbox', XhCheckboxElement)
  defineXhElement('xh-descriptions', XhDescriptionsElement)
  defineXhElement('xh-password-input', XhPasswordInputElement)
  defineXhElement('xh-progress', XhProgressElement)
  defineXhElement('xh-select', XhSelectElement)
  defineXhElement('xh-switch', XhSwitchElement)
  defineXhElement('xh-tabs', XhTabsElement)
  defineXhElement('xh-text-field', XhTextFieldElement)
  setXhConfig(zhCN)
}

/** 按标签与文字建一个元素。 */
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined)
    node.textContent = text
  if (className !== undefined)
    node.className = className
  return node
}

/** 一颗 UI 按钮：xh-button 包一颗原生按钮。 */
export function button(text: string, onClick: () => void, variant: 'solid' | 'subtle' | 'outline' | 'ghost' | 'link' = 'outline'): HTMLElement {
  const host = document.createElement('xh-button')
  host.setAttribute('variant', variant)
  const root = element('button', text)
  root.type = 'button'
  root.dataset.xhPart = 'root'
  root.addEventListener('click', onClick)
  host.append(root)
  return host
}

/** 按钮里的原生按钮，用来设 disabled。 */
export function nativeButton(host: HTMLElement): HTMLButtonElement {
  return host.querySelector('button')!
}

/** 取 id 对应的元素。 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** 把错误写成一句话。 */
export function describe(error: unknown): string {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error)
}
