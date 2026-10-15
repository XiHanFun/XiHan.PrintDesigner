/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PathSegment } from '../json'
import type { PropertyControl } from '../registry/types'
import type { FieldRule } from './checks'
import type { IssueSink } from './issues'
import { parsePageNumberFormat } from '../page-number-format'
import {
  AGGREGATE_FUNCTIONS,
  AGGREGATE_SCOPES,
  BARCODE_SYMBOLOGIES,
  HORIZONTAL_ALIGNS,
  STROKE_STYLES,
  TABLE_CELL_TYPES,
  TABLE_FOOTER_PLACEMENTS,
  VERTICAL_ALIGNS,
} from '../schema/options'
import {
  checkFields,
  expectArray,
  expectBoolean,
  expectColor,
  expectExpression,
  expectFieldPath,
  expectNumber,
  expectObject,
  expectOption,
  expectString,
  expectTextTemplate,
  field,
} from './checks'

type Path = readonly PathSegment[]

const SAFE_URL_SCHEMES: readonly string[] = ['http', 'https', 'blob']
const URL_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/
const URL_IGNORED_PATTERN = /[\p{Cc}\s]/gu

/** 判断图片地址是否只会被当作图片加载：http(s)、blob、data:image 或不带协议的相对地址。 */
export function isSafeImageUrl(url: string): boolean {
  const normalized = url.replace(URL_IGNORED_PATTERN, '').toLowerCase()
  const scheme = URL_SCHEME_PATTERN.exec(normalized)?.[1]
  if (scheme === undefined)
    return true
  if (scheme === 'data')
    return normalized.startsWith('data:image/')
  return SAFE_URL_SCHEMES.includes(scheme)
}

function kindOf(value: Record<string, unknown>, kinds: readonly string[], path: Path, sink: IssueSink): string | undefined {
  if (value.kind === undefined) {
    sink.report('schema.missingProperty', [...path, 'kind'], { property: 'kind' })
    return undefined
  }
  return expectOption(value.kind, kinds, [...path, 'kind'], sink) ? value.kind : undefined
}

function checkVariant(
  value: unknown,
  variants: Readonly<Record<string, readonly FieldRule[]>>,
  path: Path,
  sink: IssueSink,
): string | undefined {
  if (!expectObject(value, path, sink))
    return undefined
  const kind = kindOf(value, Object.keys(variants), path, sink)
  if (kind === undefined)
    return undefined
  checkFields(value, variants[kind] ?? [], path, sink, ['kind'])
  return kind
}

/** 校验值格式。 */
export function validateValueFormat(value: unknown, path: Path, sink: IssueSink): void {
  const decimals = (item: unknown, itemPath: Path): boolean =>
    expectNumber(item, itemPath, sink, { min: 0, max: 20, integer: true })
  const text = (item: unknown, itemPath: Path): boolean => expectString(item, itemPath, sink)
  checkVariant(value, {
    number: [
      field('decimals', true, decimals),
      field('thousands', true, (item, itemPath) => expectBoolean(item, itemPath, sink)),
      field('prefix', false, text),
      field('suffix', false, text),
    ],
    percent: [field('decimals', true, decimals)],
    date: [field('pattern', true, (item, itemPath) => expectString(item, itemPath, sink, { nonEmpty: true }))],
    chineseAmount: [],
    map: [
      field('entries', true, (item, itemPath) => validateMapEntries(item, itemPath, sink)),
      field('fallback', false, text),
    ],
    expression: [field('expression', true, (item, itemPath) => expectExpression(item, itemPath, sink))],
  }, path, sink)
}

function validateMapEntries(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectArray(value, path, sink))
    return
  const seen = new Set<string>()
  value.forEach((entry, index) => {
    const entryPath = [...path, index]
    if (!expectObject(entry, entryPath, sink))
      return
    checkFields(entry, [
      field('value', true, (item, itemPath) => expectString(item, itemPath, sink)),
      field('text', true, (item, itemPath) => expectString(item, itemPath, sink)),
    ], entryPath, sink)
    if (typeof entry.value !== 'string')
      return
    if (seen.has(entry.value))
      sink.report('format.duplicateMapValue', [...entryPath, 'value'], { value: entry.value })
    seen.add(entry.value)
  })
}

