/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath } from '@xihan-ui/core/json'
import type { SchemaIssue } from '@xihan-ui/designer-kit/schema'
import type { EngineCompileResult, EngineEvaluation, ExpressionEngine, FormatOptions, FormatSpec, ValueFormatter } from '@xihan-ui/expression'
import type { TextMeasurer, TextSize } from '@xihan-ui/viz'
import type { PrintCoreExtension } from '../extensions'
import type { ElementRegistry } from '../registry/registry'
import type { PrintPage } from '../schema/document'
import type { PrintElement } from '../schema/elements'
import type { IssueParams } from '../validation/issues'
import type { PaginationDiagnosticCode, PaginationDiagnosticTarget } from './types'
import { evaluateSource } from '@xihan-ui/expression'
import { createPrintModel } from '../extensions'
import { PrintLayoutError } from './types'

/** 长度比较的容差，单位 mm。 */
export const LAYOUT_EPSILON = 1e-6

/** 诊断定位：path 从文档根算起，指到页面或元素；target 为同一个页面或元素。 */
export interface DiagnosticScope {
  readonly path: JsonPath
  readonly target: PaginationDiagnosticTarget
}

/** 页面的诊断定位，path 为 `['pages', 页面下标]`。 */
export function pageScope(pageIndex: number, page: PrintPage): DiagnosticScope {
  return { path: ['pages', pageIndex], target: { kind: 'page', id: page.id } }
}

/** 元素的诊断定位，path 为所属元素数组的路径接上元素下标。 */
export function elementScope(elementsPath: JsonPath, index: number, element: PrintElement): DiagnosticScope {
  return { path: [...elementsPath, index], target: { kind: 'element', id: element.id } }
}

/** 未定严重程度的分页诊断，分页结束时按诊断码查表补上。 */
export type PendingDiagnostic = SchemaIssue<PaginationDiagnosticCode> & { readonly target: PaginationDiagnosticTarget }

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
  /** 当前扩展合出的元素登记表：扩展元素按它的原型排版。 */
  elements: ElementRegistry
  /** 正文元素续排到后续输出页、或整块挪到下一页时调一次，分页调试日志用；没人听时没有它。 */
  trace?: (step: BodyStep) => void
}

/** 正文排版中的一步：元素续排（split）或整块挪页（move），页序号在这个页面模板里从 0 起。 */
export interface BodyStep {
  readonly kind: 'split' | 'move'
  readonly elementId: string
  readonly from: number
  readonly to: number
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

/** 创建分页上下文：诊断按诊断码、路径与参数去重，测量或格式化结果不合法时抛出 PrintLayoutError。 */
export function createLayoutContext(
  data: unknown,
  measurer: TextMeasurer,
  options: { expressionEngine?: ExpressionEngine, formatter?: ValueFormatter, formatOptions?: FormatOptions, extensions?: readonly PrintCoreExtension[] },
  diagnostics: PendingDiagnostic[],
): LayoutContext {
  const seen = new Set<string>()
  const context: LayoutContext = {
    data,
    report: (code, scope, params) => {
      const key = JSON.stringify([code, scope.path, params ?? null])
      if (seen.has(key))
        return
      seen.add(key)
      diagnostics.push({
        code,
        path: [...scope.path],
        target: scope.target,
        ...(params === undefined ? {} : { params }),
      })
    },
    measurer: checkedMeasurer(measurer),
    elements: createPrintModel(options.extensions).elements,
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
