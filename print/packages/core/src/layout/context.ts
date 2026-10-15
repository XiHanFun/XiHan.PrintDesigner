/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { EngineCompileResult, ExpressionEngine, FormatOptions, FormatSpec } from '@xihan-ui/expression'
import type { IssueParams } from '../validation/issues'
import type {
  PaginationDiagnostic,
  PaginationDiagnosticCode,
  TextMeasurement,
  TextMeasurer,
  TextMeasureRequest,
  ValueFormatter,
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
  /** 编译表达式源码，同一源码只编译一次；未提供表达式接入点时为 undefined。 */
  compile?: (source: string) => EngineCompileResult
  /** 已绑定区域与时区的值格式化器，返回值不是字符串时抛出 PrintLayoutError。 */
  formatter?: (value: unknown, spec: FormatSpec) => string
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

/** 创建分页上下文：诊断按诊断码、定位与参数去重，测量或格式化结果不合法时抛出 PrintLayoutError。 */
export function createLayoutContext(
  data: unknown,
  measurer: TextMeasurer,
  options: { expressions?: ExpressionEngine, format?: ValueFormatter, formatOptions?: FormatOptions },
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
  const engine = options.expressions
  if (engine !== undefined) {
    const compiled = new Map<string, EngineCompileResult>()
    context.compile = (source) => {
      let result = compiled.get(source)
      if (result === undefined) {
        result = engine.compile(source)
        compiled.set(source, result)
      }
      return result
    }
  }
  const format = options.format
  if (format !== undefined) {
    const formatOptions = options.formatOptions ?? {}
    context.formatter = (value, spec) => {
      const text = format(value, spec, formatOptions)
      if (typeof text !== 'string')
        throw new PrintLayoutError('formatter.invalidResult', { kind: spec.kind })
      return text
    }
  }
  return context
}
