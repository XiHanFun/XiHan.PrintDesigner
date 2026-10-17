/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { RichBlock, RichInline } from '@xihan-ui/core/rich-text'
import type { PrintElement, RichTextContent, RichTextElement, RichTextLayoutBox, RichTextLine } from '../src'
import { describe, expect, it } from 'vitest'
import {
  createDocument,
  createPage,
  layoutDesign,
  RICH_TEXT_BLOCK_GAP,
  RICH_TEXT_DIVIDER_WIDTH,
  RICH_TEXT_LIST_INDENT,
  RICH_TEXT_MARKER_GAP,
  validateDocument,
} from '../src'
import { boxOf, createFakeMeasurer, documentOf, fakeFormatter, registry, run, squarePage } from './layout-helpers'

/** 10pt、行高倍数 1 的一行高，即基准字号，单位 mm。 */
const LINE_10PT = 10 * 25.4 / 72

function richText(content: RichTextContent, overrides: Partial<RichTextElement> = {}): RichTextElement {
  const element = registry.createElement('richText', { id: 'rich', x: 0, y: 10, overrides: { width: 100, content, ...overrides } })
  element.style = { ...element.style, fontSize: 10, lineHeight: 1 }
  return element
}

function blocks(...items: RichBlock[]): RichTextContent {
  return { kind: 'static', document: { blocks: items } }
}

function paragraph(...runs: RichInline[]): RichBlock {
  return { type: 'paragraph', runs }
}

function text(value: string, marks?: Extract<RichInline, { type: 'text' }>['marks']): RichInline {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks }
}

function boxesOf(element: PrintElement, data: unknown = {}, options: Parameters<typeof run>[2] = {}): RichTextLayoutBox[] {
  return run(documentOf(squarePage('p', [element])), data, options).sheets.map(sheet => boxOf(sheet, 'rich', 'richText'))
}

function linesOf(element: PrintElement, data: unknown = {}, options: Parameters<typeof run>[2] = {}): RichTextLine[] {
  return boxesOf(element, data, options).flatMap(box => box.lines)
}

function textsOf(lines: readonly RichTextLine[]): string[] {
  return lines.map(line => line.spans.map(span => span.text).join(''))
}

