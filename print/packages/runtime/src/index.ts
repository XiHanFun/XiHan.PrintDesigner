/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导出 @xihan-print/runtime 的公共接口。元素不在 import 时注册，调用 definePrintPreview() 才注册。

export { DEFAULT_PRINT_DESIGNER_TRANSLATIONS } from './designer-locale'
export { createPrintRuntimeModel } from './extensions'
export type { PrintElementRenderContext, PrintElementRenderer, PrintRuntimeExtension, PrintRuntimeModel } from './extensions'
export { mergePaginationResults } from './merge'
export type { MergedPaginationDiagnostic, MergedPaginationPart, MergedPaginationResult } from './merge'
export { PrintRuntimeError } from './options'
export type { PrintRenderOptions, PrintRuntimeErrorCode } from './options'
export { printDocument, printSheets } from './print'
export type { PrintOptions, PrintOutcome, PrintSheetsOptions } from './print'
export { definePrintPreview, PRINT_PREVIEW_TAG, XhPrintPreview } from './print-preview'
export type { PaginationErrorDetail, PrintPreviewEventMap, PrintPreviewPrintOptions } from './print-preview'
export { renderBox } from './render/boxes'
export { renderSheets, sheetPageName } from './render/sheets'
export type { RenderSheetsOptions } from './render/sheets'
export { renderWatermark } from './render/watermark'
export type { PrintDesignerTranslations, PrintPreviewTranslations, PrintTablePartKind } from './translations'
