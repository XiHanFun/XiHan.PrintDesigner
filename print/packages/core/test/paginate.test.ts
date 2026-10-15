/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { TableLayoutBox, TableRowLayout } from '../src'
import type { MeasureCall } from './layout-helpers'
import { formatValue } from '@xihan-ui/expression'
import { describe, expect, it } from 'vitest'
import { paginate, PrintLayoutError } from '../src'
import {
  boxesOf,
  boxOf,
  cellStyle,
  createFakeEngine,
  createFakeMeasurer,
  documentOf,
  fakeEngine,
  fakeFormatter,
  itemsOf,
  registry,
  run,
  simpleTable,
  squarePage,
  textOf,
} from './layout-helpers'

function tableSlices(result: ReturnType<typeof run>, id: string): TableLayoutBox[] {
  return result.sheets.flatMap(sheet => boxesOf(sheet, id)).filter((box): box is TableLayoutBox => box.kind === 'table')
}

function dataIndexes(box: TableLayoutBox): number[] {
  return box.rows.filter(row => row.role === 'body').map(row => row.dataIndex as number)
}

function roles(box: TableLayoutBox): TableRowLayout['role'][] {
  return box.rows.map(row => row.role)
}

function footerTexts(box: TableLayoutBox): string[] {
  return box.rows.filter(row => row.role === 'footer').map(row => row.cells.map(cell => cell.text).join('|'))
}

/** 10pt、行高倍数 1 的一行高，单位 mm。 */
const LINE_10PT = 10 * 25.4 / 72

describe('基本排版', () => {
  it('单页文档按设计坐标输出布局盒', () => {
    const text = registry.createElement('text', {
      id: 'name',
      x: 10,
      y: 10,
      overrides: { content: { kind: 'field', field: 'customer.name' } },
    })
    const result = run(documentOf(squarePage('p', [text])), { customer: { name: '张三' } })
    expect(result.diagnostics).toEqual([])
    expect(result.sheets).toHaveLength(1)
    const [sheet] = result.sheets
    expect(sheet).toMatchObject({
      pageId: 'p',
      sheetIndex: 0,
      pageNumber: 1,
      totalPages: 1,
      size: { width: 100, height: 100 },
      orientation: 'portrait',
      header: { key: 'default', rect: { x: 0, y: 0, width: 100, height: 0 } },
      footer: { key: 'default', rect: { x: 0, y: 100, width: 100, height: 0 } },
      body: { x: 0, y: 0, width: 100, height: 100 },
    })
    expect(boxOf(sheet!, 'name', 'text')).toMatchObject({
      elementType: 'text',
      region: 'body',
      x: 10,
      y: 10,
      width: 60,
      height: 8,
      lines: ['张三'],
      overflow: 'clip',
      previewOnly: false,
    })
  })

  it('同样的输入得到同样的结果，且不修改文档与数据', () => {
    const doc = documentOf(squarePage('p', [simpleTable('t', 10)]))
    const data = { items: itemsOf(30) }
    const first = run(doc, data)
    const second = run(doc, data)
    expect(first).toEqual(second)
  })

  it('图形、条码、二维码与图片按元素属性输出', () => {
    const elements = [
      registry.createElement('line', { id: 'line', x: 0, y: 5 }),
      registry.createElement('rect', { id: 'rect', x: 0, y: 10, overrides: { fill: '#eeeeee' } }),
      registry.createElement('ellipse', { id: 'ellipse', x: 50, y: 10 }),
      registry.createElement('barCode', { id: 'barCode', x: 0, y: 40, overrides: { content: { kind: 'field', field: 'sku' } } }),
      registry.createElement('matrixCode', { id: 'qr', x: 60, y: 40, overrides: { background: '#ffffff' } }),
      registry.createElement('image', { id: 'photo', x: 0, y: 60, overrides: { source: { kind: 'field', field: 'photo' }, previewOnly: true } }),
    ]
    const result = run(documentOf(squarePage('p', elements)), { sku: 'A-001', photo: 'https://example.com/a.png' })
    const [sheet] = result.sheets
    expect(boxOf(sheet!, 'line', 'line')).toMatchObject({ direction: 'horizontal', stroke: { width: 0.3 } })
    expect(boxOf(sheet!, 'rect', 'rect')).toMatchObject({ fill: '#eeeeee', radius: 0 })
    expect(boxOf(sheet!, 'ellipse', 'ellipse').stroke).toBeDefined()
    expect(boxOf(sheet!, 'barCode', 'barCode')).toMatchObject({ format: 'code128', value: 'A-001', showText: true })
    expect(boxOf(sheet!, 'qr', 'matrixCode')).toMatchObject({ format: 'qr', value: '1234567890', level: 'M', background: '#ffffff' })
    expect(boxOf(sheet!, 'photo', 'image')).toMatchObject({ src: 'https://example.com/a.png', fit: 'contain', previewOnly: true })
    expect(result.diagnostics).toEqual([])
  })
})

