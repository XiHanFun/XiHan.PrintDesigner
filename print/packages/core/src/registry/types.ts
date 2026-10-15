/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath } from '@xihan-ui/core/json'
import type { Rect, Size } from '@xihan-ui/designer-kit'
import type { PropertyControl as KitPropertyControl, PropertyDescriptor as KitPropertyDescriptor } from '@xihan-ui/designer-kit/properties'
import type { PrintElement, PrintElementOf, PrintElementType } from '../schema/elements'
import type { ElementRegion } from '../traverse'
import type { IssueParams, ValidationIssueCode } from '../validation/issues'

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

/** 数值属性：designer-kit 的 number 编辑方式，单位取打印的单位。 */
export type NumberControl = Extract<KitPropertyControl, { kind: 'number' }> & { readonly unit: PropertyUnit }

/**
 * 属性编辑方式：@xihan-ui/designer-kit/properties 的内建编辑方式（数值的单位取打印的单位），
 * 加上打印专属的复合类型；复合类型由设计器提供对应的专用编辑器。
 */
export type PropertyControl
  = | Exclude<KitPropertyControl, { kind: 'number' }>
    | NumberControl
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
    | { kind: 'matrixCodeLevel' }

/** 属性编辑方式的种类。 */
export type PropertyControlKind = PropertyControl['kind']

/**
 * 可编辑属性描述：@xihan-ui/designer-kit/properties 的 PropertyDescriptor，path 相对元素；
 * 分组总是给出，显示条件写在 visibleWhen；required（显示时必须填写）不用，空值由打印自己的规则报告。
 */
export interface PropertyDescriptor extends KitPropertyDescriptor<PropertyControl> {
  readonly group: PropertyGroup
  /** 元素上是否必须有该属性（结构上的必备，与是否填写无关）。 */
  readonly present: boolean
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
  /** 校验通用属性之外的元素专属规则；只在元素的结构校验没有 error 时调用。 */
  validate?: (element: TElement, context: ElementValidationContext) => void
}

/** 元素专属规则的校验上下文。 */
export interface ElementValidationContext {
  /** 元素所在区域。 */
  region: ElementRegion
  /** 按 default 页眉页脚算出的正文区；页面几何不合法时为 undefined。 */
  bodyRect?: Rect
  /** 记录问题，路径相对元素。 */
  report: (code: ValidationIssueCode, path?: JsonPath, params?: IssueParams) => void
}

/** 任一内置元素的原型。 */
export type AnyElementPrototype = { [TType in PrintElementType]: ElementPrototype<PrintElementOf<TType>> }[PrintElementType]
