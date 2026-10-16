/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 建 DOM 节点：属性值为 false 或 undefined 时不写，true 写成空串，字符串子节点作为文本。

/** 属性表。 */
export type Attributes = Readonly<Record<string, string | number | boolean | undefined>>

/** 写入一组属性：false 或 undefined 删除该属性，true 写成空串。 */
export function setAttributes(element: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false)
      element.removeAttribute(name)
    else
      element.setAttribute(name, value === true ? '' : String(value))
  }
}

/** 建一个元素，写上属性并依次放入子节点。 */
export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attributes?: Attributes, children?: readonly (Node | string)[]): HTMLElementTagNameMap[K]
export function el(doc: Document, tag: string, attributes?: Attributes, children?: readonly (Node | string)[]): HTMLElement
export function el(doc: Document, tag: string, attributes: Attributes = {}, children: readonly (Node | string)[] = []): HTMLElement {
  const element = doc.createElement(tag)
  setAttributes(element, attributes)
  element.append(...children)
  return element
}

/** 文本不同时才改写。 */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text)
    element.textContent = text
}