describe('表格分页', () => {
  it('按行批量跨页并在每页重复表头', () => {
    const result = run(documentOf(squarePage('p', [simpleTable('t', 10)])), { items: itemsOf(20) })
    expect(result.sheets).toHaveLength(3)
    const slices = tableSlices(result, 't')
    expect(slices.map(dataIndexes)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15, 16],
      [17, 18, 19],
    ])
    expect(slices.map(slice => slice.rows[0]!.role)).toEqual(['header', 'header', 'header'])
    expect(slices.map(slice => [slice.y, slice.height])).toEqual([[10, 90], [0, 100], [0, 40]])
    expect(slices.map(slice => slice.fragment)).toEqual([
      { index: 0, last: false },
      { index: 1, last: false },
      { index: 2, last: true },
    ])
    expect(slices[0]!.rows.slice(0, 3).map(row => row.y)).toEqual([10, 20, 30])
    expect(slices[0]!.rows[1]!.cells.map(cell => [cell.columnId, cell.x, cell.width, cell.align, cell.text])).toEqual([
      ['name', 0, 60, 'left', 'item-1'],
      ['qty', 60, 40, 'right', '1'],
    ])
    expect(slices[0]!.rows[0]!.cells.map(cell => cell.text)).toEqual(['品名', '数量'])
  })

  it('不重复表头时只有首段带表头', () => {
    const table = simpleTable('t', 10, { header: { visible: true, repeat: false, height: 10, style: cellStyle() } })
    const slices = tableSlices(run(documentOf(squarePage('p', [table])), { items: itemsOf(20) }), 't')
    expect(slices.map(dataIndexes)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [18, 19],
    ])
    expect(slices.map(slice => slice.rows[0]!.role)).toEqual(['header', 'body', 'body'])
  })

  it('每页表尾按本页与累计汇总，末页表尾只出现在最后一段', () => {
    const table = simpleTable('t', 10, {
      footerRows: [
        {
          id: 'subtotal',
          placement: 'everyPage',
          height: 5,
          style: cellStyle(),
          cells: [
            { columnId: 'name', colSpan: 1, content: { kind: 'static', text: '小计' } },
            { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'page' } },
          ],
        },
        {
          id: 'running',
          placement: 'everyPage',
          height: 5,
          style: cellStyle(),
          cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'cumulative' } }],
        },
        {
          id: 'total',
          placement: 'lastPage',
          height: 10,
          style: cellStyle(),
          cells: [
            { columnId: 'name', colSpan: 1, content: { kind: 'template', template: '合计 {{order}}' } },
            { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'all' } },
          ],
        },
      ],
    })
    const result = run(documentOf(squarePage('p', [table])), { items: itemsOf(20), order: 'NO.1' }, { expressionEngine: fakeEngine })
    const slices = tableSlices(result, 't')
    expect(slices.map(slice => dataIndexes(slice).length)).toEqual([7, 8, 5])
    expect(slices.map(footerTexts)).toEqual([
      ['小计|28', '28'],
      ['小计|92', '120'],
      ['小计|90', '210', '合计 NO.1|210'],
    ])
    expect(roles(slices[2]!)).toEqual(['header', 'body', 'body', 'body', 'body', 'body', 'footer', 'footer', 'footer'])
  })

  it('最后一行放不下末页表尾时连同表尾移到下一页', () => {
    const table = simpleTable('t', 10, {
      footerRows: [{
        id: 'total',
        placement: 'lastPage',
        height: 10,
        style: cellStyle(),
        cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'all' } }],
      }],
    })
    const slices = tableSlices(run(documentOf(squarePage('p', [table])), { items: itemsOf(8) }), 't')
    expect(slices.map(dataIndexes)).toEqual([[0, 1, 2, 3, 4, 5, 6], [7]])
    expect(footerTexts(slices[1]!)).toEqual(['8'])
  })

  it('汇总函数：平均、计数、最小、最大，非数字值不参与计算', () => {
    const fns = ['avg', 'count', 'min', 'max'] as const
    const table = simpleTable('t', 10, {
      footerRows: fns.map(fn => ({
        id: fn,
        placement: 'lastPage' as const,
        height: 5,
        style: cellStyle(),
        cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate' as const, fn, field: 'qty', scope: 'all' as const } }],
      })),
    })
    const items = [{ qty: '1.5' }, { qty: 'x' }, { qty: null }, { qty: -2 }, { qty: 10 }]
    const slices = tableSlices(run(documentOf(squarePage('p', [table])), { items }, { expressionEngine: fakeEngine }), 't')
    expect(footerTexts(slices[0]!)).toEqual(['3.1666666666666665', '4', '-2', '10'])
  })

  it('求和、平均、最小、最大经表达式接入点求值，计数在本包内完成', () => {
    const compiled: string[] = []
    const fns = ['sum', 'avg', 'min', 'max', 'count'] as const
    const table = simpleTable('t', 10, {
      footerRows: fns.map(fn => ({
        id: fn,
        placement: 'lastPage' as const,
        height: 5,
        style: cellStyle(),
        cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate' as const, fn, field: 'qty', scope: 'all' as const } }],
      })),
    })
    const items = itemsOf(3)
    const result = run(documentOf(squarePage('p', [table])), { items }, { expressionEngine: createFakeEngine(compiled) })
    expect(footerTexts(tableSlices(result, 't')[0]!)).toEqual(['6', '2', '1', '3', '3'])
    expect([...new Set(compiled)].sort()).toEqual(['AVG($values)', 'MAX($values)', 'MIN($values)', 'SUM($values)'])

    const withoutEngine = run(documentOf(squarePage('p', [table])), { items })
    expect(footerTexts(tableSlices(withoutEngine, 't')[0]!)).toEqual(['', '', '', '', '3'])
    expect(withoutEngine.diagnostics).toEqual([{ code: 'expression.unavailable', pageId: 'p', elementId: 't' }])
  })

  it('跨列的表尾单元格合并列宽，对齐方式逐级继承', () => {
    const table = simpleTable('t', 10, {
      footerRows: [{
        id: 'note',
        placement: 'lastPage',
        height: 10,
        style: cellStyle({ align: 'center' }),
        cells: [{ columnId: 'name', colSpan: 2, content: { kind: 'static', text: '备注' } }],
      }],
    })
    const slices = tableSlices(run(documentOf(squarePage('p', [table])), { items: [] }), 't')
    const footer = slices[0]!.rows.at(-1)!
    expect(footer.cells).toEqual([{
      columnId: 'name',
      colSpan: 2,
      x: 0,
      width: 100,
      align: 'center',
      cellType: 'text',
      text: '备注',
      lines: ['备注'],
    }])
  })

  it('每页最大行数与补空行', () => {
    const limited = simpleTable('t', 10, { maxRowsPerPage: 5, fillEmptyRows: true })
    const slices = tableSlices(run(documentOf(squarePage('p', [limited])), { items: itemsOf(12) }), 't')
    expect(slices.map(dataIndexes)).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11]])
    expect(slices.map(slice => slice.rows.filter(row => row.role === 'filler').length)).toEqual([0, 0, 3])

    const filled = simpleTable('t', 10, { fillEmptyRows: true })
    const [only] = tableSlices(run(documentOf(squarePage('p', [filled])), { items: itemsOf(2) }), 't')
    expect(roles(only!)).toEqual(['header', 'body', 'body', 'filler', 'filler', 'filler', 'filler', 'filler', 'filler'])
    expect(only!.rows.at(-1)!.cells.map(cell => cell.text)).toEqual(['', ''])
  })

  it('没有数据时只排表头、补空行与表尾，并不小于设计高度', () => {
    const table = simpleTable('t', 10, { maxRowsPerPage: 3, fillEmptyRows: true })
    const [box] = tableSlices(run(documentOf(squarePage('p', [table])), { items: [] }), 't')
    expect(roles(box!)).toEqual(['header', 'filler', 'filler', 'filler'])
    expect(box!.height).toBe(40)

    const result = run(documentOf(squarePage('p', [simpleTable('t', 10)])), {})
    expect(result.diagnostics).toEqual([{ code: 'data.notArray', pageId: 'p', elementId: 't', params: { field: 'items' } }])
    expect(tableSlices(result, 't')[0]!.height).toBe(20)
  })

  it('最小行高模式按单元格行数乘以行高撑高，固定行高模式不撑高', () => {
    const items = [{ name: 'short', qty: 1 }, { name: 'x'.repeat(60), qty: 2 }]
    const minimum = simpleTable('t', 10, { body: { rowHeight: 5, rowHeightMode: 'minimum', style: cellStyle({ lineHeight: 3.5 }) } })
    const [box] = tableSlices(run(documentOf(squarePage('p', [minimum])), { items }), 't')
    const bodyRows = box!.rows.filter(row => row.role === 'body')
    expect(bodyRows.map(row => row.height)).toEqual([5, 10.5])
    expect(bodyRows[1]!.cells[0]!.lines).toHaveLength(3)

    const fixed = simpleTable('t', 10, { body: { rowHeight: 5, rowHeightMode: 'fixed', style: cellStyle({ lineHeight: 3.5 }) } })
    const [fixedBox] = tableSlices(run(documentOf(squarePage('p', [fixed])), { items }), 't')
    expect(fixedBox!.rows.filter(row => row.role === 'body').map(row => row.height)).toEqual([5, 5])
  })

  it('单元格的字号与行高换成 CSS 像素交给度量器', () => {
    const calls: MeasureCall[] = []
    const table = simpleTable('t', 10, { body: { rowHeight: 10, rowHeightMode: 'fixed', style: cellStyle({ fontSize: 9, lineHeight: 4.5 }) } })
    paginate(documentOf(squarePage('p', [table])), { items: [{ name: 'a', qty: 1 }] }, { measurer: createFakeMeasurer(calls) })
    const { font } = calls.find(call => call.text === 'a')!
    expect(font.size).toBeCloseTo(12, 10)
    expect(font.lineHeight).toBeCloseTo(4.5 * 96 / 25.4, 10)
  })

  it('单行高于空白正文区时强制放下并给出诊断', () => {
    const table = simpleTable('t', 10, { body: { rowHeight: 120, rowHeightMode: 'fixed', style: cellStyle() } })
    const result = run(documentOf(squarePage('p', [table])), { items: itemsOf(2) })
    expect(tableSlices(result, 't').map(dataIndexes)).toEqual([[0], [1]])
    expect(result.diagnostics).toEqual([
      { code: 'table.rowOverflow', pageId: 'p', elementId: 't', params: { dataIndex: 0 } },
      { code: 'table.rowOverflow', pageId: 'p', elementId: 't', params: { dataIndex: 1 } },
    ])
  })

  it('图片、条码、二维码列输出单元格内容并检查数据', () => {
    const table = simpleTable('t', 10, {
      columns: [
        { id: 'photo', title: '图', width: 30, align: 'center', content: { kind: 'field', field: 'photo' }, cellType: 'image' },
        { id: 'sku', title: '码', width: 40, align: 'center', content: { kind: 'field', field: 'sku' }, cellType: 'barCode', barCodeFormat: 'ean8' },
        { id: 'url', title: '码', width: 30, align: 'center', content: { kind: 'field', field: 'url' }, cellType: 'matrixCode' },
      ],
    })
    const items = [
      { photo: 'https://example.com/1.png', sku: '96385074', url: 'https://example.com/1' },
      { photo: 'javascript:alert(1)', sku: '123', url: 'x' },
      { photo: ' https://example.com/3.png\n', sku: '96385074', url: 'x' },
      { photo: 'java\nscript:alert(1)', sku: '96385074', url: 'x' },
    ]
    const result = run(documentOf(squarePage('p', [table])), { items })
    const rows = tableSlices(result, 't')[0]!.rows.filter(row => row.role === 'body')
    expect(rows[0]!.cells.map(cell => [cell.cellType, cell.text, cell.lines])).toEqual([
      ['image', 'https://example.com/1.png', []],
      ['barCode', '96385074', []],
      ['matrixCode', 'https://example.com/1', []],
    ])
    expect(rows[0]!.cells[1]!.barCodeFormat).toBe('ean8')
    expect(rows.map(row => row.cells[0]!.text)).toEqual(['https://example.com/1.png', '', 'https://example.com/3.png', ''])
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['image.unsafeSource', 'barCode.invalidValue'])
  })
})

