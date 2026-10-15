/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPathSegment, JsonValue } from '@xihan-ui/core/json'
import type { OperationResult as KitOperationResult, Rect } from '@xihan-ui/designer-kit'
import type { PageBand, PrintDocument, PrintPage } from '../schema/document'
import type { PrintElement } from '../schema/elements'
import type { PageBandVariant } from '../schema/options'
import type { ElementContainerRef } from '../traverse'

/** 一处属性修改。 */
export interface PropertyChange {
  /** 相对被修改对象的属性路径。 */
  path: readonly JsonPathSegment[]
  /** 新值；省略或为 undefined 表示删除该属性。 */
  value?: JsonValue
}

/** 层级调整目标：最上层、最下层、上移一层、下移一层，或容器内的目标下标。 */
export type ReorderTarget = 'front' | 'back' | 'forward' | 'backward' | number

/** 向容器添加元素，`index` 缺省时放在最上层。 */
export interface AddElementOperation {
  type: 'addElement'
  container: ElementContainerRef
  element: PrintElement
  index?: number
}

/** 删除元素。 */
export interface RemoveElementOperation {
  type: 'removeElement'
  id: string
}

/** 修改元素属性；不能修改 `id` 与 `type`。 */
export interface UpdateElementOperation {
  type: 'updateElement'
  id: string
  changes: PropertyChange[]
}

/** 平移一组元素，单位 mm。 */
export interface MoveElementsOperation {
  type: 'moveElements'
  ids: string[]
  dx: number
  dy: number
}

/** 把元素缩放到新的元素框，元素原型可附带专属缩放行为。 */
export interface ResizeElementOperation {
  type: 'resizeElement'
  id: string
  bounds: Rect
}

/** 调整元素在容器内的层级。 */
export interface ReorderElementOperation {
  type: 'reorderElement'
  id: string
  to: ReorderTarget
}

/** 添加页面模板，`index` 缺省时放在末尾。 */
export interface AddPageOperation {
  type: 'addPage'
  page: PrintPage
  index?: number
}

/** 删除页面模板。 */
export interface RemovePageOperation {
  type: 'removePage'
  pageId: string
}

/** 移动页面模板到目标下标。 */
export interface MovePageOperation {
  type: 'movePage'
  pageId: string
  index: number
}

/**
 * 修改页面设置：名称、纸张、方向、边距、页码规则、水印、宿主附加数据，
 * 以及页眉页脚的 `singleSheet` 和已有带区的 `height`。
 */
export interface UpdatePageOperation {
  type: 'updatePage'
  pageId: string
  changes: PropertyChange[]
}

/** 为页眉或页脚添加变体带区。 */
export interface AddBandOperation {
  type: 'addBand'
  pageId: string
  region: 'header' | 'footer'
  variant: PageBandVariant
  band: PageBand
}

/** 删除页眉或页脚的变体带区及其中的元素。 */
export interface RemoveBandOperation {
  type: 'removeBand'
  pageId: string
  region: 'header' | 'footer'
  variant: PageBandVariant
}

/** 修改文档属性；不能修改 `schemaVersion` 与 `pages`。 */
export interface UpdateDocumentOperation {
  type: 'updateDocument'
  changes: PropertyChange[]
}

/** 编辑操作。 */
export type PrintOperation
  = | AddElementOperation
    | RemoveElementOperation
    | UpdateElementOperation
    | MoveElementsOperation
    | ResizeElementOperation
    | ReorderElementOperation
    | AddPageOperation
    | RemovePageOperation
    | MovePageOperation
    | UpdatePageOperation
    | AddBandOperation
    | RemoveBandOperation
    | UpdateDocumentOperation

/** 编辑操作的种类。 */
export type PrintOperationType = PrintOperation['type']

/**
 * 操作结果，即 @xihan-ui/designer-kit 的 OperationResult：新文档，以及按顺序作用于新文档即可还原出传入文档的逆操作。
 * 操作没有带来变化时 `document` 就是传入的文档，`inverse` 为空数组。
 */
export type OperationResult = KitOperationResult<PrintDocument, PrintOperation>
