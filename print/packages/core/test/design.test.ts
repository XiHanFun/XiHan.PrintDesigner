/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { DesignLayout, LayoutBox, TableLayoutBox, TextLayoutBox } from '../src'
import { describe, expect, it } from 'vitest'
import { layoutDesign, PrintLayoutError } from '../src'
import { cellStyle, createFakeMeasurer, fakeEngine, registry, simpleTable, squarePage } from './layout-helpers'

function design(page: Parameters<typeof layoutDesign>[0], options: Partial<Parameters<typeof layoutDesign>[1]> = {}): DesignLayout {
  return layoutDesign(page, { measurer: createFakeMeasurer(), ...options })
}

function find(boxes: readonly LayoutBox[], id: string): LayoutBox {
  const box = boxes.find(item => item.elementId === id)
  if (box === undefined)
    throw new Error(`no box for ${id}`)
  return box
}

function lines(boxes: readonly LayoutBox[], id: string): string[] {
  return (find(boxes, id) as TextLayoutBox).lines
}

function text(id: string, y: number, content: Record<string, unknown>): ReturnType<typeof registry.createElement<'text'>> {
  return registry.createElement('text', { id, x: 0, y, overrides: { width: 100, height: 8, content: content as never } })
}

describe('设计态排版', () => {
  it('不给示例数据时字段显示 {path} 占位，模板替换成占位，表达式显示源码', () => {
    const page = squarePage('p', [
      text('f', 0, { kind: 'field', field: 'customer.name' }),
      text('t', 10, { kind: 'template', template: '单号 {{order.no}}' }),
      text('e', 20, { kind: 'expression', expression: 'qty * price' }),
    ])
    const layout = design(page)
    expect(lines(layout.body, 'f')).toEqual(['{customer.name}'])
    expect(lines(layout.body, 't')).toEqual(['单号 {order.no}'])
    expect(lines(layout.body, 'e')).toEqual(['=qty * price'])
    expect(layout.diagnostics).toEqual([])
  })

  it('给了示例数据时按数据取值', () => {
    const page = squarePage('p', [text('f', 0, { kind: 'field', field: 'customer.name' }), text('e', 10, { kind: 'expression', expression: 'upper(name)' })])
    const layout = design(page, { sampleData: { customer: { name: '张三' }, name: 'ab' }, expressionEngine: fakeEngine })
    expect(lines(layout.body, 'f')).toEqual(['张三'])
    expect(lines(layout.body, 'e')).toEqual(['AB'])
  })

  it('表格不分页：表头、示意行、补空行与全部表尾行排在设计位置，高度不小于设计高度', () => {
    const table = simpleTable('t', 30, {
      height: 80,
      fillEmptyRows: true,
      maxRowsPerPage: 10,
      footerRows: [
        { id: 'page', placement: 'everyPage', height: 10, style: cellStyle(), cells: [{ columnId: 'name', colSpan: 1, content: { kind: 'static', text: '小计' } }, { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'page' } }] },
        { id: 'all', placement: 'lastPage', height: 10, style: cellStyle(), cells: [{ columnId: 'name', colSpan: 2, content: { kind: 'expression', expression: 'total' } }] },
      ],
    })
    const box = find(design(squarePage('p', [table])).body, 't') as TableLayoutBox
    expect([box.y, box.height]).toEqual([30, 80])
    expect(box.rows.map(row => row.role)).toEqual(['header', 'body', 'filler', 'filler', 'footer', 'footer'])
    expect(box.rows[1]!.cells.map(cell => cell.text)).toEqual(['{name}', '{qty}'])
    expect(box.rows[4]!.cells.map(cell => cell.text)).toEqual(['小计', 'sum(qty)'])
    expect(box.rows[5]!.cells.map(cell => cell.text)).toEqual(['=total'])
  })

  it('示例数据的表格只取前 sampleRows 行，汇总按这几行算', () => {
    const table = simpleTable('t', 0, {
      footerRows: [{ id: 'sum', placement: 'lastPage', height: 10, style: cellStyle(), cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'all' } }] }],
    })
    const items = Array.from({ length: 20 }, (_, index) => ({ name: `n${index}`, qty: index }))
    const box = find(design(squarePage('p', [table]), { sampleData: { items }, sampleRows: 3 }).body, 't') as TableLayoutBox
    expect(box.rows.filter(row => row.role === 'body').map(row => row.cells[0]!.text)).toEqual(['n0', 'n1', 'n2'])
    expect(box.rows.at(-1)!.cells.map(cell => [cell.columnId, cell.text])).toEqual([['qty', '3']])
  })

  it('长文本不跨页，按内容撑高，不低于设计高度', () => {
    const long = registry.createElement('longText', { id: 'l', x: 0, y: 90, overrides: { width: 100, height: 5, content: { kind: 'static', text: 'x'.repeat(400) } } })
    const box = find(design(squarePage('p', [long])).body, 'l') as TextLayoutBox
    expect(box.y).toBe(90)
    expect(box.height).toBeGreaterThan(10)
    expect(box.fragment).toEqual({ index: 0, last: true })
  })

  it('页眉页脚取指定的变体，变体不存在时用 default；页码按第 1 页共 1 页填', () => {
    const page = squarePage('p', [])
    page.header.default = { height: 10, elements: [text('hd', 0, { kind: 'static', text: '默认' })] }
    page.header.first = { height: 10, elements: [text('hf', 0, { kind: 'static', text: '首页' })] }
    page.footer.default = { height: 10, elements: [registry.createElement('pageNumber', { id: 'no', x: 0, y: 90, overrides: { width: 100, format: '{{$page}}/{{$pages}}' } })] }
    const layout = design(page, { bands: { header: 'first', footer: 'last' } })
    expect(layout.header.map(box => box.elementId)).toEqual(['hf'])
    expect(lines(layout.footer, 'no')).toEqual(['1/1'])
    expect(find(layout.footer, 'no').region).toBe('footer')
    expect(design(page).header.map(box => box.elementId)).toEqual(['hd'])
  })

  it('水印替换占位；按字段取地址的图片留空；诊断的 path 用页面模板的下标', () => {
    const page = squarePage('p', [
      registry.createElement('image', { id: 'img', x: 0, y: 0, overrides: { source: { kind: 'field', field: 'photo' } } }),
      registry.createElement('barCode', { id: 'bar', x: 0, y: 40, overrides: { format: 'ean13', content: { kind: 'field', field: 'sku' } } }),
    ])
    page.watermark = { text: '{{status}}', fontSize: 20, color: '#999999', opacity: 0.2, rotation: 30, gapX: 10, gapY: 10 }
    const layout = design(page, { pageIndex: 2 })
    expect(layout.watermark?.text).toBe('{status}')
    expect(find(layout.body, 'img')).toMatchObject({ kind: 'image', src: '' })
    expect(layout.diagnostics).toMatchObject([
      { code: 'barCode.invalidValue', severity: 'error', path: ['pages', 2, 'elements', 1], target: { kind: 'element', id: 'bar' } },
    ])
  })

  it('选项不合法时抛错', () => {
    expect(() => layoutDesign(squarePage(), {} as never)).toThrow(PrintLayoutError)
    expect(() => design(squarePage(), { sampleRows: -1 })).toThrow(PrintLayoutError)
  })
})
