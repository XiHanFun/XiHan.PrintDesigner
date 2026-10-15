/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect } from '../geometry'
import type { JsonPrimitive } from '../json'
import type { Size } from '../paper'
import type { PrintElement, PrintElementOf, PrintElementType } from '../schema/elements'

/** 物料面板分组取值，按面板中的显示顺序。 */
export const ELEMENT_CATEGORIES = ['text', 'media', 'data', 'shape', 'code'] as const

/** 物料面板分组：文字、图片、数据、图形、条码。 */
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number]

/** 属性面板分组取值，按面板中的显示顺序。 */
export const PROPERTY_GROUPS = ['layout', 'content', 'data', 'text', 'table', 'code', 'appearance', 'behavior'] as const

/** 属性面板分组：布局、内容、数据、文字、表格、条码、外观、行为。 */
export type PropertyGroup = (typeof PROPERTY_GROUPS)[number]

/** 数值属性的单位：mm、pt、角度、倍数或个数。 */
export type PropertyUnit = 'mm' | 'pt' | 'deg' | 'ratio' | 'count'

/** 数值属性。 */
export interface NumberControl {
  kind: 'number'
  unit: PropertyUnit
  /** 下限（含）。 */
  min?: number
  /** 下限（不含）。 */
  exclusiveMin?: number
  /** 上限（含）。 */
  max?: number
  /** 编辑步长。 */
  step?: number
  /** 是否只接受整数。 */
  integer?: boolean
}

/** 属性编辑方式；复合类型由设计器提供对应的专用编辑器。 */
export type PropertyControl
  = | NumberControl
    | { kind: 'text', multiline?: boolean }
    | { kind: 'boolean' }
    | { kind: 'select', options: readonly string[] }
    | { kind: 'color' }
    | { kind: 'field', target: 'value' | 'list' }
    | { kind: 'textContent' }
    | { kind: 'imageSource' }
    | { kind: 'valueFormat' }
    | { kind: 'stroke' }
    | { kind: 'edges' }
    | { kind: 'borderSides' }
    | { kind: 'cellStyle' }
    | { kind: 'tableColumns' }
    | { kind: 'tableFooterRows' }
    | { kind: 'pageNumberFormat' }

/** 属性编辑方式的种类。 */
export type PropertyControlKind = PropertyControl['kind']

/** 属性显示条件：`path` 处的值等于 `equals` 中任一项时显示。 */
export interface PropertyCondition {
  path: readonly string[]
  equals: readonly JsonPrimitive[]
}

/** 可编辑属性描述。 */
export interface PropertyDescriptor {
  /** 属性相对元素的路径，同时作为属性面板文案的查找键。 */
  path: readonly string[]
  group: PropertyGroup
  control: PropertyControl
  /** 元素上是否必须有该属性。 */
  required: boolean
  /** 属性面板中显示该属性的条件，缺省总是显示。 */
  when?: PropertyCondition
}

/** 元素默认值：不含标识与坐标。 */
export type ElementDefaults<TElement extends PrintElement> = Omit<TElement, 'id' | 'x' | 'y'>

/** 元素原型：一种元素的默认值、尺寸约束、可编辑属性与专属行为。 */
export interface ElementPrototype<TElement extends PrintElement = PrintElement> {
  type: TElement['type']
  category: ElementCategory
  /** 在物料面板分组内的顺序，越小越靠前。 */
  order: number
  /** 是否随数据纵向延展并跨页续排；这类元素只能放在正文区。 */
  flow: boolean
  /** 宽高下限，单位 mm。 */
  minSize: Size
  defaults: ElementDefaults<TElement>
  properties: readonly PropertyDescriptor[]
  /** 按新元素框生成缩放后的元素，缺省直接替换坐标与宽高。 */
  resize?: (element: TElement, bounds: Rect) => TElement
}

/** 任一内置元素的原型。 */
export type AnyElementPrototype = { [TType in PrintElementType]: ElementPrototype<PrintElementOf<TType>> }[PrintElementType]