function textContentRules(sink: IssueSink): Record<string, FieldRule[]> {
  return {
    static: [field('text', true, (item, itemPath) => expectString(item, itemPath, sink))],
    field: [
      field('field', true, (item, itemPath) => expectFieldPath(item, itemPath, sink)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
      field('emptyText', false, (item, itemPath) => expectString(item, itemPath, sink)),
    ],
    template: [field('template', true, (item, itemPath) => expectTextTemplate(item, itemPath, sink))],
    expression: [
      field('expression', true, (item, itemPath) => expectExpression(item, itemPath, sink)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
    ],
  }
}

/** 校验文本内容来源。 */
export function validateTextContent(value: unknown, path: Path, sink: IssueSink): void {
  checkVariant(value, textContentRules(sink), path, sink)
}

/** 校验图片来源。 */
export function validateImageSource(value: unknown, path: Path, sink: IssueSink): void {
  checkVariant(value, {
    static: [field('url', true, (item, itemPath) => {
      if (!expectString(item, itemPath, sink))
        return
      if (item.trim().length === 0)
        sink.report('image.emptySource', itemPath)
      else if (!isSafeImageUrl(item))
        sink.report('image.unsafeSource', itemPath)
    })],
    field: [field('field', true, (item, itemPath) => expectFieldPath(item, itemPath, sink))],
  }, path, sink)
}

/** 校验描边。 */
export function validateStroke(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  checkFields(value, [
    field('width', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0, max: 50 })),
    field('style', true, (item, itemPath) => expectOption(item, STROKE_STYLES, itemPath, sink)),
    field('color', true, (item, itemPath) => expectColor(item, itemPath, sink)),
  ], path, sink)
}

/** 校验四边距离。 */
export function validateEdges(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  const side = (item: unknown, itemPath: Path): boolean => expectNumber(item, itemPath, sink, { min: 0 })
  checkFields(value, ['top', 'right', 'bottom', 'left'].map(key => field(key, true, side)), path, sink)
}

/** 校验四边边框。 */
export function validateBorderSides(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  const side = (item: unknown, itemPath: Path): void => validateStroke(item, itemPath, sink)
  checkFields(value, ['top', 'right', 'bottom', 'left'].map(key => field(key, false, side)), path, sink)
}

/** 校验单元格样式。 */
export function validateCellStyle(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  const boolean = (item: unknown, itemPath: Path): boolean => expectBoolean(item, itemPath, sink)
  const color = (item: unknown, itemPath: Path): boolean => expectColor(item, itemPath, sink)
  checkFields(value, [
    field('fontFamily', false, (item, itemPath) => expectString(item, itemPath, sink)),
    field('fontSize', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0, max: 500 })),
    field('bold', true, boolean),
    field('italic', true, boolean),
    field('color', true, color),
    field('background', false, color),
    field('align', false, (item, itemPath) => expectOption(item, HORIZONTAL_ALIGNS, itemPath, sink)),
    field('verticalAlign', true, (item, itemPath) => expectOption(item, VERTICAL_ALIGNS, itemPath, sink)),
    field('padding', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: 0 })),
    field('lineHeight', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0, max: 100 })),
  ], path, sink)
}

function validateTableCellContent(value: unknown, path: Path, sink: IssueSink): void {
  const rules = textContentRules(sink)
  checkVariant(value, {
    field: rules.field ?? [],
    template: rules.template ?? [],
    rowNumber: [],
    expression: rules.expression ?? [],
  }, path, sink)
}

function validateFooterCellContent(value: unknown, path: Path, sink: IssueSink): void {
  checkVariant(value, {
    ...textContentRules(sink),
    aggregate: [
      field('fn', true, (item, itemPath) => expectOption(item, AGGREGATE_FUNCTIONS, itemPath, sink)),
      field('field', false, (item, itemPath) => expectFieldPath(item, itemPath, sink)),
      field('scope', true, (item, itemPath) => expectOption(item, AGGREGATE_SCOPES, itemPath, sink)),
      field('format', false, (item, itemPath) => validateValueFormat(item, itemPath, sink)),
    ],
  }, path, sink)
  if (typeof value !== 'object' || value === null)
    return
  const content = value as Record<string, unknown>
  const needsField = content.kind === 'aggregate'
    && typeof content.fn === 'string'
    && content.fn !== 'count'
    && content.field === undefined
  if (needsField)
    sink.report('table.aggregateFieldMissing', path, { fn: content.fn as string })
}

