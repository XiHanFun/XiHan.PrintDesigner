/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

// 扩展元素的渲染：按扩展给的渲染画进元素框，没给渲染时画成写着类型的占位；同一类型的渲染登记两次抛错；
// 预览与打印都按同一份扩展渲染。
import type { ExtensionElementPrototype, PrintElement } from '@xihan-print/core'
import type { PrintRuntimeExtension } from '../src'
import { behaviorProperties, layoutProperties, paginate, property } from '@xihan-print/core'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { afterEach, describe, expect, it } from 'vitest'
import { createPrintRuntimeModel, definePrintPreview, renderSheets } from '../src'
import { createFakeMeasurer, documentOf, pageOf } from './fixtures'

const seal: ExtensionElementPrototype = {
  type: 'seal',
  category: 'media',
  order: 9,
  flow: false,
  minSize: { width: 5, height: 5 },
  defaults: { type: 'seal', width: 30, height: 30, owner: '' },
  properties: [...layoutProperties({ rotation: false }), property(['owner'], 'content', { kind: 'text' }), ...behaviorProperties()],
  layout: element => ({ owner: String(element.owner ?? '') }),
}

const SEALS: PrintRuntimeExtension = {
  id: '@acme/seal',
  elements: [seal],
  renderers: {
    seal: (box, { document }) => {
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      mark.dataset.owner = String((box.data as { owner: string }).owner)
      return mark
    },
  },
}

const element = { id: 's', type: 'seal', x: 10, y: 10, width: 30, height: 30, owner: '曦寒' } as unknown as PrintElement

function layout(extensions: readonly PrintRuntimeExtension[]): ReturnType<typeof paginate> {
  return paginate(documentOf(pageOf('p', [element])), {}, { measurer: createFakeMeasurer(), expressionEngine: createExpressionEngine(), formatter: formatValue, extensions })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('扩展元素的渲染', () => {
  it('按扩展给的渲染画进元素框，元素框带位置与元素类型；没给渲染时画成写着类型的占位', () => {
    const container = document.createElement('div')
    const result = layout([SEALS])
    renderSheets(result, container, { renderers: createPrintRuntimeModel([SEALS]).renderers })
    const frame = container.querySelector<HTMLElement>('[data-element-id="s"]')!
    expect([frame.dataset.kind, frame.dataset.elementType, frame.style.left, frame.style.width]).toEqual(['extension', 'seal', '10mm', '30mm'])
    expect(frame.querySelector('svg')!.dataset.owner).toBe('曦寒')

    renderSheets(result, container)
    const placeholder = container.querySelector<HTMLElement>('[data-element-id="s"]')!
    expect([placeholder.hasAttribute('data-placeholder'), placeholder.textContent]).toEqual([true, 'seal'])
  })

  it('跨页的扩展元素每页一段，渲染收到这一段的块、重复块与分段序号', () => {
    const rows: ExtensionElementPrototype = {
      type: 'rows',
      category: 'data',
      order: 9,
      flow: true,
      minSize: { width: 5, height: 5 },
      defaults: { type: 'rows', width: 80, height: 20 },
      properties: [...layoutProperties({ rotation: false }), ...behaviorProperties()],
      prepare: () => ({ repeat: { height: 10, data: '表头' }, blocks: ['一', '二', '三'].map(data => ({ height: 120, data })) }),
    }
    const extension: PrintRuntimeExtension = {
      id: '@acme/rows',
      elements: [rows],
      renderers: {
        rows: (box, { document }) => {
          const { repeat, blocks } = box.data as { repeat: string, blocks: string[] }
          return Object.assign(document.createElement('span'), { textContent: `${repeat}:${blocks.join(',')}:${box.fragment?.index}` })
        },
      },
    }
    const flowing = { id: 'r', type: 'rows', x: 10, y: 10, width: 80, height: 20 } as unknown as PrintElement
    const result = paginate(documentOf(pageOf('p', [flowing])), {}, { measurer: createFakeMeasurer(), expressionEngine: createExpressionEngine(), formatter: formatValue, extensions: [extension] })
    const container = document.createElement('div')
    renderSheets(result, container, { renderers: createPrintRuntimeModel([extension]).renderers })
    expect(Array.from(container.querySelectorAll('[data-element-id="r"]'), frame => frame.textContent)).toEqual(['表头:一,二:0', '表头:三:1'])
  })

  it('同一类型的渲染在两个扩展里都给了时抛 DesignerExtensionError', () => {
    const other: PrintRuntimeExtension = { id: '@acme/other', renderers: { seal: () => document.createElement('div') } }
    expect(() => createPrintRuntimeModel([SEALS, other])).toThrow(expect.objectContaining({ code: 'designer.extension-conflict', space: 'element-renderer', key: 'seal' }))
  })

  it('预览按自己的 extensions 分页并渲染', async () => {
    definePrintPreview()
    const preview = document.createElement('xh-print-preview')
    preview.measurer = createFakeMeasurer()
    preview.extensions = [SEALS]
    preview.schema = documentOf(pageOf('p', [element]))
    document.body.append(preview)
    await preview.updateComplete
    expect(preview.querySelector<SVGElement>('[data-element-id="s"] svg')!.dataset.owner).toBe('曦寒')
  })
})
