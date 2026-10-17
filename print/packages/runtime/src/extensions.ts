/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 运行时层的扩展：在 core 层之上加扩展元素的渲染，预览、打印与设计器的画布都读它。

import type { ExtensionLayoutBox, PrintCoreExtension, PrintModel } from '@xihan-print/core'
import { createPrintModel } from '@xihan-print/core'
import { DesignerExtensionError } from '@xihan-ui/designer-kit'

/** 渲染扩展元素时拿到的上下文。 */
export interface PrintElementRenderContext {
  /** 输出页所在的文档：预览是页面本身，打印是另一份文档，节点都要从它建。 */
  readonly document: Document
}

/**
 * 扩展元素的渲染：按布局盒建出画在元素框里的节点，元素框的位置、尺寸与只预览标记由运行时摆好。
 * 只用标准 HTML 与 SVG：打印用的文档里自定义元素不会升级。
 */
export type PrintElementRenderer = (box: ExtensionLayoutBox, context: PrintElementRenderContext) => Element

/** 打印运行时层的扩展：core 层的全部字段，加上扩展元素的渲染。 */
export interface PrintRuntimeExtension extends PrintCoreExtension {
  /** 扩展元素的渲染，键是元素类型；没给渲染的类型画成占位。 */
  readonly renderers?: Readonly<Record<string, PrintElementRenderer>>
}

/** 运行时用的打印模型：core 的模型加上各元素类型的渲染。 */
export interface PrintRuntimeModel extends PrintModel {
  readonly renderers: ReadonlyMap<string, PrintElementRenderer>
}

const MODELS = new WeakMap<readonly PrintRuntimeExtension[], PrintRuntimeModel>()
const NO_EXTENSIONS: readonly PrintRuntimeExtension[] = []

/** 合出运行时用的打印模型；同一元素类型在两个扩展里都给了渲染时抛 DesignerExtensionError。同一个数组只合一次。 */
export function createPrintRuntimeModel(extensions: readonly PrintRuntimeExtension[] = NO_EXTENSIONS): PrintRuntimeModel {
  const cached = MODELS.get(extensions)
  if (cached)
    return cached
  const model = createPrintModel(extensions)
  const renderers = new Map<string, PrintElementRenderer>()
  const owners = new Map<string, string>()
  for (const extension of model.extensions as readonly PrintRuntimeExtension[]) {
    for (const [type, renderer] of Object.entries(extension.renderers ?? {})) {
      const previous = owners.get(type)
      if (previous !== undefined)
        throw new DesignerExtensionError('element-renderer', type, [previous, extension.id])
      owners.set(type, extension.id)
      renderers.set(type, renderer)
    }
  }
  const runtime: PrintRuntimeModel = { ...model, renderers }
  MODELS.set(extensions, runtime)
  return runtime
}
