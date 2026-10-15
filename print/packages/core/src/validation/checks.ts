/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PathSegment } from '../json'
import type { IssueSink } from './issues'
import { isValidFieldPath } from '../field-path'
import { isPlainObject } from '../json'
import { parseTextTemplate } from '../text-template'

type Path = readonly PathSegment[]

/** 数值约束。 */
export interface NumberConstraints {
  min?: number
  exclusiveMin?: number
  max?: number
  integer?: boolean
}

const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** 判断颜色是否为 `#RGB`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。 */
export function isValidColor(value: string): boolean {
  return value === 'transparent' || COLOR_PATTERN.test(value)
}

/** 要求值为普通对象。 */
export function expectObject(value: unknown, path: Path, sink: IssueSink): value is Record<string, unknown> {
  if (isPlainObject(value))
    return true
  sink.report('schema.invalidType', path, { expected: 'object' })
  return false
}

/** 要求值为数组。 */
export function expectArray(value: unknown, path: Path, sink: IssueSink): value is unknown[] {
  if (Array.isArray(value))
    return true
  sink.report('schema.invalidType', path, { expected: 'array' })
  return false
}

/** 要求值为字符串，`nonEmpty` 时还要求非空。 */
export function expectString(value: unknown, path: Path, sink: IssueSink, options: { nonEmpty?: boolean } = {}): value is string {
  if (typeof value !== 'string') {
    sink.report('schema.invalidType', path, { expected: 'string' })
    return false
  }
  if (options.nonEmpty === true && value.length === 0) {
    sink.report('value.empty', path)
    return false
  }
  return true
}

/** 要求值为布尔。 */
export function expectBoolean(value: unknown, path: Path, sink: IssueSink): value is boolean {
  if (typeof value === 'boolean')
    return true
  sink.report('schema.invalidType', path, { expected: 'boolean' })
  return false
}

/** 要求值为满足约束的有限数字；非有限数字已由 JSON 检查报告，这里只返回 false。 */
export function expectNumber(value: unknown, path: Path, sink: IssueSink, constraints: NumberConstraints = {}): value is number {
  if (typeof value !== 'number') {
    sink.report('schema.invalidType', path, { expected: 'number' })
    return false
  }
  if (!Number.isFinite(value))
    return false
  if (constraints.integer === true && !Number.isInteger(value)) {
    sink.report('value.notInteger', path, { value })
    return false
  }
  const belowMin = constraints.min !== undefined && value < constraints.min
  const belowExclusive = constraints.exclusiveMin !== undefined && value <= constraints.exclusiveMin
  const aboveMax = constraints.max !== undefined && value > constraints.max
  if (belowMin || belowExclusive || aboveMax) {
    const params: Record<string, number> = { value }
    if (constraints.min !== undefined)
      params.min = constraints.min
    if (constraints.exclusiveMin !== undefined)
      params.exclusiveMin = constraints.exclusiveMin
    if (constraints.max !== undefined)
      params.max = constraints.max
    sink.report('value.outOfRange', path, params)
    return false
  }
  return true
}

/** 要求值为给定选项之一。 */
export function expectOption<TOption extends string>(
  value: unknown,
  options: readonly TOption[],
  path: Path,
  sink: IssueSink,
): value is TOption {
  if (typeof value !== 'string') {
    sink.report('schema.invalidType', path, { expected: 'string' })
    return false
  }
  if ((options as readonly string[]).includes(value))
    return true
  sink.report('value.invalidOption', path, { value, options })
  return false
}

/** 要求值为合法颜色。 */
export function expectColor(value: unknown, path: Path, sink: IssueSink): value is string {
  if (!expectString(value, path, sink))
    return false
  if (isValidColor(value))
    return true
  sink.report('value.invalidColor', path, { value })
  return false
}

/** 要求值为字段路径；空串报告未绑定，非法路径报告错误。 */
export function expectFieldPath(value: unknown, path: Path, sink: IssueSink): value is string {
  if (!expectString(value, path, sink))
    return false
  if (value.length === 0) {
    sink.report('field.empty', path)
    return false
  }
  if (isValidFieldPath(value))
    return true
  sink.report('field.invalidPath', path, { field: value })
  return false
}

/** 要求值为合法的 `{{path}}` 文本模板。 */
export function expectTextTemplate(value: unknown, path: Path, sink: IssueSink): value is string {
  if (!expectString(value, path, sink))
    return false
  const { errors } = parseTextTemplate(value)
  for (const error of errors) {
    const params: Record<string, string | number> = { offset: error.offset }
    if (error.field !== undefined)
      params.field = error.field
    sink.report(`template.${error.code}`, path, params)
  }
  return errors.length === 0
}

/** 要求值为非空的表达式源码；接收器带有表达式检查接入点时报告其中的问题。 */
export function expectExpression(value: unknown, path: Path, sink: IssueSink): value is string {
  if (!expectString(value, path, sink, { nonEmpty: true }))
    return false
  const diagnostics = sink.expressions?.check(value) ?? []
  for (const diagnostic of diagnostics) {
    sink.report('expression.invalid', path, {
      ...diagnostic.data,
      code: diagnostic.code,
      start: diagnostic.start,
      end: diagnostic.end,
    })
  }
  return diagnostics.length === 0
}

/** 对象中一个字段的校验规则。 */
export interface FieldRule {
  key: string
  required: boolean
  check: (value: unknown, path: Path) => void
}

/** 按字段规则校验对象：缺少必填字段报告缺失，规则之外的字段报告未知属性。 */
export function checkFields(
  object: Record<string, unknown>,
  rules: readonly FieldRule[],
  path: Path,
  sink: IssueSink,
  extraKeys: readonly string[] = [],
): void {
  for (const rule of rules) {
    const value = object[rule.key]
    if (value === undefined) {
      if (rule.required)
        sink.report('schema.missingProperty', [...path, rule.key], { property: rule.key })
      continue
    }
    rule.check(value, [...path, rule.key])
  }
  reportUnknownKeys(object, [...rules.map(rule => rule.key), ...extraKeys], path, sink)
}

/** 报告对象中不在 `known` 之列且值不为 undefined 的字段。 */
export function reportUnknownKeys(object: Record<string, unknown>, known: readonly string[], path: Path, sink: IssueSink): void {
  for (const key of Object.keys(object)) {
    if (object[key] !== undefined && !known.includes(key))
      sink.report('schema.unknownProperty', [...path, key], { property: key })
  }
}

/** 生成字段规则。 */
export function field(key: string, required: boolean, check: (value: unknown, path: Path) => void): FieldRule {
  return { key, required, check }
}
