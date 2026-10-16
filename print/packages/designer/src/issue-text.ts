/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 校验问题与分页诊断的英文缺省文案：按问题码与参数生成一句说明。

import type { SchemaIssue } from '@xihan-ui/designer-kit/schema'

const REGIONS: Readonly<Record<string, string>> = { header: 'header', body: 'body', footer: 'footer' }

function text(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

function mm(value: unknown): string {
  return String(Math.round(Number(value) * 10) / 10)
}

function range(params: Readonly<Record<string, unknown>>): string {
  const parts: string[] = []
  if (params.min !== undefined)
    parts.push(`at least ${text(params.min)}`)
  if (params.exclusiveMin !== undefined)
    parts.push(`greater than ${text(params.exclusiveMin)}`)
  if (params.max !== undefined)
    parts.push(`at most ${text(params.max)}`)
  return parts.length === 0 ? 'Out of range' : `Must be ${parts.join(' and ')}`
}

/** 一条问题的英文说明；不认识的问题码原样返回。 */
export function defaultIssueText(issue: SchemaIssue): string {
  const params = issue.params ?? {}
  switch (issue.code) {
    case 'required':
      return 'Required value is missing'
    case 'invalid-type':
      return params.expected === undefined ? 'Wrong type' : `Expected ${text(params.expected)}`
    case 'invalid-value':
      return 'Invalid value'
    case 'out-of-range':
      return range(params)
    case 'not-integer':
      return 'Must be a whole number'
    case 'invalid-option':
      return 'Not one of the allowed options'
    case 'invalid-color':
      return 'Not a valid color'
    case 'empty':
      return 'Must not be empty'
    case 'unknown-key':
      return `Unknown property ${text(params.key)}`
    case 'duplicate-key':
      return `Duplicate key ${text(params.key)}`
    case 'duplicate-id':
      return `Duplicate id ${text(params.id)}`
    case 'json.circular':
      return 'Contains a circular reference'
    case 'schema.unsupportedVersion':
      return `Template version ${text(params.version)} is not supported (expected ${text(params.supported)})`
    case 'field.empty':
      return 'No field is bound'
    case 'field.invalidPath':
      return `Invalid field path ${text(params.field)}`
    case 'template.unclosedPlaceholder':
      return 'The template has an unclosed {{'
    case 'template.emptyPlaceholder':
      return 'The template has an empty {{}}'
    case 'template.invalidPath':
      return 'The template has an invalid field path'
    case 'expression.invalid':
      return 'Invalid expression'
    case 'format.duplicateMapValue':
      return `Value ${text(params.value)} is mapped more than once`
    case 'format.invalidOption':
      return 'Invalid format option'
    case 'format.conflict':
      return 'Format options conflict with each other'
    case 'document.noPages':
      return 'The template has no pages'
    case 'page.presetMismatch':
      return `Paper size does not match ${text(params.preset)}`
    case 'page.noContentArea':
      return 'The margins leave no room for content'
    case 'page.bandsOverflow':
      return 'Header and footer are taller than the content area'
    case 'watermark.emptyText':
      return 'Watermark text is empty'
    case 'element.unknownType':
      return `Unknown element type ${text(params.type)}`
    case 'element.tooSmall':
      return `Smaller than the minimum size ${mm(params.minWidth)} × ${mm(params.minHeight)} mm`
    case 'element.outsidePaper':
      return 'Extends beyond the paper'
    case 'element.outsideBand':
      return `Extends beyond the ${REGIONS[text(params.region)] ?? text(params.region)}`
    case 'element.flowInBand':
      return 'Flowing elements can only be placed in the body'
    case 'element.flowOutsideBody':
      return 'Flowing element extends beyond the body'
    case 'line.zeroLength':
      return 'The line has zero length'
    case 'shape.invisible':
      return 'The shape has neither stroke nor fill'
    case 'image.emptySource':
      return 'Image source is empty'
    case 'image.unsafeSource':
      return 'Image source is not allowed'
    case 'table.noColumns':
      return 'The table has no columns'
    case 'table.duplicateColumnId':
      return `Duplicate column id ${text(params.id)}`
    case 'table.duplicateRowId':
      return `Duplicate footer row id ${text(params.id)}`
    case 'table.columnWidthMismatch':
      return `Columns add up to ${mm(params.columnsWidth)} mm but the table is ${mm(params.width)} mm wide`
    case 'table.unknownColumn':
      return `Footer cell refers to missing column ${text(params.columnId)}`
    case 'table.cellSpanOverflow':
      return `Spans ${text(params.colSpan)} columns but only ${text(params.available)} remain`
    case 'table.cellOverlap':
      return 'Footer cell overlaps another cell'
    case 'table.aggregateFieldMissing':
      return `Summary ${text(params.fn)} needs a field`
    case 'table.rowExceedsBody':
      return `Header and one row need ${mm(params.required)} mm but the body is ${mm(params.available)} mm`
    case 'barCode.invalidValue':
      return `Content cannot be encoded as ${text(params.format)}`
    case 'matrixCode.invalidValue':
      return `Content cannot be encoded as ${text(params.format)}`
    case 'matrixCode.invalidLevel':
      return `Error correction level ${text(params.level)} does not apply to ${text(params.format)}`
    case 'matrixCode.levelIgnored':
      return `${text(params.format)} has no error correction level; it is ignored`
    case 'matrixCode.notSquare':
      return '2D code is not square'
    case 'pageNumber.noToken':
      return 'Page number format has no {{$page}} or {{$pages}}'
    case 'pageNumber.unknownToken':
      return `Unknown variable ${text(params.token)} in page number format`
    case 'data.notArray':
      return `Field ${text(params.field)} is not a list`
    case 'data.notScalar':
      return params.field === undefined ? 'Value is not a single value' : `Field ${text(params.field)} is not a single value`
    case 'format.unavailable':
      return 'No formatter is available'
    case 'format.failed':
      return 'Formatting failed'
    case 'expression.unavailable':
      return 'No expression engine is available'
    case 'expression.failed':
      return 'Expression evaluation failed'
    case 'text.overflow':
      return params.fontSize === undefined ? 'Text overflows its box' : `Text overflows its box at ${text(params.fontSize)} pt`
    case 'table.rowOverflow':
      return `Row ${Number(params.dataIndex) + 1} does not fit on one page`
    case 'element.overflow':
      return 'Content overflows its box'
    case 'layout.sheetLimit':
      return `More than ${text(params.limit)} pages`
    default:
      return issue.code
  }
}
