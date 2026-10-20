/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintTrace, XhPrintPreview } from '../src'
import type { JobStatus, PrintClient, PrintClientDocumentOptions } from '../src/client'
import { paginate, PRINT_CORE_EXTENSION_ID } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { setXhConfig } from '@xihan-ui/web-components'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintPreview, mergePaginationResults, paginateDocument, PRINT_PREVIEW_TAG, printDocument, PrintRuntimeError, printSheets } from '../src'
import { PrintClientError, printWithFallback } from '../src/client'
import { printZhCN } from '../src/locale'
import { createFakeMeasurer, documentOf, pageOf, registry, textElement } from './fixtures'

definePrintPreview()

/** 打印时 iframe 里的样子：样式文字与输出页。 */
interface Printed {
  css: string
  title: string
  sheets: number
  previewOnly: number
}

let printed: Printed[] = []
let observer: MutationObserver

/** iframe 一加载就把它的 print 换成记录并派发 afterprint：jsdom 没有打印对话框。 */
beforeEach(() => {
  printed = []
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof HTMLIFrameElement))
          continue
        node.addEventListener('load', () => {
          const win = node.contentWindow!
          win.print = () => {
            const doc = node.contentDocument!
            printed.push({
              css: Array.from(doc.querySelectorAll('style'), style => style.textContent).join('\n'),
              title: doc.title,
              sheets: doc.querySelectorAll('[data-part="sheet"]').length,
              previewOnly: doc.querySelectorAll('[data-preview-only]').length,
            })
            win.dispatchEvent(new Event('afterprint'))
          }
        })
      }
    }
  })
  observer.observe(document.body, { childList: true })
})

const mounted: Element[] = []

afterEach(() => {
  observer.disconnect()
  for (const element of mounted.splice(0)) element.remove()
  setXhConfig({})
})

async function mount(setup: (preview: XhPrintPreview) => void): Promise<XhPrintPreview> {
  const preview = document.createElement(PRINT_PREVIEW_TAG)
  setup(preview)
  document.body.append(preview)
  mounted.push(preview)
  await preview.updateComplete
  return preview
}

interface StubClient extends PrintClient {
  readonly calls: Array<{ readonly sheets: number, readonly options: PrintClientDocumentOptions }>
}

/** 只实现打印的假客户端：每次打印的结果由 finish 给出。 */
function stubClient(finish: () => Promise<JobStatus>): StubClient {
  const calls: StubClient['calls'] = []
  const job = (sheets: number, options: PrintClientDocumentOptions = {}) => {
    calls.push({ sheets, options })
    const done = finish()
    done.catch(() => undefined)
    return { id: 'j', status: undefined, done, onStatus: () => () => undefined, cancel: async () => false }
  }
  return {
    calls,
    printSheets: (result, options) => job(result.sheets.length, options),
    printDocument: (_schema, _data, options) => job(1, options),
  } as Partial<StubClient> as StubClient
}

function sheetsOf(preview: Element): HTMLElement[] {
  return Array.from(preview.querySelectorAll<HTMLElement>('[data-part="sheet"]'))
}

