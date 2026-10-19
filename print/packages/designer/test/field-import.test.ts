/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { DataField, DesignerFieldSource } from '@xihan-ui/designer-kit'
import type { DesignerFieldImportDetail, XhDesignerFieldImportElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { PrintDesignerExtension, XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner } from '../src'

const registry = createElementRegistry()

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } })]
  return createDocument({ pages: [page] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.autoTour = false
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
})

function importButton(): HTMLButtonElement | null {
  const bar = designer.querySelector<HTMLElement>('[slot="palette-actions"]')
  return bar === null || bar.hidden ? null : bar.querySelector<HTMLButtonElement>('button[value="import-fields"]')
}

function dialog(): XhDesignerFieldImportElement {
  return designer.querySelector('xh-designer-field-import')!
}

function finish(detail: Partial<DesignerFieldImportDetail>): void {
  const full: DesignerFieldImportDetail = { fields: [], mode: 'replace', source: 'sample', annotations: new Map(), ...detail }
  dialog().dispatchEvent(new CustomEvent('fields-import', { detail: full, bubbles: true }))
}

const imported: DataField[] = [
  { name: 'no', label: 'Order No.', kind: 'value', type: 'string' },
  { name: 'photo', kind: 'value', type: 'string', content: 'image' },
]

describe('导入字段', () => {
  it('物料面板头有导入字段钮，点了打开导入对话框；对话框拿到现有字段与四种内容', async () => {
    designer.fields = [{ name: 'customer', kind: 'value' }]
    await designer.updateComplete
    const button = importButton()!
    expect([button.disabled, button.getAttribute('aria-label') ?? button.textContent]).toEqual([false, 'Import fields'])
    button.click()
    await designer.updateComplete
    expect([dialog().open, dialog().fields, dialog().contents, dialog().offerSample]).toEqual([true, designer.fields, ['text', 'image', 'barcode', 'qrcode'], true])
  })

  it('导入后换上字段并派发 fields-change，物料面板的「字段」组跟着变；带了样例的换上示例数据并派发 sample-data-change', async () => {
    const seen: string[] = []
    designer.addEventListener('fields-change', event => seen.push(`fields:${(event as CustomEvent<{ fields: readonly DataField[] }>).detail.fields.length}`))
    designer.addEventListener('sample-data-change', event => seen.push(`sample:${JSON.stringify((event as CustomEvent<{ sampleData: unknown }>).detail.sampleData)}`))
    finish({ fields: imported })
    await designer.updateComplete
    expect([designer.fields, seen]).toEqual([imported, ['fields:2']])
    const palette = designer.querySelector<HTMLElement & { groups?: readonly { id: string, items: readonly { label: string }[] }[] }>('xh-designer-palette')!
    expect(palette.groups!.at(-1)!.items.map(item => item.label)).toEqual(['Order No.', 'photo'])
    finish({ fields: imported, sample: { no: 'SO-1', photo: 'a.png' } })
    await designer.updateComplete
    expect([designer.sampleData, seen.at(-1)]).toEqual([{ no: 'SO-1', photo: 'a.png' }, 'sample:{"no":"SO-1","photo":"a.png"}'])
  })

  it('fields-readonly、只读或预览态时面板头没有导入字段钮，import-fields 命令不可用', async () => {
    designer.commandLayout = { toolbar: [['import-fields']] }
    designer.setAttribute('fields-readonly', '')
    await designer.updateComplete
    const toolbarButton = (): HTMLButtonElement => designer.querySelector<HTMLButtonElement>('[data-part="command-bar"] button[value="import-fields"]')!
    expect([importButton(), toolbarButton().disabled]).toEqual([null, true])
    designer.setAttribute('fields-readonly', 'false')
    await designer.updateComplete
    expect([importButton() !== null, toolbarButton().disabled]).toEqual([true, false])
    designer.readonly = true
    await designer.updateComplete
    expect([importButton(), toolbarButton().disabled]).toEqual([null, true])
  })

  it('扩展的字段来源交给对话框；字段来源 id 重名时抛 DesignerExtensionError', async () => {
    const source = (id: string): DesignerFieldSource => ({ id, label: id, create: host => ({ element: host.document.createElement('div') }) })
    const request: PrintDesignerExtension = { id: '@acme/request', fieldSources: [source('@acme/request.api')] }
    designer.extensions = [request]
    await designer.updateComplete
    expect(dialog().sources!.map(item => item.id)).toEqual(['@acme/request.api'])
    const again: PrintDesignerExtension = { id: '@acme/again', fieldSources: [source('@acme/request.api')] }
    expect(() => (designer.extensions = [request, again])).toThrow(DesignerExtensionError)
    designer.openFieldImport('@acme/request.api')
    await designer.updateComplete
    expect([dialog().open, dialog().source]).toEqual([true, '@acme/request.api'])
  })
})