describe('富文本排版', () => {
  it('行内样式在基准样式之上覆写，行高取这一行最大的字号，上下标缩小字号但不压低行高', () => {
    const [line] = linesOf(richText(blocks(paragraph(
      text('小'),
      text('大', { fontSize: 20, bold: true, color: '#ff0000' }),
      text('上', { fontSize: 30, superscript: true, link: 'https://example.com' }),
    ))))
    expect(line!.height).toBeCloseTo(3 * LINE_10PT, 10)
    expect(line!.spans).toEqual([
      { text: '小', fontSize: 10, bold: false, italic: false, underline: false, lineThrough: false, color: '#000000', letterSpacing: 0 },
      { text: '大', fontSize: 20, bold: true, italic: false, underline: false, lineThrough: false, color: '#ff0000', letterSpacing: 0 },
      { text: '上', fontSize: 21, bold: false, italic: false, underline: false, lineThrough: false, color: '#000000', letterSpacing: 0, script: 'super', link: 'https://example.com' },
    ])
  })

  it('标题按级别放大并加粗，行内样式可以取消加粗', () => {
    const [h1, h3] = linesOf(richText(blocks(
      { type: 'heading', level: 1, runs: [text('一级')] },
      { type: 'heading', level: 3, runs: [text('三级', { bold: false })] },
    )))
    expect(h1!.spans[0]).toMatchObject({ fontSize: 16, bold: true })
    expect(h1!.height).toBeCloseTo(1.6 * LINE_10PT, 10)
    expect(h3!.spans[0]).toMatchObject({ fontSize: 11.5, bold: false })
  })

  it('按元素内宽折行；两端对齐时最后一行与换行之前的行不拉伸', () => {
    const lines = linesOf(richText(blocks({ type: 'paragraph', align: 'justify', runs: [text('字'.repeat(60)), { type: 'break' }, text('尾')] })))
    expect(textsOf(lines)).toEqual(['字'.repeat(50), '字'.repeat(10), '尾'])
    expect(lines.map(line => line.align)).toEqual(['justify', 'left', 'left'])
  })

  it('换行与文字里的换行符都断行，空行按换行处的字号定行高', () => {
    const lines = linesOf(richText(blocks(paragraph(text('甲', { fontSize: 20 }), { type: 'break' }, { type: 'break' }, text('乙\n丙')))))
    expect(textsOf(lines)).toEqual(['甲', '', '乙', '丙'])
    expect(lines[1]!.spans).toEqual([])
    expect(lines[1]!.height).toBeCloseTo(2 * LINE_10PT, 10)
  })

  it('空段落占一行基准行高，内边距从内宽里扣除', () => {
    const lines = linesOf(richText(blocks(paragraph(), paragraph(text('字'.repeat(48)))), { box: { padding: { top: 0, right: 2, bottom: 0, left: 2 } } }))
    expect(textsOf(lines)).toEqual(['', '字'.repeat(48)])
    expect(lines[0]!.height).toBeCloseTo(LINE_10PT, 10)
  })

  it('顶层块之间留半个基准字号的段距，列表项之间不留', () => {
    const lines = linesOf(richText(blocks(
      paragraph(text('甲')),
      { type: 'list', ordered: false, items: [{ blocks: [paragraph(text('一'))] }, { blocks: [paragraph(text('二'))] }] },
      paragraph(text('乙')),
    )))
    const gap = LINE_10PT * RICH_TEXT_BLOCK_GAP
    expect(lines.map(line => line.gap)).toEqual([0, gap, 0, gap])
  })

  it('列表按层缩进，项目符号按层换形，序号从 start 起，符号右缘离文字一个间距', () => {
    const lines = linesOf(richText(blocks(
      { type: 'list', ordered: false, items: [
        { blocks: [paragraph(text('一')), { type: 'list', ordered: false, items: [{ blocks: [paragraph(text('二'))] }] }] },
      ] },
      { type: 'list', ordered: true, start: 9, items: [{ blocks: [paragraph(text('九'))] }, { blocks: [paragraph(text('十'))] }] },
    )))
    const step = LINE_10PT * RICH_TEXT_LIST_INDENT
    const markerGap = LINE_10PT * RICH_TEXT_MARKER_GAP
    expect(textsOf(lines)).toEqual(['一', '二', '九', '十'])
    expect(lines.map(line => line.indent)).toEqual([step, 2 * step, step, step])
    expect(lines.map(line => line.marker?.span.text)).toEqual(['•', '◦', '9.', '10.'])
    expect(lines[0]!.marker!.x).toBeCloseTo(step - markerGap - 2, 6)
    expect(lines[1]!.marker!.x).toBeCloseTo(2 * step - markerGap - 2, 6)
    // 「10.」宽 6 mm，放不下时贴着上一层的缩进
    expect(lines[3]!.marker!.x).toBe(0)
    expect(lines[0]!.marker!.span).toMatchObject({ fontSize: 10, bold: false, color: '#000000' })
  })

  it('列表项第一块就是内层列表时，外层符号单独占一行；空列表项只有符号', () => {
    const lines = linesOf(richText(blocks({ type: 'list', ordered: true, items: [
      { blocks: [{ type: 'list', ordered: true, items: [{ blocks: [paragraph(text('内'))] }] }] },
      { blocks: [] },
    ] })))
    expect(lines.map(line => [line.marker?.span.text, textsOf([line])[0]])).toEqual([['1.', ''], ['1.', '内'], ['2.', '']])
  })

  it('分隔线单独占一行基准行高，取基准颜色', () => {
    const [, divider] = linesOf(richText(blocks(paragraph(text('甲')), { type: 'divider' })))
    expect(divider).toMatchObject({ spans: [], divider: { color: '#000000', width: RICH_TEXT_DIVIDER_WIDTH } })
    expect(divider!.height).toBeCloseTo(LINE_10PT, 10)
  })

  it('行内字段按数据取值并按值格式转成文字，带自己的样式', () => {
    const element = richText(blocks(paragraph(text('金额：'), { type: 'field', field: 'order.amount', format: { kind: 'number' }, marks: { bold: true } })))
    const [line] = linesOf(element, { order: { amount: 5 } }, { formatter: fakeFormatter })
    expect(line!.spans.map(span => [span.text, span.bold])).toEqual([['金额：', false], ['number:5', true]])
  })
})

