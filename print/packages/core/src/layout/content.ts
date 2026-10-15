/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { EngineEvaluation, ExpressionIssue, FormatSpec } from '@xihan-ui/expression'
import type { MapFormat, TextContent, ValueFormat } from '../schema/common'
import type { DiagnosticScope, LayoutContext } from './context'
import type { PaginationDiagnosticCode } from './types'
import { isPlainObject } from '@xihan-ui/core/json'
import { fillTextTemplate } from '@xihan-ui/core/template'
import { getFieldValue, toDisplayText } from '../data'

/** 取值或格式化未完成的原因：未提供格式化器、格式化器报错、未提供表达式接入点、表达式编译或求值失败、结果不是标量。 */
export type ValueProblem
  = | 'formatterUnavailable'
    | 'formatFailed'
    | 'expressionUnavailable'
    | 'expressionFailed'
    | 'notScalar'

/** 取值或格式化的结果；未完成时 `text` 为原值的显示文本或空串，并给出原因。 */
export interface ValueResult {
  text: string
  /** 表达式求出的原值。 */
  value?: unknown
  problem?: ValueProblem
  /** 表达式编译或求值失败时的第一处问题。 */
  issue?: ExpressionIssue
  /** 格式化器报错时的问题码。 */
  reason?: string
}

/** 取值与格式化依赖的注入接口。 */
export interface ValueOptions {
  formatter?: (value: unknown, spec: FormatSpec) => string
  /** 按源码求值，未提供时表达式不可用。 */
  evaluate?: (source: string, scope: Readonly<Record<string, unknown>>) => EngineEvaluation
}

const PROBLEM_CODES = {
  formatterUnavailable: 'format.unavailable',
  formatFailed: 'format.failed',
  expressionUnavailable: 'expression.unavailable',
  expressionFailed: 'expression.failed',
  notScalar: 'data.notScalar',
} as const satisfies Record<ValueProblem, PaginationDiagnosticCode>

/** 把未完成的原因报告为诊断，返回结果文本。 */
export function reportValueResult(context: LayoutContext, scope: DiagnosticScope, result: ValueResult): string {
  if (result.problem !== undefined) {
    const reason = result.issue?.code ?? result.reason
    context.report(PROBLEM_CODES[result.problem], scope, reason === undefined ? undefined : { reason })
  }
  return result.text
}

/** 判断值是否为空：null、undefined 或空字符串。 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/** 值映射：按显示文本查表，未命中时用 `fallback`，没有 `fallback` 时显示原值。 */
export function mapValue(value: unknown, format: MapFormat): string {
  const display = toDisplayText(value).text
  const entry = format.entries.find(item => item.value === display)
  return entry?.text ?? format.fallback ?? display
}

/** 把数据对象当作表达式变量；不是普通对象时没有变量。 */
export function scopeVariables(scope: unknown): Readonly<Record<string, unknown>> {
  return isPlainObject(scope) ? scope : {}
}

/** 以给定变量求表达式，结果转成文本；编译不通过与求值失败都记为 expressionFailed，带上第一处问题。 */
export function evaluateExpression(
  evaluate: ValueOptions['evaluate'],
  source: string,
  variables: Readonly<Record<string, unknown>>,
): ValueResult {
  if (evaluate === undefined)
    return { text: '', problem: 'expressionUnavailable' }
  const result = evaluate(source, variables)
  if (!result.ok)
    return { text: '', problem: 'expressionFailed', issue: result.issue }
  const display = toDisplayText(result.value)
  return display.scalar ? { text: display.text, value: result.value } : { text: '', problem: 'notScalar' }
}

/**
 * 按值格式把数据值转成显示文本：值映射在本包内完成，表达式格式经表达式接入点，其余格式交给注入的格式化器；
 * 空值不经格式化直接为空串，表达式格式除外。
 */
export function formatValue(value: unknown, format: ValueFormat, options: ValueOptions = {}): ValueResult {
  if (format.kind === 'expression')
    return evaluateExpression(options.evaluate, format.expression, { value })
  if (isEmptyValue(value))
    return { text: '' }
  if (format.kind === 'map')
    return { text: mapValue(value, format) }
  if (options.formatter === undefined)
    return { text: toDisplayText(value).text, problem: 'formatterUnavailable' }
  try {
    return { text: options.formatter(value, format) }
  }
  catch (error) {
    if (!(error instanceof TypeError))
      throw error
    return { text: toDisplayText(value).text, problem: 'formatFailed', reason: error.message }
  }
}

/** 把一个值转成显示文本：有格式时按格式，否则直接转文本；结果为空时用 `emptyText`。 */
export function valueText(
  value: unknown,
  format: ValueFormat | undefined,
  emptyText: string | undefined,
  context: LayoutContext,
  scope: DiagnosticScope,
): string {
  let text: string
  if (format === undefined) {
    const display = toDisplayText(value)
    if (!display.scalar)
      context.report('data.notScalar', scope)
    text = display.text
  }
  else {
    text = reportValueResult(context, scope, formatValue(value, format, context))
  }
  return text.length === 0 && emptyText !== undefined ? emptyText : text
}

/** 按 `{{path}}` 占位从数据对象取值生成文本。 */
export function templateText(template: string, data: unknown, context: LayoutContext, scope: DiagnosticScope): string {
  const { text, nonScalar } = fillTextTemplate(template, data)
  for (const field of nonScalar)
    context.report('data.notScalar', scope, { field })
  return text
}

/** 以给定变量求表达式，再按格式转成文本。 */
export function evaluatedText(
  source: string,
  variables: Readonly<Record<string, unknown>>,
  format: ValueFormat | undefined,
  context: LayoutContext,
  scope: DiagnosticScope,
): string {
  const result = evaluateExpression(context.evaluate, source, variables)
  if (result.problem !== undefined)
    return reportValueResult(context, scope, result)
  return format === undefined ? result.text : reportValueResult(context, scope, formatValue(result.value, format, context))
}

/** 以数据对象的顶层字段为变量求表达式，再按格式转成文本。 */
export function expressionText(
  expression: string,
  format: ValueFormat | undefined,
  data: unknown,
  context: LayoutContext,
  scope: DiagnosticScope,
): string {
  return evaluatedText(expression, scopeVariables(data), format, context, scope)
}

/** 按文本内容来源从数据对象生成文本。 */
export function contentText(content: TextContent, data: unknown, context: LayoutContext, scope: DiagnosticScope): string {
  switch (content.kind) {
    case 'static':
      return content.text
    case 'field':
      return valueText(getFieldValue(data, content.field), content.format, content.emptyText, context, scope)
    case 'template':
      return templateText(content.template, data, context, scope)
    case 'expression':
      return expressionText(content.expression, content.format, data, context, scope)
  }
}
