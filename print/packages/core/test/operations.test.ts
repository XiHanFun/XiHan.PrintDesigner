/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type {
  OperationResult,
  PrintDocument,
  PrintOperation,
  PrintOperationErrorCode,
  RectElement,
  TableElement,
  TextElement,
} from '../src'
import { deepFreeze } from '@xihan-ui/core/json'
import { describe, expect, it } from 'vitest'
import {
  applyOperation,
  applyOperations,
  createElementRegistry,
  createPage,
  findElement,
  PrintOperationError,
  validateDocument,
} from '../src'
import { writeChanges } from '../src/operations/path'
import { createSampleDocument } from './fixtures'

const registry = createElementRegistry()

function sample(): PrintDocument {
  return deepFreeze(createSampleDocument())
}

/** 执行一个或一组操作并核对：逆操作还原原文档，逆操作的逆操作重做出同一结果，逆操作经 JSON 往返后仍然有效。 */
function apply(document: PrintDocument, operation: PrintOperation | PrintOperation[]): OperationResult {
  const result = Array.isArray(operation) ? applyOperations(document, operation) : applyOperation(document, operation)
  deepFreeze(result.document)
  expect(result.inverse.length).toBeGreaterThan(0)
  const undone = applyOperations(result.document, result.inverse)
  expect(undone.document).toEqual(document)
  const redone = applyOperations(undone.document, undone.inverse)
  expect(redone.document).toEqual(result.document)
  const serialized = JSON.parse(JSON.stringify(result.inverse)) as PrintOperation[]
  expect(applyOperations(result.document, serialized).document).toEqual(document)
  return result
}

function expectError(action: () => unknown, code: PrintOperationErrorCode): PrintOperationError {
  try {
    action()
  }
  catch (error) {
    expect(error).toBeInstanceOf(PrintOperationError)
    expect((error as PrintOperationError).code).toBe(code)
    return error as PrintOperationError
  }
  throw new Error(`expected ${code}`)
}

function elementOf<TElement>(document: PrintDocument, id: string): TElement {
  const location = findElement(document, id)
  if (location === undefined)
    throw new Error(`missing ${id}`)
  return location.element as TElement
}

function bodyIds(document: PrintDocument, pageIndex = 0): string[] {
  return document.pages[pageIndex]!.elements.map(element => element.id)
}

describe('属性修改', () => {
  it('写入时沿途复制，原对象不变，逆修改写回原值', () => {
    const root = deepFreeze({ a: { b: 1 }, keep: { x: 1 } })
    const { root: next, undo } = writeChanges(root, [{ path: ['a', 'b'], value: 2 }])
    expect(next).toEqual({ a: { b: 2 }, keep: { x: 1 } })
    expect(next.keep).toBe(root.keep)
    expect(undo).toEqual([{ path: ['a', 'b'], value: 1 }])
  })

  it('补出缺失的中间对象，逆修改删除最上层补出的对象', () => {
    const { root, undo } = writeChanges({ a: 1 } as Record<string, unknown>, [{ path: ['box', 'border', 'top'], value: { width: 1 } }])
    expect(root).toEqual({ a: 1, box: { border: { top: { width: 1 } } } })
    expect(undo).toEqual([{ path: ['box'] }])
  })

  it('删除属性，逆修改写回原值；删除不存在的属性没有变化', () => {
    const root = { a: 1, b: { c: 2 } }
    expect(writeChanges(root, [{ path: ['b', 'c'] }])).toEqual({ root: { a: 1, b: {} }, undo: [{ path: ['b', 'c'], value: 2 }] })
    const missing = writeChanges(root, [{ path: ['x', 'y'] }])
    expect(missing.root).toBe(root)
    expect(missing.undo).toEqual([])
  })

  it('写入相同的值没有变化', () => {
    const root = { a: { b: [1, 2] } }
    const result = writeChanges(root, [{ path: ['a'], value: { b: [1, 2] } }])
    expect(result.root).toBe(root)
    expect(result.undo).toEqual([])
  })

  it('写入的值是深拷贝', () => {
    const value = { inner: { n: 1 } }
    const { root } = writeChanges({} as Record<string, unknown>, [{ path: ['v'], value }])
    value.inner.n = 2
    expect(root).toEqual({ v: { inner: { n: 1 } } })
  })

  it('一组修改的逆修改按相反顺序排列', () => {
    const { undo } = writeChanges({ a: 1, b: 2 }, [{ path: ['a'], value: 10 }, { path: ['b'], value: 20 }])
    expect(undo).toEqual([{ path: ['b'], value: 2 }, { path: ['a'], value: 1 }])
  })

  it.each([
    [[]],
    [['__proto__', 'x']],
    [['constructor']],
    [['list', 5]],
    [['list', -1]],
    [['list', 0.5]],
    [['list', 'x']],
    [['obj', 0]],
    [['num', 'x']],
    [['missing', 0]],
  ] as const)('拒绝不合法或不存在的路径 %j', (path) => {
    const root = { list: [1, 2], obj: { a: 1 }, num: 1 }
    expectError(() => writeChanges(root, [{ path, value: 1 }]), 'path.invalid')
  })

  it('不能删除数组项，不能写入非 JSON 值', () => {
    expectError(() => writeChanges({ list: [1] }, [{ path: ['list', 0] }]), 'value.invalid')
    expectError(() => writeChanges({}, [{ path: ['a'], value: Number.NaN }]), 'value.invalid')
    expectError(() => writeChanges({}, [{ path: ['a'], value: { fn: () => 1 } as never }]), 'value.invalid')
  })
})

