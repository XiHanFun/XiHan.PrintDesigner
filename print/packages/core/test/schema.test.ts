/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PageBandSet, PrintDocument, RectElement } from '../src'
import { describe, expect, it } from 'vitest'
import {
  collectDocumentIds,
  createDocument,
  createEdges,
  createPage,
  createPaper,
  createUniqueId,
  findElement,
  findPage,
  forEachElement,
  getBandRect,
  getBodyRect,
  getContainerElements,
  getContentRect,
  getPageBand,
  getPaperSize,
  isPaperPresetName,
  listContainers,
  listPageBandKeys,
  PAPER_PRESET_NAMES,
  PAPER_PRESETS,
  PRINT_SCHEMA_VERSION,
  resolvePageBand,
  resolvePageBandKey,
} from '../src'

function rect(id: string, x = 0, y = 0): RectElement {
  return { id, type: 'rect', x, y, width: 10, height: 10, radius: 0, rotation: 0 }
}

describe('纸张与工厂', () => {
  it('预设名列表与预设表一一对应', () => {
    expect(PAPER_PRESET_NAMES).toEqual(Object.keys(PAPER_PRESETS))
    expect(isPaperPresetName('A4')).toBe(true)
    expect(isPaperPresetName('a4')).toBe(false)
    expect(isPaperPresetName(4)).toBe(false)
  })

  it('createPaper 带上预设名与纵向尺寸', () => {
    expect(createPaper('A4')).toEqual({ preset: 'A4', width: 210, height: 297 })
  })

  it('createEdges 支持统一值与逐边值', () => {
    expect(createEdges(5)).toEqual({ top: 5, right: 5, bottom: 5, left: 5 })
    const edges = { top: 1, right: 2, bottom: 3, left: 4 }
    expect(createEdges(edges)).toEqual(edges)
    expect(createEdges(edges)).not.toBe(edges)
  })

  it('createPage 默认 A4 纵向、10 mm 边距、空页眉页脚', () => {
    const page = createPage({ id: 'p' })
    expect(page).toEqual({
      id: 'p',
      paper: { preset: 'A4', width: 210, height: 297 },
      orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      header: { default: { height: 0, elements: [] }, singleSheet: 'first' },
      footer: { default: { height: 0, elements: [] }, singleSheet: 'last' },
      elements: [],
      numbering: { continuous: true, start: 1 },
    })
  })

  it('createPage 接受自定义纸张、方向、边距与名称', () => {
    const paper = { width: 241, height: 140 }
    const page = createPage({ id: 'p', name: '凭证', paper, orientation: 'landscape', margins: 0 })
    expect(page.paper).toEqual(paper)
    expect(page.paper).not.toBe(paper)
    expect(page.orientation).toBe('landscape')
    expect(page.name).toBe('凭证')
    expect(page.margins.left).toBe(0)
  })

  it('createDocument 带 schema 版本与默认页面', () => {
    const doc = createDocument({ name: '出库单' })
    expect(doc.schemaVersion).toBe(PRINT_SCHEMA_VERSION)
    expect(doc.name).toBe('出库单')
    expect(doc.pages.map(page => page.id)).toEqual(['page-1'])
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })
})

describe('页面几何', () => {
  const page = createPage({ id: 'p', margins: { top: 10, right: 15, bottom: 20, left: 5 } })

  it('横向时宽高互换', () => {
    expect(getPaperSize(page)).toEqual({ width: 210, height: 297 })
    expect(getPaperSize({ ...page, orientation: 'landscape' })).toEqual({ width: 297, height: 210 })
  })

  it('内容区、页眉区、页脚区与正文区', () => {
    expect(getContentRect(page)).toEqual({ x: 5, y: 10, width: 190, height: 267 })
    expect(getBandRect(page, 'header', { height: 20 })).toEqual({ x: 5, y: 10, width: 190, height: 20 })
    expect(getBandRect(page, 'footer', { height: 15 })).toEqual({ x: 5, y: 262, width: 190, height: 15 })
    expect(getBodyRect(page, { height: 20 }, { height: 15 })).toEqual({ x: 5, y: 30, width: 190, height: 232 })
  })
})

