/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEngine, PrintDocument, PrintElement, ValidationIssue, ValidationReport } from '../src'
import { describe, expect, it } from 'vitest'
import {
  cloneJson,
  createBuiltinElementPrototypes,
  createDocument,
  createElementRegistry,
  createPage,
  PRINT_ELEMENT_TYPES,
  validateDocument,
  VALIDATION_ISSUE_SEVERITIES,
} from '../src'
import { createSampleDocument, createSampleTable } from './fixtures'

const registry = createElementRegistry()

function summarize(report: ValidationReport): string[] {
  return report.issues.map(issue => `${issue.code}@${issue.path.join('.')}`)
}

function issuesOf(input: unknown): string[] {
  return summarize(validateDocument(input))
}

function first(input: unknown): ValidationIssue {
  const [issue] = validateDocument(input).issues
  if (issue === undefined)
    throw new Error('expected an issue')
  return issue
}

/** 生成只含一页、页面正文放入给定元素的文档。 */
function withBody(...elements: unknown[]): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = elements as PrintElement[]
  return createDocument({ pages: [page] })
}

function element<TType extends PrintElement['type']>(
  type: TType,
  id: string,
  overrides: Record<string, unknown> = {},
  position: { x: number, y: number } = { x: 20, y: 40 },
): Record<string, unknown> {
  return { ...registry.createElement(type, { id, ...position }), ...overrides }
}

describe('合法文档', () => {
  it('完整样例文档没有任何问题', () => {
    const report = validateDocument(createSampleDocument())
    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  })

  it('样例文档经 JSON 往返后仍然合法', () => {
    const roundTrip = JSON.parse(JSON.stringify(createSampleDocument())) as unknown
    expect(validateDocument(roundTrip).issues).toEqual([])
  })

  it('各类型默认元素放进正文后没有 error，只有提示未绑定的 warning', () => {
    const elements = PRINT_ELEMENT_TYPES.map((type, index) =>
      registry.createElement(type, { id: `e${index}`, x: 15, y: 30 + index * 2 }),
    )
    const report = validateDocument(withBody(...elements))
    expect(report.valid).toBe(true)
    expect(summarize(report)).toEqual([
      'field.empty@pages.0.elements.2.dataField',
      'field.empty@pages.0.elements.2.columns.0.content.field',
      'field.empty@pages.0.elements.2.columns.1.content.field',
      'field.empty@pages.0.elements.2.columns.2.content.field',
      'image.emptySource@pages.0.elements.3.source.url',
    ])
  })

  it('全部问题码都有固定的严重程度', () => {
    for (const severity of Object.values(VALIDATION_ISSUE_SEVERITIES))
      expect(['error', 'warning']).toContain(severity)
  })
})

describe('模板须为纯 JSON', () => {
  it('报告非 JSON 值并带上页面与元素定位', () => {
    const doc = withBody(element('rect', 'r', { width: Number.NaN }))
    const report = validateDocument(doc)
    expect(report.valid).toBe(false)
    expect(report.issues[0]).toEqual({
      code: 'json.invalidValue',
      severity: 'error',
      path: ['pages', 0, 'elements', 0, 'width'],
      pageId: 'p',
      elementId: 'r',
      params: { kind: 'nonFiniteNumber' },
    })
    expect(report.issues).toHaveLength(1)
  })

  it('报告函数、日期与循环引用', () => {
    const doc = withBody(element('rect', 'r')) as unknown as Record<string, unknown>
    doc.meta = { fn: () => 1, at: new Date(0) } as never
    const meta = doc.meta as Record<string, unknown>
    meta.self = meta
    expect(issuesOf(doc)).toEqual([
      'json.invalidValue@meta.fn',
      'json.invalidValue@meta.at',
      'json.circular@meta.self',
    ])
  })
})

