/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath, JsonValue } from '@xihan-ui/core/json'
import type { RichBlock, RichTextDocument } from '@xihan-ui/core/rich-text'
import type { ControlKind } from '@xihan-ui/designer-kit/properties'
import type { FormatSpecIssueCode } from '@xihan-ui/expression'
import type { PropertyControl } from '../registry/types'
import type { FieldRule } from './checks'
import type { IssueSink, ValidationIssueCode } from './issues'
import { checkRichTextDocument } from '@xihan-ui/core/rich-text'
import { parseTextTemplate } from '@xihan-ui/core/template'
import { toSafeImageSource } from '@xihan-ui/core/url'
import { isPaperPresetName, PAPER_PRESET_NAMES, PAPER_PRESETS } from '@xihan-ui/designer-kit'
import { readArray, readBoolean, readNumber, readObject, readOneOf, readString } from '@xihan-ui/designer-kit/schema'
import { checkFormatSpec, FORMAT_KINDS } from '@xihan-ui/expression'
import { BAR_CODE_FORMATS } from '@xihan-ui/headless'
import {
  AGGREGATE_FUNCTIONS,
  AGGREGATE_SCOPES,
  HORIZONTAL_ALIGNS,
  RICH_TEXT_SOURCES,
  STROKE_STYLES,
  TABLE_CELL_TYPES,
  TABLE_FOOTER_PLACEMENTS,
  VERTICAL_ALIGNS,
} from '../schema/options'
import { field, readColor, readExpression, readFieldPath, readFields, readTextTemplate } from './checks'
import { LENGTH_TOLERANCE } from './element-rules'

/** 读取变体对象的 kind：缺少报 required，不在 kinds 里报 invalid-option。 */
function kindOf(sink: IssueSink, object: Readonly<Record<string, unknown>>, kinds: readonly string[], path: JsonPath): string | undefined {
  if (object.kind === undefined) {
    sink.report('required', [...path, 'kind'])
    return undefined
  }
  return readOneOf(sink, object.kind, [...path, 'kind'], kinds)
}

function checkVariant(
  sink: IssueSink,
  value: unknown,
  path: JsonPath,
  variants: Readonly<Record<string, readonly FieldRule[]>>,
): string | undefined {
  const object = readObject(sink, value, path)
  if (object === undefined)
    return undefined
  const kind = kindOf(sink, object, Object.keys(variants), path)
  if (kind === undefined)
    return undefined
  readFields(sink, object, path, variants[kind] ?? [], ['kind'])
  return kind
}

/** @xihan-ui/expression 格式说明问题码对应的打印问题码。 */
const FORMAT_ISSUE_CODES = {
  XH_EXPR_FORMAT_INVALID_SPEC: 'invalid-type',
  XH_EXPR_FORMAT_INVALID_KIND: 'invalid-option',
  XH_EXPR_FORMAT_INVALID_OPTION: 'format.invalidOption',
  XH_EXPR_FORMAT_CONFLICT: 'format.conflict',
  XH_EXPR_FORMAT_UNKNOWN_KEY: 'unknown-key',
} as const satisfies Record<FormatSpecIssueCode, ValidationIssueCode>

/** 校验值格式：值映射与表达式格式按本包规则，其余种类交给 @xihan-ui/expression 的 checkFormatSpec。 */
export function validateValueFormat(value: unknown, path: JsonPath, sink: IssueSink): void {
  const object = readObject(sink, value, path)
  if (object === undefined)
    return
  const kind = kindOf(sink, object, [...FORMAT_KINDS, 'map', 'expression'], path)
  if (kind === 'map') {
    readFields(sink, object, path, [
      field('entries', true, (item, itemPath) => validateMapEntries(item, itemPath, sink)),
      field('fallback', false, (item, itemPath) => readString(sink, item, itemPath)),
    ], ['kind'])
  }
  else if (kind === 'expression') {
    readFields(sink, object, path, [field('expression', true, (item, itemPath) => readExpression(sink, item, itemPath))], ['kind'])
  }
  else if (kind !== undefined) {
    for (const issue of checkFormatSpec(object))
      sink.report(FORMAT_ISSUE_CODES[issue.code], [...path, ...issue.path])
  }
}