describe('增删元素', () => {
  it('默认添加到正文最上层，逆操作删除', () => {
    const doc = sample()
    const element = registry.createElement('rect', { id: 'new-rect', x: 20, y: 150 })
    const result = apply(doc, { type: 'addElement', container: { pageId: 'page-1', region: 'body' }, element })
    expect(bodyIds(result.document).at(-1)).toBe('new-rect')
    expect(result.inverse).toEqual([{ type: 'removeElement', id: 'new-rect' }])
    expect(result.document.pages[1]).toBe(doc.pages[1])
  })

  it('按下标插入到页眉带区，元素经深拷贝', () => {
    const doc = sample()
    const element = registry.createElement('text', { id: 'sub-title', x: 10, y: 22 })
    const result = apply(doc, {
      type: 'addElement',
      container: { pageId: 'page-1', region: 'header', band: 'default' },
      element,
      index: 0,
    })
    expect(result.document.pages[0]!.header.default.elements.map(item => item.id)).toEqual(['sub-title', 'title'])
    element.width = 999
    expect(elementOf<TextElement>(result.document, 'sub-title').width).toBe(60)
  })

  it('目标不存在、标识冲突、下标越界与非 JSON 元素', () => {
    const doc = sample()
    const element = registry.createElement('rect', { id: 'x', x: 0, y: 0 })
    expectError(() => applyOperation(doc, { type: 'addElement', container: { pageId: 'nope', region: 'body' }, element }), 'page.notFound')
    const missingBand = { pageId: 'page-1', region: 'footer', band: 'odd' } as const
    const bandError = expectError(() => applyOperation(doc, { type: 'addElement', container: missingBand, element }), 'band.notFound')
    expect(bandError.params).toEqual({ pageId: 'page-1', region: 'footer', variant: 'odd' })
    const body = { pageId: 'page-1', region: 'body' } as const
    expectError(() => applyOperation(doc, { type: 'addElement', container: body, element: { ...element, id: 'title' } }), 'id.duplicate')
    expectError(() => applyOperation(doc, { type: 'addElement', container: body, element: { ...element, id: 'label' } }), 'id.duplicate')
    expectError(() => applyOperation(doc, { type: 'addElement', container: body, element: { ...element, id: '' } }), 'value.invalid')
    expectError(() => applyOperation(doc, { type: 'addElement', container: body, element, index: 99 }), 'index.outOfRange')
    const sidebar = { pageId: 'page-1', region: 'sidebar' } as unknown as typeof body
    expectError(() => applyOperation(doc, { type: 'addElement', container: sidebar, element }), 'value.invalid')
    expectError(() => applyOperation(doc, { type: 'addElement', container: body, element: { ...element, width: Number.NaN } }), 'value.invalid')
  })

  it('删除元素，逆操作放回原容器原位置', () => {
    const doc = sample()
    const result = apply(doc, { type: 'removeElement', id: 'signature' })
    expect(findElement(result.document, 'signature')).toBeUndefined()
    expect(result.inverse).toMatchObject([{
      type: 'addElement',
      container: { pageId: 'page-1', region: 'footer', band: 'last' },
      index: 0,
    }])
    expectError(() => applyOperation(doc, { type: 'removeElement', id: 'missing' }), 'element.notFound')
  })
})

