/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEvaluator } from '../expression'
import type { FormatResult } from '../format'
import type { IssueParams } from '../validation/issues'
import type {
  PaginationDiagnostic,
  PaginationDiagnosticCode,
  TextMeasurement,
  TextMeasurer,
  TextMeasureRequest,
} from './types'
import { PrintLayoutError } from './types'

/** 长度比较的容差，单位 mm。 */
export const LAYOUT_EPSILON = 1e-6

/** 诊断定位。 */
export interface DiagnosticScope {
  pageId: string
  elementId?: string
}

/** 一次分页内共享的上下文。 */
export interface LayoutContext {
  data: unknown
  evaluator?: ExpressionEvaluator
  timeZone?: string
  report: (code: PaginationDiagnosticCode, scope: DiagnosticScope, params?: IssueParams) => void
  measure: (request: TextMeasureRequest) => TextMeasurement
}

function isValidMeasurement(result: unknown): result is TextMeasurement {
  if (typeof result !== 'object' || result === null)
    return false
  const { lines, width, height } = result as Record<string, unknown>
  return Array.isArray(lines)
    && lines.every(line => typeof line === 'string')
    && typeof width === 'number' && Number.isFinite(width) && width >= 0
    && typeof height === 'number' && Number.isFinite(height) && height >= 0
}

/** 创建分页上下文：诊断按诊断码、定位与参数去重，测量结果不合法时抛出 PrintLayoutError。 */
export function createLayoutContext(
  data: unknown,
  measurer: TextMeasurer,
  options: { evaluator?: ExpressionEvaluator, timeZone?: string },
  diagnostics: PaginationDiagnostic[],
): LayoutContext {
  const seen = new Set<string>()
  const context: LayoutContext = {
    data,
    report: (code, scope, params) => {
      const key = JSON.stringify([code, scope.pageId, scope.elementId ?? null, params ?? null])
      if (seen.has(key))
        return
      seen.add(key)
      const diagnostic: PaginationDiagnostic = { code, pageId: scope.pageId }
      if (scope.elementId !== undefined)
        diagnostic.elementId = scope.elementId
      if (params !== undefined)
        diagnostic.params = params
      diagnostics.push(diagnostic)
    },
    measure: (request) => {
      const result = measurer.measure(request)
      if (!isValidMeasurement(result))
        throw new PrintLayoutError('measurer.invalidResult', { text: request.text })
      return result
    },
  }
  if (options.evaluator !== undefined)
    context.evaluator = options.evaluator
  if (options.timeZone !== undefined)
    context.timeZone = options.timeZone
  return context
}

const FORMAT_PROBLEM_CODES = {
  notNumber: 'format.notNumber',
  invalidDate: 'format.invalidDate',
  outOfRange: 'format.outOfRange',
  expressionUnavailable: 'expression.unavailable',
  expressionFailed: 'expression.failed',
  notScalar: 'data.notScalar',
} as const satisfies Record<NonNullable<FormatResult['problem']>, PaginationDiagnosticCode>

/** 把格式化或求值的问题报告为诊断，返回结果文本。 */
export function reportFormatResult(context: LayoutContext, scope: DiagnosticScope, result: FormatResult): string {
  if (result.problem !== undefined) {
    const params: Record<string, string> = {}
    const [first] = result.diagnostics ?? []
    if (first !== undefined)
      params.reason = first.code
    context.report(FORMAT_PROBLEM_CODES[result.problem], scope, first === undefined ? undefined : params)
  }
  return result.text
}
