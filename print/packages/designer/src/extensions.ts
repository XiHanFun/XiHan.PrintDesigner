/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器层的扩展：在运行时层之上加属性编辑器、物料项与装上时的回调；设计器自带的编辑器也写成一个扩展。

import type { PrintDesignerTranslations, PrintRuntimeExtension, PrintRuntimeModel } from '@xihan-print/runtime'
import type { IconRecord } from '@xihan-ui/core'
import type { DesignerExtensionBase } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type { DesignerPropertyEditor } from '@xihan-ui/designer-shell'
import type { XhPrintDesigner } from './print-designer'
import { ELEMENT_CATEGORIES } from '@xihan-print/core'
import { createPrintRuntimeModel } from '@xihan-print/runtime'
import { DesignerExtensionError, extensionEditors } from '@xihan-ui/designer-kit'

/** 扩展装上时拿到的上下文。 */
export interface PrintDesignerContext {
  readonly designer: XhPrintDesigner
  /** 此刻生效的设计器文案。 */
  readonly translations: PrintDesignerTranslations
}

/** 物料面板里的一项：扩展元素的名称与图标。 */
export interface PrintPaletteEntry {
  /** 元素种类的名称，物料面板、画布与属性面板的可访问名、问题列表都用它；不给时显示类型名。 */
  readonly label?: string
  readonly icon?: IconRecord
}

/** 打印设计器层的扩展：运行时层的全部字段（元素种类、渲染、编辑方式与规则），加上属性编辑器、物料项与 setup。 */
export interface PrintDesignerExtension extends PrintRuntimeExtension, Pick<DesignerExtensionBase<PrintDesignerContext, DesignerPropertyEditor>, 'editors' | 'setup'> {
  /** 本扩展登记的元素的物料项，键是元素类型；只能给本扩展 elements 里的类型。 */
  readonly palette?: Readonly<Record<string, PrintPaletteEntry>>
  /** 本扩展新加的物料分组的名称，键是分组名；不能是内置分组，也不能与别的扩展重名。没给名称的分组显示分组名。 */
  readonly categories?: Readonly<Record<string, string>>
}

/** 设计器自带的扩展的 id：表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 */
export const PRINT_DESIGNER_EXTENSION_ID = '@xihan-print/designer'

/** 一组设计器扩展合出的东西：交给 core 函数与预览的列表、运行时的模型、属性编辑器表与物料项。 */
export interface PrintDesignerModel {
  /** 设计器自带的扩展在前、传入的在后；校验、分页与预览都拿这一份。 */
  readonly list: readonly PrintDesignerExtension[]
  /** 元素登记表、编辑方式与扩展元素的渲染。 */
  readonly runtime: PrintRuntimeModel
  /** 各扩展的属性编辑器按顺序合成一张，后面的压前面的。 */
  readonly editors: PropertyEditorTable<DesignerPropertyEditor>
  /** 扩展的元素类型 → 物料项。 */
  readonly palette: ReadonlyMap<string, PrintPaletteEntry>
  /** 扩展的物料分组 → 名称。 */
  readonly categories: ReadonlyMap<string, string>
}

/** 合出设计器用的模型；任何一处重名都抛 DesignerExtensionError，物料项给了别处登记的元素类型时抛 TypeError。 */
export function createPrintDesignerModel(builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): PrintDesignerModel {
  const list = [builtin, ...extensions]
  const runtime = createPrintRuntimeModel(list)
  const all = runtime.extensions as readonly PrintDesignerExtension[]
  const palette = new Map<string, PrintPaletteEntry>()
  const categories = new Map<string, string>()
  const owners = new Map<string, string>(ELEMENT_CATEGORIES.map(category => [category, 'builtin']))
  for (const extension of all) {
    const own = new Set((extension.elements ?? []).map(prototype => prototype.type))
    for (const [type, entry] of Object.entries(extension.palette ?? {})) {
      if (!own.has(type))
        throw new TypeError(`[xh-print] 扩展 ${extension.id} 的 palette 里的 ${type} 不是它自己登记的元素类型`)
      palette.set(type, entry)
    }
    for (const [category, label] of Object.entries(extension.categories ?? {})) {
      const previous = owners.get(category)
      if (previous !== undefined)
        throw new DesignerExtensionError('palette-category', category, [previous, extension.id])
      owners.set(category, extension.id)
      categories.set(category, label)
    }
  }
  return { list, runtime, editors: extensionEditors<DesignerPropertyEditor>(undefined, all), palette, categories }
}
