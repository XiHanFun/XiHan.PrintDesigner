/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { PathOperation } from '@xihan-ui/designer-kit'
import type { PropertyChange } from './types'
import { cloneJson } from '@xihan-ui/core/json'
import { applyPathOperations, PathOperationError } from '@xihan-ui/designer-kit'
import { PrintOperationError } from './errors'

/** 一处属性修改换成 designer-kit 的 set 操作：中间缺少的对象键补出，写入的值先深拷贝。 */
function toOperation(change: PropertyChange): PathOperation {
  if (change.path.length === 0)
    throw new PrintOperationError('path.invalid', { path: [] })
  return change.value === undefined
    ? { type: 'set', path: change.path, createMissing: true }
    : { type: 'set', path: change.path, value: cloneJson(change.value), createMissing: true }
}

/** set 的逆操作换回属性修改：remove 即删除该属性。 */
function toChange(operation: PathOperation): PropertyChange {
  if (operation.type === 'set')
    return operation.value === undefined ? { path: operation.path } : { path: operation.path, value: operation.value }
  return { path: operation.path }
}

/**
 * 依次应用一组属性修改，不修改原对象，返回新根与按相反顺序排列的逆修改。
 * 中间缺少的对象自动补出，逆修改删除补出的最上层对象；数组只能按已有下标替换，不能删除数组项。
 * 路径不合法或不存在时抛 PrintOperationError('path.invalid')，值不是 JSON 或想删除数组项时抛 'value.invalid'。
 */
export function writeChanges<TRoot>(root: TRoot, changes: readonly PropertyChange[]): { root: TRoot, undo: PropertyChange[] } {
  const operations = changes.map(toOperation)
  try {
    const { document, inverse } = applyPathOperations(root as JsonValue, operations)
    return { root: document as TRoot, undo: inverse.map(toChange) }
  }
  catch (error) {
    if (error instanceof PathOperationError) {
      const code = error.code === 'invalid-value' ? 'value.invalid' : 'path.invalid'
      throw new PrintOperationError(code, { path: error.operation.path.map(String) })
    }
    throw error
  }
}
