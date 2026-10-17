/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 扩展元素：登记后能校验、排版，排版盒带原型 layout 给出的数据；扩展去掉后文档照样保留元素，校验报未知类型，设计态画成占位。
import type { ExtensionElement, ExtensionElementPrototype, PrintCoreExtension, PrintElement } from '../src'
import { describe, expect, it } from 'vitest'
import { behaviorProperties, createPrintModel, layoutDesign, layoutProperties, property, validateDocument } from '../src'
import { boxOf, createFakeMeasurer, documentOf, run, squarePage } from './layout-helpers'

const seal: ExtensionElementPrototype = {
  type: 'seal',
  category: 'media',
  order: 9,
  flow: false,
  minSize: { width: 5, height: 5 },
  defaults: { type: 'seal', width: 30, height: 30, field: '', angle: 0 },
  properties: [
    ...layoutProperties({ rotation: false }),
    property(['field'], 'data', { kind: 'dataField' }),
    property(['angle'], 'layout', { kind: 'number', unit: 'deg', min: 0, max: 360 }),
    ...behaviorProperties(),
  ],
  layout: (element, context) => ({ owner: String(context.field(String(element.field)) ?? ''), angle: element.angle ?? 0, region: context.region }),
}

const SEALS: PrintCoreExtension = { id: '@acme/seal', elements: [seal] }

function sealElement(overrides: Partial<ExtensionElement> = {}): PrintElement {
  return { id: 's', type: 'seal', x: 20, y: 20, width: 30, height: 30, field: 'company', angle: 15, ...overrides } as unknown as PrintElement
}

describe('扩展元素', () => {
  it('登记后按原型的属性描述校验；没登记时报未知类型', () => {
    const doc = documentOf(squarePage('p', [sealElement()]))
    expect(validateDocument(doc, { extensions: [SEALS] }).issues).toEqual([])
    expect(validateDocument(documentOf(squarePage('p', [sealElement({ angle: 400 })])), { extensions: [SEALS] }).issues.map(issue => issue.code)).toEqual(['out-of-range'])
    expect(validateDocument(doc).issues.map(issue => issue.code)).toEqual(['element.unknownType'])
  })

  it('分页时按原型的 layout 排出 extension 盒，元素框由 core 填好', () => {
    const result = run(documentOf(squarePage('p', [sealElement()])), { company: '曦寒' }, { extensions: [SEALS] })
    expect(boxOf(result.sheets[0]!, 's', 'extension')).toMatchObject({
      elementType: 'seal',
      x: 20,
      y: 20,
      width: 30,
      height: 30,
      data: { owner: '曦寒', angle: 15, region: 'body' },
    })
  })

  it('设计态：登记了按 layout 排；扩展被去掉时数据为 null，渲染成占位', () => {
    const page = squarePage('p', [sealElement()])
    const registered = layoutDesign(page, { measurer: createFakeMeasurer(), sampleData: { company: '示例' }, extensions: [SEALS] })
    expect(registered.body.find(box => box.elementId === 's')).toMatchObject({ kind: 'extension', data: { owner: '示例' } })
    const removed = layoutDesign(page, { measurer: createFakeMeasurer() })
    expect(removed.body.find(box => box.elementId === 's')).toMatchObject({ kind: 'extension', elementType: 'seal', data: null })
  })

  it('扩展的元素没给 layout 或要跨页时抛 TypeError', () => {
    const { layout: _layout, ...noLayout } = seal
    expect(() => createPrintModel([{ id: '@acme/a', elements: [noLayout as ExtensionElementPrototype] }])).toThrow(TypeError)
    expect(() => createPrintModel([{ id: '@acme/b', elements: [{ ...seal, flow: true } as unknown as ExtensionElementPrototype] }])).toThrow(TypeError)
  })
})
