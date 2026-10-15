/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect } from '@xihan-ui/designer-kit'
import type { PropertyCondition } from '@xihan-ui/designer-kit/properties'
import type { Stroke, TextStyle } from '../schema/common'
import type {
  BarCodeElement,
  EllipseElement,
  ImageElement,
  LineElement,
  LongTextElement,
  MatrixCodeElement,
  PageNumberElement,
  RectElement,
  TableElement,
  TextElement,
} from '../schema/elements'
import type { CellStyle, TableColumn } from '../schema/table'
import type { AnyElementPrototype, ElementPrototype } from './types'
import { NUMERAL_STYLES } from '@xihan-ui/expression'
import { BAR_CODE_FORMATS, MATRIX_CODE_FORMATS } from '@xihan-ui/headless'
import {
  IMAGE_FITS,
  LINE_DIRECTIONS,
  TABLE_ROW_HEIGHT_MODES,
  TEXT_OVERFLOWS,
} from '../schema/options'
import {
  validateBarCodeRules,
  validateLineRules,
  validateMatrixCodeRules,
  validateShapeRules,
  validateTableRules,
} from '../validation/element-rules'
import { behaviorProperties, boxProperties, choices, layoutProperties, property, textStyleProperties } from './properties'

function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontSize: 10.5,
    bold: false,
    italic: false,
    underline: false,
    lineThrough: false,
    color: '#000000',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  }
}

function defaultCellStyle(overrides: Partial<CellStyle> = {}): CellStyle {
  return {
    fontSize: 10.5,
    bold: false,
    italic: false,
    color: '#000000',
    verticalAlign: 'middle',
    padding: 1,
    lineHeight: 4.5,
    ...overrides,
  }
}

function defaultStroke(width: number): Stroke {
  return { width, style: 'solid', color: '#000000' }
}

function defaultColumn(index: number, width: number): TableColumn {
  return {
    id: `col-${index}`,
    title: '',
    width,
    align: 'left',
    content: { kind: 'field', field: '' },
    cellType: 'text',
  }
}

/** 按新的总宽度等比缩放列宽，末列吸收舍入误差；原列宽合计不为正时均分。 */
export function scaleTableColumns(columns: readonly TableColumn[], totalWidth: number): TableColumn[] {
  if (columns.length === 0)
    return []
  const sum = columns.reduce((acc, column) => acc + column.width, 0)
  const widths = sum > 0
    ? columns.map(column => column.width / sum * totalWidth)
    : columns.map(() => totalWidth / columns.length)
  const head = widths.slice(0, -1).reduce((acc, width) => acc + width, 0)
  widths[widths.length - 1] = totalWidth - head
  return columns.map((column, index) => ({ ...column, width: widths[index] ?? column.width }))
}

function resizeTable(element: TableElement, bounds: Rect): TableElement {
  const next: TableElement = { ...element, ...bounds }
  if (bounds.width !== element.width)
    next.columns = scaleTableColumns(element.columns, bounds.width)
  return next
}

function textPrototype(): ElementPrototype<TextElement> {
  return {
    type: 'text',
    category: 'text',
    order: 1,
    flow: false,
    minSize: { width: 1, height: 1 },
    defaults: {
      type: 'text',
      width: 60,
      height: 8,
      content: { kind: 'static', text: '' },
      style: defaultTextStyle({ verticalAlign: 'middle' }),
      wrap: false,
      overflow: 'clip',
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['content'], 'content', { kind: 'textContent' }),
      ...textStyleProperties(),
      property(['wrap'], 'text', { kind: 'boolean' }),
      property(['overflow'], 'text', { kind: 'select', options: choices(TEXT_OVERFLOWS) }),
      ...boxProperties(),
      ...behaviorProperties(),
    ],
  }
}

function longTextPrototype(): ElementPrototype<LongTextElement> {
  return {
    type: 'longText',
    category: 'text',
    order: 2,
    flow: true,
    minSize: { width: 5, height: 3 },
    defaults: {
      type: 'longText',
      width: 120,
      height: 20,
      content: { kind: 'static', text: '' },
      style: defaultTextStyle({ lineHeight: 1.5 }),
    },
    properties: [
      ...layoutProperties({ rotation: false }),
      property(['content'], 'content', { kind: 'textContent' }),
      ...textStyleProperties(),
      ...boxProperties(),
      ...behaviorProperties(),
    ],
  }
}

