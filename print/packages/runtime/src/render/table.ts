/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { CellStyle, TableCellLayout, TableLayoutBox, TableRowLayout } from '@xihan-print/core'
import { DEFAULT_FONT_FAMILY } from '@xihan-print/core'
import { renderBarCode, renderMatrixCode } from './codes'
import { mm, pt, setStyles } from './css'
import { boxFrame, JUSTIFY } from './frame'
import { createMmSvg, strokeSegment } from './svg'

function cellContent(doc: Document, cell: TableCellLayout, row: TableRowLayout): Element | undefined {
  const { style } = row
  const innerWidth = Math.max(0, cell.width - style.padding * 2)
  switch (cell.cellType) {
    case 'text':
      return cellLines(doc, cell, style)
    case 'image': {
      if (cell.text === '')
        return undefined
      const image = doc.createElement('img')
      image.alt = ''
      image.src = cell.text
      setStyles(image, { 'display': 'block', 'width': '100%', 'height': '100%', 'object-fit': 'contain' })
      return image
    }
    case 'barCode':
      return cell.barCodeFormat === undefined
        ? undefined
        : renderBarCode(doc, {
            format: cell.barCodeFormat,
            value: cell.text,
            showText: false,
            textStyle: { fontSize: style.fontSize },
            color: style.color,
            width: innerWidth,
            height: row.height,
          })
    case 'matrixCode':
      return renderMatrixCode(doc, { format: 'qr', value: cell.text, color: style.color })
  }
}

/** 单元格里已换行的文字：每行定高为样式里的行高。 */
function cellLines(doc: Document, cell: TableCellLayout, style: CellStyle): HTMLDivElement {
  const content = doc.createElement('div')
  content.dataset.part = 'text'
  setStyles(content, {
    'font-family': style.fontFamily ?? DEFAULT_FONT_FAMILY,
    'font-size': pt(style.fontSize),
    'font-weight': style.bold ? '700' : '400',
    'font-style': style.italic ? 'italic' : 'normal',
    'line-height': mm(style.lineHeight),
    'color': style.color,
    'text-align': cell.align,
    'white-space': 'pre',
  })
  for (const text of cell.lines) {
    const line = doc.createElement('div')
    line.dataset.part = 'line'
    line.textContent = text
    line.style.setProperty('height', mm(style.lineHeight))
    content.append(line)
  }
  return content
}

function renderRow(doc: Document, row: TableRowLayout, box: TableLayoutBox): HTMLDivElement {
  const element = doc.createElement('div')
  element.dataset.part = 'row'
  element.dataset.role = row.role
  setStyles(element, {
    'position': 'absolute',
    'left': '0',
    'top': mm(row.y - box.y),
    'width': '100%',
    'height': mm(row.height),
    'background-color': row.style.background,
  })
  for (const cell of row.cells) {
    const cellElement = doc.createElement('div')
    cellElement.dataset.part = 'cell'
    cellElement.dataset.columnId = cell.columnId
    setStyles(cellElement, {
      'position': 'absolute',
      'top': '0',
      'left': mm(cell.x - box.x),
      'width': mm(cell.width),
      'height': '100%',
      'box-sizing': 'border-box',
      'padding': `0 ${mm(row.style.padding)}`,
      'display': 'flex',
      'flex-direction': 'column',
      'justify-content': JUSTIFY[row.style.verticalAlign],
      'overflow': 'hidden',
    })
    const content = cellContent(doc, cell, row)
    if (content !== undefined)
      cellElement.append(content)
    element.append(cellElement)
  }
  return element
}

/** 按表格边框画外框、行间横线与列间竖线；列间竖线按各行自己的单元格分界画，跨列单元格内不画。 */
function renderGrid(doc: Document, box: TableLayoutBox): SVGSVGElement {
  const { border } = box
  const svg = createMmSvg(doc, box.width, box.height)
  const bottom = box.rows.reduce((max, row) => Math.max(max, row.y + row.height - box.y), 0)
  if (border.outer) {
    strokeSegment(svg, 0, 0, box.width, 0, border.stroke)
    strokeSegment(svg, 0, bottom, box.width, bottom, border.stroke)
    strokeSegment(svg, 0, 0, 0, bottom, border.stroke)
    strokeSegment(svg, box.width, 0, box.width, bottom, border.stroke)
  }
  if (border.horizontal) {
    for (const row of box.rows.slice(1))
      strokeSegment(svg, 0, row.y - box.y, box.width, row.y - box.y, border.stroke)
  }
  if (border.vertical) {
    for (const row of box.rows) {
      const top = row.y - box.y
      for (const cell of row.cells.slice(0, -1)) {
        const x = cell.x + cell.width - box.x
        strokeSegment(svg, x, top, x, top + row.height, border.stroke)
      }
    }
  }
  return svg
}

/** 渲染表格的一段：行与单元格按纸张坐标换算到表格框内，边框画在最上层。 */
export function renderTable(doc: Document, box: TableLayoutBox): HTMLDivElement {
  const frame = boxFrame(doc, box)
  for (const row of box.rows)
    frame.append(renderRow(doc, row, box))
  frame.append(renderGrid(doc, box))
  return frame
}
