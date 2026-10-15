/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionCompilation, ExpressionIssue } from './expression'
import type { ChineseAmountFormat, DateFormat, MapFormat, NumberFormat, PercentFormat, ValueFormat } from './schema/common'
import { toDisplayText } from './data'

/** 交给注入的值格式化器处理的格式说明。 */
export type FormatSpec = NumberFormat | PercentFormat | DateFormat | ChineseAmountFormat

/** 值格式化器：按格式说明把值转成显示文本，由宿主或上层包实现。 */
export type ValueFormatter = (value: unknown, spec: FormatSpec) => string

/** 格式化未完成的原因：未提供格式化器、未提供表达式接入点、表达式编译或求值失败、结果不是标量。 */
export type FormatProblem
  = | 'formatterUnavailable'
    | 'expressionUnavailable'
    | 'expressionFailed'
    | 'notScalar'

/** 格式化结果；未完成时 `text` 为原值的显示文本或空串，并给出原因。 */
export interface FormatResult {
  text: string
  problem?: FormatProblem
  /** 表达式编译或求值失败时的第一处问题。 */
  issue?: ExpressionIssue
}

/** 格式化选项。 */
export interface FormatOptions {
  /** 数字、百分比、日期、人民币大写格式的格式化器。 */
  formatter?: ValueFormatter
  /** 编译表达式源码，未提供时表达式不可用。 */
  compile?: (source: string) => ExpressionCompilation
}

/** 判断值是否为空：null、undefined 或空字符串。 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/** 值映射：按显示文本查表，未命中时用 `fallback`，没有 `fallback` 时显示原值。 */
export function formatMapValue(value: unknown, format: MapFormat): string {
  const display = toDisplayText(value).text
  const entry = format.entries.find(item => item.value === display)
  return entry?.text ?? format.fallback ?? display
}

/** 编译并以给定变量求表达式，结果转成文本。 */
export function evaluateToText(
  compile: ((source: string) => ExpressionCompilation) | undefined,
  source: string,
  scope: Readonly<Record<string, unknown>>,
): FormatResult & { value?: unknown } {
  if (compile === undefined)
    return { text: '', problem: 'expressionUnavailable' }
  const compiled = compile(source)
  if (!compiled.ok) {
    const [issue] = compiled.issues
    return issue === undefined ? { text: '', problem: 'expressionFailed' } : { text: '', problem: 'expressionFailed', issue }
  }
  const result = compiled.evaluate(scope)
  if (!result.ok)
    return { text: '', problem: 'expressionFailed', issue: result.issue }
  const display = toDisplayText(result.value)
  return display.scalar ? { text: display.text, value: result.value } : { text: '', problem: 'notScalar' }
}

/**
 * 按值格式把数据值转成显示文本：值映射在本包内完成，表达式格式经表达式接入点，其余格式交给注入的格式化器；
 * 空值不经格式化直接为空串，表达式格式除外。
 */
export function formatValue(value: unknown, format: ValueFormat, options: FormatOptions = {}): FormatResult {
  if (format.kind === 'expression')
    return evaluateToText(options.compile, format.expression, { value })
  if (isEmptyValue(value))
    return { text: '' }
  if (format.kind === 'map')
    return { text: formatMapValue(value, format) }
  if (options.formatter === undefined)
    return { text: toDisplayText(value).text, problem: 'formatterUnavailable' }
  return { text: options.formatter(value, format) }
}
