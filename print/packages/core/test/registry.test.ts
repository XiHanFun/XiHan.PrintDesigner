/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { AnyElementPrototype, PropertyDescriptor, TableElement } from '../src'
import { describe, expect, it } from 'vitest'
import {
  BARCODE_SYMBOLOGIES,
  createBuiltinElementPrototypes,
  createElementRegistry,
  ELEMENT_CATEGORIES,
  isJsonValue,
  PRINT_ELEMENT_TYPES,
  PROPERTY_GROUPS,
  scaleTableColumns,
} from '../src'

function valueAt(source: unknown, path: readonly string[]): unknown {
  let current = source
  for (const segment of path) {
    if (typeof current !== 'object' || current === null)
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function samplePrototypes(): AnyElementPrototype[] {
  return createBuiltinElementPrototypes()
}

describe('内置元素原型', () => {
  it('恰好覆盖全部内置元素类型', () => {
    const types = samplePrototypes().map(prototype => prototype.type)
    expect([...types].sort()).toEqual([...PRINT_ELEMENT_TYPES].sort())
  })

  it('每次调用返回互不共享的新对象', () => {
    const [a] = createBuiltinElementPrototypes()
    const [b] = createBuiltinElementPrototypes()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a!.defaults).not.toBe(b!.defaults)
  })

  it.each(samplePrototypes().map(prototype => [prototype.type, prototype] as const))('%s 原型自洽', (_type, prototype) => {
    expect(prototype.defaults.type).toBe(prototype.type)
    expect(ELEMENT_CATEGORIES).toContain(prototype.category)
    expect(isJsonValue(prototype.defaults)).toBe(true)
    expect(prototype.defaults.width).toBeGreaterThanOrEqual(prototype.minSize.width)
    expect(prototype.defaults.height).toBeGreaterThanOrEqual(prototype.minSize.height)

    const descriptors: readonly PropertyDescriptor[] = prototype.properties
    const keys = descriptors.map(descriptor => descriptor.path.join('.'))
    expect(new Set(keys).size).toBe(keys.length)

    for (const descriptor of descriptors) {
      expect(PROPERTY_GROUPS).toContain(descriptor.group)
      const value = valueAt({ ...prototype.defaults, x: 0, y: 0 }, descriptor.path)
      if (descriptor.required)
        expect(value, descriptor.path.join('.')).not.toBeUndefined()
      if (descriptor.control.kind === 'select' && value !== undefined)
        expect(descriptor.control.options).toContain(value)
      if (descriptor.when !== undefined)
        expect(keys).toContain(descriptor.when.path.join('.'))
    }

    for (const key of Object.keys(prototype.defaults)) {
      if (key === 'type')
        continue
      expect(descriptors.some(descriptor => descriptor.path[0] === key), key).toBe(true)
    }
  })

  it('只有长文本与表格是跨页续排元素', () => {
    const flow = samplePrototypes().filter(prototype => prototype.flow).map(prototype => prototype.type)
    expect(flow.sort()).toEqual(['longText', 'table'])
  })

  it('条码码制选项与码制常量一致', () => {
    const barcode = samplePrototypes().find(prototype => prototype.type === 'barcode')!
    const symbology = barcode.properties.find(descriptor => descriptor.path[0] === 'symbology')!
    expect(symbology.control).toEqual({ kind: 'select', options: BARCODE_SYMBOLOGIES })
  })
})

describe('元素类型登记表', () => {
  it('按物料分组顺序再按组内顺序排列', () => {
    const registry = createElementRegistry()
    expect(registry.prototypes.map(prototype => prototype.type)).toEqual([
      'text',
      'longText',
      'pageNumber',
      'image',
      'table',
      'line',
      'rect',
      'ellipse',
      'barcode',
      'qrcode',
    ])
    expect(registry.groupByCategory().map(group => [group.category, group.prototypes.length])).toEqual([
      ['text', 3],
      ['media', 1],
      ['data', 1],
      ['shape', 3],
      ['code', 2],
    ])
  })

  it('可只登记部分原型，空分组不列出', () => {
    const registry = createElementRegistry(samplePrototypes().filter(prototype => prototype.category === 'shape'))
    expect(registry.has('rect')).toBe(true)
    expect(registry.has('text')).toBe(false)
    expect(registry.get('text')).toBeUndefined()
    expect(registry.groupByCategory().map(group => group.category)).toEqual(['shape'])
  })

  it('类型重复时抛出错误', () => {
    const prototypes = samplePrototypes()
    expect(() => createElementRegistry([...prototypes, prototypes[0]!])).toThrow(/Duplicate element prototype: text/)
  })

  it('不同登记表互不共享原型', () => {
    const a = createElementRegistry()
    const b = createElementRegistry()
    expect(a.get('text')).not.toBe(b.get('text'))
  })

  it('createElement 以默认值生成元素且每次是独立副本', () => {
    const registry = createElementRegistry()
    const first = registry.createElement('table', { id: 't1', x: 15, y: 30 })
    const second = registry.createElement('table', { id: 't2', x: 0, y: 0 })
    expect(Object.keys(first).slice(0, 4)).toEqual(['id', 'type', 'x', 'y'])
    expect(first).toMatchObject({ id: 't1', type: 'table', x: 15, y: 30, width: 180 })
    first.columns[0]!.title = '品名'
    expect(second.columns[0]!.title).toBe('')
    expect(registry.get('table')!.defaults.columns[0]!.title).toBe('')
  })

  it('createElement 接受顶层覆盖值，标识、类型与坐标以参数为准', () => {
    const registry = createElementRegistry()
    const element = registry.createElement('text', {
      id: 'name',
      x: 1,
      y: 2,
      overrides: { content: { kind: 'field', field: 'customer.name' }, width: 80 },
    })
    expect(element.content).toEqual({ kind: 'field', field: 'customer.name' })
    expect(element.width).toBe(80)

    const forged = registry.createElement('rect', {
      id: 'r',
      x: 3,
      y: 4,
      overrides: { id: 'other', type: 'text', x: 9 } as never,
    })
    expect(forged).toMatchObject({ id: 'r', type: 'rect', x: 3, y: 4 })
  })

  it('createElement 对未登记类型抛出错误', () => {
    const registry = createElementRegistry([])
    expect(() => registry.createElement('text', { id: 'a', x: 0, y: 0 })).toThrow(/Unknown element type: text/)
  })
})

describe('表格缩放', () => {
  const columns = createElementRegistry().createElement('table', { id: 't', x: 0, y: 0 }).columns

  it('scaleTableColumns 等比缩放且合计严格等于新宽度', () => {
    const uneven = [{ ...columns[0]!, width: 10 }, { ...columns[1]!, width: 20 }, { ...columns[2]!, width: 70 }]
    const scaled = scaleTableColumns(uneven, 150)
    expect(scaled.map(column => column.width)).toEqual([15, 30, 105])
    const odd = scaleTableColumns(columns, 100)
    expect(odd.reduce((sum, column) => sum + column.width, 0)).toBe(100)
  })

  it('原列宽合计不为正时均分，空列表返回空', () => {
    const zero = columns.map(column => ({ ...column, width: 0 }))
    expect(scaleTableColumns(zero, 90).map(column => column.width)).toEqual([30, 30, 30])
    expect(scaleTableColumns([], 90)).toEqual([])
  })

  it('原型的 resize 只在宽度变化时缩放列', () => {
    const registry = createElementRegistry()
    const table = registry.createElement('table', { id: 't', x: 0, y: 0 })
    const prototype = registry.get('table')!
    const wider: TableElement = prototype.resize!(table, { x: 5, y: 5, width: 120, height: 40 })
    expect(wider.columns.map(column => column.width)).toEqual([40, 40, 40])
    expect(wider).toMatchObject({ x: 5, y: 5, width: 120, height: 40 })
    const taller = prototype.resize!(table, { x: 0, y: 0, width: 180, height: 60 })
    expect(taller.columns).toBe(table.columns)
  })
})