describe('修改元素属性', () => {
  it('修改嵌套属性与数组项', () => {
    const doc = sample()
    const result = apply(doc, {
      type: 'updateElement',
      id: 'items',
      changes: [
        { path: ['header', 'style', 'fontSize'], value: 12 },
        { path: ['columns', 1, 'title'], value: '品名' },
        { path: ['maxRowsPerPage'] },
      ],
    })
    const table = elementOf<TableElement>(result.document, 'items')
    expect(table.header.style.fontSize).toBe(12)
    expect(table.columns[1]!.title).toBe('品名')
    expect(table.maxRowsPerPage).toBeUndefined()
    expect(table.body).toBe(elementOf<TableElement>(doc, 'items').body)
  })

  it('补出缺失的可选对象，撤销后不留空对象', () => {
    const doc = sample()
    const result = apply(doc, { type: 'updateElement', id: 'customer', changes: [{ path: ['box', 'background'], value: '#eeeeee' }] })
    expect(elementOf<TextElement>(result.document, 'customer').box).toEqual({ background: '#eeeeee' })
    const undone = applyOperations(result.document, result.inverse).document
    expect(Object.keys(elementOf<TextElement>(undone, 'customer'))).not.toContain('box')
  })

  it('同一操作内先整体替换再改子属性也能精确撤销', () => {
    const doc = sample()
    apply(doc, {
      type: 'updateElement',
      id: 'customer',
      changes: [
        { path: ['style'], value: { ...elementOf<TextElement>(doc, 'customer').style, bold: true } },
        { path: ['style', 'fontSize'], value: 14 },
        { path: ['style', 'fontSize'], value: 16 },
      ],
    })
  })

  it('值没有变化时返回原文档', () => {
    const doc = sample()
    const result = applyOperation(doc, { type: 'updateElement', id: 'customer', changes: [{ path: ['x'], value: 12 }] })
    expect(result.document).toBe(doc)
    expect(result.inverse).toEqual([])
  })

  it('不能修改标识与类型', () => {
    const doc = sample()
    expectError(() => applyOperation(doc, { type: 'updateElement', id: 'customer', changes: [{ path: ['id'], value: 'x' }] }), 'path.protected')
    expectError(() => applyOperation(doc, { type: 'updateElement', id: 'customer', changes: [{ path: ['type'], value: 'rect' }] }), 'path.protected')
    expectError(() => applyOperation(doc, { type: 'updateElement', id: 'nope', changes: [] }), 'element.notFound')
  })
})