function validateMapEntries(value: unknown, path: JsonPath, sink: IssueSink): void {
  const entries = readArray(sink, value, path)
  if (entries === undefined)
    return
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    const entryPath = [...path, index]
    const object = readFields(sink, entry, entryPath, [
      field('value', true, (item, itemPath) => readString(sink, item, itemPath)),
      field('text', true, (item, itemPath) => readString(sink, item, itemPath)),
    ])
    if (object === undefined || typeof object.value !== 'string')
      return
    if (seen.has(object.value))
      sink.report('format.duplicateMapValue', [...entryPath, 'value'], { params: { value: object.value } })
    seen.add(object.value)
  })
}

function textContentRules(sink: IssueSink): Record<string, FieldRule[]> {
  return {
    static: [field('text', true, (item, itemPath) => readString(sink, item, itemPath))],
    field: [
      field('field', true, (item, itemPath) => readFieldPath(sink, item, itemPath)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
      field('emptyText', false, (item, itemPath) => readString(sink, item, itemPath)),
    ],
    template: [field('template', true, (item, itemPath) => readTextTemplate(sink, item, itemPath))],
    expression: [
      field('expression', true, (item, itemPath) => readExpression(sink, item, itemPath)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
    ],
  }
}

/** 校验文本内容来源。 */
export function validateTextContent(value: unknown, path: JsonPath, sink: IssueSink): void {
  checkVariant(sink, value, path, textContentRules(sink))
}

/** 逐个读取富文本块里行内字段的路径与值格式。 */
function validateRichFields(blocks: readonly RichBlock[], path: JsonPath, sink: IssueSink): void {
  blocks.forEach((block, index) => {
    const blockPath = [...path, index]
    if (block.type === 'list') {
      block.items.forEach((item, itemIndex) => validateRichFields(item.blocks, [...blockPath, 'items', itemIndex, 'blocks'], sink))
      return
    }
    if (block.type === 'divider')
      return
    block.runs.forEach((run, runIndex) => {
      if (run.type !== 'field')
        return
      const runPath = [...blockPath, 'runs', runIndex]
      readFieldPath(sink, run.field, [...runPath, 'field'])
      if (run.format !== undefined)
        validateValueFormat(run.format, [...runPath, 'format'], sink)
    })
  })
}

/** 校验富文本文档：结构按 @xihan-ui/core/rich-text 的 checkRichTextDocument，结构无误时再读行内字段的路径与值格式。 */
export function validateRichTextDocument(value: unknown, path: JsonPath, sink: IssueSink): void {
  const issues = checkRichTextDocument(value)
  for (const issue of issues)
    sink.report('richText.invalidDocument', [...path, ...issue.path], { params: { code: issue.code } })
  if (issues.length === 0)
    validateRichFields((value as RichTextDocument).blocks, [...path, 'blocks'], sink)
}

/** 校验富文本内容来源。 */
export function validateRichTextContent(value: unknown, path: JsonPath, sink: IssueSink): void {
  checkVariant(sink, value, path, {
    static: [field('document', true, (item, itemPath) => validateRichTextDocument(item, itemPath, sink))],
    field: [
      field('field', true, (item, itemPath) => readFieldPath(sink, item, itemPath)),
      field('source', true, (item, itemPath) => readOneOf(sink, item, itemPath, RICH_TEXT_SOURCES)),
    ],
  })
}

/** 校验图片来源。 */
export function validateImageSource(value: unknown, path: JsonPath, sink: IssueSink): void {
  checkVariant(sink, value, path, {
    static: [field('url', true, (item, itemPath) => {
      const url = readString(sink, item, itemPath)
      if (url === undefined)
        return
      if (url.trim().length === 0)
        sink.report('image.emptySource', itemPath)
      else if (toSafeImageSource(url) === undefined)
        sink.report('image.unsafeSource', itemPath)
    })],
    field: [field('field', true, (item, itemPath) => readFieldPath(sink, item, itemPath))],
  })
}

/** 校验描边。 */
export function validateStroke(value: unknown, path: JsonPath, sink: IssueSink): void {
  readFields(sink, value, path, [
    field('width', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0, max: 50 })),
    field('style', true, (item, itemPath) => readOneOf(sink, item, itemPath, STROKE_STYLES)),
    field('color', true, (item, itemPath) => readColor(sink, item, itemPath)),
  ])
}

