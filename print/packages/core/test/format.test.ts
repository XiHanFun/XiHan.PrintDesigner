/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { ExpressionEvaluator, MapFormat } from '../src'
import { describe, expect, it } from 'vitest'
import { fillTextTemplate, getFieldValue, toDisplayText } from '../src/data'
import {
  addDecimals,
  compareDecimals,
  decimalToNumber,
  decimalToString,
  roundDecimal,
  shiftDecimal,
  toDecimal,
  zeroDecimal,
} from '../src/decimal'
import { evaluateToText, formatChineseAmount, formatValue, isEmptyValue } from '../src/format'

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

  it('按绝对值四舍五入', () => {
    expect(decimalToString(roundDecimal(decimal(1.005), 2))).toBe('1.01')
    expect(decimalToString(roundDecimal(decimal(-1.005), 2))).toBe('-1.01')
    expect(decimalToString(roundDecimal(decimal(1.004), 2))).toBe('1.00')
    expect(decimalToString(roundDecimal(decimal(2.5), 0))).toBe('3')
    expect(decimalToString(roundDecimal(decimal(-0.004), 2))).toBe('0.00')
    expect(decimalToString(roundDecimal(decimal(7), 2))).toBe('7.00')
  })

  it('小数点移位', () => {
    expect(decimalToString(shiftDecimal(decimal(0.07), 2))).toBe('7')
    expect(decimalToString(shiftDecimal(decimal(12), 3))).toBe('12000')
    expect(decimalToString(shiftDecimal(decimal(12), -3))).toBe('0.012')
  })
})

describe('人民币大写', () => {
  it.each([
    [0, '零元整'],
    [1, '壹元整'],
    [10, '壹拾元整'],
    [1001, '壹仟零壹元整'],
    [1010, '壹仟零壹拾元整'],
    [10001, '壹万零壹元整'],
    [100000, '壹拾万元整'],
    [100010000, '壹亿零壹万元整'],
    [100000001, '壹亿零壹元整'],
    [1000000000000, '壹万亿元整'],
    [1000100000000, '壹万零壹亿元整'],
    [1.5, '壹元伍角'],
    [1.05, '壹元零伍分'],
    [0.05, '伍分'],
    [0.5, '伍角'],
    [12345.67, '壹万贰仟叁佰肆拾伍元陆角柒分'],
    [-8.2, '负捌元贰角'],
    [0.004, '零元整'],
    [0.995, '壹元整'],
  ])('%s → %s', (value, expected) => {
    expect(formatChineseAmount(decimal(value))).toBe(expected)
  })

  it('整数部分超过 16 位时返回 undefined', () => {
    expect(formatChineseAmount(decimal('9999999999999999.99'))).toBe('玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分')
    expect(formatChineseAmount(decimal('10000000000000000'))).toBeUndefined()
  })
})

describe('值格式', () => {
  it('数字：小数位、千分位与前后缀', () => {
    expect(formatValue(1234567.005, { kind: 'number', decimals: 2, thousands: true, prefix: '¥' })).toEqual({ text: '¥1,234,567.01' })
    expect(formatValue('-1234', { kind: 'number', decimals: 0, thousands: true, suffix: ' 件' })).toEqual({ text: '-1,234 件' })
    expect(formatValue(999, { kind: 'number', decimals: 1, thousands: true })).toEqual({ text: '999.0' })
    expect(formatValue('n/a', { kind: 'number', decimals: 2, thousands: false })).toEqual({ text: 'n/a', problem: 'notNumber' })
  })

  it('百分比按十进制移位，不受浮点误差影响', () => {
    expect(formatValue(0.07, { kind: 'percent', decimals: 0 })).toEqual({ text: '7%' })
    expect(formatValue(0.12345, { kind: 'percent', decimals: 2 })).toEqual({ text: '12.35%' })
  })

  it('日期：不带时区的字符串按字面取值', () => {
    const format = { kind: 'date', pattern: 'YYYY年MM月DD日 HH:mm:ss' } as const
    expect(formatValue('2026-10-16', format)).toEqual({ text: '2026年10月16日 00:00:00' })
    expect(formatValue('2026-10-16T08:05', format)).toEqual({ text: '2026年10月16日 08:05:00' })
    expect(formatValue('2026-10-16 23:59:58.123', format)).toEqual({ text: '2026年10月16日 23:59:58' })
  })

  it('日期：带时区的字符串、时间戳与 Date 按时区换算', () => {
    const format = { kind: 'date', pattern: 'YYYY-MM-DD HH:mm' } as const
    expect(formatValue('2026-10-16T16:30:00Z', format, { timeZone: 'Asia/Shanghai' })).toEqual({ text: '2026-10-17 00:30' })
    expect(formatValue(Date.UTC(2026, 0, 1, 0, 0), format, { timeZone: 'UTC' })).toEqual({ text: '2026-01-01 00:00' })
    expect(formatValue(new Date(Date.UTC(2026, 0, 1, 12)), format, { timeZone: 'America/New_York' })).toEqual({ text: '2026-01-01 07:00' })
    expect(formatValue('not a date', format)).toEqual({ text: 'not a date', problem: 'invalidDate' })
    expect(formatValue(true, format)).toEqual({ text: 'true', problem: 'invalidDate' })
  })

  it('人民币大写与超出范围', () => {
    expect(formatValue('100.5', { kind: 'chineseAmount' })).toEqual({ text: '壹佰元伍角' })
    expect(formatValue('1e20', { kind: 'chineseAmount' })).toEqual({ text: '1e20', problem: 'outOfRange' })
    expect(formatValue('x', { kind: 'chineseAmount' })).toEqual({ text: 'x', problem: 'notNumber' })
  })

  it('值映射按显示文本匹配', () => {
    const format: MapFormat = { kind: 'map', entries: [{ value: '1', text: '已付' }, { value: 'true', text: '是' }], fallback: '未知' }
    expect(formatValue(1, format)).toEqual({ text: '已付' })
    expect(formatValue(true, format)).toEqual({ text: '是' })
    expect(formatValue(2, format)).toEqual({ text: '未知' })
    expect(formatValue(2, { kind: 'map', entries: [] })).toEqual({ text: '2' })
  })

  it('空值不经格式化', () => {
    for (const value of [null, undefined, ''])
      expect(formatValue(value, { kind: 'number', decimals: 2, thousands: false })).toEqual({ text: '' })
    expect(isEmptyValue(0)).toBe(false)
  })

  it('表达式格式经求值接入点', () => {
    const evaluator: ExpressionEvaluator = {
      evaluate: (source, scope) => source === 'bad'
        ? { ok: false, diagnostics: [{ code: 'E', start: 0, end: 3 }] }
        : { ok: true, value: `${source}:${String(scope.value)}` },
    }
    expect(formatValue(5, { kind: 'expression', expression: 'x' }, { evaluator })).toEqual({ text: 'x:5', value: 'x:5' })
    expect(formatValue(5, { kind: 'expression', expression: 'bad' }, { evaluator })).toEqual({
      text: '',
      problem: 'expressionFailed',
      diagnostics: [{ code: 'E', start: 0, end: 3 }],
    })
    expect(formatValue(5, { kind: 'expression', expression: 'x' })).toEqual({ text: '', problem: 'expressionUnavailable' })
    const objectResult: ExpressionEvaluator = { evaluate: () => ({ ok: true, value: { a: 1 } }) }
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
