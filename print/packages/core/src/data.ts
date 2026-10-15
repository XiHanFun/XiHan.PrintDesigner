/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { splitFieldPath } from './field-path'
import { parseTextTemplate } from './text-template'

const INDEX_PATTERN = /^\d+$/

/** 按字段路径读取数据：只读自有属性，数组按数字段取下标；路径不合法或中途缺失时返回 undefined。 */
export function getFieldValue(data: unknown, path: string): unknown {
  const segments = splitFieldPath(path)
  if (segments === undefined)
    return undefined
  let current = data
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!INDEX_PATTERN.test(segment))
        return undefined
      current = current[Number(segment)]
      continue
    }
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment))
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** 数据值转显示文本的结果；`scalar` 为 false 表示值是对象或数组，文本为空。 */
export interface DisplayText {
  text: string
  scalar: boolean
}

/** 把数据值转成显示文本：null 与 undefined 为空，字符串原样，有限数字、布尔与 bigint 转字符串，日期转 ISO 字符串。 */
export function toDisplayText(value: unknown): DisplayText {
  if (value === null || value === undefined)
    return { text: '', scalar: true }
  switch (typeof value) {
    case 'string':
      return { text: value, scalar: true }
    case 'number':
      return { text: Number.isFinite(value) ? String(value) : '', scalar: true }
    case 'boolean':
    case 'bigint':
      return { text: String(value), scalar: true }
  }
  if (value instanceof Date)
    return { text: Number.isNaN(value.getTime()) ? '' : value.toISOString(), scalar: true }
  return { text: '', scalar: false }
}

/** 按数据替换文本模板中的 `{{path}}` 占位；不合法的占位按原样保留。 */
export function fillTextTemplate(template: string, data: unknown): { text: string, nonScalarFields: string[] } {
  const nonScalarFields: string[] = []
  const text = parseTextTemplate(template).segments.map((segment) => {
    if (segment.kind === 'text')
      return segment.text
    const display = toDisplayText(getFieldValue(data, segment.field))
    if (!display.scalar)
      nonScalarFields.push(segment.field)
    return display.text
  }).join('')
  return { text, nonScalarFields }
}