/** 校验四边距离。 */
export function validateEdges(value: unknown, path: JsonPath, sink: IssueSink): void {
  const side = (item: unknown, itemPath: JsonPath): void => {
    readNumber(sink, item, itemPath, { min: 0 })
  }
  readFields(sink, value, path, ['top', 'right', 'bottom', 'left'].map(key => field(key, true, side)))
}

/** 校验四边边框。 */
export function validateBorderSides(value: unknown, path: JsonPath, sink: IssueSink): void {
  const side = (item: unknown, itemPath: JsonPath): void => validateStroke(item, itemPath, sink)
  readFields(sink, value, path, ['top', 'right', 'bottom', 'left'].map(key => field(key, false, side)))
}

/** 校验单元格样式。 */
export function validateCellStyle(value: unknown, path: JsonPath, sink: IssueSink): void {
  const boolean = (item: unknown, itemPath: JsonPath): void => {
    readBoolean(sink, item, itemPath)
  }
  const color = (item: unknown, itemPath: JsonPath): void => {
    readColor(sink, item, itemPath)
  }
  readFields(sink, value, path, [
    field('fontFamily', false, (item, itemPath) => readString(sink, item, itemPath)),
    field('fontSize', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0, max: 500 })),
    field('bold', true, boolean),
    field('italic', true, boolean),
    field('color', true, color),
    field('background', false, color),
    field('align', false, (item, itemPath) => readOneOf(sink, item, itemPath, HORIZONTAL_ALIGNS)),
    field('verticalAlign', true, (item, itemPath) => readOneOf(sink, item, itemPath, VERTICAL_ALIGNS)),
    field('padding', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 0 })),
    field('lineHeight', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0, max: 100 })),
  ])
}

/** 校验表体单元格的内容来源。 */
export function validateTableCellContent(value: unknown, path: JsonPath, sink: IssueSink): void {
  const rules = textContentRules(sink)
  checkVariant(sink, value, path, {
    field: rules.field ?? [],
    template: rules.template ?? [],
    rowNumber: [],
    expression: rules.expression ?? [],
  })
}

/** 校验表尾单元格的内容来源。 */
export function validateFooterCellContent(value: unknown, path: JsonPath, sink: IssueSink): void {
  checkVariant(sink, value, path, {
    ...textContentRules(sink),
    aggregate: [
      field('fn', true, (item, itemPath) => readOneOf(sink, item, itemPath, AGGREGATE_FUNCTIONS)),
      field('field', false, (item, itemPath) => readFieldPath(sink, item, itemPath)),
      field('scope', true, (item, itemPath) => readOneOf(sink, item, itemPath, AGGREGATE_SCOPES)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
    ],
  })
  if (typeof value !== 'object' || value === null)
    return
  const content = value as Record<string, unknown>
  const needsField = content.kind === 'aggregate'
    && typeof content.fn === 'string'
    && content.fn !== 'count'
    && content.field === undefined
  if (needsField)
    sink.report('table.aggregateFieldMissing', path, { params: { fn: content.fn as string } })
}

function checkUniqueIds(
  items: readonly unknown[],
  path: JsonPath,
  sink: IssueSink,
  code: 'table.duplicateColumnId' | 'table.duplicateRowId',
): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (typeof item !== 'object' || item === null)
      return
    const id = (item as Record<string, unknown>).id
    if (typeof id !== 'string' || id.length === 0)
      return
    if (seen.has(id))
      sink.report(code, [...path, index, 'id'], { params: { id } })
    seen.add(id)
  })
}