function checkUniqueIds(
  items: readonly unknown[],
  path: Path,
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
      sink.report(code, [...path, index, 'id'], { id })
    seen.add(id)
  })
}

/** 校验表格列。 */
export function validateTableColumns(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectArray(value, path, sink))
    return
  value.forEach((column, index) => {
    const columnPath = [...path, index]
    if (!expectObject(column, columnPath, sink))
      return
    checkFields(column, [
      field('id', true, (item, itemPath) => expectString(item, itemPath, sink, { nonEmpty: true })),
      field('title', true, (item, itemPath) => expectString(item, itemPath, sink)),
      field('width', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0 })),
      field('align', true, (item, itemPath) => expectOption(item, HORIZONTAL_ALIGNS, itemPath, sink)),
      field('content', true, (item, itemPath) => validateTableCellContent(item, itemPath, sink)),
      field('cellType', true, (item, itemPath) => expectOption(item, TABLE_CELL_TYPES, itemPath, sink)),
      field('symbology', column.cellType === 'barcode', (item, itemPath) => expectOption(item, BARCODE_SYMBOLOGIES, itemPath, sink)),
    ], columnPath, sink)
  })
  checkUniqueIds(value, path, sink, 'table.duplicateColumnId')
}

/** 校验表尾行的结构；单元格与列的对应关系由表格规则另行校验。 */
export function validateTableFooterRows(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectArray(value, path, sink))
    return
  value.forEach((row, index) => {
    const rowPath = [...path, index]
    if (!expectObject(row, rowPath, sink))
      return
    checkFields(row, [
      field('id', true, (item, itemPath) => expectString(item, itemPath, sink, { nonEmpty: true })),
      field('placement', true, (item, itemPath) => expectOption(item, TABLE_FOOTER_PLACEMENTS, itemPath, sink)),
      field('height', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0 })),
      field('style', true, (item, itemPath) => validateCellStyle(item, itemPath, sink)),
      field('cells', true, (item, itemPath) => validateFooterCells(item, itemPath, sink)),
    ], rowPath, sink)
  })
  checkUniqueIds(value, path, sink, 'table.duplicateRowId')
}

function validateFooterCells(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectArray(value, path, sink))
    return
  value.forEach((cell, index) => {
    const cellPath = [...path, index]
    if (!expectObject(cell, cellPath, sink))
      return
    checkFields(cell, [
      field('columnId', true, (item, itemPath) => expectString(item, itemPath, sink, { nonEmpty: true })),
      field('colSpan', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: 1, integer: true })),
      field('content', true, (item, itemPath) => validateFooterCellContent(item, itemPath, sink)),
      field('align', false, (item, itemPath) => expectOption(item, HORIZONTAL_ALIGNS, itemPath, sink)),
    ], cellPath, sink)
  })
}

/** 校验页码格式：至少含一个已知记号，不含未知记号。 */
export function validatePageNumberFormat(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectString(value, path, sink))
    return
  const { segments, unknownTokens } = parsePageNumberFormat(value)
  if (!segments.some(segment => segment.kind === 'token'))
    sink.report('pageNumber.noToken', path)
  for (const token of unknownTokens)
    sink.report('pageNumber.unknownToken', path, { token })
}

/** 按属性编辑方式校验属性值。 */
export function validateControlValue(control: PropertyControl, value: unknown, path: Path, sink: IssueSink): void {
  switch (control.kind) {
    case 'number':
      expectNumber(value, path, sink, control)
      return
    case 'text':
      expectString(value, path, sink)
      return
    case 'boolean':
      expectBoolean(value, path, sink)
      return
    case 'select':
      expectOption(value, control.options, path, sink)
      return
    case 'color':
      expectColor(value, path, sink)
      return
    case 'field':
      expectFieldPath(value, path, sink)
      return
    case 'textContent':
      validateTextContent(value, path, sink)
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
    case 'edges':
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
    case 'matrixCodeLevel':
      if (typeof value !== 'string' && typeof value !== 'number')
        sink.report('schema.invalidType', path, { expected: 'string|number' })
  }
}
