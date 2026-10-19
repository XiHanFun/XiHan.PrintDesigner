/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEngine } from '@xihan-ui/expression'
import type { PrintCoreExtension, PrintDocument, PrintElement, ValidationIssue, ValidationReport } from '../src'
import { describe, expect, it } from 'vitest'
import {
  createBuiltinElementPrototypes,
  createDocument,
  createElementRegistry,
  createPage,
  PRINT_CORE_EXTENSION_ID,
  PRINT_ELEMENT_TYPES,
  validateDocument,
  VALIDATION_ISSUE_SEVERITIES,
} from '../src'
import { createSampleDocument, createSampleTable } from './fixtures'

const registry = createElementRegistry()

function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

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

  it('各类型默认元素放进正文后没有 error，只有提示未绑定或内容为空的 warning', () => {
    const elements = PRINT_ELEMENT_TYPES.map((type, index) =>
      registry.createElement(type, { id: `e${index}`, x: 15, y: 30 + index * 2 }),
    )
    const report = validateDocument(withBody(...elements))
    expect(report.valid).toBe(true)
    expect(summarize(report)).toEqual([
      'richText.empty@pages.0.elements.2.content.document',
      'field.empty@pages.0.elements.3.dataField',
      'field.empty@pages.0.elements.3.columns.0.content.field',
      'field.empty@pages.0.elements.3.columns.1.content.field',
      'field.empty@pages.0.elements.3.columns.2.content.field',
      'image.emptySource@pages.0.elements.4.source.url',
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
      code: 'invalid-value',
      severity: 'error',
      path: ['pages', 0, 'elements', 0, 'width'],
      target: { kind: 'element', id: 'r' },
      params: { kind: 'nonFiniteNumber' },
    })
    expect(report.issues).toHaveLength(1)
  })

  it('只报告第一处非 JSON 值，并给出种类', () => {
    const withMeta = (meta: unknown): Record<string, unknown> => ({ ...withBody(element('rect', 'r')), meta })
    const first = validateDocument(withMeta({ fn: () => 1, at: new Date(0) }))
    expect(summarize(first)).toEqual(['invalid-value@meta.fn'])
    expect(first.issues[0]!.params).toEqual({ kind: 'function' })
    expect(validateDocument(withMeta({ at: new Date(0) })).issues[0]!.params).toEqual({ kind: 'nonPlainObject' })
    expect(validateDocument(withMeta({ list: [1, undefined] })).issues.map(issue => [issue.path, issue.params])).toEqual([
      [['meta', 'list', 1], { kind: 'undefined' }],
    ])
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(issuesOf(withMeta(cyclic))).toEqual(['json.circular@meta.self'])
  })

  it('值为 undefined 的属性也不是 JSON', () => {
    const text = { ...element('text', 't'), name: undefined }
    expect(issuesOf(withBody(text))).toEqual(['invalid-value@pages.0.elements.0.name'])
  })
})

