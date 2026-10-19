/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintDocument } from '@xihan-print/core'
import type { DesignerOutlineNode } from '@xihan-ui/designer-shell'
import type { PrintOutlineLabels } from '../src/outline'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { describe, expect, it } from 'vitest'
import { printOutline } from '../src/outline'

const registry = createElementRegistry()

const labels: PrintOutlineLabels = {
  page: (page, index) => page.name ?? `Page ${index + 1}`,
  region: region => region,
  band: key => key,
  element: element => element.name === undefined ? { label: `${element.type} · ${element.id}` } : { label: element.name, description: element.type },
}

function sample(): PrintDocument {
  const first = createPage({ id: 'p1' })
  first.elements = [
    registry.createElement('text', { id: 'a', x: 0, y: 0 }),
    registry.createElement('rect', { id: 'b', x: 0, y: 0, overrides: { name: 'frame', locked: true } }),
    registry.createElement('image', { id: 'c', x: 0, y: 0 }),
  ]
  first.header.default.elements = [registry.createElement('text', { id: 'h', x: 0, y: 0 })]
  first.footer.default.elements = [registry.createElement('pageNumber', { id: 'n', x: 0, y: 0 })]
  first.footer.first = { height: 10, elements: [registry.createElement('text', { id: 'f', x: 0, y: 0 })] }
  const second = createPage({ id: 'p2', name: 'Back' })
  return createDocument({ pages: [first, second] })
}

/** 树压成「缩进 + id: 名字」一行一个，方便整棵比对。 */
function lines(nodes: readonly DesignerOutlineNode[], depth = 0): string[] {
  return nodes.flatMap(node => [`${'  '.repeat(depth)}${node.id}: ${node.label}`, ...lines(node.children ?? [], depth + 1)])
}

describe('页面结构', () => {
  it('按页面模板分组，每页分页眉、正文、页脚；页眉页脚有几种带区时再分，没有元素时不列；同一容器最上层排最前', () => {
    const outline = printOutline(sample(), labels)
    expect(lines(outline.nodes)).toEqual([
      'page:p1: Page 1',
      '  region:p1:header: header',
      '    h: text · h',
      '  region:p1:body: body',
      '    c: image · c',
      '    b: frame',
      '    a: text · a',
      '  region:p1:footer: footer',
      '    band:p1:footer:default: default',
      '      n: pageNumber · n',
      '    band:p1:footer:first: first',
      '      f: text · f',
      'page:p2: Back',
      '  region:p2:body: body',
    ])
  })

  it('分组行只作分组；锁定的元素不能挪、不能删；记下各元素的上级行、容器与个数', () => {
    const outline = printOutline(sample(), labels)
    const page = outline.nodes[0]!
    expect([page.selectable, page.movable, page.deletable]).toEqual([false, false, false])
    const body = page.children![1]!
    expect(body.children!.map(node => [node.id, node.movable, node.deletable, node.description])).toEqual([
      ['c', true, true, undefined],
      ['b', false, false, 'rect'],
      ['a', true, true, undefined],
    ])
    expect([outline.places.get('b'), outline.places.get('f')]).toEqual([
      { parent: 'region:p1:body', container: { pageId: 'p1', region: 'body' }, count: 3 },
      { parent: 'band:p1:footer:first', container: { pageId: 'p1', region: 'footer', band: 'first' }, count: 1 },
    ])
  })
})
