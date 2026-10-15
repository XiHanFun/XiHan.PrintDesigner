/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import { cloneJson, isJsonValue, isPlainObject, jsonEqual } from '../src'

describe('isPlainObject', () => {
  it('只认普通对象与无原型对象', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(new Map())).toBe(false)
  })
})

describe('cloneJson', () => {
  it('深拷贝且与原值无共享引用', () => {
    const source = { a: [1, { b: 'x' }], c: { d: null } }
    const copy = cloneJson(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.a).not.toBe(source.a)
    expect(copy.a[1]).not.toBe(source.a[1])
    expect(copy.c).not.toBe(source.c)
  })
})

describe('jsonEqual', () => {
  it('忽略键顺序比较', () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  })

  it('区分数组长度、键集合与值', () => {
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
    expect(jsonEqual({ a: '1' }, { a: 1 })).toBe(false)
    expect(jsonEqual([], {})).toBe(false)
  })
})

describe('isJsonValue', () => {
  it('接受纯 JSON 数据', () => {
    expect(isJsonValue({ a: [1, 'x', true, null, { b: -0.5 }] })).toBe(true)
  })

  it('拒绝不能无损序列化的值', () => {
    expect(isJsonValue(undefined)).toBe(false)
    expect(isJsonValue(Number.NaN)).toBe(false)
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isJsonValue(() => 1)).toBe(false)
    expect(isJsonValue(10n)).toBe(false)
    expect(isJsonValue({ a: new Date() })).toBe(false)
    expect(isJsonValue({ a: undefined })).toBe(false)
    // eslint-disable-next-line no-sparse-arrays
    expect(isJsonValue([1, , 3])).toBe(false)
  })

  it('拒绝循环引用但接受共享引用', () => {
    const shared = { x: 1 }
    expect(isJsonValue({ a: shared, b: shared })).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(isJsonValue(cyclic)).toBe(false)
  })
})