describe('文档结构', () => {
  it('根不是对象', () => {
    expect(issuesOf(null)).toEqual(['invalid-type@'])
    expect(first([]).params).toEqual({ expected: 'object' })
  })

  it('缺少或不支持的版本号只报告版本问题', () => {
    expect(issuesOf({ pages: 'x' })).toEqual(['required@schemaVersion'])
    expect(issuesOf({ schemaVersion: '1', pages: [] })).toEqual(['invalid-type@schemaVersion'])
    const unsupported = first({ schemaVersion: 2, pages: 'x' })
    expect(unsupported.code).toBe('schema.unsupportedVersion')
    expect(unsupported.params).toEqual({ version: 2, supported: 1 })
  })

  it('没有页面、未知属性与错误类型', () => {
    expect(issuesOf({ schemaVersion: 1, pages: [], extra: true, name: 1 })).toEqual([
      'unknown-key@extra',
      'invalid-type@name',
      'document.noPages@pages',
    ])
    expect(issuesOf({ schemaVersion: 1 })).toEqual(['required@pages'])
  })

  it('页面与元素标识在整份文档内唯一', () => {
    const doc = createSampleDocument()
    doc.pages[1]!.id = 'page-1'
    doc.pages[1]!.elements[0]!.id = 'title'
    expect(issuesOf(doc)).toEqual([
      'duplicate-id@pages.1.id',
      'duplicate-id@pages.1.elements.0.id',
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
      'invalid-option@pages.0.orientation',
      'out-of-range@pages.0.margins.top',
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
    expect(report.issues[0]!.target).toEqual({ kind: 'page', id: 'p' })
  })

  it('页眉页脚结构、页码规则与水印', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.header = { singleSheet: 'middle', odd: { height: 5 } }
    page.numbering = { continuous: 'yes', start: 1.5 }
    page.watermark = { text: ' {{a b}}', fontSize: 0, color: 'red', opacity: 2, rotation: 0, gapX: 10, gapY: -1 }
    expect(issuesOf({ schemaVersion: 1, pages: [page] })).toEqual([
      'required@pages.0.header.default',
      'required@pages.0.header.odd.elements',
      'invalid-option@pages.0.header.singleSheet',
      'invalid-type@pages.0.numbering.continuous',
      'not-integer@pages.0.numbering.start',
      'template.invalidPath@pages.0.watermark.text',
      'out-of-range@pages.0.watermark.fontSize',
      'invalid-color@pages.0.watermark.color',
      'out-of-range@pages.0.watermark.opacity',
      'out-of-range@pages.0.watermark.gapY',
    ])
  })

  it('参考线：两轴都是非负的数字数组', () => {
    const page = createPage({ id: 'p' })
    page.guides = { x: [10, 105.5], y: [] }
    expect(validateDocument(createDocument({ pages: [page] })).issues).toEqual([])
    const broken = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    broken.guides = { x: [-1, 'a'], z: [] }
    expect(issuesOf({ schemaVersion: 1, pages: [broken] })).toEqual([
      'unknown-key@pages.0.guides.z',
      'required@pages.0.guides.y',
      'out-of-range@pages.0.guides.x.0',
      'invalid-type@pages.0.guides.x.1',
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
      'required@pages.0.elements.0.id',
      'required@pages.0.elements.0.type',
    ])
    const unknown = first(withBody({ id: 'u', type: 'chart' }))
    expect(unknown).toMatchObject({ code: 'element.unknownType', target: { kind: 'element', id: 'u' }, params: { type: 'chart' } })
    expect(issuesOf(withBody({ id: '', type: 'rect' }))[0]).toBe('empty@pages.0.elements.0.id')
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
      'unknown-key@pages.0.elements.0.colour',
      'out-of-range@pages.0.elements.0.rotation',
      'unknown-key@pages.0.elements.0.style.fontSizee',
      'required@pages.0.elements.0.style.fontSize',
      'invalid-color@pages.0.elements.0.style.color',
      'invalid-option@pages.0.elements.0.style.align',
      'invalid-type@pages.0.elements.0.wrap',
    ])
  })

  it('缺少整个必填对象时只报告一次', () => {
    const table = element('table', 't')
    delete table.header
    table.box = 'x'
    expect(issuesOf(withBody(table))).toContain('required@pages.0.elements.0.header')
    expect(issuesOf(withBody(table)).filter(code => code.includes('header'))).toHaveLength(1)
  })

  it('结构有 error 时不再校验几何与专属规则', () => {
    const line = element('line', 'l', { width: 0, stroke: { width: 0, style: 'solid', color: '#000' } })
    expect(issuesOf(withBody(line))).toEqual(['out-of-range@pages.0.elements.0.stroke.width'])
  })

  it('尺寸下限与超出纸张', () => {
    const tiny = element('matrixCode', 'q', { width: 2, height: 2 })
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
    expect(report.issues[0]).toMatchObject({ target: { kind: 'element', id: 'below' }, params: { region: 'header' } })
  })

  it('跨页元素越出正文区', () => {
    const page = createPage({ id: 'p' })
    page.header.default.height = 30
    page.elements = [registry.createElement('longText', { id: 'remark', x: 10, y: 20 })]
    expect(issuesOf(createDocument({ pages: [page] }))).toEqual(['element.flowOutsideBody@pages.0.elements.0'])
  })

  it('没登记的类型视为未知', () => {
    const report = validateDocument(withBody({ ...element('text', 't'), type: 'seal' }, element('rect', 'r')))
    expect(summarize(report)).toEqual(['element.unknownType@pages.0.elements.0.type'])
  })
})