describe('<xh-print-preview>', () => {
  it('重复注册不报错', () => {
    expect(() => definePrintPreview()).not.toThrow()
    expect(customElements.get(PRINT_PREVIEW_TAG)).toBeDefined()
  })

  it('给了模板与度量器即分页渲染，并派发 paginated', async () => {
    const events: CustomEvent[] = []
    const preview = await mount((element) => {
      element.addEventListener('paginated', event => events.push(event as CustomEvent))
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('a', [textElement('t', '你好')]), pageOf('b', []))
    })
    expect(sheetsOf(preview)).toHaveLength(2)
    expect(events.map(event => event.detail.sheets)).toEqual([2])
    expect(preview.result?.sheets).toHaveLength(2)
  })

  it('extensions 赋值时合并查重，冲突抛错且保持原状；扩展的规则进分页前的校验', async () => {
    const events: CustomEvent[] = []
    const preview = await mount((element) => {
      element.addEventListener('pagination-error', event => events.push(event as CustomEvent))
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [textElement('t', '你好')]))
    })
    expect(() => {
      preview.extensions = [{ id: PRINT_CORE_EXTENSION_ID }]
    }).toThrow(DesignerExtensionError)
    expect(preview.extensions).toBeUndefined()
    preview.extensions = [{ id: '@acme/audit', rules: [() => [{ code: 'audit.blocked', path: [] }]] }]
    await preview.updateComplete
    expect(events.map(event => [event.detail.code, event.detail.issues.map((issue: { code: string }) => issue.code)])).toEqual([['document.invalid', ['audit.blocked']]])
  })

  it('数据变化后重新分页', async () => {
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [registry.createElement('text', { id: 'name', x: 0, y: 0, overrides: { content: { kind: 'field', field: 'name' } } })]))
      element.data = { name: '甲' }
    })
    expect(preview.querySelector('[data-element-id="name"]')!.textContent).toBe('甲')
    preview.data = { name: '乙' }
    await preview.updateComplete
    expect(preview.querySelector('[data-element-id="name"]')!.textContent).toBe('乙')
  })

  it('没给度量器且拿不到 Canvas 时派发 measurer.unavailable，预览清空', async () => {
    const errors: CustomEvent[] = []
    const preview = await mount((element) => {
      element.addEventListener('pagination-error', event => errors.push(event as CustomEvent))
      element.schema = documentOf(pageOf('p', []))
    })
    expect(errors.map(event => event.detail.code)).toEqual(['measurer.unavailable'])
    expect(sheetsOf(preview)).toHaveLength(0)
    expect(preview.result).toBeUndefined()
  })

  it('模板不合法时派发 document.invalid，带上校验问题', async () => {
    const errors: CustomEvent[] = []
    const broken = textElement('t', 'x')
    ;(broken as { style: { color: string } }).style.color = 'red'
    await mount((element) => {
      element.addEventListener('pagination-error', event => errors.push(event as CustomEvent))
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [broken]))
    })
    expect(errors[0]!.detail.code).toBe('document.invalid')
    expect(errors[0]!.detail.issues.length).toBeGreaterThan(0)
  })

  it('缩放只改预览，可及名按语言包', async () => {
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('a', []), pageOf('b', []))
      element.zoom = 0.5
    })
    const viewport = preview.querySelector<HTMLElement>('[data-part="viewport"]')!
    expect(preview.style.getPropertyValue('--xh-print-zoom')).toBe('0.5')
    expect(viewport.getAttribute('aria-label')).toBe('Print preview')
    expect(sheetsOf(preview).map(sheet => sheet.getAttribute('aria-label'))).toEqual(['Page 1 of 2', 'Page 2 of 2'])
    setXhConfig(printZhCN)
    preview.requestUpdate()
    await preview.updateComplete
    expect(viewport.getAttribute('aria-label')).toBe('打印预览')
    expect(sheetsOf(preview)[1]!.getAttribute('aria-label')).toBe('第 2 页，共 2 页')
  })

  it('print() 重新分页后送去打印，只在预览中显示的元素不打印，打印后移除 iframe', async () => {
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [{ ...textElement('hint', '仅预览'), previewOnly: true }, textElement('t', '正文', 10, 60)]))
    })
    const outcome = await preview.print({ title: '出库单' })
    expect(outcome.sheets).toBe(1)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatchObject({ title: '出库单', sheets: 1, previewOnly: 0 })
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('给了 printClient 时交给客户端静默打印，带上打印选项，不弹浏览器打印', async () => {
    const client = stubClient(async () => ({ jobId: 'j', state: 'completed', sheets: 1 }))
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [textElement('t', '正文')]))
      element.printClient = client
    })
    const outcome = await preview.print({ title: '出库单', printer: 'Office', copies: 2 })
    expect(outcome).toMatchObject({ sheets: 1, via: 'client' })
    expect(printed).toEqual([])
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0]!.options).toMatchObject({ printer: 'Office', copies: 2, document })
    expect(client.calls[0]!.options).not.toHaveProperty('title')
    expect(client.calls[0]!.sheets).toBe(1)
  })

  it('连不上客户端时退回浏览器打印，其它错误照常抛出', async () => {
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.schema = documentOf(pageOf('p', [textElement('t', '正文')]))
    })
    preview.printClient = stubClient(async () => Promise.reject(new PrintClientError('CLIENT_UNAVAILABLE')))
    expect(await preview.print({ title: '出库单' })).toMatchObject({ sheets: 1, via: 'browser' })
    expect(printed).toHaveLength(1)
    expect(printed[0]!.title).toBe('出库单')

    preview.printClient = stubClient(async () => Promise.reject(new PrintClientError('PRINTER_OFFLINE')))
    await expect(preview.print()).rejects.toMatchObject({ code: 'PRINTER_OFFLINE' })
    expect(printed).toHaveLength(1)
  })

  it('没有模板时 print() 抛 schema.missing', async () => {
    const preview = await mount(() => {})
    await expect(preview.print()).rejects.toMatchObject({ code: 'schema.missing' })
  })
})

describe('printWithFallback', () => {
  const schema = (): ReturnType<typeof documentOf> => documentOf(pageOf('p', [textElement('t', '正文')]))

  it('客户端打成时不弹浏览器打印', async () => {
    const outcome = await printWithFallback(stubClient(async () => ({ jobId: 'j', state: 'completed', sheets: 1 })), schema(), {}, { measurer: createFakeMeasurer() })
    expect(outcome).toEqual({ via: 'client', sheets: 1 })
    expect(printed).toEqual([])
  })

  it('协议主版本不对时退回浏览器打印，拒绝授权时不退回', async () => {
    const outcome = await printWithFallback(stubClient(async () => Promise.reject(new PrintClientError('PROTOCOL_UNSUPPORTED'))), schema(), {}, { measurer: createFakeMeasurer(), title: '回退' })
    expect(outcome).toEqual({ via: 'browser', sheets: 1 })
    expect(printed[0]!.title).toBe('回退')
    await expect(printWithFallback(stubClient(async () => Promise.reject(new PrintClientError('CONSENT_DENIED'))), schema(), {}, { measurer: createFakeMeasurer() })).rejects.toMatchObject({ code: 'CONSENT_DENIED' })
    expect(printed).toHaveLength(1)
  })
})

