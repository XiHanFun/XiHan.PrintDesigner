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

/** 深拷贝由普通对象、数组和原始值组成的数据；值为 undefined 的对象属性按 JSON 序列化语义省略。 */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(item => cloneJson(item as unknown)) as T
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined)
        result[key] = cloneJson(value[key])
    }
    return result as T
  }
  return value
}

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter(key => value[key] !== undefined)
}

/** 按 JSON 语义比较两个值是否相等：对象键顺序不影响结果，值为 undefined 的对象属性视同不存在。 */
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
    const keysA = definedKeys(a)
    const keysB = definedKeys(b)
    if (keysA.length !== keysB.length)
      return false
    return keysA.every(key => jsonEqual(a[key], b[key]))
  }
  return false
}

/** 不能按 JSON 无损表达的值的种类。 */
export type JsonProblemKind
  = | 'undefined'
    | 'nonFiniteNumber'
    | 'function'
    | 'symbol'
    | 'bigint'
    | 'nonPlainObject'
    | 'arrayHole'
    | 'circular'

/** 不能按 JSON 无损表达的值及其路径。 */
export interface JsonProblem {
  path: PathSegment[]
  kind: JsonProblemKind
}

/**
 * 列出不能按 JSON 无损表达的值：非有限数字、函数、symbol、bigint、非普通对象、数组空位、
 * 数组中的 undefined 与循环引用。值为 undefined 的对象属性按 JSON 序列化语义视同不存在，不列入。
 */
export function listJsonProblems(value: unknown): JsonProblem[] {
  const problems: JsonProblem[] = []
  collectJsonProblems(value, [], new Set(), problems)
  return problems
}

function collectJsonProblems(value: unknown, path: PathSegment[], ancestors: Set<object>, problems: JsonProblem[]): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      problems.push({ path, kind: 'nonFiniteNumber' })
    return
  }
  if (typeof value !== 'object') {
    problems.push({ path, kind: typeof value as 'undefined' | 'function' | 'symbol' | 'bigint' })
    return
  }
  if (ancestors.has(value)) {
    problems.push({ path, kind: 'circular' })
    return
  }
  if (Array.isArray(value)) {
    ancestors.add(value)
    for (let index = 0; index < value.length; index++) {
      if (index in value)
        collectJsonProblems(value[index], [...path, index], ancestors, problems)
      else
        problems.push({ path: [...path, index], kind: 'arrayHole' })
    }
    ancestors.delete(value)
    return
  }
  if (!isPlainObject(value)) {
    problems.push({ path, kind: 'nonPlainObject' })
    return
  }
  ancestors.add(value)
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined)
      collectJsonProblems(value[key], [...path, key], ancestors, problems)
  }
  ancestors.delete(value)
}

/** 判断值是否可按 JSON 无损表达，规则同 `listJsonProblems`。 */
export function isJsonValue(value: unknown): value is JsonValue {
  return listJsonProblems(value).length === 0
}