describe('文档结构', () => {
  it('根不是对象', () => {
    expect(issuesOf(null)).toEqual(['schema.invalidType@'])
    expect(first([]).params).toEqual({ expected: 'object' })
  })

  it('缺少或不支持的版本号只报告版本问题', () => {
    expect(issuesOf({ pages: 'x' })).toEqual(['schema.missingProperty@schemaVersion'])
    expect(issuesOf({ schemaVersion: '1', pages: [] })).toEqual(['schema.invalidType@schemaVersion'])
    const unsupported = first({ schemaVersion: 2, pages: 'x' })
    expect(unsupported.code).toBe('schema.unsupportedVersion')
    expect(unsupported.params).toEqual({ version: 2, supported: 1 })
  })

  it('没有页面、未知属性与错误类型', () => {
    expect(issuesOf({ schemaVersion: 1, pages: [], extra: true, name: 1 })).toEqual([
      'schema.invalidType@name',
      'document.noPages@pages',
      'schema.unknownProperty@extra',
    ])
    expect(issuesOf({ schemaVersion: 1 })).toEqual(['schema.missingProperty@pages'])
  })

  it('页面与元素标识在整份文档内唯一', () => {
    const doc = createSampleDocument()
    doc.pages[1]!.id = 'page-1'
    doc.pages[1]!.elements[0]!.id = 'title'
    expect(issuesOf(doc)).toEqual([
      'id.duplicate@pages.1.id',
      'id.duplicate@pages.1.elements.0.id',
    ])
  })
})

describe('页面', () => {
  it('纸张预设与尺寸不符、方向与边距不合法', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.paper = { preset: 'A4', width: 200, height: 297 }
    page.orientation = 'upside'
    page.margins = { top: -1, right: 0, bottom: 0, left: 0 }
    const issues = issuesOf({ schemaVersion: 1, pages: [page] })
    expect(issues).toEqual([
      'page.presetMismatch@pages.0.paper',
      'value.invalidOption@pages.0.orientation',
      'value.outOfRange@pages.0.margins.top',
    ])
  })

  it('边距吃掉整张纸、页眉页脚撑满内容区', () => {
    const noContent = createPage({ id: 'p', paper: { width: 50, height: 50 }, margins: 25 })
    expect(issuesOf(createDocument({ pages: [noContent] }))).toEqual(['page.noContentArea@pages.0.margins'])

    const crowded = createPage({ id: 'p', paper: { width: 100, height: 100 }, margins: 0 })
    crowded.header.first = { height: 60, elements: [] }
    crowded.footer.last = { height: 40, elements: [] }
    const report = validateDocument(createDocument({ pages: [crowded] }))
    expect(summarize(report)).toEqual(['page.bandsOverflow@pages.0'])
    expect(report.issues[0]!.params).toEqual({ header: 'first', footer: 'last' })
    expect(report.issues[0]!.pageId).toBe('p')
  })

  it('页眉页脚结构、页码规则与水印', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.header = { singleSheet: 'middle', odd: { height: 5 } }
    page.numbering = { continuous: 'yes', start: 1.5 }
    page.watermark = { text: ' {{a b}}', fontSize: 0, color: 'red', opacity: 2, rotation: 0, gapX: 10, gapY: -1 }
    expect(issuesOf({ schemaVersion: 1, pages: [page] })).toEqual([
      'schema.missingProperty@pages.0.header.default',
      'schema.missingProperty@pages.0.header.odd.elements',
      'value.invalidOption@pages.0.header.singleSheet',
      'schema.invalidType@pages.0.numbering.continuous',
      'value.notInteger@pages.0.numbering.start',
      'template.invalidPath@pages.0.watermark.text',
      'value.outOfRange@pages.0.watermark.fontSize',
      'value.invalidColor@pages.0.watermark.color',
      'value.outOfRange@pages.0.watermark.opacity',
      'value.outOfRange@pages.0.watermark.gapY',
    ])
  })

  it('空白水印文字给出 warning', () => {
    const page = createPage({ id: 'p' })
    page.watermark = { text: '  ', fontSize: 30, color: '#999', opacity: 0.2, rotation: 45, gapX: 10, gapY: 10 }
    const report = validateDocument(createDocument({ pages: [page] }))
    expect(summarize(report)).toEqual(['watermark.emptyText@pages.0.watermark.text'])
    expect(report.valid).toBe(true)
  })
})

