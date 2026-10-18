/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一个扩展元素：圆形印章。原型给缺省值、属性、排版与引用的字段，渲染把排版给出的数据画成 SVG，物料项给出它在物料面板里的名称。

// #region element
import type { ExtensionElementPrototype } from '@xihan-print/core'
import type { PrintDesignerExtension } from '@xihan-print/designer'
import { behaviorProperties, layoutProperties, property } from '@xihan-print/core'

const SVG = 'http://www.w3.org/2000/svg'

const seal: ExtensionElementPrototype = {
  type: 'seal',
  category: 'media',
  order: 9,
  flow: false,
  minSize: { width: 10, height: 10 },
  defaults: { type: 'seal', width: 40, height: 40, field: '', color: '#d40000' },
  properties: [
    ...layoutProperties({ rotation: false }),
    property(['field'], 'data', { kind: 'dataField', kinds: ['value'] }),
    property(['color'], 'appearance', { kind: 'color' }),
    ...behaviorProperties(),
  ],
  // 排版只给 JSON：从数据里取单位名，元素框由 core 填好
  layout: (element, context) => ({
    name: String(context.field(String(element.field)) ?? ''),
    color: String(element.color),
  }),
  // 报出引用的字段：collectDocumentFields 汇总模板字段时不会漏掉印章
  fields: (element, context) => context.field(String(element.field)),
}

export const sealExtension: PrintDesignerExtension = {
  id: '@acme/print-seal',
  elements: [seal],
  palette: { seal: { label: '印章' } },
  renderers: {
    seal: (box, { document }) => {
      const { name, color } = box.data as { name: string, color: string }
      const svg = document.createElementNS(SVG, 'svg')
      svg.setAttribute('viewBox', '0 0 100 100')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      const ring = document.createElementNS(SVG, 'circle')
      ring.setAttribute('cx', '50')
      ring.setAttribute('cy', '50')
      ring.setAttribute('r', '46')
      ring.setAttribute('fill', 'none')
      ring.setAttribute('stroke', color)
      ring.setAttribute('stroke-width', '4')
      const text = document.createElementNS(SVG, 'text')
      text.setAttribute('x', '50')
      text.setAttribute('y', '56')
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('fill', color)
      text.textContent = name
      svg.append(ring, text)
      return svg
    },
  },
}
// #endregion element
