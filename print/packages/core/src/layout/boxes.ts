/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Edges, TextStyle } from '../schema/common'
import type {
  BarCodeElement,
  ImageElement,
  MatrixCodeElement,
  PageNumberElement,
  PrintElement,
  TextElement,
} from '../schema/elements'
import type { ElementRegion } from '../traverse'
import type { DiagnosticScope, LayoutContext } from './context'
import type { LayoutBox, LayoutBoxBase, TextLayoutBox, TextMeasurement } from './types'
import { checkBarCodeValue, matrixCodeLevelFit } from '@xihan-ui/headless'
import { barCodeIssueParams, checkMatrixCodeContent, matrixCodeIssueParams } from '../codes'
import { getFieldValue } from '../data'
import { formatPageNumber } from '../page-number-format'
import { isSafeImageUrl } from '../validation/controls'
import { contentText, valueText } from './content'
import { LAYOUT_EPSILON } from './context'

/** 缩小字号以容纳文字时的最小字号，单位 pt。 */
export const MIN_SHRINK_FONT_SIZE = 4

/** 缩小字号的步长，单位 pt。 */
export const SHRINK_FONT_STEP = 0.5

const NO_PADDING: Edges = { top: 0, right: 0, bottom: 0, left: 0 }

/** 取元素外框的内边距。 */
export function paddingOf(element: { box?: { padding?: Edges } }): Edges {
  return element.box?.padding ?? NO_PADDING
}

/** 生成布局盒共有字段。 */
export function boxBase(element: PrintElement, region: ElementRegion): LayoutBoxBase {
  return {
    elementId: element.id,
    elementType: element.type,
    region,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    previewOnly: element.previewOnly === true,
  }
}

/** 按文本样式测量文字。 */
export function measureText(
  context: LayoutContext,
  text: string,
  style: Omit<TextStyle, 'align' | 'verticalAlign' | 'color' | 'underline' | 'lineThrough'>,
  maxWidth: number,
  wrap: boolean,
): TextMeasurement {
  const request = {
    text,
    fontSize: style.fontSize,
    bold: style.bold,
    italic: style.italic,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    maxWidth: Math.max(0, maxWidth),
    wrap,
  }
  return context.measure(style.fontFamily === undefined ? request : { ...request, fontFamily: style.fontFamily })
}

function layoutText(element: TextElement, region: ElementRegion, context: LayoutContext, scope: DiagnosticScope): TextLayoutBox {
  const text = contentText(element.content, context.data, context, scope)
  const padding = paddingOf(element)
  const innerWidth = element.width - padding.left - padding.right
  const innerHeight = element.height - padding.top - padding.bottom
  const overflows = (measurement: TextMeasurement): boolean =>
    measurement.height > innerHeight + LAYOUT_EPSILON
    || (!element.wrap && measurement.width > innerWidth + LAYOUT_EPSILON)

  let style = element.style
  let measurement = measureText(context, text, style, innerWidth, element.wrap)
  if (element.overflow === 'shrink') {
    let fontSize = style.fontSize
    while (overflows(measurement) && fontSize - SHRINK_FONT_STEP >= MIN_SHRINK_FONT_SIZE - LAYOUT_EPSILON) {
      fontSize -= SHRINK_FONT_STEP
      style = { ...element.style, fontSize }
      measurement = measureText(context, text, style, innerWidth, element.wrap)
    }
    if (overflows(measurement))
      context.report('text.overflow', scope, { fontSize })
  }

  const box: TextLayoutBox = {
    ...boxBase(element, region),
    kind: 'text',
    lines: measurement.lines,
    style,
    overflow: element.overflow === 'visible' ? 'visible' : 'clip',
    rotation: element.rotation,
  }
  if (element.box !== undefined)
    box.box = element.box
  return box
}

