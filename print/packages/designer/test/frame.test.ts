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
    expect([region('toolbar').title, region('canvas').title]).toEqual([undefined, undefined])
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

describe('问题计数', () => {
  it('错误、警告数在问题卡片的面板头里，零件里不再有；条数照旧随校验变', async () => {
    designer.execute([{ type: 'moveElements', ids: ['a'], dx: 200, dy: 0 }])
    await Promise.resolve()
    await settle()
    const actions = frame().querySelector('[data-region="issues"] [data-part="panel-actions"]')!
    const summary = actions.querySelector('[data-part="filter"]')!
    expect(summary).not.toBeNull()
    expect(designer.querySelector('xh-designer-issues')!.querySelector('[data-part="filter"]')).toBeNull()
    expect(summary.textContent).toContain('1 warning')
  })
})

describe('翻页条', () => {
  function strip(): HTMLElement {
    return designer.querySelector<HTMLElement>('[slot="canvas-end"]')!
  }

  function button(value: string): HTMLButtonElement {
    return strip().querySelector<HTMLButtonElement>(`button[value="${value}"]`)!
  }

  async function twoPages(): Promise<void> {
    const second = createPage({ id: 'q', name: '明细页' })
    designer.schema = createDocument({ pages: [sample().pages[0]!, second] })
    await settle()
  }

  it('竖排落在画布区右侧中间：上一页、页码、下一页，新增、复制、删除页面；页码按钮写第几页、共几页与页面名称', async () => {
    await twoPages()
    expect(strip().closest('[data-region="canvas"]')).not.toBeNull()
    expect(strip().getAttribute('data-orientation')).toBe('vertical')
    const groups = Array.from(strip().querySelectorAll('[data-xh-part="group"]'), group => Array.from(group.querySelectorAll('button'), item => item.value))
    expect(groups).toEqual([['previous-page', 'page-menu', 'next-page'], ['add-page', 'duplicate-page', 'remove-page']])
    expect(button('page-menu').getAttribute('aria-label')).toBe('Page 1 of 2: Page 1')
    expect([button('previous-page').disabled, button('next-page').disabled]).toEqual([true, false])
    button('next-page').click()
    await settle()
    expect(designer.activePageId).toBe('q')
    expect(button('page-menu').getAttribute('aria-label')).toBe('Page 2 of 2: 明细页')
    expect([button('previous-page').disabled, button('next-page').disabled, button('remove-page').getAttribute('data-tone')]).toEqual([false, true, 'danger'])
  })

  it('页码菜单：上半是全部页面模板（单选，当前那个打勾），下半是上移、下移；选中一项切过去', async () => {
    await twoPages()
    button('page-menu').click()
    await settle()
    const menu = document.querySelector('[aria-label="Page 1 of 2: Page 1"][role="menu"]')!
    const items = Array.from(menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'), item => [item.getAttribute('role'), item.textContent?.trim(), item.getAttribute('aria-checked')])
    expect(items).toEqual([
      ['menuitemradio', 'Page 1', 'true'],
      ['menuitemradio', '明细页', 'false'],
      ['menuitem', 'Move page up', null],
      ['menuitem', 'Move page down', null],
    ])
    menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]!.click()
    await settle()
    expect(designer.activePageId).toBe('q')
  })

  it('复制页面：放在当前页之后并切过去，元素换了新 id，可以撤销；只读时增、复制、删、移都不可用，翻页照常', async () => {
    await twoPages()
    button('duplicate-page').click()
    await settle()
    expect(designer.schema.pages.map(page => page.id)).toEqual(['p', 'page-1', 'q'])
    expect([designer.activePageId, designer.schema.pages[1]!.elements.map(element => element.id)]).toEqual(['page-1', ['text-1']])
    designer.undo()
    await settle()
    expect(designer.schema.pages.map(page => page.id)).toEqual(['p', 'q'])
    designer.readonly = true
    await settle()
    expect(['previous-page', 'next-page', 'add-page', 'duplicate-page', 'remove-page'].map(value => button(value).disabled)).toEqual([true, false, true, true, true])
  })

  it('预览态与 panels 不含 pages 时翻页条收起；收起面板时 pages 照原样留着', async () => {
    designer.mode = 'preview'
    await settle()
    expect(strip().hidden).toBe(true)
    designer.mode = 'design'
    designer.panels = 'toolbar palette properties issues'
    await settle()
    expect(strip().hidden).toBe(true)
    designer.panels = undefined
    await settle()
    frame().querySelector<HTMLButtonElement>('[data-region="palette"] [data-part="panel-close"]')!.click()
    await settle()
    expect([designer.panels!.split(' ').includes('pages'), strip().hidden]).toEqual([true, false])
  })
})