describe('paginateDocument', () => {
  /** 用到表达式与值格式的模板：缺省的表达式引擎或格式化器换了，排出的文字就不同。 */
  const schema = documentOf(pageOf('p', [
    registry.createElement('text', { id: 'total', x: 10, y: 20, overrides: { content: { kind: 'expression', expression: 'qty * price', format: { kind: 'number', decimals: 2, grouping: true } } } }),
    registry.createElement('text', { id: 'name', x: 10, y: 40, overrides: { content: { kind: 'field', field: 'name' } } }),
  ]))

  it('缺省注入项与 printDocument 同一份：表达式引擎与格式化器取 UI 的缺省，结果与 printDocument 送去打印的一致', async () => {
    const measurer = createFakeMeasurer()
    const data = { qty: 1200, price: 3.5, name: '甲' }
    const result = paginateDocument(schema, data, { measurer })
    expect(result).toEqual(paginate(schema, data, { measurer, expressionEngine: createExpressionEngine(), formatter: formatValue }))
    const outcome = await printDocument(schema, data, { measurer })
    expect(outcome).toEqual({ sheets: result.sheets.length, diagnostics: result.diagnostics, via: 'browser' })
    expect(printed[0]!.sheets).toBe(result.sheets.length)
  })

  it('拿不到度量器时与 printDocument 一样抛 PrintRuntimeError', async () => {
    expect(() => paginateDocument(schema, {})).toThrow(PrintRuntimeError)
    await expect(printDocument(schema, {})).rejects.toMatchObject({ code: 'measurer.unavailable' })
  })

  it('一次打多份：每份数据各排一次，合并后交给 printSheets', async () => {
    const measurer = createFakeMeasurer()
    const merged = mergePaginationResults([{ qty: 1, price: 1, name: '甲' }, { qty: 2, price: 2, name: '乙' }].map(data => paginateDocument(schema, data, { measurer })))
    expect(merged.parts).toEqual([{ start: 0, count: 1 }, { start: 1, count: 1 }])
    await printSheets(merged)
    expect(printed[0]!.sheets).toBe(2)
  })
})

/** 记下分页的每一步与各环节的起止：step:<种类>、start:<环节>、end:<环节> <结束时带的数据>。 */
function recorder(): { readonly log: string[], readonly trace: PrintTrace } {
  const log: string[] = []
  return {
    log,
    trace: {
      step: step => void log.push(`step:${step.kind}`),
      phase: (phase) => {
        log.push(`start:${phase}`)
        return details => void log.push(`end:${phase}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`)
      },
    },
  }
}

describe('分页与打印环节的回调', () => {
  const PRINTED = ['start:paginate', 'step:page', 'step:done', 'end:paginate {"sheets":1}', 'start:render', 'end:render {"sheets":1}', 'start:resources', 'end:resources', 'start:print', 'end:print']

  it('printDocument 按先后报分页的每一步，以及分页、生成 DOM、等资源与送打印四个环节的起止', async () => {
    const { log, trace } = recorder()
    await printDocument(documentOf(pageOf('p', [textElement('t', '正文')])), {}, { measurer: createFakeMeasurer(), trace })
    expect(log).toEqual(PRINTED)
  })

  it('预览元素给了 trace：重新分页报每一步与分页、生成 DOM 两个环节；print() 报全部四个环节；不给时什么都不报', async () => {
    const { log, trace } = recorder()
    const preview = await mount((element) => {
      element.measurer = createFakeMeasurer()
      element.trace = trace
      element.schema = documentOf(pageOf('p', [textElement('t', '正文')]))
    })
    expect(log).toEqual(PRINTED.slice(0, 6))
    log.length = 0
    await preview.print()
    expect(log).toEqual(PRINTED)
    log.length = 0
    preview.trace = undefined
    preview.data = { x: 1 }
    await preview.updateComplete
    expect(log).toEqual([])
  })
})

describe('printDocument', () => {
  it('纸张尺寸不同的输出页分到各自的具名 @page，页边距为 0', async () => {
    const schema = documentOf(pageOf('a', []), pageOf('b', [], { id: 'b', paper: 'A5' }))
    const outcome = await printDocument(schema, {}, { measurer: createFakeMeasurer(), title: '两页' })
    expect(outcome).toEqual({ sheets: 2, diagnostics: [], via: 'browser' })
    expect(printed[0]!.sheets).toBe(2)
    expect(printed[0]!.css).toContain('@page xh-print-210x297 { size: 210mm 297mm; margin: 0; }')
    expect(printed[0]!.css).toContain('@page xh-print-148x210 { size: 148mm 210mm; margin: 0; }')
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('拿不到度量器时抛错，不打开打印', async () => {
    await expect(printDocument(documentOf(pageOf('p', [])), {})).rejects.toBeInstanceOf(PrintRuntimeError)
    expect(printed).toEqual([])
  })
})
