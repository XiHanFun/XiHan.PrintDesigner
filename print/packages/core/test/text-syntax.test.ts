/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import { formatPageNumber, parsePageNumberFormat } from '../src'

describe('页码格式', () => {
  it('解析已知记号并保留未知记号为文本', () => {
    expect(parsePageNumberFormat('第{current}页 共{total}页 {copy}')).toEqual({
      segments: [
        { kind: 'text', text: '第' },
        { kind: 'token', token: 'current' },
        { kind: 'text', text: '页 共' },
        { kind: 'token', token: 'total' },
        { kind: 'text', text: '页 {copy}' },
      ],
      unknownTokens: ['copy'],
    })
  })

  it('不成记号的花括号原样保留', () => {
    expect(parsePageNumberFormat('{ } {1}').segments).toEqual([{ kind: 'text', text: '{ } {1}' }])
  })

  it('按格式生成页码文本', () => {
    expect(formatPageNumber('{current}/{total}', { current: 2, total: 5 })).toBe('2/5')
    expect(formatPageNumber('Page {current}', { current: 7, total: 9 })).toBe('Page 7')
  })
})
