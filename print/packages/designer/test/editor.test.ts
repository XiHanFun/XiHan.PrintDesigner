/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintDocument, PrintElement, TableElement } from '@xihan-print/core'
import type { PrintEditorChange } from '../src/editor'
import { createDocument, createElementRegistry, createPage, planInsertTableColumn } from '@xihan-print/core'
import { describe, expect, it } from 'vitest'
import { createPrintEditor } from '../src/editor'

const registry = createElementRegistry()

function text(id: string, x: number, y: number): PrintElement {
  return registry.createElement('text', { id, x, y, overrides: { width: 20, height: 10 } })
}

function sample(): PrintDocument {
  const page = createPage({ id: 'p1' })
  page.elements = [text('a', 10, 10), text('b', 40, 30), text('c', 90, 60)]
  page.header.default = { height: 15, elements: [text('h', 10, 10)] }
  page.header.first = { height: 20, elements: [text('hf', 10, 10)] }
  return createDocument({ pages: [page, createPage({ id: 'p2' })] })
}

function editorOf(document = sample()): ReturnType<typeof createPrintEditor> {
  return createPrintEditor({ document, registry, now: () => 0 })
}

describe('选择', () => {
  it('只能选当前页面模板里可见的元素；追加与切换', () => {
    const editor = editorOf()
    editor.select({ elements: ['a', 'hf', 'nope', 'h'] })
    expect(editor.selection).toEqual({ elements: ['a', 'h'] })
    editor.select({ elements: ['b', 'a'] }, 'toggle')
    expect(editor.selection.elements).toEqual(['h', 'b'])
    editor.select({ elements: ['c'] }, 'add')
    expect(editor.selection.elements).toEqual(['h', 'b', 'c'])
    editor.selectAll()
    expect(editor.selection.elements).toEqual(['h', 'a', 'b', 'c'])
  })

  it('切换页眉变体时不再显示的元素取消选择；切页面时清空选择', () => {
    const editor = editorOf()
    editor.select({ elements: ['h', 'a'] })
    editor.setBandVariant('header', 'first')
    expect(editor.bands).toEqual({ header: 'first', footer: 'default' })
    expect(editor.selection.elements).toEqual(['a'])
    editor.setBandVariant('footer', 'last')
    expect(editor.bands.footer).toBe('default')
    editor.setActivePage('p2')
    expect([editor.activePageId, editor.selection.elements]).toEqual(['p2', []])
    expect(() => editor.setActivePage('none')).toThrow()
  })

  it('表格部位只在恰好选中这张表格、部位存在时保留', () => {
    const page = createPage({ id: 'p' })
    page.elements = [registry.createElement('table', { id: 't', x: 0, y: 0 }), text('a', 0, 50)]
    const editor = editorOf(createDocument({ pages: [page] }))
    const column = (page.elements[0] as TableElement).columns[0]!.id
    editor.select({ elements: ['t'], tablePart: { kind: 'column', elementId: 't', columnId: column } })
    expect(editor.selection.tablePart).toEqual({ kind: 'column', elementId: 't', columnId: column })
    editor.select({ elements: ['t', 'a'], tablePart: { kind: 'header', elementId: 't' } })
    expect(editor.selection.tablePart).toBeUndefined()
    editor.select({ elements: ['t'], tablePart: { kind: 'column', elementId: 't', columnId: 'missing' } })
    expect(editor.selection.tablePart).toBeUndefined()
  })
})

