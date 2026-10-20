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
export { createPrintDesignerModel, PRINT_DESIGNER_EXTENSION_ID, PRINT_DESIGNER_HELP_URL, PRINT_DESIGNER_PANELS, PRINT_MENUBAR_MENUS, PRINT_PAGE_STRIP_LAYOUT, PRINT_TOOLBAR_LAYOUT, printInsertCommandId, printMenubarLayout, printMenuLayout, printSelectionLayout, printToolbarLayout } from './extensions'
export type {
  PrintDesignerCommand,
  PrintDesignerContext,
  PrintDesignerExtension,
  PrintDesignerImporter,
  PrintDesignerModel,
  PrintImportFragment,
  PrintMenuSubject,
  PrintPaletteDrop,
  PrintPaletteEntry,
  PrintSelectionSubject,
} from './extensions'
export { definePrintDesigner, PRINT_DESIGNER_TAG, XhPrintDesigner } from './print-designer'
export type { PrintDesignerEventMap, PrintDesignerMode, PrintSchemaChangeKind } from './print-designer'
export type { PrintClientSettingsSectionOptions, PrintClientStatusControl, PrintSettingsSectionOptions, PrintVia } from './settings'
export { PRINT_CLIENT_DOWNLOAD_URL, PRINT_CLIENT_SETTINGS_SECTION, PRINT_CLIENT_STATUS_CONTROL, PRINT_SETTING_KEYS, PRINT_SETTINGS_SECTION, printClientSettingsSection, printSettingsSection } from './settings'
export { PRINT_VERSION } from './version'