describe('扩展', () => {
  it('文档、页面与元素上的扩展数据只查是对象，每个扩展的数据也是对象，里面不看', () => {
    const doc = withBody({ ...element('text', 't'), extensions: { '@acme/seal': { angle: 30 }, '@acme/bad': 1 } })
    const shaped = { ...doc, extensions: { '@acme/seal': { any: [1] } }, pages: [{ ...doc.pages[0]!, extensions: 'x' }] }
    expect(summarize(validateDocument(shaped))).toEqual([
      'invalid-type@pages.0.extensions',
      'invalid-type@pages.0.elements.0.extensions.@acme/bad',
    ])
  })

  it('扩展的规则在结构没有 error 时按扩展顺序跑，问题码带扩展 id 末段的前缀，缺省按 error；前缀不对抛 TypeError', () => {
    const rule: PrintCoreExtension = {
      id: '@acme/audit',
      rules: [(document, context) => document.pages.flatMap((page, index) => page.elements.length > 0 && context.elements.has('text')
        ? [{ code: 'audit.notEmpty', path: ['pages', index], severity: 'warning' as const }, { code: 'audit.always', path: [] }]
        : [])],
    }
    const report = validateDocument(withBody(element('text', 't')), { extensions: [rule] })
    expect(report.issues.map(issue => [issue.code, issue.severity])).toEqual([['audit.notEmpty', 'warning'], ['audit.always', 'error']])
    expect(report.valid).toBe(false)
    expect(summarize(validateDocument({ ...withBody(element('text', 't')), pages: [] }, { extensions: [rule] }))).toEqual(['document.noPages@pages'])
    const wrong: PrintCoreExtension = { id: '@acme/audit', rules: [() => [{ code: 'other.code', path: [] }]] }
    expect(() => validateDocument(withBody(element('text', 't')), { extensions: [wrong] })).toThrow(TypeError)
  })

  it('扩展 id 或元素类型与内置的重名时抛 DesignerExtensionError', () => {
    const thrown = (extensions: readonly PrintCoreExtension[]): unknown => {
      try {
        validateDocument(withBody(), { extensions })
      }
      catch (error) {
        return error
      }
      return undefined
    }
    const text = createBuiltinElementPrototypes().find(prototype => prototype.type === 'text')!
    expect(thrown([{ id: PRINT_CORE_EXTENSION_ID }])).toMatchObject({ code: 'designer.extension-conflict', space: 'extension' })
    expect(thrown([{ id: '@acme/text', elements: [text] }])).toMatchObject({ code: 'designer.extension-conflict', space: 'element-type', key: 'text' })
  })
})

