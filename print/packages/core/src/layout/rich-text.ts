/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { RichBlock, RichInline, RichMarks, RichTextDocument } from '@xihan-ui/core/rich-text'
import type { FontSpec, TextRun } from '@xihan-ui/viz'
import type { Edges, TextStyle, ValueFormat } from '../schema/common'
import type { RichTextContent, RichTextElement } from '../schema/elements'
import type { TextAlign } from '../schema/options'
import type { ValidationIssue } from '../validation/issues'
import type { DiagnosticScope, LayoutContext } from './context'
import type { BodyGeometry, Placement, SheetCursor } from './placement'
import type { RichTextLayoutBox, RichTextLine, RichTextMarker, RichTextSpan } from './types'
import { formatJsonPath } from '@xihan-ui/core/json'
import { parseRichTextHtml } from '@xihan-ui/core/rich-text'
import { convertLength } from '@xihan-ui/designer-kit'
import { wrapRuns } from '@xihan-ui/viz'
import { getFieldValue } from '../data'
import { validateRichTextDocument } from '../validation/controls'
import { createIssueSink } from '../validation/issues'
import { boxBase, paddingOf } from './boxes'
import { isEmptyValue, valueText } from './content'
import { LAYOUT_EPSILON } from './context'
import { bodyBottom, isAtBodyTop, nextSheetTop } from './placement'
import { fontSpec } from './text-measure'

/** 一到三级标题的字号，基准字号的倍数。 */
export const RICH_TEXT_HEADING_SCALES = [1.6, 1.35, 1.15] as const

/** 上标与下标的字号，所在文字字号的倍数。 */
export const RICH_TEXT_SCRIPT_SCALE = 0.7

/** 顶层块与块之间的段距，基准字号的倍数；列表项之间与列表项里的块之间不留段距。 */
export const RICH_TEXT_BLOCK_GAP = 0.5

/** 每层列表的缩进，基准字号的倍数。 */
export const RICH_TEXT_LIST_INDENT = 2

/** 项目符号或序号与文字之间的间距，基准字号的倍数。 */
export const RICH_TEXT_MARKER_GAP = 0.5

/** 分隔线的线宽，单位 mm。 */
export const RICH_TEXT_DIVIDER_WIDTH = 0.2

/** 一到三层无序列表的项目符号。 */
const BULLETS = ['•', '◦', '▪'] as const

const EMPTY_DOCUMENT: RichTextDocument = { blocks: [] }

/** 已取值并排好行的富文本。 */
export interface PreparedRichText {
  element: RichTextElement
  lines: RichTextLine[]
  padding: Edges
}

/** 一截带样式的文字；lineSize 是没缩上下标的字号（pt），用来定行高。 */
interface Piece {
  text: string
  span: Omit<RichTextSpan, 'text'>
  lineSize: number
}

/** 块的字号与粗细：段落取基准样式，标题按级别放大并加粗。 */
interface BlockFont {
  fontSize: number
  bold: boolean
}

/** 字段里的富文本：HTML 串按白名单换成文档，丢掉的标签报诊断；文档对象先校验，不合规时不画并报诊断。 */
function resolveDocument(content: RichTextContent, context: LayoutContext, scope: DiagnosticScope): RichTextDocument {
  if (content.kind === 'static')
    return content.document
  const value = getFieldValue(context.data, content.field)
  if (isEmptyValue(value))
    return EMPTY_DOCUMENT
  if (content.source === 'html') {
    const { document, dropped } = parseRichTextHtml(valueText(value, undefined, undefined, context, scope))
    const names = dropped.filter(drop => drop.kind === 'element' || drop.kind === 'content').map(drop => drop.name)
    if (names.length > 0)
      context.report('richText.droppedContent', scope, { field: content.field, names })
    return document
  }
  const issues: ValidationIssue[] = []
  validateRichTextDocument(value, [], createIssueSink(issues))
  const error = issues.find(issue => issue.severity === 'error')
  if (error === undefined)
    return value as RichTextDocument
  context.report('richText.invalidData', scope, { field: content.field, code: error.code, path: formatJsonPath(error.path) })
  return EMPTY_DOCUMENT
}

function pieceOf(text: string, marks: RichMarks | undefined, block: BlockFont, style: TextStyle): Piece {
  const lineSize = marks?.fontSize ?? block.fontSize
  const script = marks?.superscript === true ? 'super' : marks?.subscript === true ? 'sub' : undefined
  const span: Omit<RichTextSpan, 'text'> = {
    fontSize: script === undefined ? lineSize : lineSize * RICH_TEXT_SCRIPT_SCALE,
    bold: marks?.bold ?? block.bold,
    italic: marks?.italic ?? style.italic,
    underline: marks?.underline ?? style.underline,
    lineThrough: marks?.lineThrough ?? style.lineThrough,
    color: marks?.color ?? style.color,
    letterSpacing: style.letterSpacing,
  }
  const fontFamily = marks?.fontFamily ?? style.fontFamily
  if (fontFamily !== undefined)
    span.fontFamily = fontFamily
  if (marks?.background !== undefined)
    span.background = marks.background
  if (script !== undefined)
    span.script = script
  if (marks?.link !== undefined)
    span.link = marks.link
  return { text, span, lineSize }
}