describe('下推', () => {
  it('表格之下的元素随表格延展下推，表格旁的元素不动', () => {
    const after = registry.createElement('text', { id: 'after', x: 0, y: 35, overrides: { content: { kind: 'static', text: '签字' } } })
    const beside = registry.createElement('text', { id: 'beside', x: 70, y: 15, overrides: { width: 30 } })
    const result = run(documentOf(squarePage('p', [simpleTable('t', 10), after, beside])), { items: itemsOf(20) })
    expect(result.sheets).toHaveLength(3)
    expect(boxesOf(result.sheets[2]!, 'after')).toMatchObject([{ y: 45 }])
    expect(boxesOf(result.sheets[0]!, 'beside')).toMatchObject([{ y: 15 }])
    expect(boxesOf(result.sheets[0]!, 'after')).toEqual([])
  })

  it('被推过正文区底边的元素移到下一页顶部，其下元素随之保持间距', () => {
    const first = registry.createElement('text', { id: 'sig1', x: 0, y: 35 })
    const second = registry.createElement('text', { id: 'sig2', x: 0, y: 45 })
    const result = run(documentOf(squarePage('p', [simpleTable('t', 10), first, second])), { items: itemsOf(16) })
    expect(result.sheets).toHaveLength(3)
    expect(tableSlices(result, 't').at(-1)).toMatchObject({ y: 0, height: 90 })
    expect(boxesOf(result.sheets[2]!, 'sig1')).toMatchObject([{ y: 0 }])
    expect(boxesOf(result.sheets[2]!, 'sig2')).toMatchObject([{ y: 10 }])
  })

  it('表格起点处放不下表头加一行时整体移到下一页', () => {
    const filler = registry.createElement('longText', {
      id: 'intro',
      x: 0,
      y: 0,
      overrides: { width: 100, height: 85, content: { kind: 'static', text: '' } },
    })
    const result = run(documentOf(squarePage('p', [filler, simpleTable('t', 90)])), { items: itemsOf(2) })
    expect(result.sheets).toHaveLength(2)
    expect(tableSlices(result, 't')).toMatchObject([{ y: 0, fragment: { index: 0, last: true } }])
    expect(roles(tableSlices(result, 't')[0]!)).toEqual(['header', 'body', 'body'])
    expect(boxesOf(result.sheets[0]!, 't')).toEqual([])
  })

  it('长文本之下的元素随长文本延展下推', () => {
    const remark = registry.createElement('longText', {
      id: 'remark',
      x: 0,
      y: 10,
      overrides: { width: 100, height: 10, content: { kind: 'static', text: '字'.repeat(50 * 5) } },
    })
    remark.style = { ...remark.style, fontSize: 10, lineHeight: 1 }
    const after = registry.createElement('text', { id: 'after', x: 0, y: 25 })
    const result = run(documentOf(squarePage('p', [remark, after])))
    expect(boxOf(result.sheets[0]!, 'remark', 'text').height).toBeCloseTo(5 * LINE_10PT, 10)
    expect(boxOf(result.sheets[0]!, 'after', 'text').y).toBeCloseTo(25 + 5 * LINE_10PT - 10, 10)
  })

  it('后一个表格接在前一个表格之后续排', () => {
    const second = simpleTable('t2', 40, { dataField: 'others' })
    const result = run(documentOf(squarePage('p', [simpleTable('t1', 10), second])), { items: itemsOf(3), others: itemsOf(2) })
    expect(tableSlices(result, 't1')[0]).toMatchObject({ y: 10, height: 40 })
    expect(tableSlices(result, 't2')[0]).toMatchObject({ y: 60, height: 30 })
  })

  it('表格内容比设计高度矮时保留设计高度', () => {
    const after = registry.createElement('text', { id: 'after', x: 0, y: 40 })
    const table = simpleTable('t', 10, { height: 25 })
    const result = run(documentOf(squarePage('p', [table, after])), { items: itemsOf(1) })
    expect(tableSlices(result, 't')[0]!.height).toBe(25)
    expect(boxesOf(result.sheets[0]!, 'after')).toMatchObject([{ y: 40 }])
  })

  it('布局盒按元素层级排列，不按纵坐标', () => {
    const top = registry.createElement('text', { id: 'top', x: 0, y: 0 })
    const bottom = registry.createElement('text', { id: 'bottom', x: 0, y: 50 })
    const result = run(documentOf(squarePage('p', [bottom, top])), {})
    expect(result.sheets[0]!.boxes.map(box => box.elementId)).toEqual(['bottom', 'top'])
  })

  it('被推元素高于空白正文区时放在下一页顶部并给出诊断', () => {
    const tall = registry.createElement('rect', { id: 'tall', x: 0, y: 35, overrides: { height: 60 } })
    const doc = documentOf(squarePage('p', [simpleTable('t', 10), tall]))
    doc.pages[0]!.footer.default.height = 50
    const result = run(doc, { items: itemsOf(5) })
    expect(result.sheets).toHaveLength(3)
    expect(boxesOf(result.sheets[2]!, 'tall')).toMatchObject([{ y: 0 }])
    expect(result.diagnostics).toEqual([{ code: 'element.overflow', pageId: 'p', elementId: 'tall' }])
  })
})