function layoutImage(element: ImageElement, region: ElementRegion, context: LayoutContext, scope: DiagnosticScope): LayoutBox {
  let src = element.source.kind === 'static'
    ? element.source.url
    : valueText(getFieldValue(context.data, element.source.field), undefined, undefined, context, scope)
  if (src.trim().length > 0 && !isSafeImageUrl(src)) {
    context.report('image.unsafeSource', scope)
    src = ''
  }
  const box: LayoutBox = { ...boxBase(element, region), kind: 'image', src, fit: element.fit, rotation: element.rotation }
  if (element.box !== undefined)
    box.box = element.box
  return box
}

function layoutBarCode(element: BarCodeElement, region: ElementRegion, context: LayoutContext, scope: DiagnosticScope): LayoutBox {
  const value = contentText(element.content, context.data, context, scope)
  const issue = checkBarCodeValue(element.format, value)
  if (issue !== undefined)
    context.report('barCode.invalidValue', scope, barCodeIssueParams(element.format, issue))
  return {
    ...boxBase(element, region),
    kind: 'barCode',
    format: element.format,
    value,
    showText: element.showText,
    textStyle: element.textStyle,
    color: element.color,
    rotation: element.rotation,
  }
}

function layoutMatrixCode(element: MatrixCodeElement, region: ElementRegion, context: LayoutContext, scope: DiagnosticScope): LayoutBox {
  const value = contentText(element.content, context.data, context, scope)
  const level = matrixCodeLevelFit(element.format, element.level) === 'valid' ? element.level : undefined
  const issue = checkMatrixCodeContent(element.format, value, level)
  if (issue !== undefined)
    context.report('matrixCode.invalidValue', scope, matrixCodeIssueParams(element.format, issue))
  const box: LayoutBox = {
    ...boxBase(element, region),
    kind: 'matrixCode',
    format: element.format,
    value,
    color: element.color,
    quietZone: element.quietZone,
    rotation: element.rotation,
  }
  if (level !== undefined)
    box.level = level
  if (element.background !== undefined)
    box.background = element.background
  return box
}

/** 为页码元素生成布局盒，文字在页码确定后由 `fillPageNumber` 填入。 */
export function pageNumberBox(element: PageNumberElement, region: ElementRegion): TextLayoutBox {
  const box: TextLayoutBox = {
    ...boxBase(element, region),
    kind: 'text',
    lines: [],
    style: element.style,
    overflow: 'clip',
    rotation: 0,
  }
  if (element.box !== undefined)
    box.box = element.box
  return box
}

/** 按页码填入页码布局盒的文字。 */
export function fillPageNumber(
  box: TextLayoutBox,
  element: PageNumberElement,
  numbers: { current: number, total: number },
  context: LayoutContext,
): void {
  const padding = paddingOf(element)
  const text = formatPageNumber(element.format, numbers)
  box.lines = measureText(context, text, element.style, element.width - padding.left - padding.right, false).lines
}

/** 为不跨页的元素生成布局盒，坐标为设计坐标；页码与跨页元素另行处理。 */
export function layoutFixedElement(
  element: Exclude<PrintElement, { type: 'table' | 'longText' | 'pageNumber' }>,
  region: ElementRegion,
  context: LayoutContext,
  scope: DiagnosticScope,
): LayoutBox {
  switch (element.type) {
    case 'text':
      return layoutText(element, region, context, scope)
    case 'image':
      return layoutImage(element, region, context, scope)
    case 'barCode':
      return layoutBarCode(element, region, context, scope)
    case 'matrixCode':
      return layoutMatrixCode(element, region, context, scope)
    case 'line':
      return { ...boxBase(element, region), kind: 'line', direction: element.direction, stroke: element.stroke }
    case 'rect': {
      const box: LayoutBox = { ...boxBase(element, region), kind: 'rect', radius: element.radius, rotation: element.rotation }
      if (element.stroke !== undefined)
        box.stroke = element.stroke
      if (element.fill !== undefined)
        box.fill = element.fill
      return box
    }
    case 'ellipse': {
      const box: LayoutBox = { ...boxBase(element, region), kind: 'ellipse', rotation: element.rotation }
      if (element.stroke !== undefined)
        box.stroke = element.stroke
      if (element.fill !== undefined)
        box.fill = element.fill
      return box
    }
  }
}