function pageNumberPrototype(): ElementPrototype<PageNumberElement> {
  return {
    type: 'pageNumber',
    category: 'text',
    order: 3,
    flow: false,
    minSize: { width: 1, height: 1 },
    defaults: {
      type: 'pageNumber',
      width: 30,
      height: 6,
      format: '{{$page}}/{{$pages}}',
      style: defaultTextStyle({ fontSize: 9, align: 'center', verticalAlign: 'middle' }),
    },
    properties: [
      ...layoutProperties({ rotation: false }),
      property(['format'], 'content', { kind: 'pageNumberFormat' }),
      property(['numeral'], 'content', { kind: 'select', options: choices(NUMERAL_STYLES) }, { optional: true }),
      ...textStyleProperties(),
      ...boxProperties(),
      ...behaviorProperties(),
    ],
  }
}

function imagePrototype(): ElementPrototype<ImageElement> {
  return {
    type: 'image',
    category: 'media',
    order: 1,
    flow: false,
    minSize: { width: 1, height: 1 },
    defaults: {
      type: 'image',
      width: 40,
      height: 30,
      source: { kind: 'static', url: '' },
      fit: 'contain',
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['source'], 'content', { kind: 'imageSource' }),
      property(['fit'], 'appearance', { kind: 'select', options: choices(IMAGE_FITS) }),
      ...boxProperties(),
      ...behaviorProperties(),
    ],
  }
}

function tablePrototype(): ElementPrototype<TableElement> {
  const visible: PropertyCondition = { path: ['header', 'visible'], equals: true }
  return {
    type: 'table',
    category: 'data',
    order: 1,
    flow: true,
    minSize: { width: 10, height: 5 },
    defaults: {
      type: 'table',
      width: 180,
      height: 22,
      dataField: '',
      columns: [defaultColumn(1, 60), defaultColumn(2, 60), defaultColumn(3, 60)],
      header: {
        visible: true,
        repeat: true,
        height: 8,
        style: defaultCellStyle({ bold: true, align: 'center' }),
      },
      body: {
        rowHeight: 7,
        rowHeightMode: 'fixed',
        style: defaultCellStyle(),
      },
      footerRows: [],
      fillEmptyRows: false,
      border: { stroke: defaultStroke(0.2), outer: true, horizontal: true, vertical: true },
    },
    properties: [
      ...layoutProperties({ rotation: false }),
      property(['dataField'], 'data', { kind: 'field', target: 'list' }),
      property(['columns'], 'table', { kind: 'tableColumns' }),
      property(['header', 'visible'], 'table', { kind: 'boolean' }),
      property(['header', 'repeat'], 'table', { kind: 'boolean' }, { visibleWhen: visible }),
      property(['header', 'height'], 'table', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }, { visibleWhen: visible }),
      property(['header', 'style'], 'table', { kind: 'cellStyle' }, { visibleWhen: visible }),
      property(['body', 'rowHeight'], 'table', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }),
      property(['body', 'rowHeightMode'], 'table', { kind: 'select', options: choices(TABLE_ROW_HEIGHT_MODES) }),
      property(['body', 'style'], 'table', { kind: 'cellStyle' }),
      property(['footerRows'], 'table', { kind: 'tableFooterRows' }),
      property(['maxRowsPerPage'], 'table', { kind: 'number', unit: 'count', min: 1, step: 1, integer: true }, { optional: true }),
      property(['fillEmptyRows'], 'table', { kind: 'boolean' }),
      property(['border', 'stroke'], 'appearance', { kind: 'stroke' }),
      property(['border', 'outer'], 'appearance', { kind: 'boolean' }),
      property(['border', 'horizontal'], 'appearance', { kind: 'boolean' }),
      property(['border', 'vertical'], 'appearance', { kind: 'boolean' }),
      ...behaviorProperties(),
    ],
    resize: resizeTable,
    validate: validateTableRules,
  }
}

function linePrototype(): ElementPrototype<LineElement> {
  return {
    type: 'line',
    category: 'shape',
    order: 1,
    flow: false,
    minSize: { width: 0, height: 0 },
    defaults: {
      type: 'line',
      width: 80,
      height: 0,
      direction: 'horizontal',
      stroke: defaultStroke(0.3),
    },
    properties: [
      ...layoutProperties({ rotation: false }),
      property(['direction'], 'appearance', { kind: 'select', options: choices(LINE_DIRECTIONS) }),
      property(['stroke'], 'appearance', { kind: 'stroke' }),
      ...behaviorProperties(),
    ],
    validate: validateLineRules,
  }
}