describe('编辑命令', () => {
  it('新建元素取下一个序号并选中；跨页元素只能放在正文', () => {
    const editor = editorOf()
    editor.setBandVariant('header', 'first')
    const added = editor.addElement('text', { x: 5, y: 5, region: 'header' })
    expect(added.id).toBe('text-1')
    expect(editor.page.header.first!.elements.map(element => element.id)).toEqual(['hf', 'text-1'])
    expect(editor.selection.elements).toEqual(['text-1'])
    const table = editor.addElement('table', { x: 0, y: 100, region: 'footer' })
    expect(editor.page.elements.at(-1)!.id).toBe(table.id)
    expect(() => editor.addElement('chart', { x: 0, y: 0 })).toThrow()
  })

  it('删除、平移、层级，撤销后选择里不存在的元素被去掉', () => {
    const editor = editorOf()
    editor.select({ elements: ['a', 'b'] })
    editor.moveElements(['a'], 5, -2)
    expect(editor.page.elements[0]).toMatchObject({ x: 15, y: 8 })
    editor.reorder('front')
    expect(editor.page.elements.map(element => element.id)).toEqual(['c', 'a', 'b'])
    expect(editor.deleteSelection()).toBe(true)
    expect(editor.page.elements.map(element => element.id)).toEqual(['c'])
    expect(editor.selection.elements).toEqual([])
    editor.undo()
    expect(editor.page.elements.map(element => element.id)).toEqual(['c', 'a', 'b'])
    expect(editor.deleteSelection()).toBe(false)
  })

  it('对齐与分布按元素外框计算，各元素各自平移', () => {
    const editor = editorOf()
    editor.select({ elements: ['a', 'b', 'c'] })
    editor.align('top')
    expect(editor.page.elements.map(element => element.y)).toEqual([10, 10, 10])
    editor.distribute('horizontal')
    expect(editor.page.elements.map(element => element.x)).toEqual([10, 50, 90])
  })

  it('复制粘贴换新 id，每次多偏移 5 mm，粘到原区域；跨页元素粘到正文', () => {
    const editor = editorOf()
    editor.select({ elements: ['h'] })
    const clipboard = editor.copy()!
    expect(clipboard.region).toBe('header')
    editor.paste()
    editor.paste()
    expect(editor.page.header.default.elements.map(element => [element.id, element.x])).toEqual([['h', 10], ['text-1', 15], ['text-2', 20]])
    expect(editor.selection.elements).toEqual(['text-2'])

    const table = registry.createElement('table', { id: 'table-1', x: 0, y: 0 })
    editor.paste({ elements: [table], region: 'header' })
    expect(editor.page.elements.at(-1)!.id).toBe('table-1')
  })

  it('剪切与再制', () => {
    const editor = editorOf()
    editor.select({ elements: ['a'] })
    editor.duplicate()
    expect(editor.page.elements.map(element => element.id)).toEqual(['a', 'b', 'c', 'text-1'])
    editor.select({ elements: ['b'] })
    const cut = editor.cut()
    expect(cut?.elements.map(element => element.id)).toEqual(['b'])
    expect(editor.page.elements.map(element => element.id)).toEqual(['a', 'c', 'text-1'])
  })
})

describe('页面与带区', () => {
  it('新增、移动、删除页面模板，删掉当前页时切到相邻的一张；只剩一张时不删', () => {
    const editor = editorOf()
    const added = editor.addPage(1)
    expect([added.id, editor.activePageId]).toEqual(['page-1', 'page-1'])
    expect(editor.document.pages.map(page => page.id)).toEqual(['p1', 'page-1', 'p2'])
    editor.movePage('p2', 0)
    expect(editor.document.pages.map(page => page.id)).toEqual(['p2', 'p1', 'page-1'])
    expect(editor.removePage('page-1')).toBe(true)
    expect(editor.activePageId).toBe('p1')
    editor.removePage('p2')
    expect(editor.removePage('p1')).toBe(false)
  })

  it('新增变体取 default 的高度并切过去；调整与删除带区；撤销新增页面时当前页回落', () => {
    const editor = editorOf()
    editor.addBand('footer', 'last')
    expect([editor.page.footer.last?.height, editor.bands.footer]).toEqual([editor.page.footer.default.height, 'last'])
    editor.setBandHeight('footer', 'last', 25)
    expect(editor.page.footer.last!.height).toBe(25)
    editor.removeBand('footer', 'last')
    expect([editor.page.footer.last, editor.bands.footer]).toEqual([undefined, 'default'])
    editor.addPage()
    editor.undo()
    expect(editor.activePageId).toBe('p1')
  })
})

describe('表格计划与通知', () => {
  it('按计划修改表格，被拒的计划不改文档；变化依次通知', () => {
    const page = createPage({ id: 'p' })
    const table = registry.createElement('table', { id: 't', x: 0, y: 0 })
    page.elements = [table]
    const editor = editorOf(createDocument({ pages: [page] }))
    const changes: PrintEditorChange['kind'][] = []
    editor.subscribe(change => changes.push(change.kind))
    const column = { ...table.columns[0]!, id: 'new' }
    expect(editor.applyTablePlan('t', planInsertTableColumn(table, 0, column))).toBe(true)
    expect((editor.page.elements[0] as TableElement).columns[0]!.id).toBe('new')
    expect(editor.applyTablePlan('t', { ok: false, code: 'table.lastColumn' })).toBe(false)
    editor.select({ elements: ['t'] })
    expect(changes).toEqual(['document', 'selection'])
    editor.load(sample())
    expect(changes.slice(2)).toEqual(['document', 'page', 'selection'])
    expect(editor.history.canUndo).toBe(false)
  })
})
