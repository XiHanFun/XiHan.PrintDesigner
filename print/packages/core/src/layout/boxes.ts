/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { ElementLayoutContext } from '../registry/types'
import type { Edges, TextStyle } from '../schema/common'
import type {
  BarCodeElement,
  ExtensionElement,
  ImageElement,
  MatrixCodeElement,
  PageNumberElement,
  PrintElement,
  TextElement,
} from '../schema/elements'
import type { ElementRegion } from '../traverse'
import type { DiagnosticScope, LayoutContext } from './context'
import type { ExtensionLayoutBox, LayoutBox, LayoutBoxBase, TextLayoutBox, TextMeasurement } from './types'
import { fillTextTemplate } from '@xihan-ui/core/template'
import { toSafeImageSource } from '@xihan-ui/core/url'
import { convertLength } from '@xihan-ui/designer-kit'
import { checkBarCodeValue, matrixCodeLevelFit } from '@xihan-ui/headless'
import { barCodeIssueParams, checkMatrixCodeContent, matrixCodeIssueParams } from '../codes'
import { getFieldValue } from '../data'
import { contentText, formatValue, reportValueResult, valueText } from './content'
import { LAYOUT_EPSILON } from './context'
import { layoutTextLines } from './text-measure'

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
export function boxBase(element: PrintElement | ExtensionElement, region: ElementRegion): LayoutBoxBase {
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

/** 按文本样式排文字：行高为字号（换成 mm）乘以行高倍数。 */
export function measureText(
  context: LayoutContext,
  text: string,
  style: Omit<TextStyle, 'align' | 'verticalAlign' | 'color' | 'underline' | 'lineThrough'>,
  maxWidth: number,
  wrap: boolean,
): TextMeasurement {
  const lineHeight = convertLength(style.fontSize, 'pt', 'mm') * style.lineHeight
  const { lines, width } = layoutTextLines(context.measurer, text, style, lineHeight, maxWidth, wrap)
  return { lines, width, height: lines.length * lineHeight }
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
  const raw = element.source.kind === 'static'
    ? element.source.url
    : valueText(getFieldValue(context.data, element.source.field), undefined, undefined, context, scope)
  const src = toSafeImageSource(raw) ?? ''
  if (src === '' && raw.trim().length > 0)
    context.report('image.unsafeSource', scope)
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

/** 页码按元素的数字字形转成文本；没有格式化器或转不了时用阿拉伯数字并给出诊断。 */
function pageNumberText(value: number, element: PageNumberElement, context: LayoutContext, scope: DiagnosticScope): string {
  if (element.numeral === undefined)
    return String(value)
  const result = formatValue(value, { kind: 'numeral', style: element.numeral }, context)
  return reportValueResult(context, scope, result)
}

/** 按页码填入页码布局盒的文字：页码模板里的 `$page` 与 `$pages` 换成当前页码与总页数。 */
export function fillPageNumber(
  box: TextLayoutBox,
  element: PageNumberElement,
  numbers: { current: number, total: number },
  context: LayoutContext,
  scope: DiagnosticScope,
): void {
  const padding = paddingOf(element)
  const values = { $page: pageNumberText(numbers.current, element, context, scope), $pages: pageNumberText(numbers.total, element, context, scope) }
  const { text } = fillTextTemplate(element.format, values)
  box.lines = measureText(context, text, element.style, element.width - padding.left - padding.right, false).lines
}

/** 扩展元素：按登记的原型的 layout 取数据；类型没登记（扩展被去掉）时数据为 null，渲染成占位。 */
function layoutExtension(element: ExtensionElement, region: ElementRegion, context: LayoutContext): ExtensionLayoutBox {
  const layout = context.elements.get(element.type)?.layout as ((element: ExtensionElement, context: ElementLayoutContext) => JsonValue) | undefined
  const data = layout === undefined
    ? null
    : layout(element, { data: context.data, region, field: path => getFieldValue(context.data, path) })
  return { ...boxBase(element, region), kind: 'extension', data }
}

/** 为不跨页的元素生成布局盒，坐标为设计坐标；页码与跨页元素另行处理，其余类型是扩展元素。 */
export function layoutFixedElement(
  element: Exclude<PrintElement, { type: 'table' | 'longText' | 'richText' | 'pageNumber' }>,
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
    default:
      return layoutExtension(element as unknown as ExtensionElement, region, context)
  }
}
