/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { XhPrintPreview } from '../src'
import { setXhConfig } from '@xihan-ui/web-components'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintPreview, PRINT_PREVIEW_TAG, printDocument, PrintRuntimeError } from '../src'
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

  it('没有模板时 print() 抛 schema.missing', async () => {
    const preview = await mount(() => {})
    await expect(preview.print()).rejects.toMatchObject({ code: 'schema.missing' })
  })
})

describe('printDocument', () => {
  it('纸张尺寸不同的输出页分到各自的具名 @page，页边距为 0', async () => {
    const schema = documentOf(pageOf('a', []), pageOf('b', [], { id: 'b', paper: 'A5' }))
    const outcome = await printDocument(schema, {}, { measurer: createFakeMeasurer(), title: '两页' })
    expect(outcome).toEqual({ sheets: 2, diagnostics: [] })
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
