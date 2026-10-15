/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { BoxStyle, Stroke, StrokeStyle } from '@xihan-print/core'

/** 保留四位小数，免得浮点零头写进样式。 */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

/** 毫米长度写成 CSS 值。 */
export function mm(value: number): string {
  return `${round(value)}mm`
}

/** 磅值写成 CSS 值。 */
export function pt(value: number): string {
  return `${round(value)}pt`
}

/** 逐项写内联样式，值为 undefined 的项跳过。 */
export function setStyles(element: HTMLElement | SVGElement, styles: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(styles)) {
    if (value !== undefined)
      element.style.setProperty(name, value)
  }
}

/** 描边写成 CSS border 简写。 */
export function borderValue(stroke: Stroke): string {
  return `${mm(stroke.width)} ${stroke.style} ${stroke.color}`
}

/** 按盒样式写背景、四边描边与内边距。 */
export function applyBoxStyle(element: HTMLElement, style: BoxStyle | undefined): void {
  if (style === undefined)
    return
  const { background, border, padding } = style
  setStyles(element, {
    'background-color': background,
    'border-top': border?.top === undefined ? undefined : borderValue(border.top),
    'border-right': border?.right === undefined ? undefined : borderValue(border.right),
    'border-bottom': border?.bottom === undefined ? undefined : borderValue(border.bottom),
    'border-left': border?.left === undefined ? undefined : borderValue(border.left),
    'padding': padding === undefined ? undefined : `${mm(padding.top)} ${mm(padding.right)} ${mm(padding.bottom)} ${mm(padding.left)}`,
  })
}

/** SVG 线段的虚线样式：虚线为三倍线宽的段加两倍线宽的空，点线为圆头点。 */
export function svgDash(style: StrokeStyle, width: number): Readonly<Record<string, string>> {
  if (style === 'dashed')
    return { 'stroke-dasharray': `${round(width * 3)} ${round(width * 2)}` }
  if (style === 'dotted')
    return { 'stroke-dasharray': `0 ${round(width * 2)}`, 'stroke-linecap': 'round' }
  return {}
}
