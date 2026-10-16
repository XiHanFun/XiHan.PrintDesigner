/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PaginationResult } from '@xihan-print/core'
import type { ClientDocument, ClientResource, ClientSheetGroup } from './protocol'
import { pageRules, PRINT_CSS } from '../render/page'
import { renderSheets } from '../render/sheets'
import { toBase64 } from './base64'
import { PrintClientError } from './errors'
import { MAX_MESSAGE_BYTES, MAX_RESOURCE_BYTES, RESOURCE_ORIGIN } from './protocol'

/** 打包文档的选项。 */
export interface ClientDocumentOptions {
  /** 发起打印的文档：从它的样式表里找模板用到的字体，相对地址也按它解析；缺省为全局 document。 */
  readonly document?: Document
  /** 取资源用的 fetch，缺省为全局 fetch。 */
  readonly fetch?: typeof fetch
}

/** 消息里除文档以外的字段预留的字节数。 */
const ENVELOPE_BYTES = 64 * 1024
const URL_PATTERN = /url\((['"]?)([^'")]+)\1\)/g

/** 取资源并编号：同一地址只取一次，data: 地址原样保留，取不到的报 RESOURCE_BLOCKED。 */
class ResourceCollector {
  readonly resources: ClientResource[] = []
  bytes = 0
  readonly #ids = new Map<string, Promise<string>>()
  readonly #fetch: typeof fetch
  readonly #base: string

  constructor(fetcher: typeof fetch, base: string) {
    this.#fetch = fetcher
    this.#base = base
  }

  /** 把地址换成客户端里的资源地址。 */
  url(address: string, base: string = this.#base): Promise<string> {
    if (address.startsWith('data:'))
      return Promise.resolve(address)
    let absolute: string
    try {
      absolute = new URL(address, base).href
    }
    catch {
      return Promise.reject(new PrintClientError('RESOURCE_BLOCKED', `资源地址不对：${address}`, { url: address }))
    }
    let id = this.#ids.get(absolute)
    if (id === undefined) {
      id = this.#load(absolute)
      this.#ids.set(absolute, id)
    }
    return id.then(value => `${RESOURCE_ORIGIN}r/${value}`)
  }

  /** 把一段 CSS 文字里的 url() 都换成资源地址。 */
  async css(text: string, base: string = this.#base): Promise<string> {
    const replacements = await Promise.all(Array.from(text.matchAll(URL_PATTERN), match => this.url(match[2]!, base)))
    let index = 0
    return text.replace(URL_PATTERN, () => `url("${replacements[index++]}")`)
  }

  async #load(url: string): Promise<string> {
    let response: Response
    try {
      response = await this.#fetch(url, { mode: 'cors', credentials: 'same-origin' })
    }
    catch {
      throw new PrintClientError('RESOURCE_BLOCKED', `取不到资源：${url}`, { url })
    }
    if (!response.ok)
      throw new PrintClientError('RESOURCE_BLOCKED', `取不到资源：${url}（${response.status}）`, { url, status: response.status })
    const bytes = new Uint8Array(await response.arrayBuffer())
    this.bytes += bytes.length
    if (this.bytes > MAX_RESOURCE_BYTES)
      throw new PrintClientError('DOCUMENT_TOO_LARGE', '资源总量超过 64 MiB', { bytes: this.bytes, limit: MAX_RESOURCE_BYTES })
    const id = String(this.resources.length)
    this.resources.push({ id, type: response.headers.get('content-type') ?? 'application/octet-stream', data: toBase64(bytes) })
    return id
  }
}

function familyName(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()
}

/** 输出页里用到的字体族，小写。 */
function usedFamilies(root: Element): Set<string> {
  const families = new Set<string>()
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    for (const family of element.style.fontFamily.split(','))
      families.add(familyName(family))
  }
  families.delete('')
  return families
}

/** 读样式表的规则；跨源且没有 CORS 的样式表读不到，这时按 CORS 重新取一次文字来解析，都不行时跳过。 */
async function readRules(sheet: CSSStyleSheet, fetcher: typeof fetch): Promise<readonly CSSRule[]> {
  try {
    return Array.from(sheet.cssRules)
  }
  catch {
    if (sheet.href === null || typeof CSSStyleSheet.prototype.replace !== 'function')
      return []
    try {
      const response = await fetcher(sheet.href, { mode: 'cors', credentials: 'same-origin' })
      if (!response.ok)
        return []
      const copy = new CSSStyleSheet()
      await copy.replace(await response.text())
      return Array.from(copy.cssRules)
    }
    catch {
      return []
    }
  }
}

/** 模板用到的字体族的 @font-face：每条只取 src 里的第一个 url()，字体文件随任务带去。 */
async function fontFaces(source: Document, families: Set<string>, collector: ResourceCollector, fetcher: typeof fetch): Promise<string[]> {
  const faces: Promise<string>[] = []
  for (const sheet of Array.from(source.styleSheets)) {
    const base = sheet.href ?? source.baseURI
    for (const rule of await readRules(sheet, fetcher)) {
      if (!rule.cssText.startsWith('@font-face'))
        continue
      const style = (rule as CSSRule & { readonly style: CSSStyleDeclaration }).style
      const family = style.getPropertyValue('font-family')
      if (!families.has(familyName(family)))
        continue
      const first = /url\((['"]?)([^'")]+)\1\)/.exec(style.getPropertyValue('src'))
      if (first === null)
        continue
      const descriptors = ['font-weight', 'font-style', 'font-stretch', 'unicode-range']
        .map(name => [name, style.getPropertyValue(name)] as const)
        .filter(([, value]) => value !== '')
        .map(([name, value]) => `${name}: ${value};`)
      faces.push(collector.url(first[2]!, base).then(url => `@font-face { font-family: ${family}; src: url("${url}"); ${descriptors.join(' ')} }`))
    }
  }
  return Promise.all(faces)
}

/** 连续同尺寸的输出页并成一组，按出现顺序。 */
function sheetGroups(result: PaginationResult): ClientSheetGroup[] {
  const groups: ClientSheetGroup[] = []
  for (const sheet of result.sheets) {
    const last = groups.at(-1)
    if (last !== undefined && last.widthMm === sheet.size.width && last.heightMm === sheet.size.height)
      groups[groups.length - 1] = { ...last, count: last.count + 1 }
    else
      groups.push({ widthMm: sheet.size.width, heightMm: sheet.size.height, count: 1 })
  }
  return groups
}

/**
 * 把分页结果打包成交给客户端的文档：输出页渲染进一份独立的 HTML（只在预览中显示的元素不画），
 * 图片、背景图与模板用到的字体取来随任务带去，地址改写成客户端里的资源地址。
 */
export async function buildClientDocument(result: PaginationResult, options: ClientDocumentOptions = {}): Promise<ClientDocument> {
  const source = options.document ?? globalThis.document
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const collector = new ResourceCollector(fetcher, source.baseURI)
  const doc = source.implementation.createHTMLDocument('')
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  doc.head.prepend(charset)
  renderSheets(result, doc.body, { previewOnly: false })

  const pending: Promise<void>[] = []
  for (const image of Array.from(doc.body.querySelectorAll('img'))) {
    const src = image.getAttribute('src')
    if (src !== null && src !== '')
      pending.push(collector.url(src).then(url => image.setAttribute('src', url)))
  }
  for (const image of Array.from(doc.body.querySelectorAll('image'))) {
    const name = image.hasAttribute('href') ? 'href' : 'xlink:href'
    const href = image.getAttribute(name)
    if (href !== null && href !== '')
      pending.push(collector.url(href).then(url => image.setAttribute(name, url)))
  }
  for (const element of Array.from(doc.body.querySelectorAll('[style*="url("]'))) {
    const style = element.getAttribute('style')!
    pending.push(collector.css(style).then(css => element.setAttribute('style', css)))
  }
  const faces = fontFaces(source, usedFamilies(doc.body), collector, fetcher)
  await Promise.all(pending)

  const style = doc.createElement('style')
  style.textContent = [pageRules(result), PRINT_CSS, ...await faces].join('\n')
  doc.head.append(style)
  const html = `<!doctype html>\n${doc.documentElement.outerHTML}`
  const size = new TextEncoder().encode(html).length + collector.resources.reduce((sum, resource) => sum + resource.data.length + resource.type.length, 0)
  if (size + ENVELOPE_BYTES > MAX_MESSAGE_BYTES)
    throw new PrintClientError('DOCUMENT_TOO_LARGE', '文档超过单条消息 96 MiB 的上限', { bytes: size, limit: MAX_MESSAGE_BYTES })
  return { html, resources: collector.resources, sheets: sheetGroups(result) }
}
