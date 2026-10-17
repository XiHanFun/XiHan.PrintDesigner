/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath, JsonValue } from '@xihan-ui/core/json'
import type { Rect, Size } from '@xihan-ui/designer-kit'
import type { PropertyControl as KitPropertyControl, PropertyDescriptor as KitPropertyDescriptor } from '@xihan-ui/designer-kit/properties'
import type { ElementBase, ExtensionElement, PrintElement, PrintElementOf, PrintElementType } from '../schema/elements'
import type { ElementRegion } from '../traverse'
import type { ExtensionIssueCode, IssueParams, ValidationIssueCode } from '../validation/issues'

/** 内置的物料分组，按面板中的显示顺序；扩展自定的分组排在它们之后。 */
export const ELEMENT_CATEGORIES = ['text', 'media', 'data', 'shape', 'code'] as const

/** 内置的物料分组：文字、图片、数据、图形、条码。 */
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number]

/** 元素与表格部位的属性分组取值，按面板中的显示顺序。 */
export const PROPERTY_GROUPS = ['layout', 'content', 'data', 'text', 'table', 'code', 'appearance', 'behavior'] as const

/** 页面设置的属性分组取值，按面板中的显示顺序。 */
export const PAGE_PROPERTY_GROUPS = ['page', 'paper', 'bands', 'numbering', 'watermark'] as const

/**
 * 属性面板分组：元素与表格部位用布局、内容、数据、文字、表格、条码、外观、行为，
 * 页面设置用页面、纸张、页眉页脚、页码、水印。
 */
export type PropertyGroup = (typeof PROPERTY_GROUPS)[number] | (typeof PAGE_PROPERTY_GROUPS)[number]

/** 数值属性的单位：mm、pt、角度、倍数或个数。 */
export type PropertyUnit = 'mm' | 'pt' | 'deg' | 'ratio' | 'count'

/** 数值属性：designer-kit 的 number 编辑方式，单位取打印的单位。 */
export type NumberControl = Extract<KitPropertyControl, { kind: 'number' }> & { readonly unit: PropertyUnit }

/** 四边距离：designer-kit 的 sides 编辑方式，单位取打印的单位。 */
export type SidesControl = Extract<KitPropertyControl, { kind: 'sides' }> & { readonly unit: PropertyUnit }

/**
 * 属性编辑方式：@xihan-ui/designer-kit/properties 的内建编辑方式（数值的单位取打印的单位），
 * 加上打印专属的复合类型；复合类型由设计器提供对应的专用编辑器。
 */
export type PropertyControl
  = | Exclude<KitPropertyControl, { kind: 'number' | 'sides' }>
    | NumberControl
    | SidesControl
    | { kind: 'textContent' }
    | { kind: 'richTextContent' }
    | { kind: 'imageSource' }
    | { kind: 'valueFormat' }
    | { kind: 'stroke' }
    | { kind: 'borderSides' }
    | { kind: 'cellStyle' }
    | { kind: 'tableColumns' }
    | { kind: 'tableFooterRows' }
    | { kind: 'pageNumberFormat' }
    | { kind: 'matrixCodeLevel' }
    | { kind: 'paper' }
    | { kind: 'watermark' }
    | { kind: 'cellContent' }
    | { kind: 'footerCellContent' }

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
export type ElementDefaults<TElement extends ElementBase<string>> = Omit<TElement, 'id' | 'x' | 'y'>

/** 元素原型：一种元素的默认值、尺寸约束、可编辑属性与专属行为。 */
export interface ElementPrototype<TElement extends ElementBase<string> = PrintElement> {
  type: TElement['type']
  /** 物料分组：内置分组（ElementCategory）之一，或扩展自定的分组名。 */
  category: string
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
  /**
   * 排版：给出画在元素框里的数据，交给运行时层同一类型的渲染。只有扩展元素用它，内置元素的排版在 core 里；
   * 返回值要是 JSON，元素框（位置与尺寸）由 core 按元素填好。
   */
  layout?: (element: TElement, context: ElementLayoutContext) => JsonValue
}

/** 扩展元素排版时拿到的上下文。 */
export interface ElementLayoutContext {
  /** 绑定的数据；设计态是示例数据或占位数据。 */
  readonly data: unknown
  readonly region: ElementRegion
  /** 按字段路径（formatJsonPath 的写法）读数据里的值，读不到时为 undefined。 */
  readonly field: (path: string) => unknown
}

/** 元素专属规则的校验上下文。 */
export interface ElementValidationContext {
  /** 元素所在区域。 */
  region: ElementRegion
  /** 按 default 页眉页脚算出的正文区；页面几何不合法时为 undefined。 */
  bodyRect?: Rect
  /** 记录问题，路径相对元素。 */
  report: (code: ValidationIssueCode | ExtensionIssueCode, path?: JsonPath, params?: IssueParams) => void
}

/** 扩展元素的原型：不跨页，必须给出 layout。 */
export interface ExtensionElementPrototype extends ElementPrototype<ExtensionElement> {
  flow: false
  layout: (element: ExtensionElement, context: ElementLayoutContext) => JsonValue
}

/** 任一元素的原型：内置元素的，或扩展元素的。 */
export type AnyElementPrototype = { [TType in PrintElementType]: ElementPrototype<PrintElementOf<TType>> }[PrintElementType] | ExtensionElementPrototype
