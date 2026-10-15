/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印专属的读取器：颜色、字段路径、文本模板与表达式，以及按字段规则读对象；通用读取器来自 @xihan-ui/designer-kit/schema。

import type { JsonPath } from '@xihan-ui/core/json'
import type { TemplateIssueCode } from '@xihan-ui/core/template'
import type { IssueSink, ValidationIssueCode } from './issues'
import { isJsonPathText } from '@xihan-ui/core/json'
import { parseTextTemplate } from '@xihan-ui/core/template'
import { checkPropertyValue } from '@xihan-ui/designer-kit/properties'
import { readObject, readString } from '@xihan-ui/designer-kit/schema'

/** 判断颜色是否为 `transparent` 或以 `#` 开头的 3、4、6、8 位十六进制色，判据即 designer-kit 的 color 编辑方式。 */
export function isValidColor(value: string): boolean {
  return checkPropertyValue({ kind: 'color' }, value) === undefined
}

/** 读取颜色：不是字符串报 invalid-type，不是合法颜色报 invalid-color。 */
export function readColor(sink: IssueSink, value: unknown, path: JsonPath): string | undefined {
  const text = readString(sink, value, path)
  if (text === undefined)
    return undefined
  if (isValidColor(text))
    return text
  sink.report('invalid-color', path)
  return undefined
}

/** 读取字段路径：空串报 field.empty，写法不合 @xihan-ui/core/json 的路径文法报 field.invalidPath。 */
export function readFieldPath(sink: IssueSink, value: unknown, path: JsonPath): string | undefined {
  const text = readString(sink, value, path)
  if (text === undefined)
    return undefined
  if (text.length === 0) {
    sink.report('field.empty', path)
    return undefined
  }
  if (isJsonPathText(text))
    return text
  sink.report('field.invalidPath', path, { params: { field: text } })
  return undefined
}

/** @xihan-ui/core/template 的问题码对应的打印问题码。 */
const TEMPLATE_ISSUE_CODES = {
  'unclosed-placeholder': 'template.unclosedPlaceholder',
  'empty-placeholder': 'template.emptyPlaceholder',
  'invalid-path': 'template.invalidPath',
} as const satisfies Record<TemplateIssueCode, ValidationIssueCode>

/** 读取 `{{path}}` 文本模板，写法同 @xihan-ui/core/template；有问题时逐条报出并返回 undefined。 */
export function readTextTemplate(sink: IssueSink, value: unknown, path: JsonPath): string | undefined {
  const text = readString(sink, value, path)
  if (text === undefined)
    return undefined
  const { issues } = parseTextTemplate(text)
  for (const issue of issues)
    sink.report(TEMPLATE_ISSUE_CODES[issue.code], path, { params: { start: issue.start, end: issue.end } })
  return issues.length === 0 ? text : undefined
}

/** 读取非空的表达式源码；接收器带有表达式引擎时编译源码并报告编译问题。 */
export function readExpression(sink: IssueSink, value: unknown, path: JsonPath): string | undefined {
  const source = readString(sink, value, path, { nonEmpty: true })
  if (source === undefined)
    return undefined
  const compiled = sink.expressionEngine?.compile(source)
  if (compiled === undefined || compiled.ok)
    return source
  for (const issue of compiled.issues)
    sink.report('expression.invalid', path, { params: { ...issue.data, code: issue.code, start: issue.start, end: issue.end } })
  return undefined
}

/** 对象中一个字段的读取规则。 */
export interface FieldRule {
  key: string
  required: boolean
  check: (value: unknown, path: JsonPath) => void
}

/** 生成字段规则。 */
export function field(key: string, required: boolean, check: (value: unknown, path: JsonPath) => void): FieldRule {
  return { key, required, check }
}

/**
 * 按字段规则读取对象：经 readObject 报出不是对象、缺少的必填字段与规则之外的字段，再逐个读取有值的字段；
 * extraKeys 是规则之外也允许出现的字段。返回对象本身，不是对象时为 undefined。
 */
export function readFields(
  sink: IssueSink,
  value: unknown,
  path: JsonPath,
  rules: readonly FieldRule[],
  extraKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> | undefined {
  const object = readObject(sink, value, path, {
    required: rules.filter(rule => rule.required).map(rule => rule.key),
    allowed: [...rules.map(rule => rule.key), ...extraKeys],
  })
  if (object === undefined)
    return undefined
  for (const rule of rules) {
    const item = object[rule.key]
    if (item !== undefined)
      rule.check(item, [...path, rule.key])
  }
  return object
}
