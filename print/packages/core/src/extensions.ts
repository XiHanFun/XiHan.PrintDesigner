/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 按实例传入的扩展在 core 层的部分：元素原型、编辑方式与校验规则；内置元素也写成一个扩展。

import type { DesignerExtensionCore, ExtensionKeySpaces } from '@xihan-ui/designer-kit'
import type { ControlKind } from '@xihan-ui/designer-kit/properties'
import type { ElementRegistry } from './registry/registry'
import type { AnyElementPrototype } from './registry/types'
import type { PrintDocument } from './schema/document'
import { extensionControls, mergeExtensions } from '@xihan-ui/designer-kit'
import { createBuiltinElementPrototypes } from './registry/builtins'
import { createElementRegistry } from './registry/registry'

/** 规则拿到的上下文：合并后的元素登记表。 */
export interface PrintRuleContext {
  readonly elements: ElementRegistry
}

/**
 * 打印 core 层的扩展：元素原型、编辑方式与校验规则。
 * 运行时层与设计器层的扩展在它之上再加渲染、属性编辑器、命令与面板，core 函数只读这里的字段。
 */
export interface PrintCoreExtension extends DesignerExtensionCore<PrintDocument, PrintRuleContext> {
  /** 元素种类，类型名不能与内置的或别的扩展重名；扩展的元素不跨页，要给出 layout。 */
  readonly elements?: readonly AnyElementPrototype[]
}

/** 内置扩展的 id。 */
export const PRINT_CORE_EXTENSION_ID = '@xihan-print/core'

/** 内置扩展：全部内置元素。 */
export const PRINT_CORE_EXTENSION: PrintCoreExtension = {
  id: PRINT_CORE_EXTENSION_ID,
  elements: /* @__PURE__ */ createBuiltinElementPrototypes(),
}

/** 打印各层扩展共用的名字空间：元素类型。 */
export const PRINT_EXTENSION_SPACES: ExtensionKeySpaces<PrintCoreExtension> = {
  'element-type': extension => (extension.elements ?? []).map(prototype => prototype.type),
}

/** 一组扩展合出的打印模型：元素登记表与编辑方式。 */
export interface PrintModel {
  /** 内置扩展在前，传入的按顺序在后。 */
  readonly extensions: readonly PrintCoreExtension[]
  readonly elements: ElementRegistry
  readonly controls: Readonly<Record<string, ControlKind>>
}

const MODELS = new WeakMap<readonly PrintCoreExtension[], PrintModel>()
const NO_EXTENSIONS: readonly PrintCoreExtension[] = []

/**
 * 合出打印模型：内置扩展 PRINT_CORE_EXTENSION 在前，extensions 按顺序在后。扩展 id、元素类型、编辑方式等重名时
 * 抛 DesignerExtensionError；扩展的元素没给 layout 或要跨页时抛 TypeError。同一个数组只合一次：元素把同一份 extensions 交给各个 core 函数时不重复合并。
 */
export function createPrintModel(extensions: readonly PrintCoreExtension[] = NO_EXTENSIONS): PrintModel {
  const cached = MODELS.get(extensions)
  if (cached)
    return cached
  const list = mergeExtensions([PRINT_CORE_EXTENSION], extensions, PRINT_EXTENSION_SPACES)
  for (const extension of extensions) {
    for (const prototype of extension.elements ?? []) {
      if (prototype.flow || typeof prototype.layout !== 'function')
        throw new TypeError(`[xh-print] 扩展 ${extension.id} 的元素 ${prototype.type} 要给出 layout，且不能跨页（flow 为 false）`)
    }
  }
  const model: PrintModel = {
    extensions: list,
    elements: createElementRegistry(list.flatMap(extension => extension.elements ?? [])),
    controls: extensionControls(list),
  }
  MODELS.set(extensions, model)
  return model
}
