/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionCompilation, FormatSpec, MapFormat } from '../src'
import { describe, expect, it } from 'vitest'
import { fillTextTemplate, getFieldValue, toDisplayText } from '../src/data'
import { addDecimals, compareDecimals, decimalToNumber, decimalToString, toDecimal, zeroDecimal } from '../src/decimal'
import { evaluateToText, formatMapValue, formatValue, isEmptyValue } from '../src/format'

function decimal(value: unknown): NonNullable<ReturnType<typeof toDecimal>> {
  const result = toDecimal(value)
  if (result === undefined)
    throw new Error(`not a number: ${String(value)}`)
  return result
}

describe('十进制数', () => {
  it('识别数字与数字字符串，含科学计数法', () => {
    expect(decimalToString(decimal(12.5))).toBe('12.5')
    expect(decimalToString(decimal('-0.0300'))).toBe('-0.0300')
    expect(decimalToString(decimal(1e-7))).toBe('0.0000001')
    expect(decimalToString(decimal(1e21))).toBe('1000000000000000000000')
    expect(decimalToString(decimal(' +3. '))).toBe('3')
    expect(decimalToString(decimal('.5'))).toBe('0.5')
    expect(decimalToString(decimal(-0))).toBe('0')
  })

  it('不能识别的值返回 undefined', () => {
    for (const value of ['', 'abc', '1,000', '1.2.3', Number.NaN, Number.POSITIVE_INFINITY, null, true, {}])
      expect(toDecimal(value), String(value)).toBeUndefined()
  })

  it('精确相加与比较', () => {
    const sum = [0.1, 0.2, 0.3].map(decimal).reduce(addDecimals, zeroDecimal())
    expect(decimalToString(sum)).toBe('0.6')
    expect(decimalToNumber(addDecimals(decimal('19.99'), decimal('-20')))).toBe(-0.01)
    expect(compareDecimals(decimal('1.10'), decimal(1.1))).toBe(0)
    expect(compareDecimals(decimal(-2), decimal(1))).toBeLessThan(0)
    expect(compareDecimals(decimal('0.3'), decimal('0.25'))).toBeGreaterThan(0)
  })
})

describe('值格式', () => {
  const formatter = (value: unknown, spec: FormatSpec): string => `${spec.kind}(${String(value)})`

  it('数字、百分比、日期、人民币大写交给注入的格式化器', () => {
    const specs: FormatSpec[] = [
      { kind: 'number', decimals: 2, thousands: true },
      { kind: 'percent', decimals: 0 },
      { kind: 'date', pattern: 'YYYY-MM-DD' },
      { kind: 'chineseAmount' },
    ]
    expect(specs.map(spec => formatValue(12.5, spec, { formatter }))).toEqual([
      { text: 'number(12.5)' },
      { text: 'percent(12.5)' },
      { text: 'date(12.5)' },
      { text: 'chineseAmount(12.5)' },
    ])
  })

  it('没有格式化器时显示原值并给出原因', () => {
    expect(formatValue(12.5, { kind: 'number', decimals: 2, thousands: false })).toEqual({ text: '12.5', problem: 'formatterUnavailable' })
  })

  it('值映射在本包内完成，按显示文本匹配', () => {
    const format: MapFormat = { kind: 'map', entries: [{ value: '1', text: '男' }, { value: '2', text: '女' }], fallback: '未知' }
    expect(formatValue(1, format)).toEqual({ text: '男' })
    expect(formatValue('2', format)).toEqual({ text: '女' })
    expect(formatValue(3, format)).toEqual({ text: '未知' })
    expect(formatMapValue(true, { kind: 'map', entries: [{ value: 'true', text: '是' }] })).toBe('是')
    expect(formatMapValue(3, { kind: 'map', entries: [] })).toBe('3')
  })

  it('空值不经格式化', () => {
    for (const value of [null, undefined, ''])
      expect(formatValue(value, { kind: 'number', decimals: 2, thousands: false }, { formatter })).toEqual({ text: '' })
    expect(formatValue(null, { kind: 'map', entries: [], fallback: '无' })).toEqual({ text: '' })
    expect(isEmptyValue(0)).toBe(false)
  })

  it('表达式格式经表达式接入点编译求值', () => {
    const compile = (source: string): ExpressionCompilation => {
      if (source === 'bad')
        return { ok: false, issues: [{ code: 'E', start: 0, end: 3 }] }
      if (source === 'fail')
        return { ok: true, references: [], evaluate: () => ({ ok: false, issue: { code: 'F', start: 0, end: 4 } }) }
      return { ok: true, references: [], evaluate: scope => ({ ok: true, value: `${source}:${String(scope.value)}` }) }
    }
    expect(formatValue(5, { kind: 'expression', expression: 'x' }, { compile })).toEqual({ text: 'x:5', value: 'x:5' })
    expect(formatValue(null, { kind: 'expression', expression: 'x' }, { compile })).toEqual({ text: 'x:null', value: 'x:null' })
    expect(formatValue(5, { kind: 'expression', expression: 'bad' }, { compile })).toEqual({
      text: '',
      problem: 'expressionFailed',
      issue: { code: 'E', start: 0, end: 3 },
    })
    expect(formatValue(5, { kind: 'expression', expression: 'fail' }, { compile })).toEqual({
      text: '',
      problem: 'expressionFailed',
      issue: { code: 'F', start: 0, end: 4 },
    })
    expect(formatValue(5, { kind: 'expression', expression: 'x' })).toEqual({ text: '', problem: 'expressionUnavailable' })
    const objectResult = (): ExpressionCompilation => ({ ok: true, references: [], evaluate: () => ({ ok: true, value: { a: 1 } }) })
    expect(evaluateToText(objectResult, 'x', {})).toEqual({ text: '', problem: 'notScalar' })
  })
})

describe('取值', () => {
  const data = { customer: { name: '张三', tags: ['a', 'b'] }, items: [{ qty: 2 }], a: null }

  it('按路径读自有属性与数组下标', () => {
    expect(getFieldValue(data, 'customer.name')).toBe('张三')
    expect(getFieldValue(data, 'customer.tags.1')).toBe('b')
    expect(getFieldValue(data, 'items.0.qty')).toBe(2)
    expect(getFieldValue(data, 'items.x')).toBeUndefined()
    expect(getFieldValue(data, 'customer.missing.deep')).toBeUndefined()
    expect(getFieldValue(data, 'customer.toString')).toBeUndefined()
    expect(getFieldValue(data, 'a..b')).toBeUndefined()
    expect(getFieldValue('text', 'length')).toBeUndefined()
  })

  it('显示文本', () => {
    expect(toDisplayText(null)).toEqual({ text: '', scalar: true })
    expect(toDisplayText(1.5)).toEqual({ text: '1.5', scalar: true })
    expect(toDisplayText(Number.NaN)).toEqual({ text: '', scalar: true })
    expect(toDisplayText(false)).toEqual({ text: 'false', scalar: true })
    expect(toDisplayText(12n)).toEqual({ text: '12', scalar: true })
    expect(toDisplayText(new Date(Date.UTC(2026, 9, 16)))).toEqual({ text: '2026-10-16T00:00:00.000Z', scalar: true })
    expect(toDisplayText({ a: 1 })).toEqual({ text: '', scalar: false })
    expect(toDisplayText([1])).toEqual({ text: '', scalar: false })
  })

  it('填充文本模板并报告非标量字段', () => {
    expect(fillTextTemplate('客户：{{customer.name}}，标签 {{customer.tags}} {{x}}', data)).toEqual({
      text: '客户：张三，标签  ',
      nonScalarFields: ['customer.tags'],
    })
  })
})
