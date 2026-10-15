/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { BarCodeFormat, BarCodeTextStyle, Color, MatrixCodeFormat, MatrixCodeLevel } from '@xihan-print/core'
import type { MatrixCodeProps } from '@xihan-ui/headless'
import { DEFAULT_FONT_FAMILY } from '@xihan-print/core'
import { normalizeProps } from '@xihan-ui/core'
import { convertLength } from '@xihan-ui/designer-kit'
import { barEncode, checkBarCodeValue, connectBarCode, connectMatrixCode } from '@xihan-ui/headless'
import { SVG_NS } from '@xihan-ui/web-components/authoring'
import { setStyles } from './css'
import { setAttributes } from './svg'

/** 每个模块折成的视图单位：条高按十分之一模块取整。 */
const UNIT = 10
/** 人读文字的上留白与上伸，按字号的倍数。 */
const TEXT_GAP = 0.15
const TEXT_ASCENT = 0.8
/** 人读文字一行占的高度，按字号的倍数。 */
const TEXT_LINE = 1.15

/** 一维条码的绘制参数，尺寸单位 mm。 */
export interface BarCodeDrawing {
  format: BarCodeFormat
  value: string
  showText: boolean
  textStyle: BarCodeTextStyle
  color: Color
  width: number
  height: number
}

/** 二维码的绘制参数。 */
export interface MatrixCodeDrawing {
  format: MatrixCodeFormat
  value: string
  level?: MatrixCodeLevel
  color: Color
  background?: Color
  /** 静区宽度，单位为模块数；缺省取码制的规范值。 */
  quietZone?: number
}

function codeSvg(doc: Document, viewBox: string, aspect: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  setAttributes(svg, { 'viewBox': viewBox, 'preserveAspectRatio': aspect, 'width': '100%', 'height': '100%', 'shape-rendering': 'crispEdges' })
  setStyles(svg, { display: 'block' })
  return svg
}

/**
 * 按 @xihan-ui/headless 的几何画一维条码，铺满给定的宽高：条宽按模块数等分宽度，
 * 人读文字按模板字号排在条下，落点取自编码器；守卫条码制的文字排在守卫条延长段之间。
 * 内容为空或不能编码时返回 undefined。
 */
export function renderBarCode(doc: Document, drawing: BarCodeDrawing): SVGSVGElement | undefined {
  const { format, value } = drawing
  if (value === '' || checkBarCodeValue(format, value) !== undefined || drawing.width <= 0 || drawing.height <= 0)
    return undefined
  const probe = connectBarCode({ format, value, text: false, barWidth: UNIT, height: UNIT }, normalizeProps)
  const viewWidth = probe.pixelWidth
  const scale = drawing.width / viewWidth
  const below = probe.pixelHeight - UNIT
  const symbol = barEncode(format, value)
  const runs = drawing.showText ? symbol.text : []
  const fontSize = convertLength(drawing.textStyle.fontSize, 'pt', 'mm') / scale
  const textBlock = runs.length > 0 ? fontSize * TEXT_LINE : 0
  const guarded = symbol.guards.length > 0
  const viewHeight = drawing.height / scale
  const barHeight = Math.max(UNIT, Math.round(viewHeight - (guarded ? Math.max(below, textBlock) : below + textBlock)))

  const api = connectBarCode({ format, value, text: false, barWidth: UNIT, height: barHeight }, normalizeProps)
  const svg = codeSvg(doc, `0 0 ${viewWidth} ${Math.round(viewHeight * 1e4) / 1e4}`, 'none')
  const bars = doc.createElementNS(SVG_NS, 'path')
  setAttributes(bars, { d: api.path, fill: drawing.color })
  svg.append(bars)
  const textTop = guarded ? barHeight : barHeight + below
  for (const run of runs) {
    const text = doc.createElementNS(SVG_NS, 'text')
    setAttributes(text, {
      'x': (api.margin + run.x) * UNIT,
      'y': textTop + fontSize * (TEXT_GAP + TEXT_ASCENT),
      'text-anchor': run.anchor,
      'font-size': fontSize,
      'font-family': drawing.textStyle.fontFamily ?? DEFAULT_FONT_FAMILY,
      'fill': drawing.color,
    })
    text.textContent = run.text
    svg.append(text)
  }
  return svg
}

/** 按 @xihan-ui/headless 的几何画二维码，等比放进给定的框并居中；内容为空或不能编码时返回 undefined。 */
export function renderMatrixCode(doc: Document, drawing: MatrixCodeDrawing): SVGSVGElement | undefined {
  if (drawing.value === '')
    return undefined
  const props: MatrixCodeProps = { format: drawing.format, value: drawing.value }
  if (drawing.level !== undefined)
    props.level = drawing.level
  if (drawing.quietZone !== undefined)
    props.margin = drawing.quietZone
  const api = connectMatrixCode(props, normalizeProps)
  if (api.state !== 'ready')
    return undefined
  const svg = codeSvg(doc, api.viewBox, 'xMidYMid meet')
  if (drawing.background !== undefined) {
    const backdrop = doc.createElementNS(SVG_NS, 'rect')
    setAttributes(backdrop, { x: 0, y: 0, width: api.columns + api.margin * 2, height: api.rows + api.margin * 2, fill: drawing.background })
    svg.append(backdrop)
  }
  for (const d of [api.path, api.eyePath]) {
    if (d === '')
      continue
    const path = doc.createElementNS(SVG_NS, 'path')
    setAttributes(path, { d, fill: drawing.color })
    svg.append(path)
  }
  return svg
}
