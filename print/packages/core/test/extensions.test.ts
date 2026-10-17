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

  it('扩展的元素不跨页却没给 layout、或跨页却没给 prepare 时抛 TypeError', () => {
    const { layout: _layout, ...noLayout } = seal
    expect(() => createPrintModel([{ id: '@acme/a', elements: [noLayout as ExtensionElementPrototype] }])).toThrow(TypeError)
    expect(() => createPrintModel([{ id: '@acme/b', elements: [{ ...seal, flow: true } as unknown as ExtensionElementPrototype] }])).toThrow(TypeError)
  })
})

/** 跨页的扩展元素：每段开头一行 10 mm 的表头，数据里每条审批一行 20 mm。 */
const approvals: ExtensionElementPrototype = {
  type: 'approvals',
  category: 'data',
  order: 9,
  flow: true,
  minSize: { width: 20, height: 10 },
  defaults: { type: 'approvals', width: 80, height: 15, field: 'items' },
  properties: [...layoutProperties({ rotation: false }), property(['field'], 'data', { kind: 'dataField' }), ...behaviorProperties()],
  prepare: (element, context) => {
    const items = context.field(String(element.field))
    return {
      repeat: { height: 10, data: '审批人' },
      blocks: (Array.isArray(items) ? items : []).map(item => ({ height: Number((item as { height?: number }).height ?? 20), data: String((item as { name: string }).name) })),
    }
  },
}

const APPROVALS: PrintCoreExtension = { id: '@acme/approvals', elements: [approvals] }

function approvalsElement(overrides: Partial<ExtensionElement> = {}): PrintElement {
  return { id: 'f', type: 'approvals', x: 10, y: 20, width: 80, height: 15, field: 'items', ...overrides } as unknown as PrintElement
}

const NAMES = ['甲', '乙', '丙', '丁', '戊', '己'].map(name => ({ name }))

describe('跨页的扩展元素', () => {
  it('块依次排进正文区，放不下的整块挪到下一页，每段开头放重复块；下方的元素随之下推', () => {
    const below = { id: 'n', type: 'rect', x: 10, y: 40, width: 20, height: 10, radius: 0, rotation: 0 } as unknown as PrintElement
    const result = run(documentOf(squarePage('p', [approvalsElement(), below])), { items: NAMES }, { extensions: [APPROVALS] })
    expect(result.sheets).toHaveLength(2)
    expect(boxOf(result.sheets[0]!, 'f', 'extension')).toMatchObject({ y: 20, height: 70, data: { blocks: ['甲', '乙', '丙'], repeat: '审批人' }, fragment: { index: 0, last: false } })
    expect(boxOf(result.sheets[1]!, 'f', 'extension')).toMatchObject({ y: 0, height: 70, data: { blocks: ['丁', '戊', '己'], repeat: '审批人' }, fragment: { index: 1, last: true } })
    expect(boxOf(result.sheets[1]!, 'n', 'rect').y).toBe(75)
    expect(result.diagnostics).toEqual([])
  })

  it('只有一段时高度不小于设计高度；一块比整页正文区还高时照样放下并报 element.overflow', () => {
    const short = run(documentOf(squarePage('p', [approvalsElement({ height: 40 })])), { items: NAMES.slice(0, 1) }, { extensions: [APPROVALS] })
    expect(boxOf(short.sheets[0]!, 'f', 'extension')).toMatchObject({ height: 40, fragment: { index: 0, last: true } })
    const tall = run(documentOf(squarePage('p', [approvalsElement({ y: 0 })])), { items: [{ name: '长', height: 150 }] }, { extensions: [APPROVALS] })
    expect(tall.sheets).toHaveLength(1)
    expect(boxOf(tall.sheets[0]!, 'f', 'extension')).toMatchObject({ height: 160, data: { blocks: ['长'] }, fragment: { last: true } })
    expect(tall.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['element.overflow'])
  })

  it('设计态排成一段、按内容撑高；只能放在正文区', () => {
    const page = squarePage('p', [approvalsElement()])
    const design = layoutDesign(page, { measurer: createFakeMeasurer(), sampleData: { items: NAMES.slice(0, 2) }, extensions: [APPROVALS] })
    expect(design.body.find(box => box.elementId === 'f')).toMatchObject({ kind: 'extension', height: 50, data: { blocks: ['甲', '乙'], repeat: '审批人' } })
    const inBand = squarePage('p')
    inBand.header.default = { height: 30, elements: [approvalsElement({ y: 0 })] }
    expect(validateDocument(documentOf(inBand), { extensions: [APPROVALS] }).issues.map(issue => issue.code)).toContain('element.flowInBand')
  })

  it('跨页的给了 prepare 就能登记；块高度不是不小于 0 的有限数时抛 TypeError', () => {
    expect(() => createPrintModel([APPROVALS])).not.toThrow()
    expect(() => run(documentOf(squarePage('p', [approvalsElement()])), { items: [{ name: '坏', height: -1 }] }, { extensions: [APPROVALS] })).toThrow(TypeError)
  })
})