describe('页眉页脚变体选择', () => {
  const band = (height: number) => ({ height, elements: [] })
  const full: PageBandSet = {
    default: band(1),
    first: band(2),
    last: band(3),
    odd: band(4),
    even: band(5),
    singleSheet: 'first',
  }

  it('首页、末页优先于奇偶页', () => {
    expect(resolvePageBandKey(full, { isFirst: true, isLast: false, pageNumber: 2 })).toBe('first')
    expect(resolvePageBandKey(full, { isFirst: false, isLast: true, pageNumber: 3 })).toBe('last')
    expect(resolvePageBandKey(full, { isFirst: false, isLast: false, pageNumber: 3 })).toBe('odd')
    expect(resolvePageBandKey(full, { isFirst: false, isLast: false, pageNumber: 4 })).toBe('even')
  })

  it('单页同时命中首页与末页时按 singleSheet 选择', () => {
    const sheet = { isFirst: true, isLast: true, pageNumber: 1 }
    expect(resolvePageBandKey(full, sheet)).toBe('first')
    expect(resolvePageBandKey({ ...full, singleSheet: 'last' }, sheet)).toBe('last')
  })

  it('单页只有一种变体时直接命中该变体', () => {
    const sheet = { isFirst: true, isLast: true, pageNumber: 1 }
    const onlyLast: PageBandSet = { default: band(1), last: band(3), singleSheet: 'first' }
    expect(resolvePageBandKey(onlyLast, sheet)).toBe('last')
  })

  it('缺少变体时回到 default，页码奇偶按绝对值判断', () => {
    const plain: PageBandSet = { default: band(1), singleSheet: 'first' }
    expect(resolvePageBandKey(plain, { isFirst: true, isLast: true, pageNumber: 1 })).toBe('default')
    expect(resolvePageBandKey({ ...plain, odd: band(4) }, { isFirst: false, isLast: false, pageNumber: -3 })).toBe('odd')
    expect(resolvePageBandKey({ ...plain, even: band(5) }, { isFirst: false, isLast: false, pageNumber: 0 })).toBe('even')
  })

  it('resolvePageBand 返回命中的带区对象，getPageBand 按键取带区', () => {
    expect(resolvePageBand(full, { isFirst: false, isLast: false, pageNumber: 4 }).height).toBe(5)
    expect(getPageBand(full, 'last')?.height).toBe(3)
    expect(getPageBand({ default: band(1), singleSheet: 'first' }, 'odd')).toBeUndefined()
  })
})

describe('元素遍历与查找', () => {
  function sampleDocument(): PrintDocument {
    const first = createPage({ id: 'p1' })
    first.elements.push(rect('b1'), rect('b2'))
    first.header.default.elements.push(rect('h1'))
    first.footer.last = { height: 10, elements: [rect('f1')] }
    const second = createPage({ id: 'p2' })
    second.elements.push(rect('b3'))
    return createDocument({ pages: [first, second] })
  }

  it('按正文、页眉、页脚顺序遍历并给出路径', () => {
    const doc = sampleDocument()
    const visited: string[] = []
    forEachElement(doc, location => visited.push(`${location.element.id}@${location.path.join('.')}`))
    expect(visited).toEqual([
      'b1@pages.0.elements.0',
      'b2@pages.0.elements.1',
      'h1@pages.0.header.default.elements.0',
      'f1@pages.0.footer.last.elements.0',
      'b3@pages.1.elements.0',
    ])
  })

  it('findElement 返回容器与下标', () => {
    const doc = sampleDocument()
    const location = findElement(doc, 'f1')
    expect(location?.container).toEqual({ pageId: 'p1', region: 'footer', band: 'last' })
    expect(location?.index).toBe(0)
    expect(location?.pageIndex).toBe(0)
    expect(findElement(doc, 'missing')).toBeUndefined()
  })

  it('容器列举与取元素数组', () => {
    const doc = sampleDocument()
    const page = doc.pages[0]!
    expect(listPageBandKeys(page.footer)).toEqual(['default', 'last'])
    expect(listContainers(page)).toHaveLength(4)
    expect(getContainerElements(page, { pageId: 'p1', region: 'footer', band: 'odd' })).toBeUndefined()
    expect(getContainerElements(page, { pageId: 'p1', region: 'body' })).toBe(page.elements)
  })

  it('findPage 返回页面与下标', () => {
    const doc = sampleDocument()
    expect(findPage(doc, 'p2')?.index).toBe(1)
    expect(findPage(doc, 'p3')).toBeUndefined()
  })

  it('createUniqueId 取已用最大序号加一', () => {
    const doc = sampleDocument()
    expect(collectDocumentIds(doc)).toEqual(new Set(['p1', 'p2', 'b1', 'b2', 'h1', 'f1', 'b3']))
    expect(createUniqueId(doc, 'text')).toBe('text-1')
    doc.pages[0]!.elements.push(rect('text-1'), rect('text-7'), rect('text-07'), rect('text-x'))
    expect(createUniqueId(doc, 'text')).toBe('text-8')
    expect(createUniqueId(doc, 'page')).toBe('page-1')
  })
})