describe('富文本字段', () => {
  it('字段里的 HTML 串按白名单换成文档，连同内容去掉或降级的标签报一条诊断，样式属性的取舍不报', () => {
    const element = richText({ kind: 'field', field: 'body', source: 'html' })
    const html = '<h2>标题</h2><p style="line-height:2">正文<script>alert(1)</script></p><table><tr><td>格</td></tr></table>'
    const result = run(documentOf(squarePage('p', [element])), { body: html })
    expect(textsOf(boxOf(result.sheets[0]!, 'rich', 'richText').lines)).toEqual(['标题', '正文', '格'])
    expect(result.diagnostics).toEqual([{
      code: 'richText.droppedContent',
      severity: 'warning',
      path: ['pages', 0, 'elements', 0],
      target: { kind: 'element', id: 'rich' },
      params: { field: 'body', names: ['script', 'table'] },
    }])
  })

  it('文档对象先校验，合规时照排，不合规时不画并报 error 级诊断', () => {
    const element = richText({ kind: 'field', field: 'body', source: 'document' })
    expect(textsOf(linesOf(element, { body: { blocks: [paragraph(text('来自数据'))] } }))).toEqual(['来自数据'])

    const invalid = run(documentOf(squarePage('p', [element])), { body: { blocks: [{ type: 'quote', runs: [] }] } })
    expect(boxOf(invalid.sheets[0]!, 'rich', 'richText').lines).toEqual([])
    expect(invalid.diagnostics).toMatchObject([{
      code: 'richText.invalidData',
      severity: 'error',
      params: { field: 'body', code: 'richText.invalidDocument', path: 'blocks[0].type' },
    }])

    const format = run(documentOf(squarePage('p', [element])), { body: { blocks: [paragraph({ type: 'field', field: 'x', format: { kind: 'nope' } })] } })
    expect(format.diagnostics).toMatchObject([{ code: 'richText.invalidData', params: { code: 'invalid-option', path: 'blocks[0].runs[0].format.kind' } }])

    const string = run(documentOf(squarePage('p', [element])), { body: '{"blocks":[]}' })
    expect(string.diagnostics).toMatchObject([{ code: 'richText.invalidData', params: { code: 'richText.invalidDocument', path: '' } }])
  })

  it('字段为空时没有内容也不报诊断', () => {
    for (const source of ['html', 'document'] as const) {
      const result = run(documentOf(squarePage('p', [richText({ kind: 'field', field: 'body', source })])), { body: null })
      expect(boxOf(result.sheets[0]!, 'rich', 'richText').lines).toEqual([])
      expect(result.diagnostics).toEqual([])
    }
  })
})

describe('富文本跨页', () => {
  const many = (count: number): RichTextContent => blocks(...Array.from({ length: count }, (_, index) => paragraph(text(`第${index + 1}段`))))
  const gap = LINE_10PT * RICH_TEXT_BLOCK_GAP

  it('按整行切分到后续输出页，续排那一段的第一行不留段距', () => {
    // 正文区从 y = 10 起还剩 90 mm：17 行加 16 个段距
    const boxes = boxesOf(richText(many(30)))
    expect(boxes.map(box => box.lines.length)).toEqual([17, 13])
    expect(boxes[0]).toMatchObject({ y: 10, fragment: { index: 0, last: false } })
    expect(boxes[0]!.height).toBeCloseTo(17 * LINE_10PT + 16 * gap, 10)
    expect(boxes[1]).toMatchObject({ y: 0, fragment: { index: 1, last: true } })
    expect(boxes[1]!.lines[0]!.gap).toBe(0)
    expect(boxes[1]!.height).toBeCloseTo(13 * LINE_10PT + 12 * gap, 10)
  })

  it('内容少时保留设计高度，空文档按设计高度占位，内边距计入每段', () => {
    expect(boxesOf(richText(many(1)))[0]).toMatchObject({ height: 20, verticalAlign: 'top' })
    expect(boxesOf(richText(blocks()))[0]).toMatchObject({ height: 20, lines: [] })

    const padded = boxesOf(richText(many(30), { box: { padding: { top: 2, right: 0, bottom: 2, left: 0 } } }))
    expect(padded.map(box => box.lines.length)).toEqual([16, 14])
    expect(padded[0]!.height).toBeCloseTo(16 * LINE_10PT + 15 * gap + 4, 10)
  })

  it('富文本之下的元素随它延展下推', () => {
    const below = registry.createElement('text', { id: 'below', x: 0, y: 35 })
    const result = run(documentOf(squarePage('p', [richText(many(30)), below])))
    const last = boxOf(result.sheets[1]!, 'rich', 'richText')
    expect(boxOf(result.sheets[1]!, 'below', 'text').y).toBeCloseTo(last.y + last.height + 5, 10)
  })
})