describe('元素通用规则', () => {
  it('缺少标识与类型、未知类型', () => {
    expect(issuesOf(withBody({ x: 1 }))).toEqual([
      'schema.missingProperty@pages.0.elements.0.id',
      'schema.missingProperty@pages.0.elements.0.type',
    ])
    const unknown = first(withBody({ id: 'u', type: 'chart' }))
    expect(unknown).toMatchObject({ code: 'element.unknownType', elementId: 'u', params: { type: 'chart' } })
    expect(issuesOf(withBody({ id: '', type: 'rect' }))[0]).toBe('value.empty@pages.0.elements.0.id')
  })

  it('按属性描述报告缺失、类型错误、取值越界与未知属性', () => {
    const text = element('text', 't')
    const style = text.style as Record<string, unknown>
    delete style.fontSize
    style.color = '#12'
    style.align = 'middle'
    style.fontSizee = 12
    text.wrap = 'no'
    text.rotation = 720
    text.colour = '#000'
    expect(issuesOf(withBody(text))).toEqual([
      'value.outOfRange@pages.0.elements.0.rotation',
      'schema.missingProperty@pages.0.elements.0.style.fontSize',
      'value.invalidColor@pages.0.elements.0.style.color',
      'value.invalidOption@pages.0.elements.0.style.align',
      'schema.unknownProperty@pages.0.elements.0.style.fontSizee',
      'schema.invalidType@pages.0.elements.0.wrap',
      'schema.unknownProperty@pages.0.elements.0.colour',
    ])
  })

  it('缺少整个必填对象时只报告一次', () => {
    const table = element('table', 't')
    delete table.header
    table.box = 'x'
    expect(issuesOf(withBody(table))).toContain('schema.missingProperty@pages.0.elements.0.header')
    expect(issuesOf(withBody(table)).filter(code => code.includes('header'))).toHaveLength(1)
  })

  it('结构有 error 时不再校验几何与专属规则', () => {
    const line = element('line', 'l', { width: 0, stroke: { width: 0, style: 'solid', color: '#000' } })
    expect(issuesOf(withBody(line))).toEqual(['value.outOfRange@pages.0.elements.0.stroke.width'])
  })

  it('尺寸下限与超出纸张', () => {
    const tiny = element('qrcode', 'q', { width: 2, height: 2 })
    const outside = element('rect', 'r', { x: 200, width: 20 })
    const report = validateDocument(withBody(tiny, outside))
    expect(summarize(report)).toEqual([
      'element.tooSmall@pages.0.elements.0',
      'element.outsidePaper@pages.0.elements.1',
    ])
    expect(report.issues[0]!.params).toEqual({ minWidth: 5, minHeight: 5 })
  })

  it('页眉页脚中的元素越出带区、放入跨页元素', () => {
    const page = createPage({ id: 'p' })
    page.header.default = {
      height: 20,
      elements: [
        registry.createElement('text', { id: 'inside', x: 10, y: 10 }),
        registry.createElement('text', { id: 'below', x: 10, y: 25 }),
        registry.createElement('longText', { id: 'flow', x: 10, y: 10, overrides: { height: 5 } }),
      ],
    }
    const report = validateDocument(createDocument({ pages: [page] }))
    expect(summarize(report)).toEqual([
      'element.outsideBand@pages.0.header.default.elements.1',
      'element.flowInBand@pages.0.header.default.elements.2',
    ])
    expect(report.issues[0]).toMatchObject({ elementId: 'below', params: { region: 'header' } })
  })

  it('跨页元素越出正文区', () => {
    const page = createPage({ id: 'p' })
    page.header.default.height = 30
    page.elements = [registry.createElement('longText', { id: 'remark', x: 10, y: 20 })]
    expect(issuesOf(createDocument({ pages: [page] }))).toEqual(['element.flowOutsideBody@pages.0.elements.0'])
  })

  it('只登记部分类型时其余类型视为未知', () => {
    const shapes = createElementRegistry(createBuiltinElementPrototypes().filter(prototype => prototype.category === 'shape'))
    const report = validateDocument(withBody(element('text', 't'), element('rect', 'r')), { registry: shapes })
    expect(summarize(report)).toEqual(['element.unknownType@pages.0.elements.0.type'])
  })
})

