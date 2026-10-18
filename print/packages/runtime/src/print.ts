/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PaginationDiagnostic, PaginationResult, PrintDocument } from '@xihan-print/core'
import type { PrintRuntimeExtension } from './extensions'
import type { PrintRenderOptions } from './options'
import { paginate } from '@xihan-print/core'
import { createExpressionEngine } from '@xihan-ui/expression'
import { createCanvasMeasurer } from '@xihan-ui/viz'
import { createPrintRuntimeModel } from './extensions'
import { resolvePaginateOptions } from './options'
import { pageRules, PRINT_CSS } from './render/page'
import { renderSheets } from './render/sheets'

/** 等样式表、图片与字体就绪的上限，超时即照常打印。 */
const RESOURCE_TIMEOUT = 10_000
/** 打印对话框关闭前最长等多久；有的浏览器不派发 afterprint。 */
const AFTERPRINT_TIMEOUT = 60_000

const BLANK_DOCUMENT = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'

/** printSheets 的选项。 */
export interface PrintSheetsOptions {
  /** 发起打印的文档，缺省为全局 document；隐藏 iframe 挂在它的 body 上。 */
  readonly document?: Document
  /** 打印文档的标题，即打印对话框与另存 PDF 时的缺省文件名；缺省沿用发起打印的文档标题。 */
  readonly title?: string
  /** 扩展：扩展元素按它们给的渲染画出，与分页用同一份。 */
  readonly extensions?: readonly PrintRuntimeExtension[]
}

/** paginateDocument 的选项：分页注入项，外加缺省度量器所在的文档。 */
export interface PaginateDocumentOptions extends PrintRenderOptions {
  /** 缺省度量器所在的文档，缺省为全局 document。 */
  readonly document?: Document
}

/** printDocument 的选项：分页注入项加上打印选项。 */
export interface PrintOptions extends PaginateDocumentOptions, PrintSheetsOptions {}

/** 一次打印的结果：送去打印的输出页数与分页诊断。 */
export interface PrintOutcome {
  readonly sheets: number
  readonly diagnostics: readonly PaginationDiagnostic[]
  /** 送去打印的途径：client 为本地打印客户端，browser 为浏览器的打印对话框。 */
  readonly via?: 'client' | 'browser'
}

function withTimeout(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void task.finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function whenLoaded(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.addEventListener('load', () => resolve(), { once: true })
    element.addEventListener('error', () => resolve(), { once: true })
  })
}

/** 把源文档的 @font-face 带进打印文档：读得到的规则把 url() 换成绝对地址抄过去，读不到的跨源样式表整张链接过去。 */
function copyFontFaces(source: Document, target: Document): Promise<void>[] {
  const pending: Promise<void>[] = []
  const rules: string[] = []
  for (const sheet of Array.from(source.styleSheets)) {
    let cssRules: CSSRuleList
    try {
      cssRules = sheet.cssRules
    }
    catch {
      if (sheet.href !== null) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        pending.push(whenLoaded(link))
        target.head.append(link)
      }
      continue
    }
    const base = sheet.href ?? source.baseURI
    for (const rule of Array.from(cssRules)) {
      if (!rule.cssText.startsWith('@font-face'))
        continue
      rules.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, quote: string, url: string) => {
        try {
          return `url(${quote}${new URL(url, base).href}${quote})`
        }
        catch {
          return whole
        }
      }))
    }
  }
  if (rules.length > 0) {
    const style = target.createElement('style')
    style.textContent = rules.join('\n')
    target.head.append(style)
  }
  return pending
}

/** 等打印文档里的样式表、图片与字体就绪。 */
async function resourcesReady(doc: Document, pending: Promise<void>[]): Promise<void> {
  const images = Array.from(doc.images).map(image => typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve())
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
  await withTimeout(Promise.allSettled([...pending, ...images, fonts?.ready]), RESOURCE_TIMEOUT)
}

/** 调起打印对话框，等对话框关闭（afterprint）或超时。 */
function printWindow(win: Window): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (timer === undefined)
        return
      clearTimeout(timer)
      timer = undefined
      resolve()
    }
    timer = setTimeout(finish, AFTERPRINT_TIMEOUT)
    win.addEventListener('afterprint', finish, { once: true })
    win.focus()
    win.print()
  })
}

/**
 * 把排好的输出页送去打印：在隐藏 iframe 里渲染（只在预览中显示的元素不画），纸张尺寸不同的输出页分到各自的具名 @page，
 * 带上源文档的字体，等样式表、图片与字体就绪后调起打印对话框，对话框关闭后移除 iframe。
 */
export async function printSheets(result: PaginationResult, options: PrintSheetsOptions = {}): Promise<void> {
  const source = options.document ?? globalThis.document
  const iframe = source.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  for (const [name, value] of Object.entries({ position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' }))
    iframe.style.setProperty(name, value)
  iframe.srcdoc = BLANK_DOCUMENT
  const loaded = whenLoaded(iframe)
  source.body.append(iframe)
  try {
    await loaded
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (doc === null || win === null)
      return
    doc.title = options.title ?? source.title
    const pending = copyFontFaces(source, doc)
    const style = doc.createElement('style')
    style.textContent = `${pageRules(result)}\n${PRINT_CSS}`
    doc.head.append(style)
    renderSheets(result, doc.body, { previewOnly: false, renderers: createPrintRuntimeModel(options.extensions).renderers })
    await resourcesReady(doc, pending)
    await printWindow(win)
  }
  finally {
    iframe.remove()
  }
}

/**
 * 按数据排出模板，返回分页结果，不打印；缺省注入项与 printDocument 相同：
 * 度量器用 options.document（缺省全局 document）里的 Canvas 度量器，表达式引擎与格式化器同预览元素。
 * 一次打多份时每份数据调一次，经 mergePaginationResults 合并后交给 printSheets 或打印客户端的 printSheets。
 * 文档不合法时抛 PrintLayoutError，拿不到度量器时抛 PrintRuntimeError。
 */
export function paginateDocument(schema: PrintDocument, data: unknown, options: PaginateDocumentOptions = {}): PaginationResult {
  const source = options.document ?? globalThis.document
  return paginate(schema, data, resolvePaginateOptions(options, {
    measurer: () => createCanvasMeasurer(source),
    expressionEngine: () => createExpressionEngine(),
  }))
}

/**
 * 按数据排出模板并直接打印，不需要页面上有预览元素；分页同 paginateDocument。文档不合法或拿不到度量器时抛错，不打开打印对话框。
 */
export async function printDocument(schema: PrintDocument, data: unknown, options: PrintOptions = {}): Promise<PrintOutcome> {
  const result = paginateDocument(schema, data, options)
  await printSheets(result, options)
  return { sheets: result.sheets.length, diagnostics: result.diagnostics, via: 'browser' }
}