describe('长文本', () => {
  function longText(text: string): ReturnType<typeof registry.createElement<'longText'>> {
    const element = registry.createElement('longText', { id: 'remark', x: 0, y: 10, overrides: { width: 100, content: { kind: 'static', text } } })
    element.style = { ...element.style, fontSize: 10, lineHeight: 1 }
    return element
  }

  it('按整行切分到后续输出页', () => {
    // 正文区从 y = 10 起还剩 90 mm，放得下 25 行
    const result = run(documentOf(squarePage('p', [longText('字'.repeat(50 * 30))])))
    expect(result.sheets).toHaveLength(2)
    const [first, second] = result.sheets.map(sheet => boxOf(sheet, 'remark', 'text'))
    expect(first).toMatchObject({ y: 10, fragment: { index: 0, last: false } })
    expect(first!.height).toBeCloseTo(25 * LINE_10PT, 10)
    expect(first!.lines).toHaveLength(25)
    expect(second).toMatchObject({ y: 0, fragment: { index: 1, last: true } })
    expect(second!.height).toBeCloseTo(5 * LINE_10PT, 10)
    expect(second!.lines).toHaveLength(5)
  })

  it('内容少时保留设计高度，内边距计入每段', () => {
    const short = longText('短文本')
    expect(boxOf(run(documentOf(squarePage('p', [short]))).sheets[0]!, 'remark', 'text')).toMatchObject({ height: 20, lines: ['短文本'] })

    const padded = longText('字'.repeat(50 * 30))
    padded.box = { padding: { top: 2, right: 0, bottom: 2, left: 0 } }
    const boxes = run(documentOf(squarePage('p', [padded]))).sheets.map(sheet => boxOf(sheet, 'remark', 'text'))
    expect(boxes.map(box => box.lines.length)).toEqual([24, 6])
    expect(boxes[0]!.height).toBeCloseTo(24 * LINE_10PT + 4, 10)
    expect(boxes[1]!.height).toBeCloseTo(6 * LINE_10PT + 4, 10)
  })

  it('空文本按设计高度占位', () => {
    const box = boxOf(run(documentOf(squarePage('p', [longText('')]))).sheets[0]!, 'remark', 'text')
    expect(box).toMatchObject({ height: 20, lines: [] })
  })
})