describe('内容来源与格式', () => {
  it('文本内容的三种来源', () => {
    const missingKind = element('text', 'a', { content: { text: 'x' } })
    const badKind = element('text', 'b', { content: { kind: 'html', html: '<b>' } })
    const badField = element('text', 'c', { content: { kind: 'field', field: 'a..b' } })
    const badTemplate = element('text', 'd', { content: { kind: 'template', template: '{{a}' } })
    const extra = element('text', 'e', { content: { kind: 'static', text: 'x', field: 'y' } })
    expect(issuesOf(withBody(missingKind, badKind, badField, badTemplate, extra))).toEqual([
      'schema.missingProperty@pages.0.elements.0.content.kind',
      'value.invalidOption@pages.0.elements.1.content.kind',
      'field.invalidPath@pages.0.elements.2.content.field',
      'template.unclosedPlaceholder@pages.0.elements.3.content.template',
      'schema.unknownProperty@pages.0.elements.4.content.field',
    ])
  })

  it('值格式', () => {
    const formats = [
      { kind: 'number', decimals: 1.5, thousands: true },
      { kind: 'percent', decimals: 30 },
      { kind: 'date', pattern: '' },
      { kind: 'map', entries: [{ value: '1', text: '已付' }, { value: '1', text: '重复' }] },
      { kind: 'currency' },
    ]
    const elements = formats.map((format, index) =>
      element('text', `t${index}`, { content: { kind: 'field', field: 'v', format } }),
    )
    expect(issuesOf(withBody(...elements))).toEqual([
      'value.notInteger@pages.0.elements.0.content.format.decimals',
      'value.outOfRange@pages.0.elements.1.content.format.decimals',
      'value.empty@pages.0.elements.2.content.format.pattern',
      'format.duplicateMapValue@pages.0.elements.3.content.format.entries.1.value',
      'value.invalidOption@pages.0.elements.4.content.format.kind',
    ])
  })

  it('图片地址只接受会被当作图片加载的协议', () => {
    const urls = [
      'https://a.com/x.png',
      'http://a.com/x.png',
      'data:image/png;base64,AAAA',
      'blob:https://a.com/1',
      './x.png',
      '/x.png',
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      'vbscript:x',
    ]
    const elements = urls.map((url, index) => element('image', `i${index}`, { source: { kind: 'static', url } }))
    expect(issuesOf(withBody(...elements))).toEqual([6, 7, 8, 9, 10, 11].map(
      index => `image.unsafeSource@pages.0.elements.${index}.source.url`,
    ))
  })

  it('页码格式需要记号', () => {
    const none = element('pageNumber', 'a', { format: '页码' })
    const unknown = element('pageNumber', 'b', { format: '{current}/{pages}' })
    const report = validateDocument(withBody(none, unknown))
    expect(summarize(report)).toEqual([
      'pageNumber.noToken@pages.0.elements.0.format',
      'pageNumber.unknownToken@pages.0.elements.1.format',
    ])
    expect(report.issues[1]!.params).toEqual({ token: 'pages' })
  })
})