function rectPrototype(): ElementPrototype<RectElement> {
  return {
    type: 'rect',
    category: 'shape',
    order: 2,
    flow: false,
    minSize: { width: 1, height: 1 },
    defaults: {
      type: 'rect',
      width: 40,
      height: 20,
      stroke: defaultStroke(0.3),
      radius: 0,
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['stroke'], 'appearance', { kind: 'stroke' }, { optional: true }),
      property(['fill'], 'appearance', { kind: 'color' }, { optional: true }),
      property(['radius'], 'appearance', { kind: 'number', unit: 'mm', min: 0, step: 0.1 }),
      ...behaviorProperties(),
    ],
    validate: validateShapeRules,
  }
}

function ellipsePrototype(): ElementPrototype<EllipseElement> {
  return {
    type: 'ellipse',
    category: 'shape',
    order: 3,
    flow: false,
    minSize: { width: 1, height: 1 },
    defaults: {
      type: 'ellipse',
      width: 30,
      height: 20,
      stroke: defaultStroke(0.3),
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['stroke'], 'appearance', { kind: 'stroke' }, { optional: true }),
      property(['fill'], 'appearance', { kind: 'color' }, { optional: true }),
      ...behaviorProperties(),
    ],
    validate: validateShapeRules,
  }
}

function barCodePrototype(): ElementPrototype<BarCodeElement> {
  const showText: PropertyCondition = { path: ['showText'], equals: true }
  return {
    type: 'barCode',
    category: 'code',
    order: 1,
    flow: false,
    minSize: { width: 5, height: 3 },
    defaults: {
      type: 'barCode',
      width: 50,
      height: 15,
      format: 'code128',
      content: { kind: 'static', text: '1234567890' },
      showText: true,
      textStyle: { fontSize: 9 },
      color: '#000000',
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['format'], 'code', { kind: 'select', options: choices(BAR_CODE_FORMATS) }),
      property(['content'], 'content', { kind: 'textContent' }),
      property(['showText'], 'code', { kind: 'boolean' }),
      property(['textStyle', 'fontFamily'], 'code', { kind: 'text' }, { optional: true, visibleWhen: showText }),
      property(['textStyle', 'fontSize'], 'code', { kind: 'number', unit: 'pt', exclusiveMin: 0, max: 100, step: 0.5 }, { visibleWhen: showText }),
      property(['color'], 'appearance', { kind: 'color' }),
      ...behaviorProperties(),
    ],
    validate: validateBarCodeRules,
  }
}

function matrixCodePrototype(): ElementPrototype<MatrixCodeElement> {
  return {
    type: 'matrixCode',
    category: 'code',
    order: 2,
    flow: false,
    minSize: { width: 5, height: 5 },
    defaults: {
      type: 'matrixCode',
      width: 25,
      height: 25,
      format: 'qr',
      content: { kind: 'static', text: '1234567890' },
      level: 'M',
      color: '#000000',
      quietZone: 1,
      rotation: 0,
    },
    properties: [
      ...layoutProperties({ rotation: true }),
      property(['content'], 'content', { kind: 'textContent' }),
      property(['format'], 'code', { kind: 'select', options: choices(MATRIX_CODE_FORMATS) }),
      property(['level'], 'code', { kind: 'matrixCodeLevel' }, { optional: true }),
      property(['quietZone'], 'code', { kind: 'number', unit: 'count', min: 0, max: 20, step: 1, integer: true }),
      property(['color'], 'appearance', { kind: 'color' }),
      property(['background'], 'appearance', { kind: 'color' }, { optional: true }),
      ...behaviorProperties(),
    ],
    validate: validateMatrixCodeRules,
  }
}

/** 生成全部内置元素原型，每次调用返回互不共享的新对象。 */
export function createBuiltinElementPrototypes(): AnyElementPrototype[] {
  return [
    textPrototype(),
    longTextPrototype(),
    pageNumberPrototype(),
    imagePrototype(),
    tablePrototype(),
    linePrototype(),
    rectPrototype(),
    ellipsePrototype(),
    barCodePrototype(),
    matrixCodePrototype(),
  ]
}
