/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

const SEGMENT_PATTERN = /^[^\s.{}[\]]+$/u

const FORBIDDEN_SEGMENTS: readonly string[] = ['__proto__', 'prototype', 'constructor']

/**
 * 拆分以 `.` 分隔的字段路径。
 * 每段非空，不含空白、花括号和方括号，且不是 `__proto__`、`prototype`、`constructor`；不合法时返回 undefined。
 */
export function splitFieldPath(path: string): string[] | undefined {
  if (path.length === 0)
    return undefined
  const segments = path.split('.')
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment) || FORBIDDEN_SEGMENTS.includes(segment))
      return undefined
  }
  return segments
}

/** 判断字段路径是否合法。 */
export function isValidFieldPath(path: string): boolean {
  return splitFieldPath(path) !== undefined
}