describe('表格', () => {
  function tableDoc(mutate: (table: Record<string, unknown>) => void): PrintDocument {
    const table = cloneJson(createSampleTable()) as unknown as Record<string, unknown>
    mutate(table)
    return withBody(table)
  }

  const columnsOf = (table: Record<string, unknown>): Record<string, unknown>[] => table.columns as Record<string, unknown>[]
  const rowsOf = (table: Record<string, unknown>): Record<string, unknown>[] => table.footerRows as Record<string, unknown>[]
  const cellsOf = (table: Record<string, unknown>, row: number): Record<string, unknown>[] =>
    rowsOf(table)[row]!.cells as Record<string, unknown>[]

  it('样例表格合法', () => {
    expect(issuesOf(tableDoc(() => {}))).toEqual([])
  })

  it('没有列、列宽合计与表格宽度不符', () => {
    expect(issuesOf(tableDoc((table) => {
      table.columns = []
      table.footerRows = []
    }))).toEqual(['table.noColumns@pages.0.elements.0.columns'])
    const report = validateDocument(tableDoc((table) => {
      columnsOf(table)[0]!.width = 20
    }))
    expect(summarize(report)).toEqual(['table.columnWidthMismatch@pages.0.elements.0.columns'])
    expect(report.issues[0]!.params).toEqual({ width: 190, columnsWidth: 195 })
  })

  it('列标识重复、条码列缺码制、列内容不合法', () => {
    expect(issuesOf(tableDoc((table) => {
      const columns = columnsOf(table)
      columns[1]!.id = 'no'
      columns[2]!.cellType = 'barcode'
      columns[3]!.content = { kind: 'aggregate', fn: 'sum' }
    }))).toEqual([
      'schema.missingProperty@pages.0.elements.0.columns.2.symbology',
      'value.invalidOption@pages.0.elements.0.columns.3.content.kind',
      'table.duplicateColumnId@pages.0.elements.0.columns.1.id',
    ])
  })

  it('表尾单元格指向未知列、跨列越界、相互重叠', () => {
    expect(issuesOf(tableDoc((table) => {
      cellsOf(table, 0)[1]!.columnId = 'price'
      cellsOf(table, 0)[2]!.colSpan = 3
      cellsOf(table, 1)[1]!.columnId = 'name'
    }))).toEqual([
      'table.unknownColumn@pages.0.elements.0.footerRows.0.cells.1.columnId',
      'table.cellSpanOverflow@pages.0.elements.0.footerRows.0.cells.2.colSpan',
      'table.cellOverlap@pages.0.elements.0.footerRows.1.cells.1',
    ])
  })

  it('除 count 外的汇总必须指定字段，表尾行标识不得重复', () => {
    expect(issuesOf(tableDoc((table) => {
      cellsOf(table, 0)[1]!.content = { kind: 'aggregate', fn: 'avg', scope: 'page' }
      rowsOf(table)[1]!.id = 'subtotal'
    }))).toEqual([
      'table.aggregateFieldMissing@pages.0.elements.0.footerRows.0.cells.1.content',
      'table.duplicateRowId@pages.0.elements.0.footerRows.1.id',
    ])
  })

  it('每页最大行数必须为正整数', () => {
    expect(issuesOf(tableDoc((table) => {
      table.maxRowsPerPage = 0
    }))).toEqual(['value.outOfRange@pages.0.elements.0.maxRowsPerPage'])
    expect(issuesOf(tableDoc((table) => {
      table.maxRowsPerPage = 2.5
    }))).toEqual(['value.notInteger@pages.0.elements.0.maxRowsPerPage'])
  })

  it('正文区放不下表头加一行与每页表尾', () => {
    const report = validateDocument(tableDoc((table) => {
      table.body = { ...(table.body as object), rowHeight: 300 }
    }))
    expect(summarize(report)).toContain('table.rowExceedsBody@pages.0.elements.0')
    const issue = report.issues.find(item => item.code === 'table.rowExceedsBody')!
    expect(issue.params).toEqual({ required: 315, available: 277 })
  })
})