describe('移动与缩放', () => {
  it('平移跨容器的一组元素，逆操作写回精确坐标', () => {
    const doc = sample()
    const result = apply(doc, { type: 'moveElements', ids: ['customer', 'title', 'label-name'], dx: 0.1, dy: 0.2 })
    expect(elementOf<TextElement>(result.document, 'customer')).toMatchObject({ x: 12.1, y: 42.2 })
    expect(elementOf<TextElement>(result.document, 'title').x).toBeCloseTo(10.1, 10)
    expect(elementOf<TextElement>(result.document, 'label-name').y).toBeCloseTo(5.2, 10)
    const undone = applyOperations(result.document, result.inverse).document
    expect(elementOf<TextElement>(undone, 'title').x).toBe(10)
  })

  it('零位移或空列表没有变化，重复、缺失与非有限值报错', () => {
    const doc = sample()
    expect(applyOperation(doc, { type: 'moveElements', ids: ['customer'], dx: 0, dy: 0 }).document).toBe(doc)
    expect(applyOperation(doc, { type: 'moveElements', ids: [], dx: 1, dy: 1 }).document).toBe(doc)
    expectError(() => applyOperation(doc, { type: 'moveElements', ids: ['customer', 'customer'], dx: 1, dy: 0 }), 'value.invalid')
    expectError(() => applyOperation(doc, { type: 'moveElements', ids: ['nope'], dx: 1, dy: 0 }), 'element.notFound')
    expectError(() => applyOperation(doc, { type: 'moveElements', ids: ['customer'], dx: Number.NaN, dy: 0 }), 'value.invalid')
  })

  it('缩放普通元素只改元素框', () => {
    const doc = sample()
    const result = apply(doc, { type: 'resizeElement', id: 'frame', bounds: { x: 5, y: 30, width: 200, height: 40 } })
    expect(elementOf<RectElement>(result.document, 'frame')).toMatchObject({ x: 5, y: 30, width: 200, height: 40 })
    expect(result.inverse).toEqual([{
      type: 'updateElement',
      id: 'frame',
      changes: [{ path: ['x'], value: 10 }, { path: ['width'], value: 190 }, { path: ['height'], value: 35 }],
    }])
  })

  it('缩放表格时等比缩放列宽，撤销恢复原列宽', () => {
    const doc = sample()
    const result = apply(doc, { type: 'resizeElement', id: 'items', bounds: { x: 10, y: 70, width: 95, height: 22 } })
    const columns = elementOf<TableElement>(result.document, 'items').columns.map(column => column.width)
    expect(columns).toEqual([7.5, 47.5, 20, 20])
  })

  it('没登记的类型缩放时直接替换元素框', () => {
    const doc = sample()
    const table = elementOf<TableElement>(doc, 'items')
    const unknown = { ...doc, pages: [{ ...doc.pages[0]!, elements: doc.pages[0]!.elements.map(item => item.id === 'items' ? { ...table, type: 'seal' } as unknown as TableElement : item) }] }
    const result = applyOperation(unknown, { type: 'resizeElement', id: 'items', bounds: { x: 10, y: 70, width: 95, height: 22 } })
    expect(elementOf<TableElement>(result.document, 'items')).toMatchObject({ width: 95, height: 22, columns: table.columns })
  })

  it('元素框不变时没有变化，负尺寸或非有限值报错', () => {
    const doc = sample()
    expect(applyOperation(doc, { type: 'resizeElement', id: 'frame', bounds: { x: 10, y: 30, width: 190, height: 35 } }).document).toBe(doc)
    expectError(() => applyOperation(doc, { type: 'resizeElement', id: 'frame', bounds: { x: 0, y: 0, width: -1, height: 1 } }), 'value.invalid')
    expectError(() => applyOperation(doc, { type: 'resizeElement', id: 'frame', bounds: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 } }), 'value.invalid')
  })
})

describe('层级', () => {
  it.each([
    ['front', 7],
    ['back', 0],
    ['forward', 2],
    ['backward', 0],
    [4, 4],
  ] as const)('移到 %s', (to, expected) => {
    const doc = sample()
    const result = apply(doc, { type: 'reorderElement', id: 'customer', to })
    expect(bodyIds(result.document).indexOf('customer')).toBe(expected)
    expect(result.inverse).toEqual([{ type: 'reorderElement', id: 'customer', to: 1 }])
  })

  it('已在边界时没有变化，目标下标越界报错', () => {
    const doc = sample()
    expect(applyOperation(doc, { type: 'reorderElement', id: 'frame', to: 'back' }).document).toBe(doc)
    expect(applyOperation(doc, { type: 'reorderElement', id: 'frame', to: 'backward' }).document).toBe(doc)
    expect(applyOperation(doc, { type: 'reorderElement', id: 'remark', to: 'front' }).document).toBe(doc)
    expectError(() => applyOperation(doc, { type: 'reorderElement', id: 'frame', to: 8 }), 'index.outOfRange')
    expectError(() => applyOperation(doc, { type: 'reorderElement', id: 'frame', to: 1.5 }), 'index.outOfRange')
  })
})

