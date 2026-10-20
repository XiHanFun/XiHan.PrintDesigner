/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { DesignerMinimapShape, XhDesignerFrameElement, XhDesignerMinimapElement } from '@xihan-ui/designer-shell'
import type { TextMeasurer } from '@xihan-ui/viz'
import type { XhPrintDesigner } from '../src'
import { createDocument, createElementRegistry, createPage, getPaperSize } from '@xihan-print/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definePrintDesigner, PRINT_DESIGNER_PANELS } from '../src'

const registry = createElementRegistry()
const PX_PER_MM = 96 / 25.4

const measurer: TextMeasurer = {
  version: 0,
  measure: (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

function sample(): PrintDocument {
  const first = createPage({ id: 'p1' })
  first.elements = [registry.createElement('rect', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 20 } })]
  first.footer.default.elements = [registry.createElement('pageNumber', { id: 'n', x: 10, y: 2 })]
  const second = createPage({ id: 'p2', paper: { preset: 'A5', width: 148, height: 210 } })
  second.elements = [registry.createElement('rect', { id: 'z', x: 5, y: 5, overrides: { width: 20, height: 20 } })]
  return createDocument({ pages: [first, second] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.autoTour = false
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await designer.updateComplete
})

afterEach(() => {
  designer.remove()
})

function minimap(): XhDesignerMinimapElement {
  return designer.querySelector('xh-designer-minimap')!
}

function frame(): XhDesignerFrameElement {
  return designer.querySelector('xh-designer-frame')!
}

function rects(shapes: readonly DesignerMinimapShape[] | undefined): string[] {
  return (shapes ?? []).map(shape => shape.kind === 'rect' ? `${shape.tone ?? 'default'}:${shape.rect.x},${shape.rect.y},${shape.rect.width},${shape.rect.height}` : 'path')
}

describe('缩略图', () => {
  it('是画布左下角的浮动件（右侧中间是翻页条），面板菜单与 panel:minimap 能开关它；预览态不显示', async () => {
    const region = frame().regions!.find(item => item.name === PRINT_DESIGNER_PANELS.minimap)!
    expect([region.position, region.anchor, region.icon?.name]).toEqual(['overlay', 'bottom-start', 'map'])
    expect(minimap().getAttribute('slot')).toBe('minimap')
    expect(frame().panelEntries().map(entry => entry.name)).toContain('minimap')
    expect(designer.hasAttribute('data-rulers')).toBe(true)
    designer.settings = { ...designer.settings, 'print.rulers': false }
    await designer.updateComplete
    expect(designer.hasAttribute('data-rulers')).toBe(false)
    frame().setPanelVisible('minimap', false)
    await designer.updateComplete
    expect(frame().showsPanel('minimap')).toBe(false)
    designer.mode = 'preview'
    await designer.updateComplete
    expect(frame().regions!.some(item => item.name === 'minimap')).toBe(false)
  })

  it('按页显示：纸张一块淡色、当前页面模板里看得见的元素各一块，范围是这张纸；换页、改元素随之重画', async () => {
    const paper = getPaperSize(designer.schema.pages[0]!)
    expect(minimap().bounds).toEqual({ x: 0, y: 0, width: paper.width, height: paper.height })
    const shapes = rects(minimap().shapes)
    expect(shapes[0]).toBe(`muted:0,0,${paper.width},${paper.height}`)
    expect(shapes).toContain('default:10,30,40,20')
    expect(shapes.length).toBe(3)
    designer.execute([{ type: 'updateElement', id: 'a', changes: [{ path: ['x'], value: 60 }] }])
    await designer.updateComplete
    expect(rects(minimap().shapes)).toContain('default:60,30,40,20')
    designer.activePageId = 'p2'
    await designer.updateComplete
    expect(minimap().bounds).toEqual({ x: 0, y: 0, width: 148, height: 210 })
    expect(rects(minimap().shapes)).toEqual(['muted:0,0,148,210', 'default:5,5,20,20'])
  })

  it('视口与画布尺寸随画布交过去；在缩略图上按下或拖动派发 navigate，视口中心移到那一点', async () => {
    const viewport = designer.querySelector<HTMLElement>('[data-part="viewport"]')!
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    designer.zoomToActual()
    await designer.updateComplete
    expect(minimap().canvasSize).toEqual({ width: 800, height: 600 })
    expect(minimap().viewport!.zoom).toBeCloseTo(PX_PER_MM, 10)
    minimap().dispatchEvent(new CustomEvent('navigate', { detail: { center: { x: 100, y: 150 } }, bubbles: true }))
    await designer.updateComplete
    const center = designer.clientToWorld(viewport.getBoundingClientRect().left + 400, viewport.getBoundingClientRect().top + 300)
    expect(center.x).toBeCloseTo(100, 6)
    expect(center.y).toBeCloseTo(150, 6)
    expect(minimap().viewport).toEqual({ ...designer.getViewport(), zoom: designer.getViewport().zoom * PX_PER_MM })
  })
})
