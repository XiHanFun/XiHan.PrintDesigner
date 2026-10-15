/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { EngineCompileResult, EngineEvaluation, ExpressionEngine, FormatOptions, FormatSpec } from '@xihan-ui/expression'
import type { TextMeasurer, TextSize } from '@xihan-ui/viz'
import type { IssueParams } from '../validation/issues'
import type { PaginationDiagnostic, PaginationDiagnosticCode, ValueFormatter } from './types'
import { evaluateSource } from '@xihan-ui/expression'
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
  /** 按源码在给定变量上求值，同一源码一轮分页只编译一次；未提供表达式引擎时为 undefined。 */
  evaluate?: (source: string, scope: Readonly<Record<string, unknown>>) => EngineEvaluation
  /** 已绑定区域与时区的值格式化器，返回值不是字符串时抛出 PrintLayoutError。 */
  formatter?: (value: unknown, spec: FormatSpec) => string
  report: (code: PaginationDiagnosticCode, scope: DiagnosticScope, params?: IssueParams) => void
  /** 注入的文字度量器，量出的宽度不是非负有限数时抛出 PrintLayoutError。 */
  measurer: TextMeasurer
}

function isValidSize(result: unknown): result is TextSize {
  if (typeof result !== 'object' || result === null)
    return false
  const { width } = result as Record<string, unknown>
  return typeof width === 'number' && Number.isFinite(width) && width >= 0
}

/** 包一层检查：量出的宽度不是非负有限数时抛出 PrintLayoutError。 */
function checkedMeasurer(measurer: TextMeasurer): TextMeasurer {
  return {
    get version() {
      return measurer.version
    },
    measure: (text, font) => {
      const result = measurer.measure(text, font)
      if (!isValidSize(result))
        throw new PrintLayoutError('measurer.invalidResult', { text })
      return result
    },
  }
}

/** 创建分页上下文：诊断按诊断码、定位与参数去重，测量或格式化结果不合法时抛出 PrintLayoutError。 */
export function createLayoutContext(
  data: unknown,
  measurer: TextMeasurer,
  options: { expressionEngine?: ExpressionEngine, formatter?: ValueFormatter, formatOptions?: FormatOptions },
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
    measurer: checkedMeasurer(measurer),
  }
  const engine = options.expressionEngine
  if (engine !== undefined) {
    const cache = new Map<string, EngineCompileResult>()
    context.evaluate = (source, scope) => evaluateSource(engine, source, scope, cache)
  }
  const format = options.formatter
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