describe('图形、条码与二维码', () => {
  it('直线按方向判断长度', () => {
    const horizontal = element('line', 'h', { width: 0, height: 5 })
    const vertical = element('line', 'v', { direction: 'vertical', width: 5, height: 0 })
    const diagonal = element('line', 'd', { direction: 'diagonalUp', width: 0, height: 5 })
    expect(issuesOf(withBody(horizontal, vertical, diagonal))).toEqual([
      'line.zeroLength@pages.0.elements.0',
      'line.zeroLength@pages.0.elements.1',
    ])
  })

  it('既无边线也无填充的图形不可见', () => {
    const bare = element('rect', 'r')
    delete bare.stroke
    const transparent = element('ellipse', 'e', { fill: 'transparent' })
    delete transparent.stroke
    const filled = element('ellipse', 'f', { fill: '#eee' })
    delete filled.stroke
    expect(issuesOf(withBody(bare, transparent, filled))).toEqual([
      'shape.invisible@pages.0.elements.0',
      'shape.invisible@pages.0.elements.1',
    ])
  })

  it('条码固定内容必须符合码制，字段内容不检查', () => {
    const cases: [string, string][] = [
      ['ean13', '4006381333932'],
      ['ean8', '963850'],
      ['code39', 'abc'],
      ['code128', '中文'],
      ['upca', ''],
    ]
    const elements = cases.map(([symbology, text], index) =>
      element('barcode', `b${index}`, { symbology, content: { kind: 'static', text } }),
    )
    elements.push(element('barcode', 'bound', { symbology: 'ean13', content: { kind: 'field', field: 'sku' } }))
    const report = validateDocument(withBody(...elements))
    expect(summarize(report)).toEqual([
      'barcode.invalidValue@pages.0.elements.0.content.text',
      'barcode.invalidValue@pages.0.elements.1.content.text',
      'barcode.invalidValue@pages.0.elements.2.content.text',
      'barcode.invalidValue@pages.0.elements.3.content.text',
      'value.empty@pages.0.elements.4.content.text',
    ])
    expect(report.issues[0]!.params).toEqual({ symbology: 'ean13' })
  })

  it('二维码固定内容不能为空或无法编码，元素框应为正方形', () => {
    const empty = element('qrcode', 'a', { content: { kind: 'static', text: '' } })
    const tooLong = element('qrcode', 'b', { level: 'H', content: { kind: 'static', text: '中'.repeat(425) } })
    const oblong = element('qrcode', 'c', { width: 30 })
    const report = validateDocument(withBody(empty, tooLong, oblong))
    expect(summarize(report)).toEqual([
      'value.empty@pages.0.elements.0.content.text',
      'qrcode.invalidValue@pages.0.elements.1.content.text',
      'qrcode.notSquare@pages.0.elements.2',
    ])
    expect(report.issues[1]!.params).toEqual({ format: 'qr' })
  })

  it('四种码制都可用，纠错级别按码制校验，PDF417 不要求正方形', () => {
    const elements = [
      element('qrcode', 'dm', { format: 'data-matrix', level: undefined }),
      element('qrcode', 'pdf', { format: 'pdf417', level: 5, width: 60, height: 15 }),
      element('qrcode', 'aztec', { format: 'aztec', level: 23 }),
      element('qrcode', 'badQr', { format: 'qr', level: 4 }),
      element('qrcode', 'badPdf', { format: 'pdf417', level: 'H', width: 60, height: 15 }),
      element('qrcode', 'dmLevel', { format: 'data-matrix', level: 'M' }),
      element('qrcode', 'badFormat', { format: 'maxicode' }),
      element('qrcode', 'badType', { level: true }),
    ]
    const report = validateDocument(withBody(...elements))
    expect(summarize(report)).toEqual([
      'qrcode.invalidLevel@pages.0.elements.3.level',
      'qrcode.invalidLevel@pages.0.elements.4.level',
      'qrcode.levelIgnored@pages.0.elements.5.level',
      'value.invalidOption@pages.0.elements.6.format',
      'schema.invalidType@pages.0.elements.7.level',
    ])
    expect(report.issues[0]!.params).toEqual({ format: 'qr', level: '4' })
    expect(report.issues[2]!.severity).toBe('warning')
  })
})

describe('复合属性', () => {
  it('外框的背景、边框与内边距', () => {
    const text = element('text', 't', {
      box: {
        background: 'blue',
        border: { top: { width: 0.2, style: 'wavy', color: '#000' }, middle: {} },
        padding: { top: 1, right: 1, bottom: -1 },
      },
    })
    expect(issuesOf(withBody(text))).toEqual([
      'value.invalidColor@pages.0.elements.0.box.background',
      'value.invalidOption@pages.0.elements.0.box.border.top.style',
      'schema.unknownProperty@pages.0.elements.0.box.border.middle',
      'value.outOfRange@pages.0.elements.0.box.padding.bottom',
      'schema.missingProperty@pages.0.elements.0.box.padding.left',
    ])
  })

  it('单元格样式与表格网格线', () => {
    const table = cloneJson(createSampleTable()) as unknown as Record<string, unknown>
    table.header = { visible: true, repeat: true, height: 8, style: { fontSize: 10, bold: 'yes', italic: false, color: '#000', verticalAlign: 'center', padding: 1, lineHeight: 0 } }
    table.border = { stroke: { width: 0.2, style: 'solid', color: '#000' }, outer: true, horizontal: true }
    expect(issuesOf(withBody(table))).toEqual([
      'schema.invalidType@pages.0.elements.0.header.style.bold',
      'value.invalidOption@pages.0.elements.0.header.style.verticalAlign',
      'value.outOfRange@pages.0.elements.0.header.style.lineHeight',
      'schema.missingProperty@pages.0.elements.0.border.vertical',
    ])
  })

  it('表尾单元格跨列数必须为正整数', () => {
    const table = cloneJson(createSampleTable())
    const cell = table.footerRows[0]!.cells[0] as unknown as Record<string, unknown>
    cell.colSpan = 1.5
    expect(issuesOf(withBody(table))).toEqual(['value.notInteger@pages.0.elements.0.footerRows.0.cells.0.colSpan'])
  })

  it('图片字段来源未绑定、宿主附加数据必须是对象', () => {
    const image = element('image', 'i', { source: { kind: 'field', field: '' }, meta: 'x' })
    const report = validateDocument(withBody(image))
    expect(summarize(report)).toEqual([
      'field.empty@pages.0.elements.0.source.field',
      'schema.invalidType@pages.0.elements.0.meta',
    ])
  })

  it('页面上的未知属性与宿主附加数据', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.background = '#fff'
    page.meta = []
    expect(issuesOf({ schemaVersion: 1, pages: [page] })).toEqual([
      'schema.invalidType@pages.0.meta',
      'schema.unknownProperty@pages.0.background',
    ])
  })
})