describe('页面', () => {
  it('增删与移动页面模板', () => {
    const doc = sample()
    const page = createPage({ id: 'cover' })
    page.elements.push(registry.createElement('text', { id: 'cover-title', x: 20, y: 20 }))
    const added = apply(doc, { type: 'addPage', page, index: 0 })
    expect(added.document.pages.map(item => item.id)).toEqual(['cover', 'page-1', 'label'])

    const removed = apply(doc, { type: 'removePage', pageId: 'page-1' })
    expect(removed.document.pages.map(item => item.id)).toEqual(['label'])
    expect(removed.inverse).toMatchObject([{ type: 'addPage', index: 0 }])

    const moved = apply(doc, { type: 'movePage', pageId: 'label', index: 0 })
    expect(moved.document.pages.map(item => item.id)).toEqual(['label', 'page-1'])
    expect(applyOperation(doc, { type: 'movePage', pageId: 'label', index: 1 }).document).toBe(doc)
  })

  it('页面与其中元素的标识不得与文档冲突', () => {
    const doc = sample()
    expectError(() => applyOperation(doc, { type: 'addPage', page: createPage({ id: 'label' }) }), 'id.duplicate')
    const page = createPage({ id: 'p2' })
    page.footer.default.elements.push(registry.createElement('text', { id: 'title', x: 0, y: 0 }))
    expectError(() => applyOperation(doc, { type: 'addPage', page }), 'id.duplicate')
    const twins = createPage({ id: 'p3' })
    twins.elements.push(registry.createElement('text', { id: 'a', x: 0, y: 0 }), registry.createElement('text', { id: 'a', x: 0, y: 0 }))
    expectError(() => applyOperation(doc, { type: 'addPage', page: twins }), 'id.duplicate')
    expectError(() => applyOperation(doc, { type: 'removePage', pageId: 'nope' }), 'page.notFound')
    expectError(() => applyOperation(doc, { type: 'movePage', pageId: 'label', index: 2 }), 'index.outOfRange')
  })

  it('修改页面设置', () => {
    const doc = sample()
    const result = apply(doc, {
      type: 'updatePage',
      pageId: 'page-1',
      changes: [
        { path: ['orientation'], value: 'landscape' },
        { path: ['paper'], value: { preset: 'A5', width: 148, height: 210 } },
        { path: ['margins', 'left'], value: 15 },
        { path: ['watermark'] },
        { path: ['numbering', 'continuous'], value: false },
        { path: ['header', 'singleSheet'], value: 'last' },
        { path: ['footer', 'last', 'height'], value: 30 },
        { path: ['meta', 'templateCode'], value: 'stock-out' },
        { path: ['guides'], value: { x: [10], y: [] } },
      ],
    })
    const page = result.document.pages[0]!
    expect(page.orientation).toBe('landscape')
    expect(page.paper.preset).toBe('A5')
    expect(page.margins.left).toBe(15)
    expect(page.watermark).toBeUndefined()
    expect(page.header.singleSheet).toBe('last')
    expect(page.footer.last!.height).toBe(30)
    expect(page.footer.last!.elements).toBe(doc.pages[0]!.footer.last!.elements)
    expect(page.meta).toEqual({ templateCode: 'stock-out' })
    expect(page.guides).toEqual({ x: [10], y: [] })
  })

  it.each([
    [['id']],
    [['elements']],
    [['elements', 0, 'x']],
    [['header']],
    [['header', 'default']],
    [['header', 'default', 'elements']],
    [['footer', 'last', 'elements', 0]],
    [['footer', 'variant']],
  ] as const)('页面设置不能触及 %j', (path) => {
    expectError(() => applyOperation(sample(), { type: 'updatePage', pageId: 'page-1', changes: [{ path, value: 1 }] }), 'path.protected')
  })

  it('修改不存在的带区高度报错', () => {
    expectError(
      () => applyOperation(sample(), { type: 'updatePage', pageId: 'page-1', changes: [{ path: ['footer', 'odd', 'height'], value: 5 }] }),
      'band.notFound',
    )
  })
})

