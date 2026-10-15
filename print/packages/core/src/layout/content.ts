/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { TextContent, ValueFormat } from '../schema/common'
import type { DiagnosticScope, LayoutContext } from './context'
import { fillTextTemplate, getFieldValue, toDisplayText } from '../data'
import { evaluateToText, formatValue } from '../format'
import { isPlainObject } from '../json'
import { reportFormatResult } from './context'

/** 把数据对象当作表达式变量；不是普通对象时没有变量。 */
export function scopeVariables(scope: unknown): Readonly<Record<string, unknown>> {
  return isPlainObject(scope) ? scope : {}
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
    text = reportFormatResult(context, scope, formatValue(value, format, context))
  }
  return text.length === 0 && emptyText !== undefined ? emptyText : text
}

/** 按 `{{path}}` 占位从数据对象取值生成文本。 */
export function templateText(template: string, data: unknown, context: LayoutContext, scope: DiagnosticScope): string {
  const { text, nonScalarFields } = fillTextTemplate(template, data)
  for (const field of nonScalarFields)
    context.report('data.notScalar', scope, { field })
  return text
}

/** 以数据对象为变量求表达式，再按格式转成文本。 */
export function expressionText(
  expression: string,
  format: ValueFormat | undefined,
  data: unknown,
  context: LayoutContext,
  scope: DiagnosticScope,
): string {
  const result = evaluateToText(context.evaluator, expression, scopeVariables(data))
  if (result.problem !== undefined)
    return reportFormatResult(context, scope, result)
  return format === undefined ? result.text : reportFormatResult(context, scope, formatValue(result.value, format, context))
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
