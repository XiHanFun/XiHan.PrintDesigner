/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEngine } from '../expression'
import type { PathSegment } from '../json'

/** 问题严重程度：error 模板不可用或不安全，warning 模板可用但很可能有误。 */
export type IssueSeverity = 'error' | 'warning'

/** 全部问题码及其固定的严重程度。 */
export const VALIDATION_ISSUE_SEVERITIES = {
  'json.invalidValue': 'error',
  'json.circular': 'error',
  'schema.invalidType': 'error',
  'schema.missingProperty': 'error',
  'schema.unknownProperty': 'warning',
  'schema.unsupportedVersion': 'error',
  'value.empty': 'error',
  'value.outOfRange': 'error',
  'value.notInteger': 'error',
  'value.invalidOption': 'error',
  'value.invalidColor': 'error',
  'id.duplicate': 'error',
  'field.empty': 'warning',
  'field.invalidPath': 'error',
  'template.unclosedPlaceholder': 'error',
  'template.emptyPlaceholder': 'error',
  'template.invalidPath': 'error',
  'expression.invalid': 'error',
  'format.duplicateMapValue': 'warning',
  'document.noPages': 'error',
  'page.presetMismatch': 'warning',
  'page.noContentArea': 'error',
  'page.bandsOverflow': 'error',
  'watermark.emptyText': 'warning',
  'element.unknownType': 'error',
  'element.tooSmall': 'error',
  'element.outsidePaper': 'warning',
  'element.outsideBand': 'warning',
  'element.flowInBand': 'error',
  'element.flowOutsideBody': 'warning',
  'line.zeroLength': 'error',
  'shape.invisible': 'warning',
  'image.emptySource': 'warning',
  'image.unsafeSource': 'error',
  'table.noColumns': 'warning',
  'table.duplicateColumnId': 'error',
  'table.duplicateRowId': 'error',
  'table.columnWidthMismatch': 'warning',
  'table.unknownColumn': 'error',
  'table.cellSpanOverflow': 'error',
  'table.cellOverlap': 'error',
  'table.aggregateFieldMissing': 'error',
  'table.rowExceedsBody': 'warning',
  'barcode.invalidValue': 'error',
  'qrcode.capacityExceeded': 'error',
  'qrcode.notSquare': 'warning',
  'pageNumber.noToken': 'warning',
  'pageNumber.unknownToken': 'warning',
} as const satisfies Record<string, IssueSeverity>

/** 问题码。 */
export type ValidationIssueCode = keyof typeof VALIDATION_ISSUE_SEVERITIES

/** 问题参数，供各语言文案插值。 */
export type IssueParams = Record<string, string | number | boolean | readonly string[]>

/** 校验问题：只含问题码、严重程度、定位与参数，不含文案。 */
export interface ValidationIssue {
  code: ValidationIssueCode
  severity: IssueSeverity
  /** 问题所在值从文档根开始的 JSON 路径。 */
  path: PathSegment[]
  /** 问题所在页面的标识。 */
  pageId?: string
  /** 问题所在元素的标识。 */
  elementId?: string
  params?: IssueParams
}

/** 校验报告。 */
export interface ValidationReport {
  /** 是否没有 error 级问题。 */
  valid: boolean
  issues: ValidationIssue[]
}

/** 问题接收器：按问题码、绝对路径与参数记录问题，并带上可选的表达式检查接入点。 */
export interface IssueSink {
  report: (code: ValidationIssueCode, path: readonly PathSegment[], params?: IssueParams) => void
  expressions?: ExpressionEngine
}

/** 问题定位所属的页面与元素。 */
export interface IssueScope {
  pageId?: string
  elementId?: string
}

/** 创建把问题追加到 `issues` 并带上定位的接收器。 */
export function createIssueSink(issues: ValidationIssue[], scope: IssueScope = {}, expressions?: ExpressionEngine): IssueSink {
  const sink: IssueSink = {
    report: (code, path, params) => {
      const issue: ValidationIssue = { code, severity: VALIDATION_ISSUE_SEVERITIES[code], path: [...path] }
      if (scope.pageId !== undefined)
        issue.pageId = scope.pageId
      if (scope.elementId !== undefined)
        issue.elementId = scope.elementId
      if (params !== undefined)
        issue.params = params
      issues.push(issue)
    },
  }
  if (expressions !== undefined)
    sink.expressions = expressions
  return sink
}
