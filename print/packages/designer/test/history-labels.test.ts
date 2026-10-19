/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintDocument, PrintOperation } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { HistoryLabel } from '@xihan-ui/designer-kit'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { DEFAULT_PRINT_DESIGNER_TRANSLATIONS } from '@xihan-print/runtime'
import { printZhCN } from '@xihan-print/runtime/locale'
import { describe, expect, it } from 'vitest'
import { createPrintEditor } from '../src/editor'
import { describePrintOperations } from '../src/history-labels'

const registry = createElementRegistry()
const zh = (printZhCN.translations as { 'xh-print-designer': PrintDesignerTranslations })['xh-print-designer']

function sample(): PrintDocument {
  const page = createPage({ id: 'p' })
  page.elements = [
    registry.createElement('text', { id: 'a', x: 10, y: 10, overrides: { name: '标题' } }),
    registry.createElement('rect', { id: 'b', x: 30, y: 30 }),
  ]
  return createDocument({ pages: [page] })
}

function text(label: HistoryLabel | undefined): string | undefined {
  return typeof label === 'function' ? label() : label
}

function labelOf(operations: readonly PrintOperation[], translations: PrintDesignerTranslations = DEFAULT_PRINT_DESIGNER_TRANSLATIONS): string | undefined {
  return text(describePrintOperations(operations, sample(), {
    translations: () => translations,
    kindName: (type, t) => t.elements[type as keyof PrintDesignerTranslations['elements']] ?? type,
  }))
}

describe('describePrintOperations', () => {
  it('元素：单个写「种类 名称」（没有名称写 id），几个写个数', () => {
    const element = registry.createElement('image', { id: 'c', x: 0, y: 0 })
    expect(labelOf([{ type: 'addElement', container: { pageId: 'p', region: 'body' }, element }])).toBe('Add Image c')
    expect(labelOf([
      { type: 'addElement', container: { pageId: 'p', region: 'body' }, element },
      { type: 'addElement', container: { pageId: 'p', region: 'body' }, element: { ...element, id: 'd' } },
    ])).toBe('Add 2 elements')
    expect(labelOf([{ type: 'removeElement', id: 'a' }])).toBe('Delete Text 标题')
    expect(labelOf([{ type: 'removeElement', id: 'a' }, { type: 'removeElement', id: 'b' }])).toBe('Delete 2 elements')
    expect(labelOf([{ type: 'updateElement', id: 'b', changes: [{ path: ['x'], value: 1 }] }])).toBe('Edit Rectangle b')
    expect(labelOf([{ type: 'moveElements', ids: ['a', 'b'], dx: 1, dy: 0 }])).toBe('Move 2 elements')
    expect(labelOf([{ type: 'resizeElement', id: 'a', bounds: { x: 10, y: 10, width: 20, height: 10 } }])).toBe('Resize Text 标题')
    expect(labelOf([{ type: 'reorderElement', id: 'b', to: 'front' }])).toBe('Change stacking of Rectangle b')
  })

  it('换区是先删再加同一个元素：写成移动', () => {
    const moved = { ...sample().pages[0]!.elements[0]!, y: 0 }
    expect(labelOf([
      { type: 'removeElement', id: 'a' },
      { type: 'addElement', container: { pageId: 'p', region: 'header', band: 'default' }, element: moved },
    ])).toBe('Move Text 标题')
    expect(labelOf([
      { type: 'moveElements', ids: ['b'], dx: 0, dy: -5 },
      { type: 'removeElement', id: 'a' },
      { type: 'addElement', container: { pageId: 'p', region: 'header', band: 'default' }, element: moved },
    ])).toBe('Move 2 elements')
  })

  it('页面、参考线、页眉页脚变体与模板设置', () => {
    const page = createPage({ id: 'q' })
    expect(labelOf([{ type: 'addPage', page }])).toBe('Add page')
    expect(labelOf([{ type: 'removePage', pageId: 'p' }])).toBe('Delete page')
    expect(labelOf([{ type: 'movePage', pageId: 'p', index: 0 }])).toBe('Move page')
    expect(labelOf([{ type: 'updatePage', pageId: 'p', changes: [{ path: ['guides'], value: { x: [10], y: [] } }] }])).toBe('Edit guides')
    expect(labelOf([{ type: 'updatePage', pageId: 'p', changes: [{ path: ['paper', 'width'], value: 100 }] }])).toBe('Edit page settings')
    expect(labelOf([{ type: 'addBand', pageId: 'p', region: 'header', variant: 'first', band: { height: 10, elements: [] } }])).toBe('Add Header · First page')
    expect(labelOf([{ type: 'removeBand', pageId: 'p', region: 'footer', variant: 'odd' }])).toBe('Delete Footer · Odd pages')
    expect(labelOf([{ type: 'updateDocument', changes: [{ path: ['name'], value: 'x' }] }])).toBe('Edit template settings')
    expect(labelOf([])).toBeUndefined()
  })

  it('说明是现取文案的函数：换了语言就跟着变，元素名称按执行那一刻取', () => {
    let translations = DEFAULT_PRINT_DESIGNER_TRANSLATIONS
    const label = describePrintOperations([{ type: 'removeElement', id: 'a' }], sample(), {
      translations: () => translations,
      kindName: (type, t) => t.elements[type as keyof PrintDesignerTranslations['elements']] ?? type,
    })
    expect(text(label)).toBe('Delete Text 标题')
    translations = zh
    expect(text(label)).toBe(`删除${zh.elementLabel(zh.elements.text, '标题')}`)
  })

  it('编辑模型把 describe 交给历史：没给说明的一步按它写', () => {
    const editor = createPrintEditor({
      document: sample(),
      describe: (operations, before) => describePrintOperations(operations, before, {
        translations: () => DEFAULT_PRINT_DESIGNER_TRANSLATIONS,
        kindName: (type, t) => t.elements[type as keyof PrintDesignerTranslations['elements']] ?? type,
      }),
    })
    editor.execute([{ type: 'removeElement', id: 'b' }])
    expect(editor.history.undoLabel).toBe('Delete Rectangle b')
    editor.execute([{ type: 'removeElement', id: 'a' }], { label: '手写的说明' })
    expect(editor.history.undoLabel).toBe('手写的说明')
  })
})