describe('页眉页脚与页码', () => {
  function variantPage(): ReturnType<typeof squarePage> {
    const page = squarePage('p', [simpleTable('t', 20)])
    const label = (id: string, y: number): ReturnType<typeof registry.createElement<'text'>> =>
      registry.createElement('text', { id, x: 0, y, overrides: { height: 5, content: { kind: 'static', text: id } } })
    page.header.default = { height: 10, elements: [label('h-default', 0)] }
    page.header.first = { height: 20, elements: [label('h-first', 0)] }
    page.header.even = { height: 15, elements: [label('h-even', 0)] }
    page.footer.default = {
      height: 10,
      elements: [registry.createElement('pageNumber', { id: 'no', x: 0, y: 90, overrides: { height: 10 } })],
    }
    page.footer.last = { height: 30, elements: [label('f-last', 70)] }
    return page
  }

  it('首页、末页、奇偶页分别选带区，正文区随之变化', () => {
    const result = run(documentOf(variantPage()), { items: itemsOf(20) })
    expect(result.sheets.map(sheet => [sheet.header.key, sheet.footer.key])).toEqual([
      ['first', 'default'],
      ['even', 'default'],
      ['default', 'default'],
      ['even', 'last'],
    ])
    expect(result.sheets.map(sheet => [sheet.body.y, sheet.body.height])).toEqual([[20, 70], [15, 75], [10, 80], [15, 55]])
    expect(tableSlices(result, 't').map(slice => dataIndexes(slice).length)).toEqual([6, 6, 7, 1])
    expect(result.sheets.map(sheet => sheet.boxes.map(box => box.elementId))).toEqual([
      ['h-first', 't', 'no'],
      ['h-even', 't', 'no'],
      ['h-default', 't', 'no'],
      ['h-even', 't', 'f-last'],
    ])
    expect(result.sheets.map(sheet => sheet.boxes[0]!.region)).toEqual(['header', 'header', 'header', 'header'])
    expect(result.diagnostics).toEqual([])
  })

  it('页码按 numeral 转成中文或罗马数字后填进模板，没有格式化器时用阿拉伯数字并给出诊断', () => {
    const page = squarePage('p', [registry.createElement('pageNumber', { id: 'no', x: 0, y: 0, overrides: { width: 100, format: '第{{$page}}页 共{{$pages}}页', numeral: 'cn-lower' } })])
    expect(boxOf(run(documentOf(page), {}, { formatter: formatValue }).sheets[0]!, 'no', 'text').lines).toEqual(['第一页 共一页'])
    const plain = run(documentOf(page))
    expect(boxOf(plain.sheets[0]!, 'no', 'text').lines).toEqual(['第1页 共1页'])
    expect(plain.diagnostics).toEqual([{ code: 'format.unavailable', pageId: 'p', elementId: 'no' }])
  })

  it('页码连续编号，总页数按编号段计算', () => {
    const first = squarePage('a', [simpleTable('t1', 10)])
    first.footer.default = {
      height: 10,
      elements: [registry.createElement('pageNumber', { id: 'no-a', x: 0, y: 90, overrides: { height: 10 } })],
    }
    const second = squarePage('b', [registry.createElement('pageNumber', { id: 'no-b', x: 0, y: 0, overrides: { format: '第{{$page}}页/共{{$pages}}页', width: 100 } })])
    const third = squarePage('c', [registry.createElement('pageNumber', { id: 'no-c', x: 0, y: 0 })])
    third.numbering = { continuous: false, start: 5 }
    const result = run(documentOf(first, second, third), { items: itemsOf(20) })
    expect(result.sheets.map(sheet => [sheet.pageId, sheet.pageNumber, sheet.totalPages])).toEqual([
      ['a', 1, 4],
      ['a', 2, 4],
      ['a', 3, 4],
      ['b', 4, 4],
      ['c', 5, 1],
    ])
    expect(result.sheets.slice(0, 3).map(sheet => textOf(sheet, 'no-a'))).toEqual(['1/4', '2/4', '3/4'])
    expect(textOf(result.sheets[3]!, 'no-b')).toBe('第4页/共4页')
    expect(textOf(result.sheets[4]!, 'no-c')).toBe('5/1')
  })

  it('末页页脚更高而放不下时补一张只有页眉页脚的末页', () => {
    const page = squarePage('p', [simpleTable('t', 0, { height: 10 })])
    page.footer.last = { height: 40, elements: [] }
    const result = run(documentOf(page), { items: itemsOf(9) })
    expect(result.sheets.map(sheet => sheet.footer.key)).toEqual(['default', 'last'])
    expect(tableSlices(result, 't').map(dataIndexes)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8]])
    expect(result.sheets[1]!.boxes).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('正文中被下推的页码取所在输出页的页码', () => {
    const number = registry.createElement('pageNumber', { id: 'no', x: 0, y: 35 })
    const result = run(documentOf(squarePage('p', [simpleTable('t', 10), number])), { items: itemsOf(20) })
    expect(result.sheets).toHaveLength(3)
    expect(textOf(result.sheets[2]!, 'no')).toBe('3/3')
    expect(boxesOf(result.sheets[0]!, 'no')).toEqual([])
  })

  it('只有一张输出页时按 singleSheet 选首页或末页变体', () => {
    const page = (singleSheet: 'first' | 'last'): ReturnType<typeof squarePage> => {
      const result = squarePage('p')
      result.footer = { ...result.footer, first: { height: 5, elements: [] }, last: { height: 8, elements: [] }, singleSheet }
      return result
    }
    expect(run(documentOf(page('last'))).sheets[0]!.footer.key).toBe('last')
    expect(run(documentOf(page('first'))).sheets[0]!.footer.key).toBe('first')
  })

  it('页码文字按页码格式测量，不折行', () => {
    const calls: MeasureCall[] = []
    const page = squarePage('p', [registry.createElement('pageNumber', { id: 'no', x: 0, y: 0 })])
    paginate(documentOf(page), {}, { measurer: createFakeMeasurer(calls) })
    expect(calls.map(call => call.text)).toEqual(['1/1'])
  })
})

