/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导出 @xihan-print/designer 的公共接口。元素不在 import 时注册，调用 definePrintDesigner() 才注册。

export { createPrintEditor, elementRect } from './editor'
export type {
  PrintAddElementInit,
  PrintBandView,
  PrintClipboard,
  PrintEditor,
  PrintEditorChange,
  PrintEditorOptions,
  PrintSelection,
  PrintSelectMode,
  PrintTablePart,
} from './editor'
export { createPrintDesignerModel, PRINT_DESIGNER_EXTENSION_ID } from './extensions'
export type { PrintDesignerContext, PrintDesignerExtension, PrintDesignerModel } from './extensions'
export { definePrintDesigner, PRINT_DESIGNER_TAG, XhPrintDesigner } from './print-designer'
export type { PrintDesignerEventMap, PrintDesignerMode, PrintSchemaChangeKind } from './print-designer'
