/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PrintDocument } from '@xihan-print/core'
import type { DesignerFrameRegion, XhDesignerFrameElement } from '@xihan-ui/designer-shell'
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
  const page = createPage({ id: 'p' })
  page.elements = [registry.createElement('text', { id: 'a', x: 10, y: 30, overrides: { width: 40, height: 10 } })]
  return createDocument({ pages: [page] })
}

let designer: XhPrintDesigner

beforeEach(async () => {
  definePrintDesigner()
  designer = document.createElement('xh-print-designer')
  designer.measurer = measurer
  document.body.append(designer)
  designer.schema = sample()
  await settle()
})

afterEach(() => {
  designer.remove()
})

function frame(): XhDesignerFrameElement {
  return designer.querySelector('xh-designer-frame')!
}

/** 设计器更新完，再等外框按新的区铺好。 */
async function settle(): Promise<void> {
  await designer.updateComplete
  await frame().updateComplete
}

function region(name: string): DesignerFrameRegion {
  return frame().regions!.find(item => item.name === name)!
}

describe('外框卡片', () => {
  it('物料、属性与问题画成卡片：面板头写标题与帮助，属性面板的副标题是当前编辑的对象；零件不画自己的标题', async () => {
    expect(['palette', 'properties', 'issues'].map(name => [region(name).title, typeof region(name).help])).toEqual([
      ['Elements', 'string'],
      ['Properties', 'string'],
      ['Problems', 'string'],
    ])
    expect([region('toolbar').title, region('pages').title, region('canvas').title]).toEqual([undefined, undefined, undefined])
    expect([region('palette').size, region('properties').size, region('issues').size]).toEqual([18, 24, 28])
    designer.select({ elements: ['a'] })
    await settle()
    expect(region('properties').subtitle).toBe('Text a')
    expect(frame().querySelector('[data-region="properties"] [data-part="panel-subtitle"]')!.textContent).toBe('Text a')
    const parts = ['xh-designer-palette', 'xh-designer-properties', 'xh-designer-issues'].map(tag => designer.querySelector<HTMLElement & { headless?: boolean }>(tag)!)
    expect(parts.map(element => element.headless)).toEqual([true, true, true])
  })

  it('点面板头的关闭钮收起这块面板：panels 换成外框剩下的区，设计器自己的标尺照原样，派发 panels-change', async () => {
    const seen: string[] = []
    designer.addEventListener('panels-change', event => seen.push((event as CustomEvent<{ panels: string }>).detail.panels))
    frame().querySelector<HTMLButtonElement>('[data-region="palette"] [data-part="panel-close"]')!.click()
    await settle()
    expect(seen).toEqual([designer.panels])
    const shown = designer.panels!.split(' ')
    expect(shown).toEqual(expect.arrayContaining(['toolbar', 'pages', 'properties', 'issues', 'rulers']))
    expect([shown.includes('palette'), frame().showsPanel('palette'), frame().showsPanel('properties')]).toEqual([false, false, true])

    designer.panels = 'toolbar properties issues'
    await settle()
    frame().querySelector<HTMLButtonElement>('[data-region="issues"] [data-part="panel-close"]')!.click()
    await settle()
    expect(designer.panels).toBe('toolbar properties')
    expect(designer.querySelector<HTMLElement>('xh-designer-ruler')!.hidden).toBe(true)
  })
})