/** 校验表格列。 */
export function validateTableColumns(value: unknown, path: JsonPath, sink: IssueSink): void {
  const columns = readArray(sink, value, path)
  if (columns === undefined)
    return
  columns.forEach((column, index) => {
    const isBarCode = typeof column === 'object' && column !== null && (column as Record<string, unknown>).cellType === 'barCode'
    readFields(sink, column, [...path, index], [
      field('id', true, (item, itemPath) => readString(sink, item, itemPath, { nonEmpty: true })),
      field('title', true, (item, itemPath) => readString(sink, item, itemPath)),
      field('width', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0 })),
      field('align', true, (item, itemPath) => readOneOf(sink, item, itemPath, HORIZONTAL_ALIGNS)),
      field('content', true, (item, itemPath) => validateTableCellContent(item, itemPath, sink)),
      field('cellType', true, (item, itemPath) => readOneOf(sink, item, itemPath, TABLE_CELL_TYPES)),
      field('barCodeFormat', isBarCode, (item, itemPath) => readOneOf(sink, item, itemPath, BAR_CODE_FORMATS)),
    ])
  })
  checkUniqueIds(columns, path, sink, 'table.duplicateColumnId')
}

/** 校验表尾行的结构；单元格与列的对应关系由表格规则另行校验。 */
export function validateTableFooterRows(value: unknown, path: JsonPath, sink: IssueSink): void {
  const rows = readArray(sink, value, path)
  if (rows === undefined)
    return
  rows.forEach((row, index) => {
    readFields(sink, row, [...path, index], [
      field('id', true, (item, itemPath) => readString(sink, item, itemPath, { nonEmpty: true })),
      field('placement', true, (item, itemPath) => readOneOf(sink, item, itemPath, TABLE_FOOTER_PLACEMENTS)),
      field('height', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0 })),
      field('style', true, (item, itemPath) => validateCellStyle(item, itemPath, sink)),
      field('cells', true, (item, itemPath) => validateFooterCells(item, itemPath, sink)),
    ])
  })
  checkUniqueIds(rows, path, sink, 'table.duplicateRowId')
}

function validateFooterCells(value: unknown, path: JsonPath, sink: IssueSink): void {
  const cells = readArray(sink, value, path)
  if (cells === undefined)
    return
  cells.forEach((cell, index) => {
    readFields(sink, cell, [...path, index], [
      field('columnId', true, (item, itemPath) => readString(sink, item, itemPath, { nonEmpty: true })),
      field('colSpan', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 1, integer: true })),
      field('content', true, (item, itemPath) => validateFooterCellContent(item, itemPath, sink)),
      field('align', false, (item, itemPath) => readOneOf(sink, item, itemPath, HORIZONTAL_ALIGNS)),
    ])
  })
}

/** 校验纸张：宽高为正，给了预设时宽高须与预设相符。 */
export function validatePaper(value: unknown, path: JsonPath, sink: IssueSink): void {
  const size = (item: unknown, itemPath: JsonPath): void => {
    readNumber(sink, item, itemPath, { exclusiveMin: 0 })
  }
  const paper = readFields(sink, value, path, [
    field('preset', false, (item, itemPath) => readOneOf(sink, item, itemPath, PAPER_PRESET_NAMES)),
    field('width', true, size),
    field('height', true, size),
  ])
  if (paper === undefined || !isPaperPresetName(paper.preset))
    return
  const expected = PAPER_PRESETS[paper.preset]
  const matches = typeof paper.width === 'number' && typeof paper.height === 'number'
    && Math.abs(paper.width - expected.width) <= LENGTH_TOLERANCE
    && Math.abs(paper.height - expected.height) <= LENGTH_TOLERANCE
  if (!matches)
    sink.report('page.presetMismatch', path, { params: { preset: paper.preset } })
}

