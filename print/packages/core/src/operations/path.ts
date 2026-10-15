/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { PathSegment } from '../json-path'
import type { PropertyChange } from './types'
import { cloneJson, findJsonViolation, isPlainObject, jsonEquals } from '@xihan-ui/core/json'
import { PrintOperationError } from './errors'

const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'prototype', 'constructor']

/** 应用一处修改的结果；没有变化时 `undo` 为 undefined 且 `root` 就是传入的对象。 */
export interface PathWriteResult<TRoot> {
  root: TRoot
  undo?: PropertyChange
}

function invalidPath(path: readonly PathSegment[]): PrintOperationError {
  return new PrintOperationError('path.invalid', { path: path.map(String) })
}

function checkSegments(path: readonly PathSegment[]): void {
  if (path.length === 0)
    throw invalidPath(path)
  for (const segment of path) {
    const valid = typeof segment === 'number'
      ? Number.isInteger(segment) && segment >= 0
      : segment.length > 0 && !FORBIDDEN_KEYS.includes(segment)
    if (!valid)
      throw invalidPath(path)
  }
}

function readChild(node: unknown, segment: PathSegment, path: readonly PathSegment[]): unknown {
  if (typeof segment === 'number') {
    if (!Array.isArray(node) || segment >= node.length)
      throw invalidPath(path)
    return node[segment]
  }
  if (!isPlainObject(node))
    throw invalidPath(path)
  return Object.hasOwn(node, segment) ? node[segment] : undefined
}

/** 读取路径上的值，路径中途不存在时返回 undefined。 */
export function readPath(root: unknown, path: readonly PathSegment[]): unknown {
  let node = root
  for (const segment of path) {
    if (typeof node !== 'object' || node === null)
      return undefined
    node = (node as Record<PathSegment, unknown>)[segment]
  }
  return node
}

function write(node: unknown, path: readonly PathSegment[], depth: number, value: unknown): unknown {
  const segment = path[depth] as PathSegment
  const last = depth === path.length - 1
  if (typeof segment === 'number') {
    const array = node as unknown[]
    const copy = array.slice()
    copy[segment] = last ? value : write(array[segment], path, depth + 1, value)
    return copy
  }
  const object = (node ?? {}) as Record<string, unknown>
  const copy: Record<string, unknown> = { ...object }
  if (last && value === undefined)
    delete copy[segment]
  else
    copy[segment] = last ? value : write(object[segment], path, depth + 1, value)
  return copy
}

/**
 * 以不修改原对象的方式在路径处写入值，`value` 为 undefined 时删除该属性。
 * 路径中缺失的对象会自动补出；数组只能按已有下标写入，不能删除数组项。
 * 返回新根与还原这次修改的逆修改。
 */
export function writePath<TRoot>(root: TRoot, path: readonly PathSegment[], value: unknown): PathWriteResult<TRoot> {
  checkSegments(path)
  if (value !== undefined && findJsonViolation(value) !== undefined)
    throw new PrintOperationError('value.invalid', { path: path.map(String) })

  let node: unknown = root
  let missingFrom: number | undefined
  for (let depth = 0; depth < path.length; depth++) {
    const segment = path[depth] as PathSegment
    const child = readChild(node, segment, path)
    const last = depth === path.length - 1
    if (last) {
      if (typeof segment === 'number' && value === undefined)
        throw invalidPath(path)
      node = child
      break
    }
    if (child === undefined) {
      if (path.slice(depth + 1).some(next => typeof next === 'number'))
        throw invalidPath(path)
      missingFrom = depth
      node = undefined
      break
    }
    if (typeof child !== 'object' || child === null)
      throw invalidPath(path)
    node = child
  }

  const previous = missingFrom === undefined ? node : undefined
  if (jsonEquals(previous as JsonValue | undefined, value as JsonValue | undefined) || (missingFrom !== undefined && value === undefined))
    return { root }

  const next = write(root, path, 0, value === undefined ? undefined : cloneJson(value as JsonValue)) as TRoot
  if (missingFrom !== undefined)
    return { root: next, undo: { path: path.slice(0, missingFrom + 1) } }
  if (previous === undefined)
    return { root: next, undo: { path: [...path] } }
  return { root: next, undo: { path: [...path], value: previous as PropertyChange['value'] } }
}

/** 依次应用一组修改，返回新根与按相反顺序排列的逆修改。 */
export function writeChanges<TRoot>(root: TRoot, changes: readonly PropertyChange[]): { root: TRoot, undo: PropertyChange[] } {
  let current = root
  const undo: PropertyChange[] = []
  for (const change of changes) {
    const result = writePath(current, change.path, change.value)
    current = result.root
    if (result.undo !== undefined)
      undo.unshift(result.undo)
  }
  return { root: current, undo }
}
