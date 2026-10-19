/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { EngineCompileResult, ExpressionEngine, FormatSpec } from '@xihan-ui/expression'
import type { MapFormat } from '../src'
import { evaluateSource } from '@xihan-ui/expression'
import { describe, expect, it } from 'vitest'
import { getFieldValue } from '../src/data'
import { evaluateExpression, formatValue, isEmptyValue, mapValue } from '../src/layout/content'

describe('值格式', () => {
  const formatter = (value: unknown, spec: FormatSpec): string => `${spec.kind}(${String(value)})`

  it('数字、百分比、日期、人民币大写交给注入的格式化器', () => {
    const specs: FormatSpec[] = [
      { kind: 'number', decimals: 2, grouping: true },
      { kind: 'percent', decimals: 0 },
      { kind: 'date', pattern: 'yyyy-MM-dd' },
      { kind: 'rmb-upper' },
    ]
    expect(specs.map(spec => formatValue(12.5, spec, { formatter }))).toEqual([
      { text: 'number(12.5)' },
      { text: 'percent(12.5)' },
      { text: 'date(12.5)' },
      { text: 'rmb-upper(12.5)' },
    ])
  })

  it('格式化器抛出 TypeError 时显示原值并带上问题码，其他异常照常抛出', () => {
    const invalid = (): string => {
      throw new TypeError('XH_EXPR_FORMAT_INVALID_VALUE')
    }
    expect(formatValue('x', { kind: 'number', decimals: 2 }, { formatter: invalid })).toEqual({
      text: 'x',
      problem: 'formatFailed',
      reason: 'XH_EXPR_FORMAT_INVALID_VALUE',
    })
    const broken = (): string => {
      throw new Error('boom')
    }
    expect(() => formatValue('x', { kind: 'number' }, { formatter: broken })).toThrow('boom')
  })

  it('没有格式化器时显示原值并给出原因', () => {
    expect(formatValue(12.5, { kind: 'number', decimals: 2 })).toEqual({ text: '12.5', problem: 'formatterUnavailable' })
  })

  it('值映射在本包内完成，按显示文本匹配', () => {
    const format: MapFormat = { kind: 'map', entries: [{ value: '1', label: '男' }, { value: '2', label: '女' }], fallback: '未知' }
    expect(formatValue(1, format)).toEqual({ text: '男' })
    expect(formatValue('2', format)).toEqual({ text: '女' })
    expect(formatValue(3, format)).toEqual({ text: '未知' })
    expect(mapValue(true, { kind: 'map', entries: [{ value: 'true', label: '是' }] })).toBe('是')
    expect(mapValue(3, { kind: 'map', entries: [] })).toBe('3')
    // 命中的一项没有 label 时显示为空，不退回原值或 fallback
    expect(mapValue('x', { kind: 'map', entries: [{ value: 'x' }], fallback: '未知' })).toBe('')
  })

  it('空值不经格式化', () => {
    for (const value of [null, undefined, ''])
      expect(formatValue(value, { kind: 'number', decimals: 2 }, { formatter })).toEqual({ text: '' })
    expect(formatValue(null, { kind: 'map', entries: [], fallback: '无' })).toEqual({ text: '' })
    expect(isEmptyValue(0)).toBe(false)
  })

  it('表达式格式经表达式引擎按源码求值', () => {
    const compile = (source: string): EngineCompileResult => {
      if (source === 'bad')
        return { ok: false, issues: [{ code: 'XH_EXPR_UNEXPECTED_TOKEN', start: 0, end: 3 }] }
      if (source === 'fail')
        return { ok: true, references: [], evaluate: () => ({ ok: false, issue: { code: 'XH_EXPR_DIVISION_BY_ZERO', start: 0, end: 4 } }) }
      return { ok: true, references: [], evaluate: scope => ({ ok: true, value: `${source}:${String(scope.value)}` }) }
    }
    const engine: ExpressionEngine = { compile }
    const evaluate = (source: string, scope: Readonly<Record<string, unknown>>) => evaluateSource(engine, source, scope)
    expect(formatValue(5, { kind: 'expression', expression: 'x' }, { evaluate })).toEqual({ text: 'x:5', value: 'x:5' })
    expect(formatValue(null, { kind: 'expression', expression: 'x' }, { evaluate })).toEqual({ text: 'x:null', value: 'x:null' })
    expect(formatValue(5, { kind: 'expression', expression: 'bad' }, { evaluate })).toEqual({
      text: '',
      problem: 'expressionFailed',
      issue: { code: 'XH_EXPR_UNEXPECTED_TOKEN', start: 0, end: 3 },
    })
    expect(formatValue(5, { kind: 'expression', expression: 'fail' }, { evaluate })).toEqual({
      text: '',
      problem: 'expressionFailed',
      issue: { code: 'XH_EXPR_DIVISION_BY_ZERO', start: 0, end: 4 },
    })
    expect(formatValue(5, { kind: 'expression', expression: 'x' })).toEqual({ text: '', problem: 'expressionUnavailable' })
    expect(evaluateExpression(() => ({ ok: true, value: { a: 1 } }), 'x', {})).toEqual({ text: '', problem: 'notScalar' })
  })
})

describe('取值', () => {
  const data = { customer: { name: '张三', tags: ['a', 'b'] }, items: [{ qty: 2 }], a: null }

  it('按路径读自有属性与数组下标', () => {
    expect(getFieldValue(data, 'customer.name')).toBe('张三')
    expect(getFieldValue(data, 'customer.tags[1]')).toBe('b')
    expect(getFieldValue(data, 'items[0].qty')).toBe(2)
    expect(getFieldValue(data, 'items.x')).toBeUndefined()
    expect(getFieldValue(data, 'items.0.qty')).toBeUndefined()
    expect(getFieldValue(data, 'customer.missing.deep')).toBeUndefined()
    expect(getFieldValue(data, 'customer.toString')).toBeUndefined()
    expect(getFieldValue(data, 'a..b')).toBeUndefined()
    expect(getFieldValue('text', 'length')).toBeUndefined()
  })
})