/** 校验水印。 */
export function validateWatermark(value: unknown, path: JsonPath, sink: IssueSink): void {
  const gap = (item: unknown, itemPath: JsonPath): void => {
    readNumber(sink, item, itemPath, { min: 0 })
  }
  readFields(sink, value, path, [
    field('text', true, (item, itemPath) => {
      const text = readTextTemplate(sink, item, itemPath)
      if (text !== undefined && text.trim().length === 0)
        sink.report('watermark.emptyText', itemPath)
    }),
    field('fontFamily', false, (item, itemPath) => readString(sink, item, itemPath)),
    field('fontSize', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0, max: 500 })),
    field('color', true, (item, itemPath) => readColor(sink, item, itemPath)),
    field('opacity', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 0, max: 1 })),
    field('rotation', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: -360, max: 360 })),
    field('gapX', true, gap),
    field('gapY', true, gap),
  ])
}

/** 页码模板可用的宿主变量。 */
const PAGE_NUMBER_VARIABLES: readonly string[] = ['$page', '$pages']

/** 校验页码格式：合法的文本模板，至少用到一个页码变量，不用别的占位。 */
export function validatePageNumberFormat(value: unknown, path: JsonPath, sink: IssueSink): void {
  const template = readTextTemplate(sink, value, path)
  if (template === undefined)
    return
  const placeholders = parseTextTemplate(template).segments.filter(segment => segment.kind === 'path')
  const known = (segment: (typeof placeholders)[number]): boolean =>
    segment.path.length === 1 && PAGE_NUMBER_VARIABLES.includes(String(segment.path[0]))
  if (!placeholders.some(known))
    sink.report('pageNumber.noToken', path)
  for (const segment of placeholders) {
    if (!known(segment))
      sink.report('pageNumber.unknownToken', path, { params: { token: segment.source } })
  }
}

/**
 * 按属性编辑方式校验属性值：内建编辑方式用 designer-kit 的读取器，复合类型按各自的结构规则；
 * 其余编辑方式交给 controls 里登记的（扩展的编辑方式），它的 check 给出问题码；没登记的报 unknown-control。
 */
export function validateControlValue(control: PropertyControl, value: unknown, path: JsonPath, sink: IssueSink, controls: Readonly<Record<string, ControlKind>> = {}): void {
  switch (control.kind) {
    case 'number':
      readNumber(sink, value, path, control)
      return
    case 'text':
      readString(sink, value, path)
      return
    case 'boolean':
      readBoolean(sink, value, path)
      return
    case 'select':
      readOneOf(sink, value, path, control.options.map(option => option.value))
      return
    case 'color':
      readColor(sink, value, path)
      return
    case 'tags':
    case 'json':
      return
    case 'dataField':
      readFieldPath(sink, value, path)
      return
    case 'textContent':
      validateTextContent(value, path, sink)
      return
    case 'richTextContent':
      validateRichTextContent(value, path, sink)
      return
    case 'imageSource':
      validateImageSource(value, path, sink)
      return
    case 'valueFormat':
      validateValueFormat(value, path, sink)
      return
    case 'stroke':
      validateStroke(value, path, sink)
      return
    case 'sides':
      validateEdges(value, path, sink)
      return
    case 'borderSides':
      validateBorderSides(value, path, sink)
      return
    case 'cellStyle':
      validateCellStyle(value, path, sink)
      return
    case 'tableColumns':
      validateTableColumns(value, path, sink)
      return
    case 'tableFooterRows':
      validateTableFooterRows(value, path, sink)
      return
    case 'pageNumberFormat':
      validatePageNumberFormat(value, path, sink)
      return
    case 'paper':
      validatePaper(value, path, sink)
      return
    case 'watermark':
      validateWatermark(value, path, sink)
      return
    case 'cellContent':
      validateTableCellContent(value, path, sink)
      return
    case 'footerCellContent':
      validateFooterCellContent(value, path, sink)
      return
    case 'matrixCodeLevel':
      if (typeof value !== 'string' && typeof value !== 'number')
        sink.report('invalid-type', path, { params: { expected: 'string|number' } })
      return
    default: {
      const other = control as { readonly kind: string }
      if (!Object.hasOwn(controls, other.kind)) {
        sink.report('unknown-control', path, { params: { kind: other.kind } })
        return
      }
      const code = controls[other.kind]!.check?.(value as JsonValue, other)
      if (code !== undefined)
        sink.report(code as ValidationIssueCode, path)
    }
  }
}