describe('取值、表达式与格式', () => {
  it('文本内容的四种来源与值格式', () => {
    const elements = [
      registry.createElement('text', { id: 'static', x: 0, y: 0, overrides: { content: { kind: 'static', text: '固定' } } }),
      registry.createElement('text', { id: 'field', x: 0, y: 10, overrides: { content: { kind: 'field', field: 'amount', format: { kind: 'number', decimals: 2, grouping: true } } } }),
      registry.createElement('text', { id: 'empty', x: 0, y: 20, overrides: { content: { kind: 'field', field: 'missing', emptyText: '-' } } }),
      registry.createElement('text', { id: 'template', x: 0, y: 30, overrides: { content: { kind: 'template', template: '{{customer.name}}（{{customer.code}}）' } } }),
      registry.createElement('text', { id: 'expr', x: 0, y: 40, overrides: { content: { kind: 'expression', expression: 'upper(name)' } } }),
      registry.createElement('text', { id: 'formatExpr', x: 0, y: 50, overrides: { content: { kind: 'field', field: 'n', format: { kind: 'expression', expression: 'value + 1' } } } }),
      registry.createElement('text', { id: 'exprFormat', x: 0, y: 60, overrides: { content: { kind: 'expression', expression: 'qty * price', format: { kind: 'rmb-upper' } } } }),
      registry.createElement('text', { id: 'map', x: 0, y: 70, overrides: { content: { kind: 'field', field: 'gender', format: { kind: 'map', entries: [{ value: '1', text: '男' }, { value: '2', text: '女' }] } } } }),
    ]
    const data = { amount: 1234.5, customer: { name: '张三', code: 'C01' }, name: 'abc', n: 41, qty: 2, price: 50.25, gender: 2 }
    const result = run(documentOf(squarePage('p', elements)), data, { expressionEngine: fakeEngine, formatter: fakeFormatter })
    const sheet = result.sheets[0]!
    expect(['static', 'field', 'empty', 'template', 'expr', 'formatExpr', 'exprFormat', 'map'].map(id => textOf(sheet, id))).toEqual([
      '固定',
      'number:1234.5',
      '-',
      '张三（C01）',
      'ABC',
      '42',
      'rmb-upper:100.5',
      '女',
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('表格表达式列以行对象为变量', () => {
    const table = simpleTable('t', 10, {
      columns: [
        { id: 'name', title: '品名', width: 50, align: 'left', content: { kind: 'template', template: '{{name}}×{{qty}}' }, cellType: 'text' },
        { id: 'amount', title: '金额', width: 50, align: 'right', content: { kind: 'expression', expression: 'qty * price', format: { kind: 'number', decimals: 2 } }, cellType: 'text' },
      ],
    })
    const compiled: string[] = []
    const items = [{ name: 'A', qty: 3, price: 1.5 }, { name: 'B', qty: 2, price: 2 }]
    const result = run(documentOf(squarePage('p', [table])), { items }, { expressionEngine: createFakeEngine(compiled), formatter: fakeFormatter })
    const rows = tableSlices(result, 't')[0]!.rows.filter(row => row.role === 'body')
    expect(rows.map(row => row.cells.map(cell => cell.text))).toEqual([['A×3', 'number:4.5'], ['B×2', 'number:4']])
    expect(compiled.filter(source => source === 'qty * price')).toHaveLength(2)
  })

  it('没有求值接口、求值失败与结果不是标量时给出诊断', () => {
    const elements = [
      registry.createElement('text', { id: 'a', x: 0, y: 0, overrides: { content: { kind: 'expression', expression: 'upper(name)' } } }),
    ]
    const missing = run(documentOf(squarePage('p', elements)), { name: 'x' })
    expect(textOf(missing.sheets[0]!, 'a')).toBe('')
    expect(missing.diagnostics).toEqual([{ code: 'expression.unavailable', pageId: 'p', elementId: 'a' }])

    const failing = [
      registry.createElement('text', { id: 'bad', x: 0, y: 0, overrides: { content: { kind: 'expression', expression: 'fail' } } }),
      registry.createElement('text', { id: 'obj', x: 0, y: 10, overrides: { content: { kind: 'expression', expression: 'obj' } } }),
    ]
    const result = run(documentOf(squarePage('p', failing)), {}, { expressionEngine: fakeEngine })
    expect(result.diagnostics).toEqual([
      { code: 'expression.failed', pageId: 'p', elementId: 'bad', params: { reason: 'XH_EXPR_FUNCTION_FAILED' } },
      { code: 'data.notScalar', pageId: 'p', elementId: 'obj' },
    ])
  })

  it('同一元素的同一问题只报告一次', () => {
    const table = simpleTable('t', 10, {
      columns: [{ id: 'qty', title: '数量', width: 100, align: 'right', content: { kind: 'field', field: 'qty', format: { kind: 'number', decimals: 0 } }, cellType: 'text' }],
    })
    const result = run(documentOf(squarePage('p', [table])), { items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }] })
    expect(result.diagnostics).toEqual([{ code: 'format.unavailable', pageId: 'p', elementId: 't' }])
    expect(tableSlices(result, 't')[0]!.rows.filter(row => row.role === 'body').map(row => row.cells[0]!.text)).toEqual(['1', '2', '3'])
  })

  it('格式化器收到原值与格式说明，汇总值为表达式接入点的求值结果', () => {
    const calls: [unknown, string][] = []
    const format = (value: unknown, spec: { kind: string }): string => {
      calls.push([value, spec.kind])
      return String(value)
    }
    const table = simpleTable('t', 10, {
      footerRows: [{
        id: 'total',
        placement: 'lastPage',
        height: 10,
        style: cellStyle(),
        cells: [{ columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'all', format: { kind: 'number', decimals: 2 } } }],
      }],
    })
    const at = registry.createElement('text', { id: 'at', x: 0, y: 60, overrides: { content: { kind: 'field', field: 'at', format: { kind: 'date', pattern: 'YYYY-MM-DD' } } } })
    const result = run(documentOf(squarePage('p', [table, at])), { items: [{ qty: 1 }, { qty: 2 }], at: '2026-10-16' }, { formatter: format, expressionEngine: fakeEngine })
    expect(calls).toEqual([['2026-10-16', 'date'], [3, 'number']])
    expect(footerTexts(tableSlices(result, 't')[0]!)).toEqual(['3'])
  })

  it('区域与时区原样交给格式化器', () => {
    const received: unknown[] = []
    const format = (_value: unknown, _spec: unknown, options: unknown): string => {
      received.push(options)
      return 'ok'
    }
    const text = registry.createElement('text', { id: 't', x: 0, y: 0, overrides: { content: { kind: 'field', field: 'n', format: { kind: 'number', decimals: 1 } } } })
    run(documentOf(squarePage('p', [text])), { n: 1 }, { formatter: format, locale: 'de-DE', timeZone: 'Asia/Shanghai' })
    run(documentOf(squarePage('p', [text])), { n: 1 }, { formatter: format })
    expect(received).toEqual([{ locale: 'de-DE', timeZone: 'Asia/Shanghai' }, {}])
  })

  it('格式化器报错时显示原值并诊断问题码', () => {
    const format = (): string => {
      throw new TypeError('XH_EXPR_FORMAT_OUT_OF_RANGE')
    }
    const text = registry.createElement('text', { id: 't', x: 0, y: 0, overrides: { content: { kind: 'field', field: 'n', format: { kind: 'rmb-upper' } } } })
    const result = run(documentOf(squarePage('p', [text])), { n: 1e20 }, { formatter: format })
    expect(textOf(result.sheets[0]!, 't')).toBe('100000000000000000000')
    expect(result.diagnostics).toEqual([
      { code: 'format.failed', pageId: 'p', elementId: 't', params: { reason: 'XH_EXPR_FORMAT_OUT_OF_RANGE' } },
    ])
  })

  it('格式化器返回的不是字符串时抛错', () => {
    const text = registry.createElement('text', { id: 't', x: 0, y: 0, overrides: { content: { kind: 'field', field: 'n', format: { kind: 'percent', decimals: 0 } } } })
    const format = (): string => 1 as unknown as string
    try {
      paginate(documentOf(squarePage('p', [text])), { n: 1 }, { measurer: createFakeMeasurer(), formatter: format })
      throw new Error('expected an error')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PrintLayoutError)
      expect((error as PrintLayoutError).code).toBe('formatter.invalidResult')
    }
  })

  it('水印替换占位', () => {
    const page = squarePage('p')
    page.watermark = { text: '{{status}}', fontSize: 40, color: '#cccccc', opacity: 0.3, rotation: 30, gapX: 30, gapY: 30 }
    const result = run(documentOf(page), { status: '作废' })
    expect(result.sheets[0]!.watermark).toEqual({ ...page.watermark, text: '作废' })
  })
})