/** 按富文本文档排行：块按元素内宽逐个排，段落与标题经 @xihan-ui/viz 的 wrapRuns 多样式折行。 */
class RichTextLayouter {
  readonly lines: RichTextLine[] = []
  private gap = 0
  private marker: RichTextMarker | undefined

  constructor(
    private readonly style: TextStyle,
    private readonly width: number,
    private readonly context: LayoutContext,
    private readonly scope: DiagnosticScope,
  ) {}

  /** 基准字号，单位 mm。 */
  private get base(): number {
    return convertLength(this.style.fontSize, 'pt', 'mm')
  }

  private font(piece: Pick<Piece, 'span' | 'lineSize'>): FontSpec {
    return fontSpec(piece.span, convertLength(piece.lineSize, 'pt', 'mm') * this.style.lineHeight)
  }

  /** 加一行：带上待用的段距，列表项还没画出的项目符号落在这一行。 */
  private emit(line: Omit<RichTextLine, 'gap' | 'marker'>): void {
    const next: RichTextLine = { ...line, gap: this.lines.length === 0 ? 0 : this.gap }
    if (this.marker !== undefined)
      next.marker = this.marker
    this.lines.push(next)
    this.gap = 0
    this.marker = undefined
  }

  /** 基准字号的空行。 */
  private emptyLine(indent: number): void {
    this.emit({ height: this.base * this.style.lineHeight, indent, align: this.style.align, spans: [] })
  }

  private fieldText(field: string, format: ValueFormat | undefined): string {
    return valueText(getFieldValue(this.context.data, field), format, undefined, this.context, this.scope)
  }

  /** 行内内容按换行切成硬行；每个硬行带一截锚点样式，空行用它定行高。 */
  private hardLines(runs: readonly RichInline[], block: BlockFont): { pieces: Piece[], anchor: Piece }[] {
    const result: { pieces: Piece[], anchor: Piece }[] = []
    let pieces: Piece[] = []
    let last = pieceOf('', undefined, block, this.style)
    const breakLine = (anchor: Piece): void => {
      result.push({ pieces, anchor })
      pieces = []
    }
    for (const run of runs) {
      if (run.type === 'break') {
        breakLine(last)
        continue
      }
      const text = run.type === 'text' ? run.text : this.fieldText(run.field, run.format as ValueFormat | undefined)
      const parts = text.split(/\r?\n/)
      parts.forEach((part, index) => {
        last = pieceOf(part, run.marks, block, this.style)
        if (index > 0)
          breakLine(last)
        if (part !== '')
          pieces.push(last)
      })
    }
    result.push({ pieces, anchor: last })
    return result
  }

  private textBlock(runs: readonly RichInline[], align: TextAlign | undefined, block: BlockFont, indent: number): void {
    const blockAlign = align ?? this.style.align
    const maxWidth = convertLength(Math.max(0, this.width - indent), 'mm', 'px')
    for (const { pieces, anchor } of this.hardLines(runs, block)) {
      const items = pieces.length === 0 ? [{ ...anchor, text: '' }] : pieces
      const textRuns: TextRun[] = items.map(piece => ({ text: piece.text, font: this.font(piece), letterSpacing: convertLength(piece.span.letterSpacing, 'pt', 'px') }))
      const wrapped = wrapRuns(textRuns, maxWidth, this.context.measurer)
      wrapped.forEach((line, index) => {
        const lineSize = Math.max(...line.segments.map(segment => (items[segment.run] as Piece).lineSize))
        this.emit({
          height: convertLength(lineSize, 'pt', 'mm') * this.style.lineHeight,
          indent,
          align: blockAlign === 'justify' && index === wrapped.length - 1 ? 'left' : blockAlign,
          spans: line.segments.filter(segment => segment.text !== '').map(segment => ({ ...(items[segment.run] as Piece).span, text: segment.text })),
        })
      })
    }
  }

  private list(block: Extract<RichBlock, { type: 'list' }>, indent: number, depth: number): void {
    const itemIndent = indent + this.base * RICH_TEXT_LIST_INDENT
    const body: BlockFont = { fontSize: this.style.fontSize, bold: this.style.bold }
    block.items.forEach((item, index) => {
      const marker = pieceOf(block.ordered ? `${(block.start ?? 1) + index}.` : BULLETS[Math.min(depth, BULLETS.length - 1)]!, undefined, body, this.style)
      const width = convertLength(this.context.measurer.measure(marker.text, this.font(marker)).width, 'px', 'mm')
      // 外层列表项的第一块就是内层列表时，外层的项目符号单独占一行
      if (this.marker !== undefined)
        this.emptyLine(indent)
      this.marker = { x: Math.max(indent, itemIndent - this.base * RICH_TEXT_MARKER_GAP - width), span: { ...marker.span, text: marker.text } }
      if (item.blocks.length === 0)
        this.emptyLine(itemIndent)
      else
        this.blocks(item.blocks, itemIndent, depth + 1)
    })
  }