describe('富文本设计态', () => {
  const design = (element: PrintElement, sampleData?: unknown): RichTextLayoutBox =>
    layoutDesign(squarePage('p', [element]), { measurer: createFakeMeasurer(), ...(sampleData === undefined ? {} : { sampleData }) }).body[0] as RichTextLayoutBox

  it('不给示例数据时字段显示 {path} 占位，行内字段同样', () => {
    expect(textsOf(design(richText({ kind: 'field', field: 'notice.body', source: 'document' })).lines)).toEqual(['{notice.body}'])
    expect(textsOf(design(richText(blocks(paragraph(text('致：'), { type: 'field', field: 'customer' })))).lines)).toEqual(['致：{customer}'])
  })

  it('给了示例数据时按数据排，按内容撑高', () => {
    const box = design(richText({ kind: 'field', field: 'body', source: 'html' }), { body: '<p>甲</p><p>乙</p>' })
    expect(textsOf(box.lines)).toEqual(['甲', '乙'])
    expect(box.height).toBe(20)
  })
})

describe('富文本校验', () => {
  function issuesOf(content: unknown, region: 'body' | 'header' = 'body'): string[] {
    const element = { ...registry.createElement('richText', { id: 'rich', x: 20, y: 40 }), content } as PrintElement
    const page = createPage({ id: 'p' })
    if (region === 'body')
      page.elements = [element]
    else
      page.header.default = { height: 60, elements: [element] }
    return validateDocument(createDocument({ pages: [page] })).issues.map(issue =>
      `${issue.code}@${issue.path.slice(4).join('.')}${issue.params?.code === undefined ? '' : `:${String(issue.params.code)}`}`)
  }

  it('文档结构按 checkRichTextDocument 逐项报出，带上原问题码', () => {
    expect(issuesOf({ kind: 'static', document: { blocks: [{ type: 'quote' }, { type: 'paragraph', runs: [{ type: 'text', text: 'a', marks: { blink: true } }] }] } })).toEqual([
      'richText.invalidDocument@content.document.blocks.0.type:unknown-block',
      'richText.invalidDocument@content.document.blocks.1.runs.0.marks.blink:unknown-mark',
    ])
    expect(issuesOf({ kind: 'static', document: { blocks: [paragraph(text('a', { link: 'javascript:alert(1)' }))] } })).toEqual([
      'richText.invalidDocument@content.document.blocks.0.runs.0.marks.link:unsafe-link',
    ])
  })

  it('行内字段的路径与值格式按打印规则校验', () => {
    expect(issuesOf(blocks(paragraph({ type: 'field', field: 'a..b' }, { type: 'field', field: 'x', format: { kind: 'nope' } })))).toEqual([
      'field.invalidPath@content.document.blocks.0.runs.0.field',
      'invalid-option@content.document.blocks.0.runs.1.format.kind',
    ])
  })

  it('内容来源与字段格式', () => {
    expect(issuesOf({ kind: 'field', field: 'body', source: 'markdown' })).toEqual(['invalid-option@content.source'])
    expect(issuesOf({ kind: 'field', field: 'body' })).toEqual(['required@content.source'])
    expect(issuesOf({ kind: 'field', field: 'body', source: 'html' })).toEqual([])
  })

  it('写死的文档没有内容时给 warning，只有分隔线或列表项也算有内容', () => {
    expect(issuesOf(blocks(paragraph(text('  '), { type: 'break' })))).toEqual(['richText.empty@content.document'])
    expect(issuesOf(blocks({ type: 'divider' }))).toEqual([])
    expect(issuesOf(blocks({ type: 'list', ordered: false, items: [{ blocks: [] }] }))).toEqual([])
  })

  it('不能放进页眉页脚', () => {
    expect(issuesOf(blocks(paragraph(text('a'))), 'header')).toContain('element.flowInBand@elements.0')
  })
})