describe('固定尺寸文本', () => {
  function shrinking(text: string): ReturnType<typeof registry.createElement<'text'>> {
    const element = registry.createElement('text', { id: 's', x: 0, y: 0, overrides: { width: 20, height: 5, overflow: 'shrink', content: { kind: 'static', text } } })
    element.style = { ...element.style, fontSize: 10 }
    return element
  }

  it('缩小字号直到容纳', () => {
    const box = boxOf(run(documentOf(squarePage('p', [shrinking('a'.repeat(15))]))).sheets[0]!, 's', 'text')
    expect(box.style.fontSize).toBe(6.5)
    expect(box.overflow).toBe('clip')
  })

  it('缩到最小字号仍放不下时给出诊断', () => {
    const result = run(documentOf(squarePage('p', [shrinking('a'.repeat(200))])))
    expect(boxOf(result.sheets[0]!, 's', 'text').style.fontSize).toBe(4)
    expect(result.diagnostics).toEqual([{ code: 'text.overflow', pageId: 'p', elementId: 's', params: { fontSize: 4 } }])
  })

  it('按内边距与换行设置测量', () => {
    const calls: MeasureCall[] = []
    // 去掉内边距可用 40 mm，10.5pt 每字 2.1 mm，一行放 19 个
    const element = registry.createElement('text', {
      id: 't',
      x: 0,
      y: 0,
      overrides: { width: 50, wrap: true, overflow: 'visible', box: { padding: { top: 1, right: 4, bottom: 1, left: 6 } }, content: { kind: 'static', text: 'x'.repeat(20) } },
    })
    const result = paginate(documentOf(squarePage('p', [element])), {}, { measurer: createFakeMeasurer(calls) })
    expect(calls[0]!.font).toMatchObject({ family: 'sans-serif', weight: 400, style: 'normal' })
    expect(calls[0]!.font.size).toBeCloseTo(14, 10)
    expect(calls[0]!.font.lineHeight).toBeCloseTo(16.8, 10)
    expect(boxOf(result.sheets[0]!, 't', 'text')).toMatchObject({ lines: ['x'.repeat(19), 'x'], overflow: 'visible', box: { padding: { left: 6 } } })
  })
})