describe('内容来源与格式', () => {
  it('字段路径与模板占位的写法同 core/json：下标写成 [0]，中文键与 $ 开头的名字可直接写', () => {
    const fields = ['items[0].qty', '客户.名称', '$page', 'row["unit price"]', 'items.0.qty']
    const elements = fields.map((field, index) => element('text', `f${index}`, { content: { kind: 'field', field } }))
    elements.push(element('text', 't', { content: { kind: 'template', template: '{{items[0].qty}} {{items.0.qty}}' } }))
    expect(issuesOf(withBody(...elements))).toEqual([
      'field.invalidPath@pages.0.elements.4.content.field',
      'template.invalidPath@pages.0.elements.5.content.template',
    ])
  })

  it('文本内容的三种来源', () => {
    const missingKind = element('text', 'a', { content: { text: 'x' } })
    const badKind = element('text', 'b', { content: { kind: 'html', html: '<b>' } })
    const badField = element('text', 'c', { content: { kind: 'field', field: 'a..b' } })
    const badTemplate = element('text', 'd', { content: { kind: 'template', template: '{{a}' } })
    const extra = element('text', 'e', { content: { kind: 'static', text: 'x', field: 'y' } })
    expect(issuesOf(withBody(missingKind, badKind, badField, badTemplate, extra))).toEqual([
      'required@pages.0.elements.0.content.kind',
      'invalid-option@pages.0.elements.1.content.kind',
      'field.invalidPath@pages.0.elements.2.content.field',
      'template.unclosedPlaceholder@pages.0.elements.3.content.template',
      'unknown-key@pages.0.elements.4.content.field',
    ])
  })

  it('值格式', () => {
    const formats = [
      { kind: 'number', decimals: 1.5, grouping: true },
      { kind: 'percent', decimals: 35 },
      { kind: 'date', pattern: '' },
      { kind: 'map', entries: [{ value: '1', label: '已付' }, { value: '1', label: '重复' }] },
      { kind: 'currency' },
      { kind: 'number', decimals: 2, maxDecimals: 3 },
      { kind: 'percent', minDecimals: 3, maxDecimals: 1 },
      { kind: 'rmb-upper', rounding: 'banker' },
      { kind: 'number', thousands: true },
      { kind: 'numeral', style: 'roman-upper' },
      { kind: 'numeral', style: 'greek' },
    ]
    const elements = formats.map((format, index) =>
      element('text', `t${index}`, { content: { kind: 'field', field: 'v', format } }),
    )
    expect(issuesOf(withBody(...elements))).toEqual([
      'format.invalidOption@pages.0.elements.0.content.format.decimals',
      'format.invalidOption@pages.0.elements.1.content.format.decimals',
      'format.invalidOption@pages.0.elements.2.content.format.pattern',
      'format.duplicateMapValue@pages.0.elements.3.content.format.entries.1.value',
      'invalid-option@pages.0.elements.4.content.format.kind',
      'format.conflict@pages.0.elements.5.content.format.decimals',
      'format.conflict@pages.0.elements.6.content.format.minDecimals',
      'format.invalidOption@pages.0.elements.7.content.format.rounding',
      'unknown-key@pages.0.elements.8.content.format.thousands',
      'format.invalidOption@pages.0.elements.10.content.format.style',
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

  it('页码格式是用 $page / $pages 的文本模板，数字字形取 numeral 的取值', () => {
    const none = element('pageNumber', 'a', { format: '页码' })
    const unknown = element('pageNumber', 'b', { format: '{{$page}}/{{total}}' })
    const broken = element('pageNumber', 'c', { format: '{{$page' })
    const numeral = element('pageNumber', 'd', { numeral: 'cn-upper' })
    const badNumeral = element('pageNumber', 'e', { numeral: 'greek' })
    const report = validateDocument(withBody(none, unknown, broken, numeral, badNumeral))
    expect(summarize(report)).toEqual([
      'pageNumber.noToken@pages.0.elements.0.format',
      'pageNumber.unknownToken@pages.0.elements.1.format',
      'template.unclosedPlaceholder@pages.0.elements.2.format',
      'invalid-option@pages.0.elements.4.numeral',
    ])
    expect(report.issues[1]!.params).toEqual({ token: 'total' })
  })
})

describe('表格', () => {
  function tableDoc(mutate: (table: Record<string, unknown>) => void): PrintDocument {
    const table = copyOf(createSampleTable()) as unknown as Record<string, unknown>
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
      columns[2]!.cellType = 'barCode'
      columns[3]!.content = { kind: 'aggregate', fn: 'sum' }
    }))).toEqual([
      'required@pages.0.elements.0.columns.2.barCodeFormat',
      'invalid-option@pages.0.elements.0.columns.3.content.kind',
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
    }))).toEqual(['out-of-range@pages.0.elements.0.maxRowsPerPage'])
    expect(issuesOf(tableDoc((table) => {
      table.maxRowsPerPage = 2.5
    }))).toEqual(['not-integer@pages.0.elements.0.maxRowsPerPage'])
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
    const elements = cases.map(([format, text], index) =>
      element('barCode', `b${index}`, { format, content: { kind: 'static', text } }),
    )
    elements.push(element('barCode', 'bound', { format: 'ean13', content: { kind: 'field', field: 'sku' } }))
    const report = validateDocument(withBody(...elements))
    expect(summarize(report)).toEqual([
      'barCode.invalidValue@pages.0.elements.0.content.text',
      'barCode.invalidValue@pages.0.elements.1.content.text',
      'barCode.invalidValue@pages.0.elements.2.content.text',
      'barCode.invalidValue@pages.0.elements.3.content.text',
      'empty@pages.0.elements.4.content.text',
    ])
    expect(report.issues.slice(0, 4).map(issue => issue.params)).toEqual([
      { format: 'ean13', reason: 'invalid-check-digit', expected: 1, actual: 2 },
      { format: 'ean8', reason: 'invalid-length', length: 6, lengths: ['7', '8'] },
      { format: 'code39', reason: 'invalid-character', character: 'a' },
      { format: 'code128', reason: 'invalid-character', character: '中' },
    ])
  })

  it('二维码固定内容不能为空或无法编码，元素框应为正方形', () => {
    const empty = element('matrixCode', 'a', { content: { kind: 'static', text: '' } })
    const tooLong = element('matrixCode', 'b', { level: 'H', content: { kind: 'static', text: '中'.repeat(425) } })
    const oblong = element('matrixCode', 'c', { width: 30 })
    const report = validateDocument(withBody(empty, tooLong, oblong))
    expect(summarize(report)).toEqual([
      'empty@pages.0.elements.0.content.text',
      'matrixCode.invalidValue@pages.0.elements.1.content.text',
      'matrixCode.notSquare@pages.0.elements.2',
    ])
    expect(report.issues[1]!.params).toEqual({ format: 'qr', reason: 'capacity-exceeded' })
  })

  it('四种码制都可用，纠错级别按码制校验，PDF417 不要求正方形', () => {
    const elements = [
      (({ level: _level, ...rest }) => rest)(element('matrixCode', 'dm', { format: 'data-matrix' })),
      element('matrixCode', 'pdf', { format: 'pdf417', level: 5, width: 60, height: 15 }),
      element('matrixCode', 'aztec', { format: 'aztec', level: 23 }),
      element('matrixCode', 'badQr', { format: 'qr', level: 4 }),
      element('matrixCode', 'badPdf', { format: 'pdf417', level: 'H', width: 60, height: 15 }),
      element('matrixCode', 'dmLevel', { format: 'data-matrix', level: 'M' }),
      element('matrixCode', 'badFormat', { format: 'maxicode' }),
      element('matrixCode', 'badType', { level: true }),
    ]
    const report = validateDocument(withBody(...elements))
    expect(summarize(report)).toEqual([
      'matrixCode.invalidLevel@pages.0.elements.3.level',
      'matrixCode.invalidLevel@pages.0.elements.4.level',
      'matrixCode.levelIgnored@pages.0.elements.5.level',
      'invalid-option@pages.0.elements.6.format',
      'invalid-type@pages.0.elements.7.level',
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
      'invalid-color@pages.0.elements.0.box.background',
      'unknown-key@pages.0.elements.0.box.border.middle',
      'invalid-option@pages.0.elements.0.box.border.top.style',
      'required@pages.0.elements.0.box.padding.left',
      'out-of-range@pages.0.elements.0.box.padding.bottom',
    ])
  })

  it('单元格样式与表格网格线', () => {
    const table = copyOf(createSampleTable()) as unknown as Record<string, unknown>
    table.header = { visible: true, repeat: true, height: 8, style: { fontSize: 10, bold: 'yes', italic: false, color: '#000', verticalAlign: 'center', padding: 1, lineHeight: 0 } }
    table.border = { stroke: { width: 0.2, style: 'solid', color: '#000' }, outer: true, horizontal: true }
    expect(issuesOf(withBody(table))).toEqual([
      'invalid-type@pages.0.elements.0.header.style.bold',
      'invalid-option@pages.0.elements.0.header.style.verticalAlign',
      'out-of-range@pages.0.elements.0.header.style.lineHeight',
      'required@pages.0.elements.0.border.vertical',
    ])
  })

  it('表尾单元格跨列数必须为正整数', () => {
    const table = copyOf(createSampleTable())
    const cell = table.footerRows[0]!.cells[0] as unknown as Record<string, unknown>
    cell.colSpan = 1.5
    expect(issuesOf(withBody(table))).toEqual(['not-integer@pages.0.elements.0.footerRows.0.cells.0.colSpan'])
  })

  it('图片字段来源未绑定、宿主附加数据必须是对象', () => {
    const image = element('image', 'i', { source: { kind: 'field', field: '' }, meta: 'x' })
    const report = validateDocument(withBody(image))
    expect(summarize(report)).toEqual([
      'field.empty@pages.0.elements.0.source.field',
      'invalid-type@pages.0.elements.0.meta',
    ])
  })

  it('页面上的未知属性与宿主附加数据', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.background = '#fff'
    page.meta = []
    expect(issuesOf({ schemaVersion: 1, pages: [page] })).toEqual([
      'unknown-key@pages.0.background',
      'invalid-type@pages.0.meta',
    ])
  })
})

