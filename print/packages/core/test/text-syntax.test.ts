/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import {
  formatPageNumber,
  isValidFieldPath,
  parsePageNumberFormat,
  parseTextTemplate,
  splitFieldPath,
} from '../src'

describe('字段路径', () => {
  it('按点拆分并允许数字段与中文段', () => {
    expect(splitFieldPath('customer.name')).toEqual(['customer', 'name'])
    expect(splitFieldPath('items.0.数量')).toEqual(['items', '0', '数量'])
    expect(splitFieldPath('$root')).toEqual(['$root'])
  })

  it('拒绝空串、空段、空白与括号', () => {
    for (const path of ['', '.a', 'a.', 'a..b', 'a b', 'a[0]', 'a{b}', ' a'])
      expect(isValidFieldPath(path), path).toBe(false)
  })

  it('拒绝可能污染原型的段', () => {
    for (const path of ['__proto__', 'a.__proto__.b', 'constructor.prototype', 'a.prototype'])
      expect(isValidFieldPath(path), path).toBe(false)
  })
})

describe('文本模板', () => {
  it('解析占位并忽略两侧空白', () => {
    expect(parseTextTemplate('客户：{{ customer.name }}，单号{{no}}')).toEqual({
      segments: [
        { kind: 'text', text: '客户：' },
        { kind: 'field', field: 'customer.name' },
        { kind: 'text', text: '，单号' },
        { kind: 'field', field: 'no' },
      ],
      errors: [],
    })
  })

  it('无占位时只有一段文本，空模板没有片段', () => {
    expect(parseTextTemplate('合计').segments).toEqual([{ kind: 'text', text: '合计' }])
    expect(parseTextTemplate('')).toEqual({ segments: [], errors: [] })
  })

  it('孤立的右花括号按文本保留', () => {
    expect(parseTextTemplate('a}}b').segments).toEqual([{ kind: 'text', text: 'a}}b' }])
  })

  it('报告未闭合占位并把余下部分当作文本', () => {
    const result = parseTextTemplate('前{{a}}后{{b')
    expect(result.errors).toEqual([{ code: 'unclosedPlaceholder', offset: 7 }])
    expect(result.segments).toEqual([
      { kind: 'text', text: '前' },
      { kind: 'field', field: 'a' },
      { kind: 'text', text: '后{{b' },
    ])
  })

  it('报告空占位与非法路径并按原样保留', () => {
    const result = parseTextTemplate('{{ }}x{{a b}}')
    expect(result.errors).toEqual([
      { code: 'emptyPlaceholder', offset: 0 },
      { code: 'invalidPath', offset: 6, field: 'a b' },
    ])
    expect(result.segments).toEqual([{ kind: 'text', text: '{{ }}x{{a b}}' }])
  })
})

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