describe('错误与上限', () => {
  it('文档有 error 级问题时抛错并附上问题', () => {
    const text = registry.createElement('text', { id: 't', x: 0, y: 0 })
    text.style = { ...text.style, color: 'red' }
    try {
      paginate(documentOf(squarePage('p', [text])), {}, { measurer: createFakeMeasurer() })
      throw new Error('expected an error')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PrintLayoutError)
      expect((error as PrintLayoutError).code).toBe('document.invalid')
      expect((error as PrintLayoutError).issues.map(issue => issue.code)).toEqual(['invalid-color'])
    }
  })

  it('表达式编译失败时按文档不合法抛错', () => {
    const text = registry.createElement('text', { id: 't', x: 0, y: 0, overrides: { content: { kind: 'expression', expression: 'unknown(' } } })
    try {
      paginate(documentOf(squarePage('p', [text])), {}, { measurer: createFakeMeasurer(), expressionEngine: fakeEngine })
      throw new Error('expected an error')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PrintLayoutError)
      expect((error as PrintLayoutError).issues.map(issue => [issue.code, issue.params?.code])).toEqual([['expression.invalid', 'XH_EXPR_UNKNOWN_FUNCTION']])
    }
  })

  it('选项不合法时抛错', () => {
    const doc = documentOf(squarePage('p'))
    const expectOption = (options: unknown, option: string): void => {
      try {
        paginate(doc, {}, options as never)
        throw new Error('expected an error')
      }
      catch (error) {
        expect(error).toBeInstanceOf(PrintLayoutError)
        expect((error as PrintLayoutError).params).toEqual({ option })
      }
    }
    expectOption({}, 'measurer')
    expectOption({ measurer: createFakeMeasurer(), maxSheets: 0 }, 'maxSheets')
    expectOption({ measurer: createFakeMeasurer(), maxSheets: 1.5 }, 'maxSheets')
    expectOption({ measurer: createFakeMeasurer(), formatter: 'number' }, 'formatter')
  })

  it('测量结果不合法时抛错', () => {
    const text = registry.createElement('text', { id: 't', x: 0, y: 0, overrides: { content: { kind: 'static', text: 'x' } } })
    const measurer = { version: 0, measure: () => ({ width: Number.NaN, ascent: 0, descent: 0 }) }
    expect(() => paginate(documentOf(squarePage('p', [text])), {}, { measurer })).toThrow(PrintLayoutError)
  })

  it('达到输出页上限时停止并给出诊断', () => {
    const doc = documentOf(squarePage('a', [simpleTable('t', 10)]), squarePage('b'))
    const result = run(doc, { items: itemsOf(100) }, { maxSheets: 2 })
    expect(result.sheets.map(sheet => sheet.pageId)).toEqual(['a', 'a'])
    expect(result.diagnostics).toEqual([
      { code: 'layout.sheetLimit', pageId: 'a', elementId: 't', params: { limit: 2 } },
      { code: 'layout.sheetLimit', pageId: 'b', params: { limit: 2 } },
    ])
  })
})
