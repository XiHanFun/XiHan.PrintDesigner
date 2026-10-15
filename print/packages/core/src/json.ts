/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** JSON 原始值。 */
export type JsonPrimitive = string | number | boolean | null

/** 任意 JSON 值。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** JSON 对象。 */
export interface JsonObject {
  [key: string]: JsonValue
}

/** JSON 路径中的一段：对象键或数组下标。 */
export type PathSegment = string | number

/** 从文档根开始的 JSON 路径。 */
export type JsonPath = readonly PathSegment[]

/** 判断值是否为原型为 `Object.prototype` 或 `null` 的普通对象。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** 深拷贝由普通对象、数组和原始值组成的数据。 */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(item => cloneJson(item as unknown)) as T
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value))
      result[key] = cloneJson(value[key])
    return result as T
  }
  return value
}

/** 按 JSON 语义比较两个值是否相等；对象键顺序不影响结果。 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length)
      return false
    return a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b))
      return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length)
      return false
    return keysA.every(key => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  }
  return false
}

/** 判断值是否可无损地按 JSON 序列化：只含普通对象、稠密数组、字符串、有限数字、布尔与 null，且无循环引用。 */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInner(value, new Set())
}

function isJsonValueInner(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (typeof value !== 'object')
    return false
  if (ancestors.has(value))
    return false
  if (Array.isArray(value)) {
    ancestors.add(value)
    for (let index = 0; index < value.length; index++) {
      if (!(index in value) || !isJsonValueInner(value[index], ancestors))
        return false
    }
    ancestors.delete(value)
    return true
  }
  if (!isPlainObject(value))
    return false
  ancestors.add(value)
  for (const key of Object.keys(value)) {
    if (!isJsonValueInner(value[key], ancestors))
      return false
  }
  ancestors.delete(value)
  return true
}