describe('受限表达式', () => {
  const engine: ExpressionEngine = {
    compile: (source) => {
      const open = source.indexOf('(')
      if (open === -1 || source.includes(')'))
        return { ok: true, references: [], evaluate: () => ({ ok: true, value: null }) }
      return { ok: false, issues: [{ code: 'XH_EXPR_UNCLOSED', start: open, end: source.length, data: { expected: ')' } }] }
    },
  }

  const expressionText = (id: string, expression: unknown): Record<string, unknown> =>
    element('text', id, { content: { kind: 'expression', expression } })

  it('未注入检查器时只要求表达式非空', () => {
    expect(issuesOf(withBody(expressionText('a', 'round(price'), expressionText('b', ''), expressionText('c', 1)))).toEqual([
      'value.empty@pages.0.elements.1.content.expression',
      'schema.invalidType@pages.0.elements.2.content.expression',
    ])
  })

  it('注入检查器后报告表达式问题', () => {
    const report = validateDocument(withBody(expressionText('a', 'round(price'), expressionText('b', 'round(price)')), { expressions: engine })
    expect(summarize(report)).toEqual(['expression.invalid@pages.0.elements.0.content.expression'])
    expect(report.issues[0]).toMatchObject({
      severity: 'error',
      elementId: 'a',
      params: { code: 'XH_EXPR_UNCLOSED', start: 5, end: 11, expected: ')' },
    })
  })

  it('检查器给出的附加数据不覆盖问题码与区间', () => {
    const conflicting: ExpressionEngine = { compile: () => ({ ok: false, issues: [{ code: 'X', start: 0, end: 1, data: { code: 'Y', start: 9 } }] }) }
    const report = validateDocument(withBody(expressionText('a', 'x')), { expressions: conflicting })
    expect(report.issues[0]!.params).toEqual({ code: 'X', start: 0, end: 1 })
  })

  it('表达式格式、表达式内容的结果格式与表格表达式列', () => {
    const formatted = element('text', 'f', {
      content: { kind: 'field', field: 'amount', format: { kind: 'expression', expression: 'fixed(value' } },
    })
    const nested = element('text', 'n', {
      content: { kind: 'expression', expression: 'a + b', format: { kind: 'number', decimals: -1, thousands: false } },
    })
    const table = cloneJson(createSampleTable()) as unknown as Record<string, unknown>
    const columns = table.columns as Record<string, unknown>[]
    columns[3]!.content = { kind: 'expression', expression: 'qty * (price', format: { kind: 'chineseAmount' } }
    const report = validateDocument(withBody(formatted, nested, table), { expressions: engine })
    expect(summarize(report)).toEqual([
      'expression.invalid@pages.0.elements.0.content.format.expression',
      'value.outOfRange@pages.0.elements.1.content.format.decimals',
      'expression.invalid@pages.0.elements.2.columns.3.content.expression',
    ])
  })

  it('表尾单元格可用表达式，以根数据为变量', () => {
    const table = cloneJson(createSampleTable())
    table.footerRows[1]!.cells[0]!.content = { kind: 'expression', expression: 'order.no' }
    expect(validateDocument(withBody(table), { expressions: engine }).issues).toEqual([])
  })

  it('样例文档带上检查器也没有问题', () => {
    expect(validateDocument(createSampleDocument(), { expressions: engine }).issues).toEqual([])
  })
})
