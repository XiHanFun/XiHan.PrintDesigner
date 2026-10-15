/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import { getJsonAt, parseJsonPath } from '@xihan-ui/core/json'

/**
 * 按字段路径读取数据，路径写法同 @xihan-ui/core/json 的 formatJsonPath（如 `customer.name`、`items[0].qty`）：
 * 只读普通对象的自有属性与数组下标；路径不合法或中途缺失时返回 undefined。
 */
export function getFieldValue(data: unknown, path: string): unknown {
  let segments
  try {
    segments = parseJsonPath(path)
  }
  catch {
    return undefined
  }
  return getJsonAt(data as JsonValue | undefined, segments)
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
