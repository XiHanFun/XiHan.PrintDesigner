/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath } from '@xihan-ui/core/json'
import type { IssueDetails, IssueParamValue, IssueSeverity, SchemaIssue, SchemaIssueTarget } from '@xihan-ui/designer-kit/schema'
import type { ExpressionEngine } from '@xihan-ui/expression'

/**
 * 全部问题码及其固定的严重程度：不带前缀的是 @xihan-ui/designer-kit/schema 的通用问题码，
 * 带前缀的是打印专属的问题码。
 */
export const VALIDATION_ISSUE_SEVERITIES = {
  'required': 'error',
  'invalid-type': 'error',
  'invalid-value': 'error',
  'out-of-range': 'error',
  'not-integer': 'error',
  'invalid-option': 'error',
  'invalid-color': 'error',
  'empty': 'error',
  'unknown-key': 'warning',
  'duplicate-key': 'error',
  'duplicate-id': 'error',
  'json.circular': 'error',
  'schema.unsupportedVersion': 'error',
  'field.empty': 'warning',
  'field.invalidPath': 'error',
  'template.unclosedPlaceholder': 'error',
  'template.emptyPlaceholder': 'error',
  'template.invalidPath': 'error',
  'expression.invalid': 'error',
  'format.duplicateMapValue': 'warning',
  'format.invalidOption': 'error',
  'format.conflict': 'error',
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
  'barCode.invalidValue': 'error',
  'matrixCode.invalidValue': 'error',
  'matrixCode.invalidLevel': 'error',
  'matrixCode.levelIgnored': 'warning',
  'matrixCode.notSquare': 'warning',
  'pageNumber.noToken': 'warning',
  'pageNumber.unknownToken': 'warning',
  'richText.invalidDocument': 'error',
  'richText.empty': 'warning',
} as const satisfies Record<string, IssueSeverity>

/** 问题码。 */
export type ValidationIssueCode = keyof typeof VALIDATION_ISSUE_SEVERITIES

/** 问题参数，供各语言文案插值。 */
export type IssueParams = Readonly<Record<string, IssueParamValue>>

/**
 * 校验问题：@xihan-ui/designer-kit/schema 的 SchemaIssue，严重程度总是给出。
 * path 从文档根算起；target 指出问题落在的页面（kind 为 page）或元素（kind 为 element）。
 */
export type ValidationIssue = SchemaIssue<ValidationIssueCode> & { readonly severity: IssueSeverity }

/** 校验报告。 */
export interface ValidationReport {
  /** 是否没有 error 级问题。 */
  valid: boolean
  issues: ValidationIssue[]
}

/** 问题接收器：designer-kit 的 IssueSink 形状，问题写进共享的数组；可带表达式引擎供表达式读取器编译源码。 */
export interface IssueSink {
  readonly issues: ValidationIssue[]
  readonly report: (code: ValidationIssueCode, path: JsonPath, details?: IssueDetails) => void
  readonly expressionEngine?: ExpressionEngine
}

/** 创建把问题追加到 issues 的接收器：没有自带 target 的问题记到 target 上，严重程度按问题码查表。 */
export function createIssueSink(issues: ValidationIssue[], target?: SchemaIssueTarget, expressionEngine?: ExpressionEngine): IssueSink {
  return {
    issues,
    report: (code, path, details = {}) => {
      const issueTarget = details.target ?? target
      issues.push({
        code,
        path: [...path],
        severity: details.severity ?? VALIDATION_ISSUE_SEVERITIES[code],
        ...(issueTarget === undefined ? {} : { target: issueTarget }),
        ...(details.params === undefined ? {} : { params: details.params }),
      })
    },
    ...(expressionEngine === undefined ? {} : { expressionEngine }),
  }
}