  blocks(blocks: readonly RichBlock[], indent: number, depth: number): void {
    blocks.forEach((block, index) => {
      if (depth === 0 && index > 0)
        this.gap = this.base * RICH_TEXT_BLOCK_GAP
      switch (block.type) {
        case 'paragraph':
          this.textBlock(block.runs, block.align, { fontSize: this.style.fontSize, bold: this.style.bold }, indent)
          break
        case 'heading':
          this.textBlock(block.runs, block.align, { fontSize: this.style.fontSize * RICH_TEXT_HEADING_SCALES[block.level - 1]!, bold: true }, indent)
          break
        case 'list':
          this.list(block, indent, depth)
          break
        case 'divider':
          this.emit({ height: this.base * this.style.lineHeight, indent, align: 'left', spans: [], divider: { color: this.style.color, width: RICH_TEXT_DIVIDER_WIDTH } })
          break
      }
    })
  }
}

/** 取得文档并按元素内宽排行。 */
export function prepareRichText(element: RichTextElement, context: LayoutContext, scope: DiagnosticScope): PreparedRichText {
  const padding = paddingOf(element)
  const layouter = new RichTextLayouter(element.style, element.width - padding.left - padding.right, context, scope)
  layouter.blocks(resolveDocument(element.content, context, scope).blocks, 0, 0)
  return { element, lines: layouter.lines, padding }
}

/** lines[from, to) 的总高度：首行不计段距。 */
function linesHeight(lines: readonly RichTextLine[], from: number, to: number): number {
  let height = 0
  for (let index = from; index < to; index++)
    height += (lines[index] as RichTextLine).height + (index === from ? 0 : (lines[index] as RichTextLine).gap)
  return height
}

/**
 * 从起点开始排富文本，按整行切分到后续输出页；每段各带上下内边距，续排那一段的第一行不留段距。
 * 只有一段时高度不小于设计高度（以当页剩余空间为限）。
 */
export function placeRichText(
  prepared: PreparedRichText,
  start: SheetCursor,
  geometry: BodyGeometry,
  context: LayoutContext,
  scope: DiagnosticScope,
): Placement {
  const { element, lines, padding } = prepared
  const verticalPadding = padding.top + padding.bottom
  const boxes: Placement['boxes'] = []
  let cursor = start
  let index = 0

  const pushBox = (from: number, to: number, y: number, height: number): void => {
    const slice = lines.slice(from, to)
    const first = slice[0]
    if (first !== undefined && first.gap !== 0)
      slice[0] = { ...first, gap: 0 }
    const box: RichTextLayoutBox = {
      ...boxBase(element, 'body'),
      y,
      height,
      kind: 'richText',
      lines: slice,
      verticalAlign: element.style.verticalAlign,
      fragment: { index: boxes.length, last: false },
    }
    if (element.box !== undefined)
      box.box = element.box
    boxes.push({ sheet: cursor.sheet, box })
  }

  const finish = (height: number): Placement => {
    pushBox(index, lines.length, cursor.y, height)
    const last = boxes.at(-1)?.box
    if (last?.kind === 'richText')
      last.fragment.last = true
    return { boxes, end: { sheet: cursor.sheet, y: cursor.y + height }, truncated: false }
  }

  while (cursor.sheet < geometry.limit) {
    const available = bodyBottom(geometry.bodyRect(cursor.sheet)) - cursor.y
    const remaining = lines.length - index
    const contentHeight = linesHeight(lines, index, lines.length) + verticalPadding
    if (contentHeight <= available + LAYOUT_EPSILON)
      return finish(boxes.length === 0 ? Math.max(contentHeight, Math.min(element.height, available)) : contentHeight)

    let fit = 0
    let used = verticalPadding
    while (fit < remaining) {
      const line = lines[index + fit] as RichTextLine
      const next = used + line.height + (fit === 0 ? 0 : line.gap)
      if (next > available + LAYOUT_EPSILON)
        break
      used = next
      fit++
    }
    if (fit <= 0 && !isAtBodyTop(cursor, geometry)) {
      cursor = nextSheetTop(cursor.sheet, geometry)
      continue
    }
    if (fit <= 0) {
      context.report('element.overflow', scope)
      if (remaining <= 1)
        return finish(contentHeight)
    }
    const count = Math.max(fit, 1)
    pushBox(index, index + count, cursor.y, linesHeight(lines, index, index + count) + verticalPadding)
    index += count
    cursor = nextSheetTop(cursor.sheet, geometry)
  }

  context.report('layout.sheetLimit', scope, { limit: geometry.limit })
  const last = boxes.at(-1)
  return {
    boxes,
    end: last === undefined ? start : { sheet: last.sheet, y: last.box.y + last.box.height },
    truncated: true,
  }
}
