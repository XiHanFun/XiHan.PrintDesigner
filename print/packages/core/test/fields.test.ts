/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 列出模板引用的字段：内置元素的各处字段来源、表格的列表上下文、模板串与表达式里的路径、水印、扩展元素的钩子。
import type { ExtensionElementPrototype, PrintCoreExtension, PrintElement } from '../src'
import { describe, expect, it } from 'vitest'
import { behaviorProperties, collectDocumentFields, layoutProperties, property } from '../src'
import { cellStyle, documentOf, registry, simpleTable, squarePage } from './layout-helpers'

function text(id: string, content: Record<string, unknown>): PrintElement {
  return registry.createElement('text', { id, x: 0, y: 0, overrides: { content: content as never } })
}

describe('collectDocumentFields', () => {
  it('文本的字段、模板与表达式里的路径都算，按首次出现的顺序去重；固定文本与 $ 开头的宿主变量不算', () => {
    const page = squarePage('p', [
      text('a', { kind: 'field', field: 'customer.name' }),
      text('b', { kind: 'template', template: '单号 {{orderNo}}，客户 {{customer.name}}，第 {{$page}} 页' }),
      text('c', { kind: 'expression', expression: 'total * rate + customer.level' }),
      text('d', { kind: 'static', text: '{{notAField}}' }),
      text('e', { kind: 'expression', expression: '1 +' }),
    ])
    expect(collectDocumentFields(documentOf(page))).toEqual([
      { name: 'customer', kind: 'object', children: [{ name: 'name', kind: 'value' }, { name: 'level', kind: 'value' }] },
      { name: 'orderNo', kind: 'value' },
      { name: 'total', kind: 'value' },
      { name: 'rate', kind: 'value' },
    ])
  })

  it('表格：dataField 记成 list，各列与汇总的行内字段挂在它下面，表尾的文本内容相对数据根', () => {
    const table = simpleTable('t', 0, {
      columns: [
        { id: 'n', title: '品名', width: 30, align: 'left', content: { kind: 'field', field: 'name' }, cellType: 'text' },
        { id: 'm', title: '规格', width: 30, align: 'left', content: { kind: 'template', template: '{{spec.size}} / {{spec.color}}' }, cellType: 'text' },
        { id: 'a', title: '金额', width: 20, align: 'right', content: { kind: 'expression', expression: 'qty * price' }, cellType: 'text' },
        { id: 'i', title: '序号', width: 20, align: 'right', content: { kind: 'rowNumber' }, cellType: 'text' },
      ],
      footerRows: [{
        id: 'f',
        placement: 'tableEnd',
        height: 8,
        style: cellStyle(),
        cells: [
          { columnId: 'n', colSpan: 2, content: { kind: 'field', field: 'remark' } },
          { columnId: 'a', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all' } },
          { columnId: 'i', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'all' } },
        ],
      }],
    } as never)
    expect(collectDocumentFields(documentOf(squarePage('p', [table])))).toEqual([
      {
        name: 'items',
        kind: 'list',
        children: [
          { name: 'name', kind: 'value' },
          { name: 'spec', kind: 'object', children: [{ name: 'size', kind: 'value' }, { name: 'color', kind: 'value' }] },
          { name: 'qty', kind: 'value' },
          { name: 'price', kind: 'value' },
          { name: 'amount', kind: 'value' },
        ],
      },
      { name: 'remark', kind: 'value' },
    ])
  })

  it('图片、富文本、条码与二维码的字段来源都算；路径里的数字下标把前一段记成 list；页面水印的模板串也算', () => {
    const page = squarePage('p', [
      registry.createElement('image', { id: 'img', x: 0, y: 0, overrides: { source: { kind: 'field', field: 'photo' } } }),
      registry.createElement('richText', { id: 'rt', x: 0, y: 10, overrides: { content: { kind: 'field', field: 'notes', source: 'html' } } }),
      registry.createElement('barCode', { id: 'bc', x: 0, y: 20, overrides: { content: { kind: 'field', field: 'lines[0].sku' } } }),
      registry.createElement('matrixCode', { id: 'qr', x: 0, y: 30, overrides: { content: { kind: 'template', template: 'https://x/{{orderNo}}' } } }),
    ])
    page.watermark = { text: '{{company}} 内部', fontSize: 20, color: '#999999', opacity: 0.2, rotation: 30, gapX: 20, gapY: 20 } as never
    expect(collectDocumentFields(documentOf(page))).toEqual([
      { name: 'company', kind: 'value' },
      { name: 'photo', kind: 'value' },
      { name: 'notes', kind: 'value' },
      { name: 'lines', kind: 'list', children: [{ name: 'sku', kind: 'value' }] },
      { name: 'orderNo', kind: 'value' },
    ])
  })

  it('页眉页脚里的元素也算，与正文同一份字段树', () => {
    const page = squarePage('p', [text('a', { kind: 'field', field: 'title' })])
    page.header.default = { height: 10, elements: [text('h', { kind: 'field', field: 'company' })] }
    expect(collectDocumentFields(documentOf(page)).map(field => field.name)).toEqual(['title', 'company'])
  })

  it('扩展元素按原型的 fields 钩子报出引用，帮手与内置元素同一套；扩展被去掉的元素不计', () => {
    const approvals: ExtensionElementPrototype = {
      type: 'approvals',
      category: 'data',
      order: 9,
      flow: false,
      minSize: { width: 10, height: 10 },
      defaults: { type: 'approvals', width: 40, height: 20, field: 'steps', title: '' },
      properties: [...layoutProperties({ rotation: false }), property(['field'], 'data', { kind: 'dataField' }), ...behaviorProperties()],
      layout: () => null,
      fields: (element, context) => [
        ...context.field(String(element.field)).map(reference => ({ ...reference, rows: [...context.field('approver'), ...context.expression('signedAt')] })),
        ...context.template(String(element.title)),
      ],
    }
    const extension: PrintCoreExtension = { id: '@acme/approvals', elements: [approvals] }
    const element = { id: 'x', type: 'approvals', x: 0, y: 0, width: 40, height: 20, field: 'steps', title: '{{flowName}}' } as unknown as PrintElement
    const doc = documentOf(squarePage('p', [element]))
    expect(collectDocumentFields(doc, { extensions: [extension] })).toEqual([
      { name: 'steps', kind: 'list', children: [{ name: 'approver', kind: 'value' }, { name: 'signedAt', kind: 'value' }] },
      { name: 'flowName', kind: 'value' },
    ])
    expect(collectDocumentFields(doc)).toEqual([])
  })
})