describe('受限表达式', () => {
  const engine: ExpressionEngine = {
    compile: (source) => {
      const open = source.indexOf('(')
      if (open === -1 || source.includes(')'))
        return { ok: true, references: [], evaluate: () => ({ ok: true, value: null }) }
      return { ok: false, issues: [{ code: 'XH_EXPR_UNEXPECTED_END', start: open, end: source.length, data: { expected: ')' } }] }
    },
  }

  const expressionText = (id: string, expression: unknown): Record<string, unknown> =>
    element('text', id, { content: { kind: 'expression', expression } })

  it('未注入检查器时只要求表达式非空', () => {
    expect(issuesOf(withBody(expressionText('a', 'round(price'), expressionText('b', ''), expressionText('c', 1)))).toEqual([
      'empty@pages.0.elements.1.content.expression',
      'invalid-type@pages.0.elements.2.content.expression',
    ])
  })

  it('注入检查器后报告表达式问题', () => {
    const report = validateDocument(withBody(expressionText('a', 'round(price'), expressionText('b', 'round(price)')), { expressionEngine: engine })
    expect(summarize(report)).toEqual(['expression.invalid@pages.0.elements.0.content.expression'])
    expect(report.issues[0]).toMatchObject({
      severity: 'error',
      target: { kind: 'element', id: 'a' },
      params: { code: 'XH_EXPR_UNEXPECTED_END', start: 5, end: 11, expected: ')' },
    })
  })

  it('检查器给出的附加数据不覆盖问题码与区间', () => {
    const conflicting: ExpressionEngine = { compile: () => ({ ok: false, issues: [{ code: 'XH_EXPR_EMPTY', start: 0, end: 1, data: { code: 'Y', start: 9 } }] }) }
    const report = validateDocument(withBody(expressionText('a', 'x')), { expressionEngine: conflicting })
    expect(report.issues[0]!.params).toEqual({ code: 'XH_EXPR_EMPTY', start: 0, end: 1 })
  })

  it('表达式格式、表达式内容的结果格式与表格表达式列', () => {
    const formatted = element('text', 'f', {
      content: { kind: 'field', field: 'amount', format: { kind: 'expression', expression: 'fixed(value' } },
    })
    const nested = element('text', 'n', {
      content: { kind: 'expression', expression: 'a + b', format: { kind: 'number', decimals: -1 } },
    })
    const table = copyOf(createSampleTable()) as unknown as Record<string, unknown>
    const columns = table.columns as Record<string, unknown>[]
    columns[3]!.content = { kind: 'expression', expression: 'qty * (price', format: { kind: 'rmb-upper' } }
    const report = validateDocument(withBody(formatted, nested, table), { expressionEngine: engine })
    expect(summarize(report)).toEqual([
      'expression.invalid@pages.0.elements.0.content.format.expression',
      'format.invalidOption@pages.0.elements.1.content.format.decimals',
      'expression.invalid@pages.0.elements.2.columns.3.content.expression',
    ])
  })

  it('表尾单元格可用表达式，以根数据为变量', () => {
    const table = copyOf(createSampleTable())
    table.footerRows[1]!.cells[0]!.content = { kind: 'expression', expression: 'order.no' }
    expect(validateDocument(withBody(table), { expressionEngine: engine }).issues).toEqual([])
  })

  it('样例文档带上检查器也没有问题', () => {
    expect(validateDocument(createSampleDocument(), { expressionEngine: engine }).issues).toEqual([])
  })
})
