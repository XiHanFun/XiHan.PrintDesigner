/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type {
  EllipseLayoutBox,
  ExtensionLayoutBox,
  ImageLayoutBox,
  LayoutBox,
  LineLayoutBox,
  RectLayoutBox,
  Stroke,
  TextLayoutBox,
  TextStyle,
} from '@xihan-print/core'
import type { PrintElementRenderer } from '../extensions'
import { DEFAULT_FONT_FAMILY } from '@xihan-print/core'
import { renderBarCode, renderMatrixCode } from './codes'
import { applyBoxStyle, borderValue, mm, pt, setStyles } from './css'
import { boxFrame, JUSTIFY } from './frame'
import { renderRichText } from './rich-text'
import { createMmSvg, strokeSegment } from './svg'
import { renderTable } from './table'

/** 按文字样式排好的各行：每行定高为字号乘以行高倍数，行内不再折行。 */
function textLines(doc: Document, lines: readonly string[], style: TextStyle): HTMLDivElement {
  const content = doc.createElement('div')
  content.dataset.part = 'text'
  const lineHeight = pt(style.fontSize * style.lineHeight)
  const decoration = [style.underline ? 'underline' : '', style.lineThrough ? 'line-through' : ''].filter(Boolean).join(' ')
  setStyles(content, {
    'display': 'flex',
    'flex-direction': 'column',
    'justify-content': JUSTIFY[style.verticalAlign],
    'height': '100%',
    'font-family': style.fontFamily ?? DEFAULT_FONT_FAMILY,
    'font-size': pt(style.fontSize),
    'font-weight': style.bold ? '700' : '400',
    'font-style': style.italic ? 'italic' : 'normal',
    'line-height': lineHeight,
    'letter-spacing': pt(style.letterSpacing),
    'color': style.color,
    'text-align': style.align,
    'text-decoration-line': decoration === '' ? undefined : decoration,
    'white-space': 'pre',
  })
  lines.forEach((text, index) => {
    const line = doc.createElement('div')
    line.dataset.part = 'line'
    line.textContent = text
    setStyles(line, { 'flex': 'none', 'height': lineHeight, 'text-align-last': style.align === 'justify' && index < lines.length - 1 ? 'justify' : undefined })
    content.append(line)
  })
  return content
}

function renderText(doc: Document, box: TextLayoutBox): HTMLDivElement {
  const frame = boxFrame(doc, box)
  applyBoxStyle(frame, box.box)
  if (box.overflow === 'clip')
    frame.style.setProperty('overflow', 'hidden')
  frame.append(textLines(doc, box.lines, box.style))
  return frame
}

function renderImage(doc: Document, box: ImageLayoutBox): HTMLDivElement {
  const frame = boxFrame(doc, box)
  applyBoxStyle(frame, box.box)
  frame.style.setProperty('overflow', 'hidden')
  if (box.src !== '') {
    const image = doc.createElement('img')
    image.alt = ''
    image.src = box.src
    setStyles(image, { 'display': 'block', 'width': '100%', 'height': '100%', 'object-fit': box.fit })
    frame.append(image)
  }
  return frame
}

function renderLine(doc: Document, box: LineLayoutBox): HTMLDivElement {
  const frame = boxFrame(doc, box)
  const { width, height, stroke } = box
  const svg = createMmSvg(doc, width, height)
  const ends: Record<LineLayoutBox['direction'], [number, number, number, number]> = {
    horizontal: [0, height / 2, width, height / 2],
    vertical: [width / 2, 0, width / 2, height],
    diagonalDown: [0, 0, width, height],
    diagonalUp: [0, height, width, 0],
  }
  const [x1, y1, x2, y2] = ends[box.direction]
  strokeSegment(svg, x1, y1, x2, y2, stroke)
  frame.append(svg)
  return frame
}

function renderShape(doc: Document, box: RectLayoutBox | EllipseLayoutBox, radius: string | undefined): HTMLDivElement {
  const frame = boxFrame(doc, box)
  const stroke: Stroke | undefined = box.stroke
  setStyles(frame, {
    'background-color': box.fill,
    'border': stroke === undefined ? undefined : borderValue(stroke),
    'border-radius': radius,
  })
  return frame
}

/** 扩展元素：交给登记的渲染；没给渲染或类型没登记时画成占位，占位里写着元素类型。 */
function renderExtension(doc: Document, box: ExtensionLayoutBox, renderers: ReadonlyMap<string, PrintElementRenderer>): HTMLDivElement {
  const frame = boxFrame(doc, box)
  frame.dataset.elementType = box.elementType
  const renderer = renderers.get(box.elementType)
  if (renderer !== undefined && box.data !== null) {
    frame.append(renderer(box, { document: doc }))
    return frame
  }
  frame.dataset.placeholder = ''
  frame.textContent = box.elementType
  return frame
}

const NO_RENDERERS: ReadonlyMap<string, PrintElementRenderer> = new Map()

/** 按布局盒的种类渲染一个元素；扩展元素按 renderers 里同一类型的渲染。 */
export function renderBox(doc: Document, box: LayoutBox, renderers: ReadonlyMap<string, PrintElementRenderer> = NO_RENDERERS): HTMLElement {
  switch (box.kind) {
    case 'text':
      return renderText(doc, box)
    case 'richText':
      return renderRichText(doc, box)
    case 'image':
      return renderImage(doc, box)
    case 'line':
      return renderLine(doc, box)
    case 'rect':
      return renderShape(doc, box, box.radius > 0 ? mm(box.radius) : undefined)
    case 'ellipse':
      return renderShape(doc, box, '50%')
    case 'barCode': {
      const frame = boxFrame(doc, box)
      const svg = renderBarCode(doc, box)
      if (svg !== undefined)
        frame.append(svg)
      return frame
    }
    case 'matrixCode': {
      const frame = boxFrame(doc, box)
      const svg = renderMatrixCode(doc, box)
      if (svg !== undefined)
        frame.append(svg)
      return frame
    }
    case 'table':
      return renderTable(doc, box)
    case 'extension':
      return renderExtension(doc, box, renderers)
  }
}