describe('页眉页脚变体', () => {
  it('添加带元素的变体，撤销连同元素一起删除', () => {
    const doc = sample()
    const band = { height: 15, elements: [registry.createElement('text', { id: 'even-title', x: 10, y: 12 })] }
    const result = apply(doc, { type: 'addBand', pageId: 'page-1', region: 'header', variant: 'even', band })
    expect(result.document.pages[0]!.header.even!.elements[0]!.id).toBe('even-title')
    expect(validateDocument(result.document).valid).toBe(true)
  })

  it('删除变体，撤销恢复其中的元素', () => {
    const doc = sample()
    const result = apply(doc, { type: 'removeBand', pageId: 'page-1', region: 'footer', variant: 'last' })
    expect(result.document.pages[0]!.footer.last).toBeUndefined()
    expect(findElement(result.document, 'signature')).toBeUndefined()
  })

  it('变体已存在、不存在、元素标识冲突与不合法的变体名', () => {
    const doc = sample()
    const empty = { height: 10, elements: [] }
    expectError(() => applyOperation(doc, { type: 'addBand', pageId: 'page-1', region: 'header', variant: 'first', band: empty }), 'band.exists')
    expectError(() => applyOperation(doc, { type: 'removeBand', pageId: 'page-1', region: 'header', variant: 'odd' }), 'band.notFound')
    const clash = { height: 10, elements: [registry.createElement('text', { id: 'title', x: 0, y: 0 })] }
    expectError(() => applyOperation(doc, { type: 'addBand', pageId: 'page-1', region: 'header', variant: 'odd', band: clash }), 'id.duplicate')
    const invalid = { type: 'removeBand', pageId: 'page-1', region: 'header', variant: 'default' } as unknown as PrintOperation
    expectError(() => applyOperation(doc, invalid), 'value.invalid')
    const noElements = { type: 'addBand', pageId: 'page-1', region: 'header', variant: 'odd', band: { height: 5 } } as unknown as PrintOperation
    expectError(() => applyOperation(doc, noElements), 'value.invalid')
  })
})

