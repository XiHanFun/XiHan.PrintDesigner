/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { AnyElementPrototype, PropertyDescriptor, TableElement, ValidationIssue } from '../src'
import { findJsonViolation, getJsonAt } from '@xihan-ui/core/json'
import { checkProperties, isPropertyVisible, nestProperties } from '@xihan-ui/designer-kit/properties'
import { BAR_CODE_FORMATS, MATRIX_CODE_FORMATS } from '@xihan-ui/headless'
import { describe, expect, it } from 'vitest'
import {
  createBuiltinElementPrototypes,
  createElementRegistry,
  createPage,
  ELEMENT_CATEGORIES,
  PAGE_PROPERTY_GROUPS,
  pageProperties,
  PRINT_ELEMENT_TYPES,
  PROPERTY_GROUPS,
  scaleTableColumns,
  tableBodyProperties,
  tableColumnProperties,
  tableFooterCellProperties,
  tableFooterRowProperties,
  tableHeaderProperties,
} from '../src'
import { validateControlValue } from '../src/validation/controls'
import { createIssueSink } from '../src/validation/issues'

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
    expect(findJsonViolation(prototype.defaults)).toBeUndefined()
    expect(prototype.defaults.width).toBeGreaterThanOrEqual(prototype.minSize.width)
    expect(prototype.defaults.height).toBeGreaterThanOrEqual(prototype.minSize.height)

    const descriptors: readonly PropertyDescriptor[] = prototype.properties
    const keys = descriptors.map(descriptor => descriptor.path.join('.'))
    expect(new Set(keys).size).toBe(keys.length)

    for (const descriptor of descriptors) {
      expect(PROPERTY_GROUPS).toContain(descriptor.group)
      const value = getJsonAt({ ...prototype.defaults, x: 0, y: 0 } as unknown as JsonValue, descriptor.path)
      if (descriptor.present)
        expect(value, descriptor.path.join('.')).not.toBeUndefined()
      if (descriptor.control.kind === 'select' && value !== undefined)
        expect(descriptor.control.options.map(option => option.value)).toContain(value)
      const condition = descriptor.visibleWhen
      if (condition !== undefined && 'path' in condition)
        expect(keys).toContain(condition.path.join('.'))
    }
    expect(checkProperties(descriptors, { ...prototype.defaults, x: 0, y: 0 } as unknown as JsonValue)).toEqual([])

    for (const key of Object.keys(prototype.defaults)) {
      if (key === 'type')
        continue
      expect(descriptors.some(descriptor => descriptor.path[0] === key), key).toBe(true)
    }
  })

  it('表格的表头、表体属性由部位描述加前缀得到', () => {
    const table = samplePrototypes().find(prototype => prototype.type === 'table')!
    const nested = table.properties.filter(descriptor => descriptor.path[0] === 'header' || descriptor.path[0] === 'body')
    expect(nested).toEqual([...nestProperties(['header'], tableHeaderProperties()), ...nestProperties(['body'], tableBodyProperties())])
    expect(nested.find(descriptor => descriptor.path.join('.') === 'header.repeat')!.visibleWhen).toEqual({ path: ['header', 'visible'], equals: true })
  })

  it('只有长文本与表格是跨页续排元素', () => {
    const flow = samplePrototypes().filter(prototype => prototype.flow).map(prototype => prototype.type)
    expect(flow.sort()).toEqual(['longText', 'table'])
  })

  it('码制选项直接取 @xihan-ui/headless 的码制常量', () => {
    const barcode = samplePrototypes().find(prototype => prototype.type === 'barCode')!
    const barCodeFormat = barcode.properties.find(descriptor => descriptor.path[0] === 'format')!
    expect(barCodeFormat.control).toEqual({ kind: 'select', options: BAR_CODE_FORMATS.map(value => ({ value })) })
    const qrcode = samplePrototypes().find(prototype => prototype.type === 'matrixCode')!
    const format = qrcode.properties.find(descriptor => descriptor.path[0] === 'format')!
    expect(format.control).toEqual({ kind: 'select', options: MATRIX_CODE_FORMATS.map(value => ({ value })) })
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
      'barCode',
      'matrixCode',
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

describe('页面与表格部位的属性描述', () => {
  function issuesFor(descriptors: readonly PropertyDescriptor[], target: unknown): string[] {
    const issues: ValidationIssue[] = []
    const sink = createIssueSink(issues)
    for (const descriptor of descriptors) {
      expect([...PROPERTY_GROUPS, ...PAGE_PROPERTY_GROUPS]).toContain(descriptor.group)
      const value = getJsonAt(target as JsonValue, descriptor.path)
      if (descriptor.present)
        expect(value, descriptor.path.join('.')).not.toBeUndefined()
      if (value !== undefined)
        validateControlValue(descriptor.control, value, descriptor.path, sink)
    }
    return issues.map(issue => `${issue.code}@${issue.path.join('.')}`)
  }

  it('页面设置描述覆盖新建页面的全部字段，变体高度只在变体存在时显示', () => {
    const page = createPage({ id: 'p' })
    page.header.first = { height: 12, elements: [] }
    page.watermark = { text: '样张', fontSize: 30, color: '#999999', opacity: 0.2, rotation: 30, gapX: 20, gapY: 20 }
    const descriptors = pageProperties()
    expect(issuesFor(descriptors, page)).toEqual([])
    const visible = descriptors.filter(descriptor => isPropertyVisible(descriptor, page as unknown as JsonValue)).map(descriptor => descriptor.path.join('.'))
    expect(visible).toContain('header.first.height')
    expect(visible).not.toContain('header.last.height')
    for (const key of Object.keys(page)) {
      if (key !== 'id' && key !== 'elements')
        expect(descriptors.some(descriptor => descriptor.path[0] === key), key).toBe(true)
    }
  })

  it('页面设置的复合编辑方式按结构校验取值', () => {
    const page = createPage({ id: 'p' }) as unknown as Record<string, unknown>
    page.paper = { preset: 'A4', width: 100, height: 297 }
    page.watermark = { text: '', fontSize: 0, color: '#999999', opacity: 0.2, rotation: 0, gapX: 1, gapY: 1 }
    expect(issuesFor(pageProperties(), page)).toEqual([
      'page.presetMismatch@paper',
      'watermark.emptyText@watermark.text',
      'out-of-range@watermark.fontSize',
    ])
  })

  it('表格部位描述与表格的列、表头、表体、表尾行、表尾格对得上', () => {
    const table = createElementRegistry().createElement('table', { id: 't', x: 0, y: 0 })
    const column = { ...table.columns[0]!, content: { kind: 'field', field: 'name' } }
    expect(issuesFor(tableColumnProperties(), column)).toEqual([])
    expect(issuesFor(tableColumnProperties(), { ...column, cellType: 'barCode', barCodeFormat: 'ean13' })).toEqual([])
    expect(issuesFor(tableHeaderProperties(), table.header)).toEqual([])
    expect(issuesFor(tableBodyProperties(), table.body)).toEqual([])
    const row = { id: 'sum', placement: 'lastPage', height: 7, style: table.body.style, cells: [] }
    expect(issuesFor(tableFooterRowProperties(), row)).toEqual([])
    const cell = { columnId: column.id, colSpan: 2, content: { kind: 'aggregate', fn: 'sum', scope: 'all' } }
    expect(issuesFor(tableFooterCellProperties(), cell)).toEqual(['table.aggregateFieldMissing@content'])
  })
})
