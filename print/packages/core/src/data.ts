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