describe('文档属性与批量操作', () => {
  it('修改文档名称与宿主数据，不能触及版本与页面', () => {
    const doc = sample()
    const result = apply(doc, { type: 'updateDocument', changes: [{ path: ['name'], value: '入库单' }, { path: ['meta', 'v'], value: 2 }] })
    expect(result.document.name).toBe('入库单')
    expectError(() => applyOperation(doc, { type: 'updateDocument', changes: [{ path: ['schemaVersion'], value: 2 }] }), 'path.protected')
    expectError(() => applyOperation(doc, { type: 'updateDocument', changes: [{ path: ['pages'], value: [] }] }), 'path.protected')
  })

  it('整份替换：换成传入的文档，逆操作换回原来那份；传入的就是当前文档时没有变化', () => {
    const doc = sample()
    const next = { ...doc, name: '新模板', pages: doc.pages.slice(0, 1) }
    const result = applyOperation(doc, { type: 'replaceDocument', document: next })
    expect([result.document, result.inverse]).toEqual([next, [{ type: 'replaceDocument', document: doc }]])
    expect(applyOperations(result.document, result.inverse).document).toBe(doc)
    expect(applyOperation(doc, { type: 'replaceDocument', document: doc })).toEqual({ document: doc, inverse: [] })
  })

  it('批量操作按顺序执行，逆操作为各逆操作的倒序拼接', () => {
    const doc = sample()
    const element = registry.createElement('rect', { id: 'box-1', x: 20, y: 150 })
    const result = apply(doc, [
      { type: 'addElement', container: { pageId: 'page-1', region: 'body' }, element },
      { type: 'moveElements', ids: ['box-1', 'frame'], dx: 5, dy: 5 },
      { type: 'updateElement', id: 'box-1', changes: [{ path: ['fill'], value: '#000000' }] },
      { type: 'reorderElement', id: 'box-1', to: 'back' },
      { type: 'removeElement', id: 'stamp' },
    ])
    expect(bodyIds(result.document)[0]).toBe('box-1')
    expect(elementOf<RectElement>(result.document, 'box-1')).toMatchObject({ x: 25, y: 155, fill: '#000000' })
    expect(findElement(result.document, 'stamp')).toBeUndefined()
    expect(result.inverse.map(operation => operation.type)).toEqual([
      'addElement',
      'reorderElement',
      'updateElement',
      'updateElement',
      'updateElement',
      'removeElement',
    ])
  })

  it('批量操作中途失败时整体抛错，原文档不变', () => {
    const doc = sample()
    const snapshot = JSON.stringify(doc)
    expectError(() => applyOperations(doc, [
      { type: 'removeElement', id: 'stamp' },
      { type: 'removeElement', id: 'stamp' },
    ]), 'element.notFound')
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('全部没有变化或为空的批量操作返回原文档与空逆操作', () => {
    const doc = sample()
    const result = applyOperations(doc, [
      { type: 'moveElements', ids: ['customer'], dx: 0, dy: 0 },
      { type: 'reorderElement', id: 'frame', to: 'back' },
    ])
    expect(result.document).toBe(doc)
    expect(result.inverse).toEqual([])
    expect(applyOperations(doc, [])).toEqual({ document: doc, inverse: [] })
  })

  it('平移多个元素的逆操作是每个元素各一条属性修改', () => {
    const result = applyOperation(sample(), { type: 'moveElements', ids: ['customer', 'frame'], dx: 1, dy: 0 })
    expect(result.inverse).toEqual([
      { type: 'updateElement', id: 'customer', changes: [{ path: ['x'], value: 12 }] },
      { type: 'updateElement', id: 'frame', changes: [{ path: ['x'], value: 10 }] },
    ])
  })

  it('未知操作报错', () => {
    expectError(() => applyOperation(sample(), { type: 'explode' } as unknown as PrintOperation), 'operation.unknown')
  })

  it('错误带有问题码与参数', () => {
    const error = expectError(() => applyOperation(sample(), { type: 'removeElement', id: 'ghost' }), 'element.notFound')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PrintOperationError')
    expect(error.params).toEqual({ id: 'ghost' })
  })
})

describe('随机操作序列', () => {
  function random(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state / 2_147_483_648
    }
  }

  it.each([1, 7, 42, 2026])('种子 %i：逐步撤销回到原文档', (seed) => {
    const next = random(seed)
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
    const original = sample()
    let doc = original
    const inverses: (readonly PrintOperation[])[] = []
    let created = 0

    for (let step = 0; step < 200; step++) {
      const ids: string[] = []
      for (const page of doc.pages) {
        for (const element of page.elements)
          ids.push(element.id)
      }
      const id = pick(ids)
      const kind = pick(['move', 'resize', 'update', 'reorder', 'add', 'remove', 'page'] as const)
      let operation: PrintOperation
      switch (kind) {
        case 'move':
          operation = { type: 'moveElements', ids: [id], dx: next() * 2 - 1, dy: next() * 2 - 1 }
          break
        case 'resize': {
          const element = elementOf<RectElement>(doc, id)
          operation = { type: 'resizeElement', id, bounds: { ...element, width: 10 + next() * 50, height: 5 + next() * 20 } }
          break
        }
        case 'update':
          operation = { type: 'updateElement', id, changes: [{ path: ['name'], value: `n${step}` }, { path: ['meta', 'step'], value: step }] }
          break
        case 'reorder':
          operation = { type: 'reorderElement', id, to: pick(['front', 'back', 'forward', 'backward'] as const) }
          break
        case 'add':
          created += 1
          operation = {
            type: 'addElement',
            container: { pageId: pick(doc.pages).id, region: 'body' },
            element: registry.createElement('rect', { id: `r-${created}`, x: next() * 100, y: next() * 100 }),
            index: 0,
          }
          break
        case 'remove':
          operation = { type: 'removeElement', id }
          break
        case 'page':
          operation = { type: 'updatePage', pageId: pick(doc.pages).id, changes: [{ path: ['margins', 'top'], value: Math.round(next() * 20) }] }
          break
      }
      const result = applyOperation(doc, operation)
      deepFreeze(result.document)
      inverses.push(result.inverse)
      doc = result.document
    }

    for (const inverse of inverses.reverse())
      doc = applyOperations(doc, inverse).document
    expect(doc).toEqual(original)
  })
})
