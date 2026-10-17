/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonValue } from '@xihan-ui/core/json'
import type { PrintElementOf, PrintElementType } from '../schema/elements'
import type { AnyElementPrototype, ElementDefaults, ElementPrototype } from './types'
import { cloneJson } from '@xihan-ui/core/json'
import { createBuiltinElementPrototypes } from './builtins'
import { ELEMENT_CATEGORIES } from './types'

/** 创建元素的参数。 */
export interface CreateElementInit<TType extends PrintElementType> {
  id: string
  x: number
  y: number
  /** 覆盖默认值的顶层属性。 */
  overrides?: Partial<Omit<ElementDefaults<PrintElementOf<TType>>, 'type'>>
}

/** 物料面板中的一个分组。 */
export interface ElementCategoryGroup {
  category: string
  prototypes: AnyElementPrototype[]
}

/** 元素类型登记表。 */
export interface ElementRegistry {
  /** 全部原型，按物料分组顺序、再按组内顺序排列；内置分组在前，扩展的分组按首次登记的顺序在后。 */
  readonly prototypes: readonly AnyElementPrototype[]
  /** 按类型取原型。 */
  get: (<TType extends PrintElementType>(type: TType) => ElementPrototype<PrintElementOf<TType>> | undefined)
    & ((type: string) => AnyElementPrototype | undefined)
  /** 判断类型是否已登记。 */
  has: (type: string) => boolean
  /** 按物料分组列出原型，分组顺序同 prototypes，跳过没有原型的分组。 */
  groupByCategory: () => ElementCategoryGroup[]
  /** 按原型默认值创建元素；类型未登记时抛出错误。 */
  createElement: <TType extends PrintElementType>(type: TType, init: CreateElementInit<TType>) => PrintElementOf<TType>
}

/** 创建元素类型登记表，默认登记全部内置元素；类型重复时抛出错误。 */
export function createElementRegistry(
  prototypes: readonly AnyElementPrototype[] = createBuiltinElementPrototypes(),
): ElementRegistry {
  const byType = new Map<string, AnyElementPrototype>()
  for (const prototype of prototypes) {
    if (byType.has(prototype.type))
      throw new Error(`Duplicate element prototype: ${prototype.type}`)
    byType.set(prototype.type, prototype)
  }

  const categories = [...new Set<string>([...ELEMENT_CATEGORIES, ...prototypes.map(prototype => prototype.category)])]
  const sorted = [...prototypes].sort((a, b) =>
    categories.indexOf(a.category) - categories.indexOf(b.category) || a.order - b.order,
  )

  const get = ((type: string) => byType.get(type)) as ElementRegistry['get']

  return {
    prototypes: sorted,
    get,
    has: type => byType.has(type),
    groupByCategory: () => categories
      .map(category => ({ category, prototypes: sorted.filter(prototype => prototype.category === category) }))
      .filter(group => group.prototypes.length > 0),
    createElement: (type, init) => {
      const prototype = byType.get(type)
      if (prototype === undefined)
        throw new Error(`Unknown element type: ${type}`)
      const fixed = { id: init.id, type, x: init.x, y: init.y }
      const element = Object.assign({ ...fixed }, cloneJson(prototype.defaults as unknown as JsonValue), cloneJson((init.overrides ?? {}) as JsonValue), fixed)
      return element as unknown as PrintElementOf<typeof type>
    },
  }
}
