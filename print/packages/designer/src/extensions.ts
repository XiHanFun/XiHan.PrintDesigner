/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器层的扩展：在 core 层之上加属性编辑器与装上时的回调；设计器自带的编辑器也写成一个扩展。

import type { PrintCoreExtension, PrintModel } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { DesignerExtensionBase } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type { DesignerPropertyEditor } from '@xihan-ui/designer-shell'
import type { XhPrintDesigner } from './print-designer'
import { createPrintModel } from '@xihan-print/core'
import { extensionEditors } from '@xihan-ui/designer-kit'

/** 扩展装上时拿到的上下文。 */
export interface PrintDesignerContext {
  readonly designer: XhPrintDesigner
  /** 此刻生效的设计器文案。 */
  readonly translations: PrintDesignerTranslations
}

/** 打印设计器层的扩展：core 层的全部字段，加上属性编辑器与 setup。 */
export interface PrintDesignerExtension extends PrintCoreExtension, Pick<DesignerExtensionBase<PrintDesignerContext, DesignerPropertyEditor>, 'editors' | 'setup'> {}

/** 设计器自带的扩展的 id：表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 */
export const PRINT_DESIGNER_EXTENSION_ID = '@xihan-print/designer'

/** 一组设计器扩展合出的东西：交给 core 函数与预览的列表、core 的模型与属性编辑器表。 */
export interface PrintDesignerModel {
  /** 设计器自带的扩展在前、传入的在后；校验、分页与预览都拿这一份。 */
  readonly list: readonly PrintDesignerExtension[]
  readonly core: PrintModel
  /** 各扩展的属性编辑器按顺序合成一张，后面的压前面的。 */
  readonly editors: PropertyEditorTable<DesignerPropertyEditor>
}

/** 合出设计器用的模型；任何一处重名都抛 DesignerExtensionError。 */
export function createPrintDesignerModel(builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): PrintDesignerModel {
  const list = [builtin, ...extensions]
  const core = createPrintModel(list)
  return { list, core, editors: extensionEditors<DesignerPropertyEditor>(undefined, core.extensions as readonly PrintDesignerExtension[]) }
}
