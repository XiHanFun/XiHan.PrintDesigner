/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { DesignerOutlineMove, DesignerOutlineNode, XhDesignerFrameElement, XhDesignerOutlineElement, XhDesignerTransformElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner } from '../src'

const registry = createElementRegistry()

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const first = createPage({ id: 'p1' })
  first.elements = [
    registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } }),
    registry.createElement('rect', { id: 'b', x: 60, y: 30, overrides: { name: 'frame' } }),
    registry.createElement('ellipse', { id: 'c', x: 100, y: 30 }),
  ]
  first.footer.default.elements = [registry.createElement('pageNumber', { id: 'n', x: 10, y: 2 })]
  const second = createPage({ id: 'p2', name: 'Back' })
  second.elements = [registry.createElement('text', { id: 'z', x: 10, y: 30 })]
  return createDocument({ pages: [first, second] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
})

function outline(): XhDesignerOutlineElement {
  return designer.querySelector('xh-designer-outline')!
}

function frame(): XhDesignerFrameElement {
  return designer.querySelector('xh-designer-frame')!
}

function emit(type: string, detail: unknown): void {
  outline().dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))
}

/** 树压成「缩进 + 名字」一行一个。 */
function lines(nodes: readonly DesignerOutlineNode[], depth = 0): string[] {
  return nodes.flatMap(node => [`${'  '.repeat(depth)}${node.label}`, ...lines(node.children ?? [], depth + 1)])
}

function bodyIds(): string[] {
  return designer.schema.pages[0]!.elements.map(element => element.id)
}

describe('页面结构面板', () => {
  it('缺省停在左栏物料下面，面板头写标题与图标；「面板」菜单与 panel:outline 能开关它', async () => {
    expect(frame().resolvedLayout.docks.start.slice(0, 2)).toEqual(['palette', 'outline'])
    const region = frame().regions!.find(item => item.name === 'outline')!
    expect([region.title, region.icon?.name]).toEqual(['Structure', 'list-tree'])
    expect(frame().panelEntries().map(entry => entry.name)).toContain('outline')
  })

  it('按页面模板分页眉、正文与页脚，同一处最上层排最前；没名字的写「种类 · id」，带种类图标', async () => {
    expect(lines(outline().nodes!)).toEqual([
      'Page 1',
      '  Body',
      '    Ellipse · c',
      '    frame',
      '    Text · a',
      '  Footer',
      '    Page number · n',
      'Back',
      '  Body',
      '    Text · z',
    ])
    const body = outline().nodes![0]!.children![0]!.children!
    expect(body.map(node => [node.description, node.icon?.name])).toEqual([[undefined, 'shape-ellipse'], ['Rectangle', 'shape-rectangle'], [undefined, 'type']])
  })

  it('选一项：不在当前页面模板时先切过去再选中；画布选中变了，树上跟着标出', async () => {
    emit('node-select', { ids: ['z'] })
    await designer.updateComplete
    expect([designer.activePageId, designer.getSelection().elements]).toEqual(['p2', ['z']])
    expect(outline().selection).toEqual(['z'])
    designer.activePageId = 'p1'
    designer.select({ elements: ['b'] })
    await designer.updateComplete
    expect(outline().selection).toEqual(['b'])
  })

  it('悬停一项时画布上标出它，离开时撤掉', async () => {
    const overlay = designer.querySelector<XhDesignerTransformElement>('xh-designer-transform')!
    emit('node-highlight', { id: 'a' })
    expect(overlay.hover).toEqual({ x: 10, y: 30, width: 40, height: 10 })
    emit('node-highlight', { id: null })
    expect(overlay.hover).toBeUndefined()
  })

  it('只能在同一处里调层级，记一步撤销；跨页眉、正文、页脚或跨页面模板不许挪', async () => {
    const allow = outline().allowMove!
    const move = (id: string, parent: string | null, index: number): DesignerOutlineMove => ({ id, parent, index })
    expect([allow(move('a', 'region:p1:body', 0)), allow(move('a', 'region:p1:footer', 0)), allow(move('a', 'region:p2:body', 0)), allow(move('a', null, 0))]).toEqual([true, false, false, false])
    emit('node-move', move('a', 'region:p1:body', 0))
    await designer.updateComplete
    expect(bodyIds()).toEqual(['b', 'c', 'a'])
    expect(lines(outline().nodes!).slice(2, 5)).toEqual(['    Text · a', '    Ellipse · c', '    frame'])
    designer.undo()
    expect(bodyIds()).toEqual(['a', 'b', 'c'])
  })

  it('删除选中的几项记一步撤销；只读与预览态时零件只读', async () => {
    emit('node-delete', { ids: ['a', 'c'] })
    await designer.updateComplete
    expect(bodyIds()).toEqual(['b'])
    designer.undo()
    expect(bodyIds()).toEqual(['a', 'b', 'c'])
    designer.readonly = true
    await designer.updateComplete
    expect(outline().readonly).toBe(true)
    emit('node-delete', { ids: ['a'] })
    expect(bodyIds()).toEqual(['a', 'b', 'c'])
  })
})
