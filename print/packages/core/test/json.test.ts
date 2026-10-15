/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import { cloneJson, isJsonValue, isPlainObject, jsonEqual, listJsonProblems } from '../src'

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

  it('省略值为 undefined 的对象属性', () => {
    const copy = cloneJson({ a: 1, b: undefined, c: { d: undefined } })
    expect(Object.keys(copy)).toEqual(['a', 'c'])
    expect(Object.keys(copy.c)).toEqual([])
  })
})

describe('jsonEqual', () => {
  it('忽略键顺序比较', () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  })

  it('区分数组长度、键集合与值', () => {
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(jsonEqual({ a: '1' }, { a: 1 })).toBe(false)
    expect(jsonEqual([], {})).toBe(false)
  })

  it('值为 undefined 的对象属性视同不存在', () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(true)
    expect(jsonEqual({ a: undefined }, { a: null })).toBe(false)
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
    // eslint-disable-next-line no-sparse-arrays
    expect(isJsonValue([1, , 3])).toBe(false)
  })

  it('值为 undefined 的对象属性按序列化语义接受，数组中的 undefined 拒绝', () => {
    expect(isJsonValue({ a: undefined })).toBe(true)
    expect(isJsonValue([undefined])).toBe(false)
  })

  it('拒绝循环引用但接受共享引用', () => {
    const shared = { x: 1 }
    expect(isJsonValue({ a: shared, b: shared })).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(isJsonValue(cyclic)).toBe(false)
  })
})

describe('listJsonProblems', () => {
  it('列出每处问题的路径与种类', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3]
    const problems = listJsonProblems({
      a: Number.NaN,
      b: [undefined, () => 1],
      c: { d: new Date(0), e: Symbol('x'), f: 1n },
      g: sparse,
      h: cyclic,
      skipped: undefined,
    })
    expect(problems).toEqual([
      { path: ['a'], kind: 'nonFiniteNumber' },
      { path: ['b', 0], kind: 'undefined' },
      { path: ['b', 1], kind: 'function' },
      { path: ['c', 'd'], kind: 'nonPlainObject' },
      { path: ['c', 'e'], kind: 'symbol' },
      { path: ['c', 'f'], kind: 'bigint' },
      { path: ['g', 1], kind: 'arrayHole' },
      { path: ['h', 'self'], kind: 'circular' },
    ])
  })

  it('纯 JSON 数据没有问题', () => {
    expect(listJsonProblems({ a: [1, 'x', null, { b: true }] })).toEqual([])
  })
})
