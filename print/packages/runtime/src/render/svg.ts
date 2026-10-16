/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Stroke } from '@xihan-print/core'
import { SVG_NS } from '@xihan-ui/web-components/authoring'
import { mm, setStyles, svgDash } from './css'

/** 写 SVG 属性，数值保留四位小数。 */
export function setAttributes(element: Element, attributes: Readonly<Record<string, string | number>>): void {
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, typeof value === 'number' ? String(Math.round(value * 1e4) / 1e4) : value)
}

/** SVG 视口向父元素四周外扩的距离，单位 mm。 */
const SVG_BLEED = 1

/** 覆盖父元素并四周外扩 SVG_BLEED 的 SVG，视图坐标即毫米、原点在父元素左上角；父元素宽或高为 0 时视口仍有面积。 */
export function createMmSvg(doc: Document, width: number, height: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  const round = (value: number): number => Math.round(value * 1e4) / 1e4
  setAttributes(svg, { viewBox: `${-SVG_BLEED} ${-SVG_BLEED} ${round(width + SVG_BLEED * 2)} ${round(height + SVG_BLEED * 2)}`, preserveAspectRatio: 'none' })
  setStyles(svg, {
    'position': 'absolute',
    'left': mm(-SVG_BLEED),
    'top': mm(-SVG_BLEED),
    'width': `calc(100% + ${mm(SVG_BLEED * 2)})`,
    'height': `calc(100% + ${mm(SVG_BLEED * 2)})`,
    'overflow': 'visible',
    'pointer-events': 'none',
  })
  return svg
}

function segment(doc: Document, x1: number, y1: number, x2: number, y2: number, width: number, stroke: Stroke): SVGLineElement {
  const line = doc.createElementNS(SVG_NS, 'line')
  setAttributes(line, { 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'stroke': stroke.color, 'stroke-width': width })
  for (const [name, value] of Object.entries(svgDash(stroke.style, width)))
    line.setAttribute(name, value)
  return line
}

/** 按描边画一条线段；double 画成两条各占三分之一线宽的平行线。 */
export function strokeSegment(parent: Element, x1: number, y1: number, x2: number, y2: number, stroke: Stroke): void {
  const doc = parent.ownerDocument
  if (stroke.style !== 'double') {
    parent.append(segment(doc, x1, y1, x2, y2, stroke.width, stroke))
    return
  }
  const length = Math.hypot(x2 - x1, y2 - y1)
  if (length === 0)
    return
  const third = stroke.width / 3
  const nx = (-(y2 - y1) / length) * third
  const ny = ((x2 - x1) / length) * third
  parent.append(
    segment(doc, x1 + nx, y1 + ny, x2 + nx, y2 + ny, third, stroke),
    segment(doc, x1 - nx, y1 - ny, x2 - nx, y2 - ny, third, stroke),
  )
}
