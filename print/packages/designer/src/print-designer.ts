/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// <xh-print-designer>：打印模板设计器。画布按纸张显示一张页面模板（页眉、正文、页脚三区），元素用 runtime 的渲染代码画；
// 点选与 Shift / Ctrl 追加选择，拖动元素移动，控制柄缩放与旋转，拖空白框选，按住空格或中键拖动平移，Ctrl / ⌘ + 滚轮缩放；
// 画布外有毫米标尺，从标尺拖出的参考线存进页面模板；右侧属性面板编辑选中元素、表格部位或页面设置，
// 下方问题列表点选即定位；页眉页脚可切换变体、拖边界改高度；
// 双击表格进入表格编辑态；键盘撤销重做、删除、微移、层级与系统剪贴板；可切到 <xh-print-preview> 预览与打印。
// 整体版式用 @xihan-ui/designer-shell 的外框，panels 决定显示哪些区。工具栏、右键菜单与快捷键都走扩展合出的命令表，
// 内置命令是设计器自带的扩展的一部分，排列可由 commandLayout 改写；扩展的面板放进外框自己的命名区；
// 粘贴与拖放进来的外部内容交给扩展的导入器换成元素。
// 设置对话框（openSettings()）里是基础分区、设计器自己的「画布」与各扩展的分区，值经 settings 与 settings-change 交给宿主。

import type {
  BarCodeFormat,
  DesignLayout,
  ElementCategory,
  ElementContainerRef,
  ElementRegion,
  LayoutBox,
  PageBandKey,
  PaginationStep,
  PrintDocument,
  PrintElement,
  PrintOperation,
  PropertyGroup,
  PropertyUnit,
  ReorderTarget,
  TableElement,
  TableLayoutBox,
  TextStyle,
  ValidationIssue,
} from '@xihan-print/core'
import type { PrintDesignerTranslations, PrintOutcome, PrintPhase, PrintPreviewPrintOptions, PrintTrace } from '@xihan-print/runtime'
import type { PrintClient, PrintClientState } from '@xihan-print/runtime/client'
import type { IconRecord, Tone } from '@xihan-ui/core'
import type { JsonPath, JsonValue } from '@xihan-ui/core/json'
import type { VisualEnvironmentStorageError } from '@xihan-ui/core/visual-environment'
import type { AlignMode, DataField, DataFieldContent, DesignerFieldSource, DesignerImportSource, DistributeAxis, ExecuteOptions, ExtensionHost, HistoryLabel, Point, Rect, Viewport } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type {
  CommandMenubar,
  CommandToolbar,
  DesignerAutosave,
  DesignerCommandLayout,
  DesignerCommandsTranslations,
  DesignerFieldImportEventMap,
  DesignerFrameEventMap,
  DesignerFrameRegion,
  DesignerGuides,
  DesignerHistoryTranslations,
  DesignerIssueItem,
  DesignerIssuesEventMap,
  DesignerJsonEditorEventMap,
  DesignerLanguage,
  DesignerLayout,
  DesignerLayoutPolicy,
  DesignerMinimapEventMap,
  DesignerMinimapShape,
  DesignerPaletteDragPayload,
  DesignerPaletteEventMap,
  DesignerPaletteGroup,
  DesignerPaletteItem,
  DesignerPaletteView,
  DesignerPanel,
  DesignerPanelActions,
  DesignerPanelHost,
  DesignerPropertiesEventMap,
  DesignerPropertyDescriptor,
  DesignerPropertyEditor,
  DesignerPropertyError,
  DesignerRulerEventMap,
  DesignerSettings,
  DesignerSettingsEventMap,
  DesignerSettingsHost,
  DesignerSettingsPolicy,
  DesignerSettingsSection,
  DesignerSnapOptions,
  DesignerStatusItem,
  DesignerTransformEventMap,
  DesignerTransformItem,
  DropOver,
  PanRequestDetail,
} from '@xihan-ui/designer-shell'
import type { ExpressionEngine, NumeralStyle, ValueFormatter } from '@xihan-ui/expression'
import type { PointerSession } from '@xihan-ui/pointer'
import type { CanvasMeasurer, TextMeasurer } from '@xihan-ui/viz'
import type { XhConfig } from '@xihan-ui/web-components'
import type { PropertyValues } from '@xihan-ui/web-components/authoring'
import type { DialogService } from '@xihan-ui/web-components/services'
import type { PrintClipboard, PrintSelection, PrintTablePart } from './editor'
import type { PrintDesignerCommand, PrintDesignerContext, PrintDesignerExtension, PrintDesignerImporter, PrintDesignerModel, PrintMenuSubject, PrintPaletteDrop, PrintSelectionSubject } from './extensions'
import type { FieldPaletteNode, FieldPlacement, FieldPlacementDefaults } from './field-palette'
import type { PrintOutline } from './outline'
import type { CompositeEditorHost } from './property-editors'
import type { ExpandedDescriptor } from './property-expand'
import type { PropertySubject } from './property-targets'
import type { PrintVia } from './settings'
import type { TableCommand } from './table-edit'
import {
  createDocument,
  createPage,
  createPaper,
  findElement,
  getBandRect,
  getBodyRect,
  getContentRect,
  getPaperSize,
  layoutDesign,
  PAGE_BAND_KEYS,
  PAGE_ORIENTATIONS,
  PAGE_PROPERTY_GROUPS,
  planResizeTableColumn,
  PROPERTY_GROUPS,
  validateDocument,
} from '@xihan-print/core'
import { DEFAULT_PRINT_DESIGNER_TRANSLATIONS, definePrintPreview, PRINT_PREVIEW_TAG, renderBox, renderWatermark } from '@xihan-print/runtime'
import { createCounterIdGenerator } from '@xihan-ui/core'
import { detectKbdPlatform } from '@xihan-ui/core/hotkey'
import { formatJsonPath, isPlainObject, jsonEquals } from '@xihan-ui/core/json'
import { fillTextTemplate } from '@xihan-ui/core/template'
import {
  centerOn,
  clipboardMimeType,
  commandForShortcut,
  createExtensionHost,
  decodeClipboard,
  encodeClipboard,
  findImporter,
  fitRect,
  formatLength,
  HISTORY_NUDGE_MERGE_WITHIN,
  hitTest,
  isPaperPresetName,
  nudgeDelta,
  nudgeMergeKey,
  panBy,
  PAPER_PRESET_NAMES,
  revealRect,
  screenToWorld,
  selectInMarquee,
  snapshotHistory,
  snapToGrid,
  unionRects,
  wheelZoomFactor,
  zoomBy,
} from '@xihan-ui/designer-kit'
import { BUILTIN_CONTROL_KINDS, resolvePropertyEditor } from '@xihan-ui/designer-kit/properties'
import {
  applyToolbarCustomization,
  arrangeCommands,
  arrangeMenubar,
  autoSaveOf,
  createCommandMenubar,
  createCommandToolbar,
  createDesignerAutosave,
  createDesignerDebugLogger,
  createDesignerSettingsHost,
  createHistoryPanel,
  createOutlinePanel,
  createPanelActions,
  createPanelHost,
  createStatusItem,
  defineDesignerShellElement,
  DESIGNER_COMMANDS_EN_US,
  DESIGNER_COMMON_KEYS,
  DESIGNER_FRAME_REGIONS,
  DESIGNER_HISTORY_EN_US,
  DESIGNER_SETTING_KEYS,
  DESIGNER_SHELL_COMMANDS,
  DESIGNER_TOUR_DONE_KEY,
  designerHistoryCommands,
  designerLayoutPolicy,
  designerPanelCommands,
  designerShellCommands,
  forwardFrameSlots,
  importSources,
  registerDropTarget,
  renderCommandMenu,
  resolvePaletteSources,
  resolveSettings,
  resolveTourSteps,
  runCommand,
  shortcutSettingsSource,
  toolbarCustomizationOf,
  toolbarDisplayOf,
  toolbarSettingsSource,
  toolbarVisibleOf,
  tourDoneOf,
  XhDesignerFieldImportElement,
  XhDesignerFrameElement,
  XhDesignerIssuesElement,
  XhDesignerJsonEditorElement,
  XhDesignerMinimapElement,
  XhDesignerPaletteElement,
  XhDesignerPropertiesElement,
  XhDesignerRulerElement,
  XhDesignerSettingsElement,
  XhDesignerTourElement,
  XhDesignerTransformElement,
} from '@xihan-ui/designer-shell'
import { loadDesignerLocale } from '@xihan-ui/designer-shell/language'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { AlignCenterIcon, AlignLeftIcon, AlignObjectsBottomIcon, AlignObjectsCenterIcon, AlignObjectsLeftIcon, AlignObjectsMiddleIcon, AlignObjectsRightIcon, AlignObjectsTopIcon, AlignRightIcon, ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, BoldIcon, BringForwardIcon, BringToFrontIcon, ChevronDownIcon, ChevronUpIcon, CircleAlertIcon, CircleHelpIcon, ClipboardIcon, CopyIcon, CopyPlusIcon, DatabaseIcon, DistributeHorizontalIcon, DistributeVerticalIcon, EraserIcon, EyeIcon, FileCodeIcon, FileIcon, FileMinusIcon, FilePlusIcon, GridIcon, HandIcon, HistoryIcon, InfoIcon, ItalicIcon, LayoutGridIcon, ListTreeIcon, MagnetIcon, MapIcon, MaximizeIcon, MenuIcon, PanelLeftIcon, PencilIcon, PrinterIcon, RedoIcon, SaveIcon, ScissorsIcon, SendBackwardIcon, SendToBackIcon, SettingsIcon, SlidersHorizontalIcon, SquareDashedIcon, StrikethroughIcon, TableCellsMergeIcon, TableCellsSplitIcon, TableColumnInsertLeftIcon, TableColumnInsertRightIcon, TableColumnRemoveIcon, TableIcon, TableRowInsertAboveIcon, TableRowInsertBelowIcon, TableRowRemoveIcon, TrashIcon, UnderlineIcon, UndoIcon, XIcon, ZoomInIcon, ZoomOutIcon, ZoomResetIcon } from '@xihan-ui/icons'
import { createPointerSession, resolveSessionDoc, shouldActivate, wheelPixels } from '@xihan-ui/pointer'
import { createCanvasMeasurer } from '@xihan-ui/viz'
import { mergeXhConfig } from '@xihan-ui/web-components'
import { BOOLEAN_CONVERTER, createAuthoredElement, createGeneratedElement, emitEvent, registerElement, XhConfigController, XhReactiveElement } from '@xihan-ui/web-components/authoring'
import { defineXhElement, XhButtonElement, XhColorFieldElement, XhContextMenuElement, XhExpressionInputElement, XhFieldArrayElement, XhFieldElement, XhFormatInputElement, XhMenuElement, XhNumberFieldElement, XhSelectElement, XhSwitchElement, XhTabsElement, XhTextFieldElement, XhToggleGroupElement, XhToolbarElement } from '@xihan-ui/web-components/define'
import { createDialogService } from '@xihan-ui/web-components/services'
import { createPrintClientStatus } from './client-status'
import { createPrintEditor, elementRect } from './editor'
import { createPrintDesignerModel, elementIcon, elementName, PRINT_DESIGNER_EXTENSION_ID, PRINT_DESIGNER_HELP_URL, PRINT_DESIGNER_PANELS, PRINT_MENUBAR_MENUS, PRINT_PAGE_STRIP_LAYOUT, PRINT_TOOLBAR_LAYOUT, PRINT_TOUR_STEPS, printMenubarLayout, printMenuLayout, printSelectionLayout } from './extensions'
import { FIELD_ITEM_PREFIX, fieldPaletteNodes } from './field-palette'
import { describePrintOperations, elementsLabel, identitiesIn } from './history-labels'
import { printOutline } from './outline'
import { borderSidesEditor, createIssueText, issuesUnder, valueFormatEditor } from './property-editors'
import { pageSubject, propertySubjects, TABLE_PART_KINDS } from './property-targets'
import { PRINT_CLIENT_STATUS_CONTROL, PRINT_SETTING_KEYS, printClientSettingsSection, printSettingsSection } from './settings'
import { columnBoundaries, planTableCommand, tablePartAt } from './table-edit'
import { PRINT_VERSION } from './version'

/** 设计器的标签名。 */
export const PRINT_DESIGNER_TAG = 'xh-print-designer'

/** 设计态或预览态。 */
export type PrintDesignerMode = 'design' | 'preview'

/** schema-change 的种类：执行操作、撤销、重做，或宿主装载了新模板。 */
export type PrintSchemaChangeKind = 'execute' | 'undo' | 'redo' | 'load'

/** 设计器派发的事件；x / y 为浏览器视口坐标。 */
export interface PrintDesignerEventMap {
  /** 模板变了：schema 为变化后的模板，operations 为实际应用的操作；一次拖动、一次属性编辑等事务提交时合成一次，宿主装载新模板时 kind 为 load、operations 为空。 */
  'schema-change': CustomEvent<{ schema: PrintDocument, operations: readonly PrintOperation[], kind: PrintSchemaChangeKind }>
  /** 选择变了，detail 为当前选择。 */
  'selection-change': CustomEvent<PrintSelection>
  /** 是否有未保存的修改变了。 */
  'dirty-change': CustomEvent<{ dirty: boolean }>
  /** 模板改动或登记表、表达式引擎换了之后重新校验，detail 为全部校验问题。 */
  'issues-change': CustomEvent<{ issues: readonly ValidationIssue[] }>
  /** 视口变了，取值同 getViewport()。 */
  'viewport-change': CustomEvent<{ viewport: Viewport }>
  /**
   * 执行了保存命令 save：选了菜单栏的「文件 → 保存」，或设计态下焦点在设计器里（输入框与面板之外）时按了 Ctrl / ⌘ + S；
   * 设计器不保存，宿主保存后调用 markSaved()。
   */
  'save': CustomEvent<Record<string, never>>
  /** 双击元素；双击表格时同时进入表格编辑态。 */
  'element-dblclick': CustomEvent<{ id: string }>
  /** 在元素上打开右键菜单，未选中的元素先被选中；可取消，取消后不弹设计器自带的菜单。 */
  'element-contextmenu': CustomEvent<{ id: string, x: number, y: number }>
  /** 在画布空白处打开右键菜单；可取消，取消后不弹设计器自带的菜单。 */
  'blank-contextmenu': CustomEvent<{ x: number, y: number }>
  /** 在表格编辑态里打开右键菜单，右键处的表格部位先被选中；可取消，取消后不弹设计器自带的菜单。 */
  'table-contextmenu': CustomEvent<{ id: string, part: PrintTablePart, x: number, y: number }>
  /** 导入器没能导入粘贴或拖放进来的内容：它抛了错，或给出的元素没有通过校验；importer 是导入器的 id。 */
  'import-error': CustomEvent<{ importer: string, source: DesignerImportSource, error: unknown }>
  /** 当前页面模板变了。 */
  'page-change': CustomEvent<{ pageId: string }>
  /** 在设计态与预览态之间切换了。 */
  'mode-change': CustomEvent<{ mode: PrintDesignerMode }>
  /**
   * 改了一条设置（设置对话框里，或工具栏上的网格、吸附开关）：设计器已换成新的 settings 并生效；
   * value 为 undefined 表示删掉这个键、回到缺省值。宿主存起来，下次赋回 settings。
   */
  'settings-change': CustomEvent<{ key: string, value: JsonValue | undefined, settings: DesignerSettings }>
  /** 读写 settingsStorageKey 指的本机存储失败（内容不是对象、无痕窗口、配额满）；设置留在内存里。 */
  'settings-storage-error': CustomEvent<VisualEnvironmentStorageError>
  /** 在导入字段对话框里导入了字段：设计器已换成新的 fields。宿主存起来，下次赋回 fields。 */
  'fields-change': CustomEvent<{ fields: readonly DataField[] }>
  /** 导入字段时勾了「同时作为示例数据」：设计器已换成新的 sampleData。宿主存起来，下次赋回 sampleData。 */
  'sample-data-change': CustomEvent<{ sampleData: JsonValue }>
}

/** 跟随页面时设计器这棵子树的配置。 */
const FOLLOW_PAGE: XhConfig = Object.freeze({})

/** 设置里选了语言时这台设计器用的配置：UI 与 designer-shell 的同语言包，再并上打印自己的同语言包（按需加载）。 */
async function loadPrintLocale(language: DesignerLanguage): Promise<XhConfig> {
  const [shared, print] = await Promise.all([loadDesignerLocale(language), import('@xihan-print/runtime/locale')])
  const pack = print[`print${language[0]!.toUpperCase()}${language.slice(1).replace('-', '')}` as keyof typeof print] as XhConfig
  return mergeXhConfig(shared, pack)
}

/** 分页一步写进调试日志的标题；输出页序号换成从 1 起。 */
function paginationStepTitle(step: PaginationStep): string {
  switch (step.kind) {
    case 'page':
      return `页面模板 ${step.pageId} 开始排，首页页码 ${step.firstNumber}`
    case 'reflow':
      return `页面模板 ${step.pageId} 按 ${step.assumed} 页选的页眉页脚不对，按 ${step.sheets} 页重排`
    case 'split':
      return `${step.elementId} 在第 ${step.from + 1} 页放不下，续排到第 ${step.to + 1} 页`
    case 'move':
      return `${step.elementId} 在第 ${step.from + 1} 页放不下，挪到第 ${step.to + 1} 页`
    case 'done':
      return `页面模板 ${step.pageId} 排完，共 ${step.sheets} 页`
  }
}

/** 剪贴板载荷的结构版本。 */
const CLIPBOARD_VERSION = 1
const NO_EXTENSIONS: readonly PrintDesignerExtension[] = []
const CLIPBOARD_PRODUCT = 'print'
/** CSS 像素与毫米之比。 */
const PX_PER_MM = 96 / 25.4
/** 显示倍数的上下限，1 为实际尺寸。 */
const ZOOM_LIMITS = { min: 0.1 * PX_PER_MM, max: 8 * PX_PER_MM }
const ZOOM_STEP = 1.2
/** 视口适配时纸张四周留白，屏幕像素。 */
const FIT_PADDING = 32
/** 方向键平移视口的距离，屏幕像素。 */
const PAN_STEP = 48
/** 微移的大步长，mm。 */
const NUDGE_LARGE_STEP = 10
/** 长度比较的容差，mm。 */
const DESIGN_EPSILON = 1e-6
/** 网格线在屏幕上的最小间距，像素；网格间距画出来比它密时改按整数倍画。 */
const GRID_MIN_PIXELS = 8

type StringKey = { [K in keyof PrintDesignerTranslations]: PrintDesignerTranslations[K] extends string ? K : never }[keyof PrintDesignerTranslations]

/** 设计器自带的命令。 */
type Command
  = | 'cut' | 'copy' | 'paste' | 'duplicate' | 'delete' | 'select-all'
    | 'align-left' | 'align-center' | 'align-right' | 'align-top' | 'align-middle' | 'align-bottom'
    | 'distribute-horizontal' | 'distribute-vertical'
    | 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'
    | 'zoom-out' | 'zoom-in' | 'zoom-to-fit' | 'zoom-to-actual' | 'grid' | 'snap'
    | 'design' | 'preview' | 'print' | 'edit-table' | 'exit-table-edit'
    | 'previous-page' | 'next-page' | 'add-page' | 'duplicate-page' | 'remove-page' | 'move-page-up' | 'move-page-down'
    | TableCommand

const ALIGN: Readonly<Record<string, AlignMode>> = {
  'align-left': 'left',
  'align-center': 'center-vertical',
  'align-right': 'right',
  'align-top': 'top',
  'align-middle': 'center-horizontal',
  'align-bottom': 'bottom',
}

const REORDER: Readonly<Record<string, ReorderTarget>> = {
  'bring-to-front': 'front',
  'bring-forward': 'forward',
  'send-backward': 'backward',
  'send-to-back': 'back',
}

/** 四款共用的命令：文案取 designer-shell 语言包里 xh-designer-commands 那一桶。 */
const SHARED_LABELS = {
  'cut': 'cut',
  'copy': 'copy',
  'paste': 'paste',
  'duplicate': 'duplicate',
  'delete': 'delete',
  'select-all': 'selectAll',
  'align-left': 'alignLeft',
  'align-center': 'alignCenter',
  'align-right': 'alignRight',
  'align-top': 'alignTop',
  'align-middle': 'alignMiddle',
  'align-bottom': 'alignBottom',
  'distribute-horizontal': 'distributeHorizontal',
  'distribute-vertical': 'distributeVertical',
  'bring-to-front': 'bringToFront',
  'bring-forward': 'bringForward',
  'send-backward': 'sendBackward',
  'send-to-back': 'sendToBack',
  'zoom-out': 'zoomOut',
  'zoom-in': 'zoomIn',
  'zoom-to-fit': 'zoomToFit',
  'zoom-to-actual': 'zoomToActual',
  'design': 'design',
  'preview': 'preview',
} as const satisfies Partial<Record<Command, keyof DesignerCommandsTranslations>>

type SharedCommand = keyof typeof SHARED_LABELS

/** 打印自己的命令：文案取打印的语言包。 */
const LABELS: Readonly<Record<Exclude<Command, SharedCommand>, StringKey>> = {
  'grid': 'grid',
  'snap': 'snap',
  'print': 'print',
  'edit-table': 'editTable',
  'exit-table-edit': 'exitTableEdit',
  'previous-page': 'previousPage',
  'next-page': 'nextPage',
  'add-page': 'addPage',
  'duplicate-page': 'duplicatePage',
  'remove-page': 'removePage',
  'move-page-up': 'movePageUp',
  'move-page-down': 'movePageDown',
  'insert-column-left': 'insertColumnLeft',
  'insert-column-right': 'insertColumnRight',
  'remove-column': 'removeColumn',
  'move-column-left': 'moveColumnLeft',
  'move-column-right': 'moveColumnRight',
  'insert-footer-row-above': 'insertFooterRowAbove',
  'insert-footer-row-below': 'insertFooterRowBelow',
  'remove-footer-row': 'removeFooterRow',
  'merge-cell-right': 'mergeCellRight',
  'split-cell': 'splitCell',
}

/** 每条内置命令的图标。 */
const ICONS: Readonly<Record<Command, IconRecord>> = {
  'cut': ScissorsIcon,
  'copy': CopyIcon,
  'paste': ClipboardIcon,
  'duplicate': CopyPlusIcon,
  'delete': TrashIcon,
  'select-all': SquareDashedIcon,
  'align-left': AlignObjectsLeftIcon,
  'align-center': AlignObjectsCenterIcon,
  'align-right': AlignObjectsRightIcon,
  'align-top': AlignObjectsTopIcon,
  'align-middle': AlignObjectsMiddleIcon,
  'align-bottom': AlignObjectsBottomIcon,
  'distribute-horizontal': DistributeHorizontalIcon,
  'distribute-vertical': DistributeVerticalIcon,
  'bring-to-front': BringToFrontIcon,
  'bring-forward': BringForwardIcon,
  'send-backward': SendBackwardIcon,
  'send-to-back': SendToBackIcon,
  'zoom-out': ZoomOutIcon,
  'zoom-in': ZoomInIcon,
  'zoom-to-fit': MaximizeIcon,
  'zoom-to-actual': ZoomResetIcon,
  'grid': GridIcon,
  'snap': MagnetIcon,
  'design': PencilIcon,
  'preview': EyeIcon,
  'print': PrinterIcon,
  'edit-table': TableIcon,
  'exit-table-edit': XIcon,
  'previous-page': ChevronUpIcon,
  'next-page': ChevronDownIcon,
  'add-page': FilePlusIcon,
  'duplicate-page': CopyPlusIcon,
  'remove-page': FileMinusIcon,
  'move-page-up': ArrowUpIcon,
  'move-page-down': ArrowDownIcon,
  'insert-column-left': TableColumnInsertLeftIcon,
  'insert-column-right': TableColumnInsertRightIcon,
  'remove-column': TableColumnRemoveIcon,
  'move-column-left': ArrowLeftIcon,
  'move-column-right': ArrowRightIcon,
  'insert-footer-row-above': TableRowInsertAboveIcon,
  'insert-footer-row-below': TableRowInsertBelowIcon,
  'remove-footer-row': TableRowRemoveIcon,
  'merge-cell-right': TableCellsMergeIcon,
  'split-cell': TableCellsSplitIcon,
}

/** 格式工具条上的四种字形开关：命令 id、文字样式里的开关与图标。 */
const FORMAT_FLAGS: readonly { readonly id: string, readonly flag: 'bold' | 'italic' | 'underline' | 'lineThrough', readonly icon: IconRecord }[] = [
  { id: 'text-bold', flag: 'bold', icon: BoldIcon },
  { id: 'text-italic', flag: 'italic', icon: ItalicIcon },
  { id: 'text-underline', flag: 'underline', icon: UnderlineIcon },
  { id: 'text-line-through', flag: 'lineThrough', icon: StrikethroughIcon },
]

/** 格式工具条上的三种水平对齐。 */
const TEXT_ALIGNS: readonly { readonly id: string, readonly align: 'left' | 'center' | 'right', readonly label: 'alignTextLeft' | 'alignTextCenter' | 'alignTextRight', readonly icon: IconRecord }[] = [
  { id: 'text-align-left', align: 'left', label: 'alignTextLeft', icon: AlignLeftIcon },
  { id: 'text-align-center', align: 'center', label: 'alignTextCenter', icon: AlignCenterIcon },
  { id: 'text-align-right', align: 'right', label: 'alignTextRight', icon: AlignRightIcon },
]

/** 字号菜单里的字号，pt。 */
const FONT_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

/** 会删掉内容的内置命令，按钮与菜单项按危险语气显示。 */
const DESTRUCTIVE: ReadonlySet<Command> = new Set<Command>(['delete', 'remove-page', 'remove-column', 'remove-footer-row'])

/** 一条内置命令的文字：共用命令取共用文案，其余取打印的文案。 */
function builtinLabel(id: Command, context: PrintDesignerContext): string {
  return id in SHARED_LABELS ? context.commands[SHARED_LABELS[id as SharedCommand]] : context.translations[LABELS[id as Exclude<Command, SharedCommand>]]
}

/** 内置命令的快捷键；Backspace 删除这个别名由按键处理直接接住。 */
const SHORTCUTS: Readonly<Partial<Record<Command, readonly string[]>>> = {
  'select-all': ['Mod', 'A'],
  'duplicate': ['Mod', 'D'],
  'delete': ['Delete'],
  'bring-forward': ['Mod', ']'],
  'bring-to-front': ['Mod', 'Shift', ']'],
  'send-backward': ['Mod', '['],
  'send-to-back': ['Mod', 'Shift', '['],
  'zoom-in': ['+'],
  'zoom-out': ['-'],
  'zoom-to-fit': ['0'],
}

/** 开关式的内置命令。 */
const TOGGLES: ReadonlySet<Command> = new Set<Command>(['grid', 'snap', 'design', 'preview'])

/** 设计器占用的 Ctrl / ⌘ 组合的主键：对应命令此刻不可用时也不交给浏览器。 */

const RESERVED_COMMAND_KEYS: ReadonlySet<string> = new Set(['z', 'y', 'a', 'd', '[', ']', '{', '}'])

/** 导入字段时值字段能选的内容种类。 */
const FIELD_CONTENTS: readonly DataFieldContent[] = ['text', 'image', 'barcode', 'qrcode']

/** 预览态只登记这几个区：菜单栏、工具栏与画布。 */
const PREVIEW_REGIONS: ReadonlySet<string> = new Set(['menubar', 'toolbar', 'canvas'])

const NO_GUIDES: DesignerGuides = { x: [], y: [] }

/** 属性面板自带编辑器的编辑方式。 */
const BUILTIN_CONTROLS: ReadonlySet<string> = new Set(BUILTIN_CONTROL_KINDS)

/** 不是外框的区、由设计器自己开关的面板：画布右侧的翻页条与标尺。 */

/** 物料面板里字段那一组的 id。 */
const FIELD_GROUP_ID = 'fields'

/** 字段物料条目：说明写字段路径，与名称相同时不写；能放上画布的带着生成元素的参数，其余只作浏览。 */
function fieldItem(node: FieldPaletteNode): DesignerPaletteItem {
  return {
    id: node.id,
    label: node.label,
    ...(node.path === node.label ? {} : { description: node.path }),
    ...(node.placement === undefined ? { browseOnly: true } : { payload: node.placement }),
    ...(node.children === undefined ? {} : { children: node.children.map(fieldItem) }),
  }
}

function isFieldPlacement(payload: unknown): payload is FieldPlacement {
  return typeof payload === 'object' && payload !== null && typeof (payload as { type?: unknown }).type === 'string' && typeof (payload as { overrides?: unknown }).overrides === 'object'
}

function isPaletteDrag(payload: unknown): payload is DesignerPaletteDragPayload {
  return typeof payload === 'object' && payload !== null && (payload as { source?: unknown }).source === 'palette' && typeof (payload as { id?: unknown }).id === 'string'
}

interface Layers {
  readonly frame: XhDesignerFrameElement
  readonly panelHost: DesignerPanelHost<PrintDesignerContext>
  /** 外框最上一条的菜单栏，窄屏时收成一颗「菜单」钮。 */
  readonly menubar: CommandMenubar<PrintDesignerContext>
  readonly palette: XhDesignerPaletteElement
  readonly issues: XhDesignerIssuesElement
  readonly properties: XhDesignerPropertiesElement
  readonly toolbar: HTMLElement
  readonly commandBar: CommandToolbar<PrintDesignerContext>
  /** 选中元素时浮在选中框上方的选中工具条。 */
  readonly selectionBar: CommandToolbar<PrintDesignerContext>
  /** 画布右侧中间的竖排翻页条。 */
  readonly pageStrip: CommandToolbar<PrintDesignerContext>
  readonly workspace: HTMLElement
  readonly menu: HTMLElement
  readonly ruler: XhDesignerRulerElement
  readonly menuContent: HTMLElement
  readonly viewport: HTMLElement
  readonly overlay: XhDesignerTransformElement
  readonly world: HTMLElement
  readonly paper: HTMLElement
  /** 网格线。 */
  readonly grid: HTMLElement
  readonly frames: HTMLElement
  readonly elements: HTMLElement
  readonly watermark: HTMLElement
  readonly decorations: HTMLElement
  readonly bandMenus: HTMLElement
  readonly preview: HTMLElement
  /** 设置对话框。 */
  readonly settings: XhDesignerSettingsElement
  /** 导入字段对话框。 */
  readonly fieldImport: XhDesignerFieldImportElement
  /** 新手引导。 */
  readonly tour: XhDesignerTourElement
  /** 编辑整份模板的 JSON 对话框。 */
  readonly jsonEditor: XhDesignerJsonEditorElement
  /** 画布左下角的小地图：按页显示纸张与元素，按下或拖动把视口中心移过去。 */
  readonly minimap: XhDesignerMinimapElement
  /** 物料面板头的命令条：导入字段。 */
  readonly paletteActions: DesignerPanelActions<PrintDesignerContext>
  /** 状态栏左段：选中的对象。 */
  readonly selectionStatus: DesignerStatusItem
  /** 状态栏右段：打印客户端的连接状态，没给 printClient 时收起。 */
  readonly clientStatus: DesignerStatusItem
  /** 状态栏右段：缩放，点了回到实际尺寸。 */
  readonly zoomStatus: DesignerStatusItem
}

interface Gesture {
  readonly session: PointerSession
  active: boolean
  readonly cancel: () => void
}

/** 元素能被拖动的控制柄：水平、竖直的直线只给两端。 */
function resizeHandles(element: PrintElement): DesignerTransformItem['handles'] {
  if (element.type !== 'line')
    return true
  if (element.direction === 'horizontal')
    return ['w', 'e']
  return element.direction === 'vertical' ? ['n', 's'] : true
}

/** 角度落到 [0, 360)。 */
function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** 物料分组的名字：内置分组取语言包，扩展的分组取扩展给的名称，都没有时用分组名。 */
function categoryName(t: PrintDesignerTranslations, model: PrintDesignerModel, category: string): string {
  return Object.hasOwn(t.categories, category) ? t.categories[category as ElementCategory] : model.categories.get(category) ?? category
}

function rectStyle(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.x}mm`
  element.style.top = `${rect.y}mm`
  element.style.width = `${rect.width}mm`
  element.style.height = `${rect.height}mm`
  element.style.transform = rect.rotation ? `rotate(${rect.rotation}deg)` : ''
}

export class XhPrintDesigner extends XhReactiveElement {
  static override properties = {
    data: { attribute: false },
    sampleData: { attribute: false },
    fields: { attribute: false },
    fieldsReadonly: { converter: BOOLEAN_CONVERTER, attribute: 'fields-readonly' },
    expressionEngine: { attribute: false },
    formatter: { attribute: false },
    measurer: { attribute: false },
    locale: { type: String },
    timeZone: { type: String, attribute: 'time-zone' },
    translations: { attribute: false },
    readonly: { converter: BOOLEAN_CONVERTER },
    mode: { type: String },
    defaultLayout: { attribute: false },
    printClient: { attribute: false },
    clientDownloadUrl: { attribute: 'client-download-url', converter: { fromAttribute: (value: string | null) => value ?? undefined } },
    commandLayout: { attribute: false },
    settings: { attribute: false },
    settingsPolicy: { attribute: false },
    settingsStorageKey: { attribute: 'settings-storage-key', converter: { fromAttribute: (value: string | null) => value ?? undefined } },
    draftKey: { attribute: 'draft-key', converter: { fromAttribute: (value: string | null) => value ?? undefined } },
    autoTour: { converter: BOOLEAN_CONVERTER, attribute: 'auto-tour' },
  }

  /** 预览分页用的数据。 */
  declare data: unknown
  /** 示例数据：给出时画布按它显示实际值，不给时字段显示 {path} 占位。 */
  declare sampleData: unknown
  /** 可绑定的字段树：物料面板「字段」组与属性面板的字段选择器读它；导入字段时设计器换掉它并派发 fields-change。 */
  declare fields: readonly DataField[] | undefined
  /** 字段由宿主管着、不许在设计器里导入：物料面板头没有导入字段钮，import-fields 命令不可用。attribute 为 fields-readonly。 */
  declare fieldsReadonly?: boolean
  /** 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 */
  declare expressionEngine: ExpressionEngine | undefined
  /** 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 */
  declare formatter: ValueFormatter | undefined
  /** 文字度量器；缺省用所在文档的 Canvas 度量器。 */
  declare measurer: TextMeasurer | undefined
  /**
   * 本地打印客户端：给了时打印先交给它静默打印，连不上客户端才退回浏览器打印；设置里的打印方式选了浏览器时直接用浏览器打印。
   * 给了它，设置对话框才有打印方式一项与「本地客户端」一页。
   */
  declare printClient: PrintClient | undefined
  /** 设置对话框「本地客户端」一页里「下载客户端」链接的地址，缺省 PRINT_CLIENT_DOWNLOAD_URL；attribute 为 client-download-url。 */
  declare clientDownloadUrl: string | undefined
  /** 交给格式化器的区域，只决定小数点与千分位符号；同名 attribute。 */
  declare locale: string | undefined
  /** 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称；attribute 为 time-zone。 */
  declare timeZone: string | undefined
  /** 元素自己的文案，压在全局配置之上。 */
  declare translations: Partial<PrintDesignerTranslations> | undefined
  /** 只读：可以选择、浏览与预览，不能修改。attribute 三态：不写或移除为不只读，写 "false" 为不只读，其余写法为只读。 */
  declare readonly?: boolean
  /** 设计态或预览态，缺省 design；同名 attribute。 */
  declare mode: PrintDesignerMode
  /**
   * 宿主的缺省面板布局：用户没存过布局（settings 里没有 layout.panels）时用它，「恢复默认布局」也回到它；
   * 写了的字段整项覆盖内置缺省。面板 id 见 PRINT_DESIGNER_PANELS。
   */
  declare defaultLayout: DesignerLayout | undefined
  /**
   * 工具栏与右键菜单的排列：位置（toolbar、menu:blank、menu:element、menu:table）→ 若干组命令 id，内置与扩展的命令可以混排。
   * 写了某个位置就只显示列出的命令；写了没登记的命令 id 时抛 TypeError。
   */
  declare commandLayout: DesignerCommandLayout | undefined
  /**
   * 设置的值：扁平的键值，键是「分区 id.条目 id」，如 general.theme、print.showGrid；没写的键取条目的缺省值。
   * 赋值即生效；用户在设置对话框里或用工具栏上的网格、吸附开关改了以后，设计器换成新的一份并派发 settings-change。
   */
  declare settings: DesignerSettings | undefined
  /** 宿主对设置条目的管控：键是条目键或分区 id，hidden 不显示，locked 只读、说明换成「由所在系统管理」。 */
  declare settingsPolicy: DesignerSettingsPolicy | undefined
  /**
   * 设置存在根所在窗口 localStorage 的哪个键下：给了，连上文档时若没赋 settings 就从这里读，用户改了设置就写回去，
   * 标了 secret 的条目不存；读写失败派发 settings-storage-error。不给就不读写。同名 attribute settings-storage-key。
   */
  declare settingsStorageKey: string | undefined
  /**
   * 自动保存草稿的键：区分同一页、同一种设计器里的不同模板（宿主写模板 id）；不给时按页面地址区分。
   * 设置里开着自动保存时，未保存的修改停手约一秒存成这台浏览器里的草稿，保存（markSaved）后删掉；下次装进同一个键的模板、
   * 和草稿不一样时问恢复还是丢弃。同名 attribute draft-key。
   */
  declare draftKey: string | undefined
  /**
   * 第一次在设计态显示出来（画布有了尺寸）后自动开始新手引导，缺省开；设置里记过 help.tourDone（走完、跳过或关上过一次）时不再自动开始。
   * 写 false 关掉，start-tour 命令、帮助页的「开始引导」与 startTour() 照样能开始。同名 attribute auto-tour，写 "false" 是关。
   */
  declare autoTour: boolean | undefined
  readonly #config = new XhConfigController(this)
  readonly #editor = createPrintEditor({
    document: createDocument(),
    describe: (operations, before) => describePrintOperations(operations, before, this.#labelSource),
  })

  /** 历史说明现取的文案与元素种类名。 */
  readonly #labelSource = {
    translations: () => this.#translations(),
    kindName: (type: string, t: PrintDesignerTranslations) => elementName(t, this.#model(), type),
  }

  #extensions: readonly PrintDesignerExtension[] | undefined
  #builtin: PrintDesignerExtension | undefined
  #designerModel: PrintDesignerModel | undefined
  readonly #host: ExtensionHost<PrintDesignerExtension> = createExtensionHost<PrintDesignerExtension, PrintDesignerContext>({
    context: () => this.#context(),
  })

  #layers: Layers | undefined
  /** 内部视口：世界坐标为纸张坐标（mm），zoom 为每毫米的屏幕像素。 */
  #viewport: Viewport = { x: 0, y: 0, zoom: PX_PER_MM }
  #autoFit = false
  #fitPending = false
  /** 等画布有了尺寸就按实际大小放：打开、换页与重设模板时排上。 */
  #placePending = true
  #layout: DesignLayout | undefined
  #layoutStale = true
  #canvasMeasurer: CanvasMeasurer | null | undefined
  #defaultEngine: ExpressionEngine | undefined
  #tableEdit: string | undefined
  #gesture: Gesture | undefined
  #dirty = false
  #issues: ValidationIssue[] = []
  #issuesScheduled = false
  #transactionOperations: PrintOperation[] = []
  #resizeObserver: ResizeObserver | undefined
  #lastMode: PrintDesignerMode = 'design'
  #spacePan = false
  #regions: { readonly key: string, readonly regions: readonly DesignerFrameRegion[] } | undefined
  /** 物料面板的内置分组（元素种类与字段），文案、模型或字段变了才重排；sourced 是上一次交给面板时物料来源那几组的内容。 */
  #palette: { readonly key: string, readonly model: PrintDesignerModel, readonly fields: readonly DataField[] | undefined, readonly builtin: readonly DesignerPaletteGroup[], sourced?: string } | undefined
  /** 这一轮物料面板的分组，以及按条目 id 交给物料来源插入。 */
  #paletteView: DesignerPaletteView<PrintDesignerContext, PrintPaletteDrop> | undefined
  /** 物料来源的条目 id（含下级）：拖到画布上时据此交给来源。 */
  #sourceItems: ReadonlySet<string> = new Set()
  /** 上一次交给小地图的图形，内容没变不重设。 */
  #minimapKey: string | undefined
  #outlineCache: { readonly document: PrintDocument, readonly t: PrintDesignerTranslations, readonly model: PrintDesignerModel, readonly outline: PrintOutline } | undefined
  /** 扩展登记的字段来源，模型换了才重取。 */
  #fieldSources: { readonly model: PrintDesignerModel, readonly sources: readonly DesignerFieldSource[] } | undefined
  #listed: { readonly issues: readonly ValidationIssue[], readonly key: string } | undefined
  #subjects: PropertySubject[] = []
  /** 进行中的手势这一步的说明，每帧重开事务时带同一个。 */
  #gestureLabel: HistoryLabel | undefined
  #panelInputs: readonly unknown[] = []
  #unregisterDrop: (() => void) | undefined
  /** 停止把宿主的 slot="menubar-end" 转交给外框。 */
  #releaseSlots: (() => void) | undefined
  /** 调试日志：开发者模式开着时，按设置记分页的每一步、重画与打印各环节的耗时。 */
  readonly #debug = createDesignerDebugLogger({ name: PRINT_DESIGNER_TAG, settings: () => this.#resolvedSettings })
  /** 交给预览与打印的环节回调，跟着两路日志的开关重建。 */
  #trace: { readonly key: string, readonly trace: PrintTrace | undefined } | undefined
  /** 自动保存本机草稿。 */
  readonly #autosave: DesignerAutosave = createDesignerAutosave({
    root: this,
    kind: PRINT_DESIGNER_TAG,
    key: () => this.draftKey,
    enabled: () => autoSaveOf(this.#resolvedSettings),
    snapshot: () => this.#editor.document as unknown as JsonValue,
    restore: document => this.#restoreDraft(document),
    confirm: options => this.#dialogService().confirm(options),
    translations: () => this.#commandTexts(),
  })

  /** 宿主在元素连上文档之前装进的模板：连上以后再看有没有草稿。 */
  #draftCheckPending = false
  #hoverId: string | undefined
  #platform: 'mac' | 'other' | undefined
  #settingsHost: DesignerSettingsHost | undefined
  #dialogs: DialogService | undefined
  #settingsHostOptions: readonly unknown[] = []
  #settingsSectionsKey = ''
  #settingsSectionList: readonly DesignerSettingsSection[] = []
  #settingsDialogKey = ''
  #toolbarSourceKey = ''
  #tourStepsKey = ''
  #helpKey = ''
  #tourChecked = false
  /** 此刻生效的设置：各分区没写的条目取了缺省值。 */
  #resolvedSettings: DesignerSettings = {}
  /** 按 settingsPolicy 换算的布局管控，settingsPolicy 换了才重算。 */
  #layoutPolicy: { readonly source: DesignerSettingsPolicy | undefined, readonly policy: DesignerLayoutPolicy } | undefined
  /** 正在听连接状态的打印客户端与退订函数。 */
  #clientWatch: { readonly client: PrintClient, readonly off: () => void } | undefined
  /** 设置对话框「本地客户端」一页的连接状态：换了 printClient 时跟着状态栏一起重新订阅。 */
  readonly #clientStatus = createPrintClientStatus({
    document: () => this.ownerDocument,
    client: () => this.printClient,
    translations: () => this.#translations(),
  })

  /**
   * 设计器这棵子树的配置：设置里选了语言时是这一语言的 UI、designer-shell 与打印语言包，跟随页面时是空对象。
   * 设计器自己、里面的元素与它弹出的浮层都按它取 locale 与文案，页面别处不受影响。
   */
  get xhConfig(): XhConfig {
    return this.#settingsHost?.localeConfig ?? FOLLOW_PAGE
  }

  /** 是否只读：readonly 移除 attribute 后为 undefined，按不只读处理。 */
  get #readOnly(): boolean {
    return this.readonly === true
  }

  constructor() {
    super()
    this.readonly = false
    this.fieldsReadonly = false
    this.mode = 'design'
    this.#editor.subscribe((change) => {
      if (change.kind === 'selection') {
        this.#editor.seal()
        if (this.#tableEdit !== undefined && !(change.selection.elements.length === 1 && change.selection.elements[0] === this.#tableEdit))
          this.#tableEdit = undefined
        this.requestUpdate()
        emitEvent(this, 'selection-change', change.selection)
        return
      }
      if (change.kind === 'page') {
        this.#tableEdit = undefined
        this.#layoutStale = true
        this.#startActualPlacement()
        this.requestUpdate()
        emitEvent(this, 'page-change', { pageId: change.pageId })
        return
      }
      if (change.kind === 'bands') {
        this.#layoutStale = true
        this.requestUpdate()
        return
      }
      if (change.cause === 'save') {
        this.#syncDirty()
        this.#autosave.changed(this.#editor.history.dirty)
        return
      }
      this.#layoutStale = true
      this.requestUpdate()
      this.#onDocumentChange(change.cause, change.operations)
    })
  }

  /** 打印模板。赋值即装载：清空历史与选择，按实际大小放到视口左上（赋回当前这一份不重新装载）；读取时得到当前模板。 */
  get schema(): PrintDocument {
    return this.#editor.document
  }

  set schema(value: PrintDocument) {
    if (value === this.#editor.document)
      return
    this.#tableEdit = undefined
    this.#editor.load(value)
    this.#startActualPlacement()
  }

  /** 当前页面模板的标识；赋值切换页面模板。 */
  get activePageId(): string {
    return this.#editor.activePageId
  }

  set activePageId(value: string) {
    this.#editor.setActivePage(value)
  }

  /** 是否有可以撤销的修改。 */
  get canUndo(): boolean {
    return this.#editor.history.canUndo
  }

  /** 是否有可以重做的修改。 */
  get canRedo(): boolean {
    return this.#editor.history.canRedo
  }

  /** 有未保存的修改。 */
  get dirty(): boolean {
    return this.#editor.history.dirty
  }

  override connectedCallback(): void {
    super.connectedCallback()
    const layers = this.#ensureLayers()
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver ??= new ResizeObserver(() => this.#onResize())
      this.#resizeObserver.observe(layers.viewport)
    }
    this.#unregisterDrop ??= registerDropTarget<unknown>(layers.viewport, {
      over: (point, payload) => this.#dropOver(point, payload),
      drop: (point, payload) => this.#drop(point, payload),
      leave: () => this.#setOverlayHover(undefined),
    })
    // 宿主写在设计器上的 slot="menubar-end"（如模板标题与保存状态）转交给外框，放在菜单栏右边
    this.#releaseSlots?.()
    this.#releaseSlots = forwardFrameSlots(this, layers.frame, ['menubar-end'])
    this.#host.assign(this.#extensions ?? NO_EXTENSIONS)
    this.requestUpdate()
    if (this.#draftCheckPending)
      void this.updateComplete.then(() => this.#checkDraft())
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#settingsHost?.dispose()
    this.#settingsHost = undefined
    this.#dialogs?.dispose()
    this.#dialogs = undefined
    this.#autosave.dispose()
    this.#clientWatch?.off()
    this.#clientWatch = undefined
    this.#clientStatus.detach()
    this.#resizeObserver?.disconnect()
    this.#cancelGesture()
    this.#layers?.overlay.cancel()
    this.#unregisterDrop?.()
    this.#unregisterDrop = undefined
    this.#releaseSlots?.()
    this.#releaseSlots = undefined
    this.#host.dispose()
  }

  /**
   * 扩展：元素种类、编辑方式、规则、属性编辑器、命令与面板都从这里来，设计器自带的扩展与内置元素自动排在最前。
   * 赋值时当场合并查重，冲突抛 DesignerExtensionError、什么都不变；各扩展的 setup 在元素连上文档时调用、断开时清理。
   * 同一个扩展对象换了引用当作卸下再装上，宿主要保持引用稳定。
   */
  get extensions(): readonly PrintDesignerExtension[] | undefined {
    return this.#extensions
  }

  set extensions(value: readonly PrintDesignerExtension[] | undefined) {
    if (value === this.#extensions)
      return
    const model = createPrintDesignerModel(this.#builtinExtension(), value ?? NO_EXTENSIONS)
    this.#ensureLayers().panelHost.assign(model.list, this.#context())
    this.#regions = undefined
    if (this.isConnected)
      this.#host.assign(value ?? NO_EXTENSIONS)
    const old = this.#extensions
    this.#extensions = value
    this.#designerModel = model
    this.#editor.setExtensions(model.list)
    this.requestUpdate('extensions', old)
  }

  protected override update(changed: PropertyValues): void {
    if (!this.#debug.enabled('render')) {
      this.#update(changed)
      return
    }
    const reasons = [...changed.keys()].map(String).join(', ')
    this.#debug.measure('render', `update: ${reasons === '' ? 'requestUpdate' : reasons}`, () => this.#update(changed))
  }

  /** 一次重画：设置、面板、工具栏与菜单，设计态画纸与画布上的各层，预览态交给预览元素。 */
  #update(changed: PropertyValues): void {
    super.update(changed)
    const layers = this.#ensureLayers()
    const t = this.#translations()
    this.#editor.setExtensions(this.#model().list)
    this.#syncSettings(layers, t, changed)
    this.#syncHelp(layers, t)
    if (['sampleData', 'extensions', 'expressionEngine', 'formatter', 'measurer', 'locale', 'timeZone'].some(name => changed.has(name)))
      this.#layoutStale = true
    if (changed.has('extensions') || changed.has('expressionEngine'))
      this.#scheduleIssues()
    this.toggleAttribute('data-readonly', this.#readOnly)
    this.dataset.mode = this.mode
    if (this.mode !== this.#lastMode) {
      this.#lastMode = this.mode
      emitEvent(this, 'mode-change', { mode: this.mode })
    }
    this.#syncLayout(layers)
    this.#syncPalette(layers, t)
    this.#syncFieldImport(layers, t)
    this.#syncIssues(layers, t)
    this.#syncProperties(layers, t)
    this.#syncFrameRegions(layers, t)
    this.#renderToolbar(layers)
    this.#renderMenubar(layers)
    this.#renderSelectionBar(layers, t)
    this.#renderPageStrip(layers, t)
    this.#renderStatus(layers, t)
    layers.panelHost.update(this.#context())
    layers.viewport.setAttribute('aria-label', t.canvas)
    const preview = this.mode === 'preview'
    this.#placeCanvas(layers, preview)
    layers.preview.hidden = !preview
    if (preview) {
      this.#syncPreview(this.#ensurePreview())
      return
    }
    if (this.#layoutStale) {
      this.#layout = this.#debug.measure('render', 'layout: design', () => this.#computeLayout())
      this.#layoutStale = false
    }
    this.#renderPaper(layers, t)
    this.#syncMinimap(layers)
    this.#syncOverlay(layers)
    this.#syncRuler(layers)
    if (!this.#fitIfPending() && !this.#placeIfPending())
      this.#applyViewport(false)
    this.#checkTour()
  }

  /** 第一次在设计态铺好、画布有了尺寸之后，看要不要自动开始新手引导；每个元素只看一次，画布没有尺寸（还藏着）时等下一次，同一页里别的引导开着时不开始。 */
  #checkTour(): void {
    if (this.#tourChecked || this.mode !== 'design' || !this.#size())
      return
    this.#tourChecked = true
    if (this.autoTour === false || tourDoneOf(this.settings))
      return
    void this.updateComplete.then(() => {
      if (this.isConnected && this.mode === 'design' && this.autoTour !== false && !tourDoneOf(this.settings))
        this.#layers?.tour.start()
    })
  }

  /**
   * 新手引导的步骤与设置对话框的帮助、快捷键、关于三页，按此刻的语言与命令表现算，内容没变不重设：
   * 帮助页是几段操作说明与「开始引导」「帮助」两颗钮；快捷键表从命令表生成，另加不是命令的几个键，「通用」里
   * 方向键与 Esc 两行按打印的实际做法改写说明；
   * 关于页是打印设计器的版本与许可证，后面接扩展给的几行。
   */
  #syncHelp(layers: Layers, t: PrintDesignerTranslations): void {
    const context = this.#context()
    const model = this.#model()
    const steps = resolveTourSteps(model.tourSteps, context)
    const stepsKey = JSON.stringify(steps)
    if (stepsKey !== this.#tourStepsKey) {
      this.#tourStepsKey = stepsKey
      layers.tour.steps = steps
    }
    const help = {
      notes: t.helpNotes,
      actions: [{ command: DESIGNER_SHELL_COMMANDS.startTour, label: context.commands.startTour }, { command: DESIGNER_SHELL_COMMANDS.help, label: context.commands.help }],
    }
    const shortcuts = shortcutSettingsSource(model.commands, context, {
      extensionCommands: (this.#extensions ?? NO_EXTENSIONS).flatMap(extension => (extension.commands ?? []).map(command => command.id)),
      commonKeys: DESIGNER_COMMON_KEYS.map(key => key.id === 'nudge' ? { ...key, label: t.shortcutNudge } : key.id === 'cancel' ? { ...key, label: t.shortcutCancel } : key),
      keys: [
        { label: context.commands.copy, keys: [['Mod', 'C']] },
        { label: context.commands.cut, keys: [['Mod', 'X']] },
        { label: context.commands.paste, keys: [['Mod', 'V']] },
        { label: context.commands.delete, keys: [['Backspace']] },
        { label: t.editTable, keys: [['Enter']] },
      ],
    })
    const about = { product: t.label, version: PRINT_VERSION, license: 'MIT', rows: model.list.flatMap(extension => extension.about ?? []) }
    const helpKey = JSON.stringify([help, shortcuts, about])
    if (helpKey !== this.#helpKey) {
      this.#helpKey = helpKey
      layers.settings.help = help
      layers.settings.shortcuts = shortcuts
      layers.settings.about = about
    }
  }

  /** 设置对话框帮助页里的钮：关上对话框，再跑那条命令（开始引导、打开帮助）。 */
  readonly #onSettingsCommand = (event: Event): void => {
    event.stopPropagation()
    const { command } = (event as DesignerSettingsEventMap['settings-command']).detail
    this.#ensureLayers().settings.open = false
    runCommand(this.#model().commands, command, this.#context())
  }

  /** 引导收起了（走完、跳过或关上）：设置里记下 help.tourDone，之后不再自动开始。 */
  readonly #onTourEnd = (): void => {
    if (tourDoneOf(this.settings))
      return
    const key = DESIGNER_TOUR_DONE_KEY
    this.#commitSettings({ key, value: true, settings: { ...this.settings, [key]: true } })
  }

  /** 执行一组操作并记为一步撤销；返回新的模板。 */
  execute(operations: readonly PrintOperation[], options?: ExecuteOptions): PrintDocument {
    return this.#editor.execute(operations, options)
  }

  /** 撤销一步；没有可撤销的修改时返回 false。 */
  undo(): boolean {
    return this.#editor.undo()
  }

  /** 重做一步；没有可重做的修改时返回 false。 */
  redo(): boolean {
    return this.#editor.redo()
  }

  /** 把当前状态记为已保存。 */
  markSaved(): void {
    this.#editor.history.markSaved()
  }

  /** 新建元素并选中：at 是元素中心的纸张坐标（mm），缺省放在视口中央；位置吸附网格，region 缺省按落点所在区决定。 */
  addElement(type: string, at?: Point, options: { readonly region?: ElementRegion } = {}): PrintElement {
    const center = at ?? this.#viewportCenter()
    const placed = this.#placement(type, center)
    if (placed === undefined)
      throw new Error(`[print-designer] element type "${type}" is not registered`)
    return this.#editor.addElement(type, { x: placed.x, y: placed.y, region: options.region ?? this.#regionAt(center) })
  }

  /** 替换当前选择；不在当前页面模板正文与当前显示的页眉页脚变体里的元素会被忽略。 */
  select(selection: Partial<PrintSelection>): void {
    this.#editor.select(selection)
  }

  /** 当前选择。 */
  getSelection(): PrintSelection {
    return this.#editor.selection
  }

  /** 删除选中的元素；只读或没有选中时返回 false。 */
  deleteSelection(): boolean {
    return !this.#readOnly && this.#editor.deleteSelection()
  }

  /** 复制选中的元素；没有选中时返回 undefined。 */
  copy(): PrintClipboard | undefined {
    return this.#editor.copy()
  }

  /** 复制并删除选中的元素；只读或没有选中时返回 undefined。 */
  cut(): PrintClipboard | undefined {
    return this.#readOnly ? undefined : this.#editor.cut()
  }

  /** 粘贴到当前页面模板并选中粘贴出的元素；缺省用最近一次复制的内容，连续粘贴依次错开。只读时不粘贴。 */
  paste(clipboard?: PrintClipboard): PrintSelection {
    return this.#readOnly ? this.#editor.selection : this.#editor.paste(clipboard)
  }

  /** 复制选中的元素并立即粘贴，不改动剪贴板；只读时什么都不做。 */
  duplicate(): PrintSelection {
    return this.#readOnly ? this.#editor.selection : this.#editor.duplicate()
  }

  /** 对齐选中的元素；少于两个或只读时什么都不做。 */
  align(mode: AlignMode): void {
    if (!this.#readOnly)
      this.#editor.align(mode)
  }

  /** 等距分布选中的元素；少于三个或只读时什么都不做。 */
  distribute(axis: DistributeAxis): void {
    if (!this.#readOnly)
      this.#editor.distribute(axis)
  }

  /** 调整选中元素的层级。 */
  reorder(target: ReorderTarget): void {
    if (!this.#readOnly)
      this.#editor.reorder(target)
  }

  /** 打开设置对话框，给了分区 id 就显示那一页：基础是 general，设计器自己的「画布」是 print。 */
  openSettings(section?: string): void {
    this.#ensureLayers().settings.show(section)
  }

  /**
   * 打开编辑整份模板 JSON 的对话框：写出当前模板，边改边按打印的校验报问题；没有错误时「应用」整份换上，记一步撤销。
   * 只读时只能看、不能应用。
   */
  openJsonEditor(): void {
    const dialog = this.#ensureLayers().jsonEditor
    dialog.value = this.#editor.document as unknown as JsonValue
    dialog.validate = value => this.#jsonIssues(value)
    dialog.readonly = this.#readOnly
    dialog.show()
  }

  /** 从头开始新手引导：通用步骤加打印与扩展的步骤，同一页里别的引导开着时先收起它；预览态或没有能走的步骤时返回 false。 */
  startTour(): boolean {
    if (this.mode === 'preview')
      return false
    return this.#ensureLayers().tour.start({ force: true })
  }

  /** 打开导入字段对话框，给了页 id 就显示那一页：内置的是 sample 与 json-schema，扩展的字段来源用它的 id。 */
  openFieldImport(source?: string): void {
    this.#ensureLayers().fieldImport.show(source)
  }

  /** 按当前登记表与表达式引擎校验模板。 */
  validate(): ValidationIssue[] {
    return validateDocument(this.#editor.document, { extensions: this.#model().list, expressionEngine: this.#engine() }).issues
  }

  /** 视口：屏幕坐标 = 纸张坐标（mm）× zoom × 96 / 25.4 + (x, y)；zoom 为 1 时是实际尺寸。 */
  getViewport(): Viewport {
    const { x, y, zoom } = this.#viewport
    return { x, y, zoom: zoom / PX_PER_MM }
  }

  /** 设置视口；此后尺寸变化不再自动适配。 */
  setViewport(viewport: Viewport): void {
    this.#stopAutoFit()
    this.#moveTo({ x: viewport.x, y: viewport.y, zoom: viewport.zoom * PX_PER_MM })
  }

  /**
   * 让整张纸连同左侧的页眉页脚标签落在视口中央，让开浮在画布一侧的翻页条（让出的宽度与四周留白取较大的那个），不放大到实际尺寸以上；
   * 此后尺寸变化时重新适配，直到设置视口或在画布上操作。
   */
  zoomToFit(): void {
    this.#startAutoFit()
    this.#fitIfPending()
  }

  /** 以视口中心放大一档。 */
  zoomIn(): void {
    this.#zoomAtCenter(ZOOM_STEP)
  }

  /** 以视口中心缩小一档。 */
  zoomOut(): void {
    this.#zoomAtCenter(1 / ZOOM_STEP)
  }

  /** 实际尺寸，纸张居中。 */
  zoomToActual(): void {
    const size = this.#size()
    if (!size)
      return
    const paper = getPaperSize(this.#editor.page)
    this.#stopAutoFit()
    this.#moveTo(centerOn({ x: 0, y: 0, zoom: PX_PER_MM }, { x: paper.width / 2, y: paper.height / 2 }, size))
  }

  /** 切到元素所在的页面模板与带区变体，并把元素居中。 */
  scrollToElement(id: string): void {
    const rect = this.#bringIntoView(id)
    const size = this.#size()
    if (rect && size) {
      this.#stopAutoFit()
      this.#moveTo(centerOn(this.#viewport, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, size))
    }
  }

  /** 切到元素所在的页面模板与带区变体；元素没整个落在视口内时把它居中。 */
  revealElement(id: string): void {
    const rect = this.#bringIntoView(id)
    const size = this.#size()
    if (!rect || !size)
      return
    const next = revealRect(this.#viewport, rect, size, FIT_PADDING)
    if (next !== this.#viewport) {
      this.#stopAutoFit()
      this.#moveTo(next)
    }
  }

  /** 浏览器视口坐标换成纸张坐标（mm）。 */
  clientToWorld(clientX: number, clientY: number): Point {
    const box = this.#ensureLayers().viewport.getBoundingClientRect()
    return screenToWorld(this.#viewport, { x: clientX - box.left, y: clientY - box.top })
  }

  /** 按当前模板与 data 打印，等同 <xh-print-preview> 的 print。 */
  async print(options: PrintPreviewPrintOptions = {}): Promise<PrintOutcome> {
    const preview = this.#ensurePreview()
    this.#syncPreview(preview)
    const end = this.#debug.start('render', 'print')
    const outcome = await preview.print(options)
    end(() => outcome)
    return outcome
  }

  // —— 内部：模型与布局 ——

  /** 当前扩展合出的设计器模型。 */
  #model(): PrintDesignerModel {
    this.#designerModel ??= createPrintDesignerModel(this.#builtinExtension(), this.#extensions ?? NO_EXTENSIONS)
    return this.#designerModel
  }

  /** 设计器自带的扩展：内置命令、菜单栏的插入与页面两张菜单、页面结构与历史记录面板、新手引导里打印的几步，以及表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 */
  #builtinExtension(): PrintDesignerExtension {
    if (this.#builtin !== undefined)
      return this.#builtin
    const composite: CompositeEditorHost = {
      ownerDocument: this.ownerDocument,
      translations: () => this.#translations(),
      engine: () => this.#engine(),
      locale: () => this.locale,
      timeZone: () => this.timeZone,
    }
    this.#builtin = {
      id: PRINT_DESIGNER_EXTENSION_ID,
      commands: this.#builtinCommands(),
      menubarMenus: [
        { id: PRINT_MENUBAR_MENUS.insert, label: ({ translations }) => translations.menuInsert, order: 30 },
        { id: PRINT_MENUBAR_MENUS.page, label: ({ translations }) => translations.menuPage, order: 40 },
      ],
      panels: [this.#outlinePanel(), this.#historyPanel()],
      tourSteps: PRINT_TOUR_STEPS,
      editors: {
        byControl: {
          tableColumns: this.#partList('column'),
          tableFooterRows: this.#partList('footerRow'),
          pageNumberFormat: this.#pageNumberFormat(),
          borderSides: borderSidesEditor(composite),
          valueFormat: valueFormatEditor(composite),
        },
      },
    }
    return this.#builtin
  }

  /**
   * 页面结构面板：按页面模板、区与带区列出元素，同一容器里最上层排最前。选择与画布是同一份：树上的选中整份换上，
   * 空数组即全部取消；新选上的第一个先切到它所在的页面与带区、滚进可见区，只取消几行时不滚；选择只留当前页面与带区里的元素。
   * 悬停在画布上标出；挪动只在同一容器里调层级，跨页眉、正文、页脚仍在画布上拖。
   */
  #outlinePanel(): DesignerPanel<PrintDesignerContext> {
    return createOutlinePanel<PrintDesignerContext>({
      nodes: () => this.#outline().nodes,
      selection: () => this.#editor.selection.elements,
      select: (_context, ids) => {
        const places = this.#outline().places
        const before = new Set(this.#editor.selection.elements)
        const elements = ids.filter(id => places.has(id))
        const added = elements.find(id => !before.has(id))
        if (added !== undefined)
          this.revealElement(added)
        this.select({ elements })
      },
      highlight: (_context, id) => {
        const item = id === null ? undefined : this.#editor.visibleElements().find(visible => visible.element.id === id)
        this.#setOverlayHover(item === undefined ? undefined : elementRect(item.element))
      },
      remove: (_context, ids) => {
        const places = this.#outline().places
        const removable = ids.filter(id => places.has(id))
        if (!this.#readOnly && removable.length > 0)
          this.#editor.execute(removable.map(id => ({ type: 'removeElement', id })))
      },
      canMove: (_context, move) => this.#outline().places.get(move.id)?.parent === move.parent,
      move: (_context, move) => {
        const place = this.#outline().places.get(move.id)
        const index = findElement(this.#editor.document, move.id)?.index
        if (place === undefined || place.parent !== move.parent || index === undefined)
          return
        const to = place.count - 1 - move.index
        if (to !== index)
          this.#editor.execute([{ type: 'reorderElement', id: move.id, to }])
      },
    }, { region: { icon: ListTreeIcon }, readonly: () => this.#readOnly || this.mode !== 'design' })
  }

  /** 历史记录面板：列出撤销历史，选一步就跳过去；缺省停在右栏属性下面、缺省隐藏，面板头是清空历史。 */
  #historyPanel(): DesignerPanel<PrintDesignerContext> {
    return createHistoryPanel<PrintDesignerContext>({
      snapshot: () => snapshotHistory(this.#editor.history),
      goTo: (_context, position) => {
        if (!this.#readOnly && this.mode === 'design')
          this.#editor.history.goTo(position)
      },
      announce: (context, message) => context.frame?.announce(message),
    }, { region: { icon: HistoryIcon }, readonly: () => this.#readOnly || this.mode !== 'design' })
  }

  /** 此刻的页面结构：模板、语言或扩展换了才重排。 */
  #outline(): PrintOutline {
    const document = this.#editor.document
    const t = this.#translations()
    const model = this.#model()
    if (this.#outlineCache?.document === document && this.#outlineCache.t === t && this.#outlineCache.model === model)
      return this.#outlineCache.outline
    const outline = printOutline(document, {
      page: (page, index) => page.name ?? t.pageTitle(index + 1),
      region: region => t.regions[region],
      band: key => t.bandVariants[key],
      element: (element) => {
        const kind = elementName(t, model, element.type)
        const icon = elementIcon(model, element.type)
        return {
          ...(element.name === undefined ? { label: `${kind} · ${element.id}` } : { label: element.name, description: kind }),
          ...(icon === undefined ? {} : { icon }),
        }
      },
    })
    this.#outlineCache = { document, t, model, outline }
    return outline
  }

  /** 设计器自带的命令：可用与否、选中状态与执行都取设计器此刻的状态。 */
  #builtinCommands(): PrintDesignerCommand[] {
    const builtin = (Object.keys(ICONS) as Command[]).map((id): PrintDesignerCommand => {
      const shortcut = SHORTCUTS[id]
      return {
        id,
        label: context => builtinLabel(id, context),
        icon: ICONS[id],
        ...(shortcut === undefined ? {} : { shortcut }),
        ...(DESTRUCTIVE.has(id) ? { tone: 'danger' as const } : {}),
        ...(TOGGLES.has(id) ? { checked: () => this.#commandChecked(id) } : {}),
        enabled: () => this.#commandEnabled(id),
        run: () => this.#run(id),
      }
    })
    // designer-shell 的撤销、重做与清空历史：只读与预览态不可用，清空先弹确认框
    const history = designerHistoryCommands<PrintDesignerContext>({
      history: () => this.#editor.history,
      disabled: () => this.#readOnly || this.mode !== 'design',
      translations: context => context.commands,
      historyTranslations: () => this.#historyTexts(),
      confirm: (_context, options) => this.#dialogService().confirm(options),
      announce: (context, message) => context.frame?.announce(message),
      icons: { undo: UndoIcon, redo: RedoIcon, clearHistory: EraserIcon },
    })
    // designer-shell 内置的保存、面板、设置、帮助与外观（三条显示开关），缺省落在菜单栏，面板与拖动也上工具栏；设计器自己的每块面板一条开关命令 panel:<面板 id>
    const shell = designerShellCommands<PrintDesignerContext>({
      translations: context => context.commands,
      save: () => emitEvent(this, 'save', {}),
      frame: context => context.frame,
      openSettings: ({ designer }, section) => designer.openSettings(section),
      settings: {
        read: context => context.settings,
        change: (_context, key, value) => this.#writeSetting(key, value),
        policy: () => this.settingsPolicy,
      },
      helpUrl: () => PRINT_DESIGNER_HELP_URL,
      openFieldImport: ({ designer }) => designer.openFieldImport(),
      startTour: ({ designer }) => designer.startTour(),
      openJsonEditor: ({ designer }) => designer.openJsonEditor(),
      fieldImportDisabled: () => !this.#fieldImportAllowed(),
      icons: { save: SaveIcon, panels: PanelLeftIcon, settings: SettingsIcon, help: CircleHelpIcon, importFields: DatabaseIcon, editJson: FileCodeIcon, panTool: HandIcon, about: InfoIcon, appearance: EyeIcon, startTour: MapIcon },
    })
    const panels = designerPanelCommands<PrintDesignerContext>({ panels: Object.values(PRINT_DESIGNER_PANELS), frame: context => context.frame })
    return [...history, ...builtin, ...this.#formatCommands(), this.#pageSetup(), this.#pageMenu(), ...this.#pageCommands(), ...this.#bandCommands(), ...shell, ...panels]
  }

  /**
   * 格式工具条上的命令：字号（菜单）、粗体、斜体、下划线、删除线与左中右对齐，作用于选中的文字类元素（带文字样式的）。
   * 开关与对齐在所有对象都是这样时显示按下；点了对每个对象写同一个值，记一步撤销。
   */
  #formatCommands(): PrintDesignerCommand[] {
    const enabled = (): boolean => !this.#readOnly && this.mode === 'design' && this.#formatTargets().length > 0
    const all = (test: (style: TextStyle) => boolean): boolean => {
      const targets = this.#formatTargets()
      return targets.length > 0 && targets.every(target => test(target.style))
    }
    const write = (key: string, value: JsonValue): void => {
      const targets = this.#formatTargets()
      if (targets.length > 0)
        this.#editor.execute(targets.map((target): PrintOperation => ({ type: 'updateElement', id: target.id, changes: [{ path: ['style', key], value }] })))
    }
    const uniformSize = (): number | undefined => {
      const sizes = new Set(this.#formatTargets().map(target => target.style.fontSize))
      return sizes.size === 1 ? [...sizes][0] : undefined
    }
    const sizeText = (): string => String(uniformSize() ?? '—')
    return [
      {
        id: 'font-size',
        label: ({ translations }) => translations.fontSizeMenu(sizeText()),
        shortLabel: sizeText,
        enabled,
        menu: () => FONT_SIZES.map(size => ({ value: String(size), label: String(size), checked: uniformSize() === size, group: 'font-size' })),
        select: value => write('fontSize', Number(value)),
      },
      ...FORMAT_FLAGS.map(({ id, flag, icon }): PrintDesignerCommand => ({
        id,
        label: ({ translations }) => translations.propertyNames[`style.${flag}`] ?? flag,
        icon,
        enabled,
        checked: () => all(style => style[flag] === true),
        run: () => write(flag, !all(style => style[flag] === true)),
      })),
      ...TEXT_ALIGNS.map(({ id, align, label, icon }): PrintDesignerCommand => ({
        id,
        label: ({ translations }) => translations[label],
        icon,
        enabled,
        checked: () => all(style => style.align === align),
        run: () => write('align', align),
      })),
    ]
  }

  /** 格式工具条作用的对象：设计态、不在表格编辑态时，选中的可见元素里带文字样式的。 */
  #formatTargets(): { readonly id: string, readonly style: TextStyle }[] {
    if (this.mode !== 'design' || this.#tableEdit !== undefined)
      return []
    const selected = new Set(this.#editor.selection.elements)
    return this.#editor.visibleElements().flatMap(({ element }) => {
      const style = (element as { style?: unknown }).style
      return selected.has(element.id) && typeof style === 'object' && style !== null && typeof (style as { bold?: unknown }).bold === 'boolean'
        ? [{ id: element.id, style: style as TextStyle }]
        : []
    })
  }

  /** 选中工具条的主体：全是文字类元素为 text，单个别的元素为 element，几个元素里有别的种类为 multiple；覆盖层上没有选中项时为 undefined。 */
  #selectionSubject(): PrintSelectionSubject | undefined {
    const count = this.#overlayItems().length
    if (count === 0)
      return undefined
    if (this.#formatTargets().length === count)
      return 'text'
    return count === 1 ? 'element' : 'multiple'
  }

  /**
   * 选中工具条：按主体取 selection:<主体> 的排列（宿主经 commandLayout 改），可编辑、有选中、排列不空时放进变换覆盖层
   * （slot="toolbar"），否则拿掉；位置与收起由覆盖层管。
   */
  #renderSelectionBar(layers: Layers, t: PrintDesignerTranslations): void {
    const subject = this.#readOnly ? undefined : this.#selectionSubject()
    const { commands } = this.#model()
    const groups = subject === undefined ? [] : arrangeCommands(`selection:${subject}`, commands, printSelectionLayout(subject), this.commandLayout)
    if (groups.every(group => group.length === 0)) {
      layers.selectionBar.element.remove()
      return
    }
    layers.selectionBar.update(groups, commands, this.#context(), t.selectionToolbar)
    if (!layers.selectionBar.element.isConnected)
      layers.overlay.append(layers.selectionBar.element)
  }

  /**
   * 页面设置：工具栏上的弹层命令，弹层里是当前页面模板的纸张、方向与页边距，用一份属性零件铺，与属性面板共用描述与文案；
   * 改动与属性面板里一样记撤销。只读时照常打开、字段只读，预览态不可用。
   */
  #pageSetup(): PrintDesignerCommand {
    return {
      id: 'page-setup',
      label: ({ translations }) => translations.pageSettings,
      icon: FileIcon,
      placement: ['toolbar'],
      enabled: () => this.mode === 'design',
      panel: () => {
        const panel = createAuthoredElement(this.ownerDocument, 'xh-designer-properties', { 'data-part': 'page-setup', 'headless': true }) as XhDesignerPropertiesElement
        let subject = pageSubject(this.#editor, (kind, descriptor) => resolvePropertyEditor(this.#propertyEditors(), kind, descriptor) !== undefined)
        panel.addEventListener('property-change', (event) => {
          event.stopPropagation()
          const { path, value, merge } = (event as DesignerPropertiesEventMap['property-change']).detail
          if (!this.#readOnly)
            this.#editor.execute([subject.write(path, value)], { merge, mergeWithin: Number.POSITIVE_INFINITY, ...this.#propertyLabel(subject, path) })
        })
        panel.addEventListener('property-commit', (event) => {
          event.stopPropagation()
          this.#editor.seal()
        })
        const render = (): void => {
          const t = this.#translations()
          subject = pageSubject(this.#editor, (kind, descriptor) => resolvePropertyEditor(this.#propertyEditors(), kind, descriptor) !== undefined)
          panel.editors = this.#propertyEditors()
          this.#labelProperties(panel, 'page', t)
          panel.groupOrder = ['paper']
          panel.targets = [{ kind: subject.kind, id: subject.id, value: subject.value, descriptors: subject.descriptors.filter(descriptor => descriptor.group === 'paper') }]
          panel.readonly = this.#readOnly
        }
        render()
        return { element: panel, update: render }
      },
    }
  }

  /** 翻页条上的页码：点开菜单，上半是全部页面模板（单选），下半是上移、下移页面。 */
  #pageMenu(): PrintDesignerCommand {
    const name = (index: number, t: PrintDesignerTranslations): string => this.#editor.document.pages[index]?.name ?? t.pageTitle(index + 1)
    return {
      id: 'page-menu',
      label: ({ translations }) => translations.pagePosition(this.#pageIndex() + 1, this.#editor.document.pages.length, name(this.#pageIndex(), translations)),
      shortLabel: () => `${this.#pageIndex() + 1} / ${this.#editor.document.pages.length}`,
      enabled: () => this.mode === 'design',
      menu: ({ translations }) => [
        ...this.#editor.document.pages.map((page, index) => ({ value: page.id, label: name(index, translations), checked: page.id === this.#editor.activePageId, group: 'page' })),
        'separator',
        'move-page-up',
        'move-page-down',
      ],
      select: (value) => {
        if (this.#editor.document.pages.some(page => page.id === value))
          this.#editor.setActivePage(value)
      },
    }
  }

  /**
   * 页面菜单里的纸张与方向：子菜单列出纸张预设与纵向、横向（单选，当前页面模板的打勾），选中写进当前页面模板、记一步撤销，
   * 只读或预览态不可用；「页面设置」在属性面板里编辑当前页面模板，预览态或属性面板显示不了时不可用。
   */
  #pageCommands(): PrintDesignerCommand[] {
    const editable = (): boolean => !this.#readOnly && this.mode === 'design'
    const name = (t: PrintDesignerTranslations, key: string): string => t.propertyNames[`page:${key}`] ?? t.propertyNames[key] ?? key
    const option = (t: PrintDesignerTranslations, key: string, value: string): string => t.propertyOptions[`${key}=${value}`] ?? t.propertyOptions[value] ?? value
    const write = (key: 'paper' | 'orientation', value: JsonValue): void => {
      const page = this.#editor.page
      if (editable() && !jsonEquals(page[key] as unknown as JsonValue, value))
        this.#editor.execute([{ type: 'updatePage', pageId: page.id, changes: [{ path: [key], value }] }])
    }
    return [
      {
        id: 'page-paper',
        label: ({ translations }) => name(translations, 'paper'),
        enabled: editable,
        menu: ({ translations }) => PAPER_PRESET_NAMES.map(preset => ({ value: preset, label: option(translations, 'paper', preset), checked: this.#editor.page.paper.preset === preset, group: 'paper' })),
        select: (value) => {
          if (isPaperPresetName(value))
            write('paper', createPaper(value) as unknown as JsonValue)
        },
      },
      {
        id: 'page-orientation',
        label: ({ translations }) => name(translations, 'orientation'),
        enabled: editable,
        menu: ({ translations }) => PAGE_ORIENTATIONS.map(orientation => ({ value: orientation, label: option(translations, 'orientation', orientation), checked: this.#editor.page.orientation === orientation, group: 'orientation' })),
        select: (value) => {
          if ((PAGE_ORIENTATIONS as readonly string[]).includes(value))
            write('orientation', value)
        },
      },
      {
        id: 'page-properties',
        label: ({ translations }) => translations.pageSettings,
        icon: SlidersHorizontalIcon,
        enabled: () => this.mode === 'design' && this.#propertiesAvailable(),
        run: () => this.#showPageProperties(),
      },
    ]
  }

  /** 属性面板显示得出来：外框里有它，没被宿主锁成隐藏。 */
  #propertiesAvailable(): boolean {
    const entry = this.#layers?.frame.panelEntries().find(item => item.name === PRINT_DESIGNER_PANELS.properties)
    return entry !== undefined && (entry.shown || !entry.locked)
  }

  /** 在属性面板里编辑当前页面模板：退出表格编辑、取消选择，属性面板藏着时显示出来，收着时亮出来。 */
  #showPageProperties(): void {
    const frame = this.#layers?.frame
    if (frame === undefined || this.mode !== 'design' || !this.#propertiesAvailable())
      return
    if (this.#tableEdit !== undefined)
      this.#exitTableEdit()
    this.#editor.clearSelection()
    if (!frame.showsPanel(PRINT_DESIGNER_PANELS.properties))
      frame.setPanelVisible(PRINT_DESIGNER_PANELS.properties, true)
    frame.revealPanel(PRINT_DESIGNER_PANELS.properties)
  }

  /**
   * 插入菜单里的页眉、页脚两条：子菜单上半是已有的变体（单选，当前显示的打勾），下半是还没有的变体，写「新增变体 · …」；
   * 显示的不是常规时末尾是删除这个变体。与画布上区标签的变体菜单做同一件事；预览态不可用，只读时新增与删除不可用。
   */
  #bandCommands(): PrintDesignerCommand[] {
    return (['header', 'footer'] as const).map((region): PrintDesignerCommand => ({
      id: `${region}-variants`,
      label: ({ translations }) => translations.regions[region],
      enabled: () => this.mode === 'design',
      menu: ({ translations }) => {
        const set = this.#editor.page[region]
        const current = this.#editor.bands[region]
        const missing = PAGE_BAND_KEYS.filter(key => set[key] === undefined)
        return [
          ...PAGE_BAND_KEYS.filter(key => set[key] !== undefined).map(key => ({ value: `show:${key}`, label: translations.bandVariants[key], checked: key === current, group: 'band-variant' })),
          ...(missing.length > 0 ? ['separator'] : []),
          ...missing.map(key => ({ value: `add:${key}`, label: `${translations.addBandVariant} · ${translations.bandVariants[key]}`, ...(this.#readOnly ? { disabled: true } : {}) })),
          ...(current !== 'default' && !this.#readOnly ? ['separator', { value: 'remove', label: translations.removeBandVariant, tone: 'danger' as const }] : []),
        ]
      },
      select: value => this.#selectBand(region, value),
    }))
  }

  /** 页眉页脚变体菜单选中一项：show:<变体> 切过去，add:<变体> 新增并切过去，remove 删除显示着的变体；只读时只能切换。 */
  #selectBand(region: 'header' | 'footer', value: string): void {
    const [action, key] = value.split(':') as [string, PageBandKey | undefined]
    const current = this.#editor.bands[region]
    if (action === 'show' && key !== undefined)
      this.#editor.setBandVariant(region, key)
    else if (action === 'add' && key !== undefined && key !== 'default' && !this.#readOnly)
      this.#editor.addBand(region, key)
    else if (action === 'remove' && current !== 'default' && !this.#readOnly)
      this.#editor.removeBand(region, current)
  }

  /** 交给命令与扩展 setup 的上下文。 */
  #context(): PrintDesignerContext {
    return { designer: this, translations: this.#translations(), commands: this.#commandTexts(), settings: this.#resolvedSettings, frame: this.#layers?.frame }
  }

  /** 此刻生效的共用命令文案。 */
  #commandTexts(): DesignerCommandsTranslations {
    return this.#config.translations<DesignerCommandsTranslations>('xh-designer-commands', DESIGNER_COMMANDS_EN_US)
  }

  #historyTexts(): DesignerHistoryTranslations {
    return this.#config.translations<DesignerHistoryTranslations>('xh-designer-history', DESIGNER_HISTORY_EN_US)
  }

  /** 确认框服务：第一次要弹确认框时建，元素移出文档时释放。 */
  #dialogService(): DialogService {
    this.#dialogs ??= createDialogService()
    return this.#dialogs
  }

  #kbdPlatform(): 'mac' | 'other' {
    this.#platform ??= detectKbdPlatform()
    return this.#platform
  }

  #engine(): ExpressionEngine {
    if (this.expressionEngine)
      return this.expressionEngine
    this.#defaultEngine ??= createExpressionEngine()
    return this.#defaultEngine
  }

  #measurerOrUndefined(): TextMeasurer | undefined {
    if (this.measurer)
      return this.measurer
    if (this.#canvasMeasurer === undefined)
      this.#canvasMeasurer = createCanvasMeasurer(this.ownerDocument)
    return this.#canvasMeasurer ?? undefined
  }

  #computeLayout(): DesignLayout | undefined {
    const measurer = this.#measurerOrUndefined()
    if (measurer === undefined)
      return undefined
    const page = this.#editor.page
    return layoutDesign(page, {
      measurer,
      extensions: this.#model().list,
      expressionEngine: this.#engine(),
      formatter: this.formatter ?? formatValue,
      ...(this.locale === undefined ? {} : { locale: this.locale }),
      ...(this.timeZone === undefined ? {} : { timeZone: this.timeZone }),
      ...(this.sampleData === undefined ? {} : { sampleData: this.sampleData }),
      bands: this.#editor.bands,
      pageIndex: Math.max(0, this.#editor.document.pages.indexOf(page)),
    })
  }

  #onDocumentChange(cause: string, operations: readonly PrintOperation[]): void {
    this.#scheduleIssues()
    this.#syncDirty()
    if (cause === 'reset')
      this.#checkDraft()
    else
      this.#autosave.changed(this.#editor.history.dirty)
    if (cause === 'execute' && this.#editor.history.inTransaction) {
      this.#transactionOperations.push(...operations)
      return
    }
    if (cause === 'rollback') {
      this.#transactionOperations = []
      return
    }
    if (cause === 'commit') {
      const collected = this.#transactionOperations
      this.#transactionOperations = []
      if (collected.length > 0)
        this.#emitSchemaChange(collected, 'execute')
    }
    else if (cause === 'reset') {
      this.#emitSchemaChange([], 'load')
    }
    else if (cause === 'execute' || cause === 'undo' || cause === 'redo') {
      this.#emitSchemaChange(operations, cause)
    }
  }

  /** 宿主装进了一份模板：同一个草稿键下有和它不一样的草稿就问恢复还是丢弃；还没连上文档时等连上再问，只读时不问。 */
  #checkDraft(): void {
    if (!this.isConnected) {
      this.#draftCheckPending = true
      return
    }
    this.#draftCheckPending = false
    if (!this.#readOnly)
      void this.#autosave.loaded(this.#editor.document as unknown as JsonValue)
  }

  /** 恢复草稿：没有错误级校验问题时整份换上，记一步撤销；有错误（如扩展换了）时不换。 */
  #restoreDraft(document: JsonValue): void {
    if (this.#readOnly || !validateDocument(document, { extensions: this.#model().list, expressionEngine: this.#engine() }).valid)
      return
    this.#tableEdit = undefined
    this.#editor.execute([{ type: 'replaceDocument', document: document as unknown as PrintDocument }])
  }

  #emitSchemaChange(operations: readonly PrintOperation[], kind: PrintSchemaChangeKind): void {
    emitEvent(this, 'schema-change', { schema: this.#editor.document, operations, kind })
  }

  #syncDirty(): void {
    const dirty = this.#editor.history.dirty
    if (dirty === this.#dirty)
      return
    this.#dirty = dirty
    emitEvent(this, 'dirty-change', { dirty })
  }

  #scheduleIssues(): void {
    if (this.#issuesScheduled)
      return
    this.#issuesScheduled = true
    queueMicrotask(() => {
      this.#issuesScheduled = false
      this.#issues = this.validate()
      this.requestUpdate()
      emitEvent(this, 'issues-change', { issues: this.#issues })
    })
  }

  /**
   * 外框的区：工具栏与画布带上区名（分隔条的无障碍名称）；物料、属性与问题画成卡片，面板头写标题与帮助，
   * 属性面板的副标题是当前编辑的对象。设置里关了工具栏或状态栏时不登记它们。扩展面板的区按扩展顺序排在后面。
   */
  #syncFrameRegions(layers: Layers, t: PrintDesignerTranslations): void {
    const heading = layers.properties.heading
    const own: Readonly<Record<string, Partial<DesignerFrameRegion>>> = {
      toolbar: { label: this.#commandTexts().toolbar },
      palette: { title: t.palette, icon: LayoutGridIcon, help: t.paletteHelp },
      canvas: { label: t.canvas },
      properties: { title: t.properties, ...(heading === undefined ? {} : { subtitle: heading }), icon: SlidersHorizontalIcon, help: t.propertiesHelp },
      issues: { title: t.issues, icon: CircleAlertIcon, help: t.issuesHelp },
    }
    const preview = this.mode === 'preview'
    const toolbar = toolbarVisibleOf(this.#resolvedSettings)
    const kept = (region: DesignerFrameRegion): boolean => (region.name !== 'toolbar' || toolbar) && (preview
      ? PREVIEW_REGIONS.has(region.name)
      : region.name !== 'status' || !this.#statusBarOff())
    const regions = preview
      ? DESIGNER_FRAME_REGIONS.filter(kept).map(region => ({ ...region, ...own[region.name] }))
      : [
          ...DESIGNER_FRAME_REGIONS.filter(kept).map(region => ({ ...region, ...own[region.name] })),
          { name: PRINT_DESIGNER_PANELS.pages, position: 'overlay', anchor: 'end', label: t.pages, icon: FileIcon } satisfies DesignerFrameRegion,
          { name: PRINT_DESIGNER_PANELS.minimap, position: 'overlay', anchor: 'bottom-start', label: t.minimap, icon: MapIcon } satisfies DesignerFrameRegion,
          ...this.#model().list.flatMap(extension => (extension.panels ?? []).map(panel => panel.region)),
        ]
    const key = JSON.stringify(regions)
    if (this.#regions?.key === key)
      return
    this.#regions = { key, regions }
    layers.frame.regions = regions
  }

  /**
   * 设置：建好设置宿主（存储键变了就重建），给了存储键又没赋 settings 时从存储读；settings 变了把主题、主题色与语言
   * 落到设计器上；算出此刻生效的设置，交给设置对话框。
   */
  #syncSettings(layers: Layers, t: PrintDesignerTranslations, changed: PropertyValues): void {
    const options = [this.settingsStorageKey]
    let fresh = false
    if (!this.#settingsHost || options.some((value, index) => value !== this.#settingsHostOptions[index])) {
      this.#settingsHost?.dispose()
      this.#settingsHostOptions = options
      const storageKey = this.settingsStorageKey
      const locale = { locale: loadPrintLocale, onLocaleChange: () => this.requestUpdate() }
      this.#settingsHost = storageKey === undefined
        ? createDesignerSettingsHost({ root: this, ...locale })
        : createDesignerSettingsHost({
            root: this,
            ...locale,
            storageKey,
            onStorageError: detail => emitEvent(this, 'settings-storage-error', detail),
          })
      if (storageKey !== undefined && this.settings === undefined)
        this.settings = this.#settingsHost.load()
      fresh = true
    }
    if (fresh || changed.has('settings'))
      this.#settingsHost.apply(this.settings ?? {})
    const client = this.printClient !== undefined
    const sections = [printSettingsSection(t, { client }), ...(client ? [printClientSettingsSection(t, { downloadUrl: this.clientDownloadUrl })] : []), ...this.#model().settings]
    const sectionsKey = JSON.stringify(sections)
    if (sectionsKey !== this.#settingsSectionsKey) {
      this.#settingsSectionsKey = sectionsKey
      this.#settingsSectionList = sections
    }
    this.#resolvedSettings = resolveSettings(this.#settingsSectionList, this.settings)
    const dialog = layers.settings
    const policy: DesignerSettingsPolicy = { ...this.settingsPolicy }
    const dialogKey = JSON.stringify(policy)
    if (dialogKey !== this.#settingsDialogKey) {
      this.#settingsDialogKey = dialogKey
      dialog.policy = policy
    }
    if (dialog.sections !== this.#settingsSectionList)
      dialog.sections = this.#settingsSectionList
    if (dialog.settings !== this.settings)
      dialog.settings = this.settings
  }

  /** 设置对话框里改了一条：换成新的 settings，给了存储键就存起来，再派发 settings-change。 */
  readonly #onSettingsChange = (event: Event): void => {
    event.stopPropagation()
    this.#commitSettings((event as DesignerSettingsEventMap['settings-change']).detail)
  }

  /** 工具栏上的开关改一条设置：与在设置对话框里改一样。 */
  #writeSetting(key: string, value: JsonValue): void {
    this.#commitSettings({ key, value, settings: { ...this.settings, [key]: value } })
  }

  #commitSettings(detail: { readonly key: string, readonly value: JsonValue | undefined, readonly settings: DesignerSettings }): void {
    this.settings = detail.settings
    this.#settingsHost?.save(detail.settings, this.#settingsSectionList)
    emitEvent(this, 'settings-change', { key: detail.key, value: detail.value, settings: detail.settings })
  }

  /** 网格线：设置里打开显示且间距大于 0 时画；间距在屏幕上不到 GRID_MIN_PIXELS 时按它的 2、5、10、20、50…倍画。 */
  #paintGrid(layers: Layers): void {
    const size = this.#gridSize()
    const shown = size > 0 && this.#resolvedSettings[PRINT_SETTING_KEYS.showGrid] === true
    layers.grid.hidden = !shown
    if (!shown)
      return
    let step = size
    for (let index = 0; step * this.#viewport.zoom < GRID_MIN_PIXELS && index < 30; index++)
      step *= index % 3 === 1 ? 2.5 : 2
    layers.grid.style.setProperty('--xh-print-designer-grid', `${step}mm`)
  }

  /** 面板布局交给外框：用户存在设置里的布局、宿主的缺省布局与按 settingsPolicy 换算的管控。 */
  #syncLayout(layers: Layers): void {
    const layout = this.#resolvedSettings[DESIGNER_SETTING_KEYS.layout] as DesignerLayout | undefined
    if (layers.frame.layout !== layout)
      layers.frame.layout = layout
    if (layers.frame.defaultLayout !== this.defaultLayout)
      layers.frame.defaultLayout = this.defaultLayout
    if (this.#layoutPolicy === undefined || this.#layoutPolicy.source !== this.settingsPolicy)
      this.#layoutPolicy = { source: this.settingsPolicy, policy: designerLayoutPolicy(this.settingsPolicy) }
    const { policy } = this.#layoutPolicy
    if (layers.frame.layoutPolicy !== policy)
      layers.frame.layoutPolicy = policy
  }

  /** 外框改了布局：存进设置的 layout.panels，与在设置对话框里改一条一样。 */
  readonly #onLayoutChange = (event: Event): void => {
    event.stopPropagation()
    this.#writeSetting(DESIGNER_SETTING_KEYS.layout, (event as DesignerFrameEventMap['layout-change']).detail.layout as unknown as JsonValue)
  }

  /** 设置里关掉了状态栏。 */
  #statusBarOff(): boolean {
    return this.#resolvedSettings[DESIGNER_SETTING_KEYS.statusBar] === false
  }

  #translations(): PrintDesignerTranslations {
    return this.#config.translations<PrintDesignerTranslations>(PRINT_DESIGNER_TAG, DEFAULT_PRINT_DESIGNER_TRANSLATIONS, this.translations)
  }

  /** 网格间距，mm；设置里写 0 或写坏了为 0，即不吸附网格。 */
  #gridSize(): number {
    const size = this.#resolvedSettings[PRINT_SETTING_KEYS.gridSize]
    return typeof size === 'number' && size > 0 ? size : 0
  }

  #snapValue(value: number): number {
    const size = this.#gridSize()
    return size > 0 ? snapToGrid(value, size) : value
  }

  /** 纸张坐标落在哪个区：页眉、页脚带区之内为页眉、页脚，其余为正文。 */
  #regionAt(point: Point): ElementRegion {
    const page = this.#editor.page
    const bands = this.#editor.bands
    const header = getBandRect(page, 'header', page.header[bands.header] ?? page.header.default)
    const footer = getBandRect(page, 'footer', page.footer[bands.footer] ?? page.footer.default)
    if (point.y < header.y + header.height)
      return 'header'
    if (point.y >= footer.y)
      return 'footer'
    return 'body'
  }

  /** 切到元素所在的页面模板与带区变体，返回它的外框；元素不存在时为 undefined。 */
  #bringIntoView(id: string): Rect | undefined {
    const found = findElement(this.#editor.document, id)
    if (found === undefined)
      return undefined
    if (found.page.id !== this.#editor.activePageId)
      this.#editor.setActivePage(found.page.id)
    if (found.container.region !== 'body')
      this.#editor.setBandVariant(found.container.region, found.container.band)
    return elementRect(found.element)
  }

  // —— 内部：视口 ——

  #startAutoFit(): void {
    this.#autoFit = true
    this.#fitPending = true
    this.#placePending = false
  }

  /** 排上一次按实际大小放，不再跟着尺寸自动适配。 */
  #startActualPlacement(): void {
    this.#autoFit = false
    this.#fitPending = false
    this.#placePending = true
  }

  #stopAutoFit(): void {
    this.#autoFit = false
    this.#fitPending = false
    this.#placePending = false
  }

  #onResize(): void {
    this.#checkTour()
    if (this.#layers)
      this.#layers.minimap.canvasSize = this.#size()
    if (this.#placeIfPending())
      return
    if (!this.#autoFit)
      return
    this.#fitPending = true
    this.#fitIfPending()
  }

  #fitIfPending(): boolean {
    const size = this.#size()
    if (!this.#fitPending || !size || this.mode === 'preview')
      return false
    this.#fitPending = false
    const paper = getPaperSize(this.#editor.page)
    const insets = this.#layers === undefined ? { start: 0, end: 0 } : this.#fitInsets(this.#layers)
    const start = Math.max(FIT_PADDING, insets.start)
    const end = Math.max(FIT_PADDING, insets.end)
    const fit = fitRect({ x: 0, y: 0, width: paper.width, height: paper.height }, { width: Math.max(0, size.width - start - end + 2 * FIT_PADDING), height: size.height }, { padding: FIT_PADDING, maxZoom: PX_PER_MM, limits: ZOOM_LIMITS })
    this.#moveTo({ ...fit, x: fit.x + start - FIT_PADDING })
    return true
  }

  /**
   * 排着按实际大小放、画布有了尺寸且不在预览态时放：缩放 100%，纸的左上角落在视口左上，上边留 FIT_PADDING，
   * 左边留 FIT_PADDING 与页眉页脚标签宽度中较大的那个。放了返回 true。
   */
  #placeIfPending(): boolean {
    const size = this.#size()
    if (!this.#placePending || !size || this.mode === 'preview')
      return false
    this.#placePending = false
    const start = this.#layers === undefined ? 0 : this.#bandMenuGutter(this.#layers)
    this.#moveTo({ x: Math.max(FIT_PADDING, start), y: FIT_PADDING, zoom: PX_PER_MM })
    return true
  }

  /** 适配视口时左右各让出的屏幕宽度，像素：浮在画布一侧的翻页条盖住的那段，加上纸张左侧的页眉页脚标签。 */
  #fitInsets(layers: Layers): { start: number, end: number } {
    const viewport = layers.viewport.getBoundingClientRect()
    const strip = (layers.pageStrip.element.closest('[data-part="region"]') ?? layers.pageStrip.element).getBoundingClientRect()
    let start = 0
    let end = 0
    if (strip.width > 0 && strip.left < viewport.right && strip.right > viewport.left) {
      if (strip.left + strip.width / 2 > viewport.left + viewport.width / 2)
        end = viewport.right - strip.left
      else
        start = strip.right - viewport.left
    }
    return { start: start + this.#bandMenuGutter(layers), end }
  }

  /** 纸张左侧页眉页脚标签占的屏幕宽度，像素；标签按屏幕尺寸显示，与缩放无关。 */
  #bandMenuGutter(layers: Layers): number {
    const paperLeft = layers.paper.getBoundingClientRect().left
    let left = paperLeft
    for (const menu of layers.bandMenus.querySelectorAll('[data-part="band-menu"]'))
      left = Math.min(left, menu.getBoundingClientRect().left)
    return paperLeft - left
  }

  #moveTo(viewport: Viewport): void {
    this.#viewport = viewport
    this.#applyViewport(true)
  }

  #applyViewport(notify: boolean): void {
    const layers = this.#layers
    if (layers) {
      const { x, y, zoom } = this.#viewport
      const scale = zoom / PX_PER_MM
      layers.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      layers.overlay.viewport = this.#viewport
      layers.ruler.viewport = this.#viewport
      layers.minimap.viewport = this.#viewport
      layers.minimap.canvasSize = this.#size()
      this.style.setProperty('--xh-print-designer-zoom', String(scale))
      this.#paintGrid(layers)
      this.#renderZoomStatus(layers, this.#translations())
    }
    if (notify)
      emitEvent(this, 'viewport-change', { viewport: this.getViewport() })
  }

  #size(): { width: number, height: number } | undefined {
    const viewport = this.#layers?.viewport
    if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0)
      return undefined
    return { width: viewport.clientWidth, height: viewport.clientHeight }
  }

  #viewportCenter(): Point {
    const size = this.#size()
    if (size)
      return screenToWorld(this.#viewport, { x: size.width / 2, y: size.height / 2 })
    const paper = getPaperSize(this.#editor.page)
    return { x: paper.width / 2, y: paper.height / 2 }
  }

  /** 小地图按页显示：这张纸一块淡色、当前页面模板与当前页眉页脚变体里看得见的元素各一块，范围就是这张纸；内容没变不重设。 */
  #syncMinimap(layers: Layers): void {
    const paper = getPaperSize(this.#editor.page)
    const bounds: Rect = { x: 0, y: 0, width: paper.width, height: paper.height }
    const shapes: DesignerMinimapShape[] = [
      { kind: 'rect', rect: bounds, tone: 'muted' },
      ...this.#editor.visibleElements().map((item): DesignerMinimapShape => ({ kind: 'rect', rect: elementRect(item.element) })),
    ]
    const key = JSON.stringify(shapes)
    if (key === this.#minimapKey)
      return
    this.#minimapKey = key
    layers.minimap.bounds = bounds
    layers.minimap.shapes = shapes
  }

  /** 在小地图上按下或拖动：视口中心移到那一点，此后尺寸变化不再自动适配。 */
  readonly #onMinimapNavigate = (event: Event): void => {
    const size = this.#size()
    if (!size)
      return
    this.#stopAutoFit()
    this.#moveTo(centerOn(this.#viewport, (event as DesignerMinimapEventMap['navigate']).detail.center, size))
  }

  #zoomAtCenter(factor: number): void {
    const size = this.#size()
    if (!size)
      return
    this.#stopAutoFit()
    this.#moveTo(zoomBy(this.#viewport, factor, { x: size.width / 2, y: size.height / 2 }, ZOOM_LIMITS))
  }

  // —— 内部：渲染 ——

  #ensureLayers(): Layers {
    if (this.#layers?.frame.parentElement === this)
      return this.#layers
    const doc = this.ownerDocument
    const bar = { platform: this.#kbdPlatform() }
    const menubar = createCommandMenubar<PrintDesignerContext>(doc, { ...bar, menuIcon: MenuIcon })
    menubar.element.slot = 'menubar'
    const commandBar = createCommandToolbar<PrintDesignerContext>(doc, bar)
    const toolbar = createAuthoredElement(doc, 'div', { 'slot': 'toolbar', 'data-part': 'command-bar' }, [commandBar.element])
    const selectionBar = createCommandToolbar<PrintDesignerContext>(doc, bar)
    selectionBar.element.slot = 'toolbar'
    const pageStrip = createCommandToolbar<PrintDesignerContext>(doc, { ...bar, orientation: 'vertical' })
    pageStrip.element.slot = PRINT_DESIGNER_PANELS.pages

    const paper = createAuthoredElement(doc, 'div', { 'data-part': 'paper' })
    const frames = createAuthoredElement(doc, 'div', { 'data-part': 'frames' })
    const elements = createAuthoredElement(doc, 'div', { 'data-part': 'elements' })
    const watermark = createAuthoredElement(doc, 'div', { 'data-part': 'watermark-layer' })
    const decorations = createAuthoredElement(doc, 'div', { 'data-part': 'decorations' })
    const bandMenus = createAuthoredElement(doc, 'div', { 'data-part': 'band-menus' })
    const grid = createAuthoredElement(doc, 'div', { 'data-part': 'grid', 'hidden': true })
    paper.append(grid, frames, elements, watermark, decorations, bandMenus)
    const world = createAuthoredElement(doc, 'div', { 'data-part': 'world' }, [paper])
    const overlay = createAuthoredElement(doc, 'xh-designer-transform', { 'data-part': 'overlay' }) as XhDesignerTransformElement
    overlay.viewport = this.#viewport
    overlay.getSnap = () => this.#snapOptions()
    overlay.measure = 'selection'
    overlay.measureOptions = { unit: 'mm', fractionDigits: 1, step: 1, largeStep: NUDGE_LARGE_STEP }
    overlay.addEventListener('transform', this.#onTransform)
    overlay.addEventListener('measure-change', this.#onMeasureChange)
    overlay.addEventListener('marquee', this.#onMarquee)
    const viewport = createAuthoredElement(doc, 'div', { 'data-part': 'viewport', 'tabindex': 0, 'role': 'region' }, [world, overlay])
    viewport.addEventListener('pan-request', this.#onPanRequest)
    const menuContent = createAuthoredElement(doc, 'div', { 'data-xh-part': 'content' })
    const trigger = createAuthoredElement(doc, 'div', { 'data-xh-part': 'trigger', 'data-print-canvas': '' }, [viewport])
    const menu = createAuthoredElement(doc, 'xh-context-menu', { 'size': 'sm', 'data-print-canvas-menu': '' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'root', 'data-print-canvas-root': '' }, [trigger, createAuthoredElement(doc, 'div', { 'data-xh-part': 'positioner' }, [menuContent])]),
    ])
    menu.addEventListener('item-select', this.#onMenuSelect)
    this.#fillMenu(menuContent, 'blank')
    const palette = createAuthoredElement(doc, 'xh-designer-palette', { 'slot': 'palette', 'data-part': 'palette', 'headless': true }) as XhDesignerPaletteElement
    palette.addEventListener('item-activate', this.#onPaletteActivate)
    const issues = createAuthoredElement(doc, 'xh-designer-issues', { 'slot': 'issues', 'data-part': 'issues', 'headless': true }) as XhDesignerIssuesElement
    issues.addEventListener('issue-activate', this.#onIssueActivate)
    issues.addEventListener('issue-hover', this.#onIssueHover)
    const properties = createAuthoredElement(doc, 'xh-designer-properties', { 'slot': 'properties', 'data-part': 'properties', 'collapsible': true, 'toggle-limit': 4, 'headless': true }) as XhDesignerPropertiesElement
    properties.addEventListener('property-change', this.#onPropertyChange)
    properties.addEventListener('property-commit', this.#onPropertyCommit)
    const preview = createAuthoredElement(doc, 'div', { 'data-part': 'preview', 'hidden': true })
    const ruler = createAuthoredElement(doc, 'xh-designer-ruler', { 'unit-size': 1 }) as XhDesignerRulerElement
    ruler.viewport = this.#viewport
    ruler.snap = (_axis, value) => this.#snapValue(value)
    ruler.addEventListener('guides-change', this.#onGuidesChange)
    const workspace = createAuthoredElement(doc, 'div', { 'data-part': 'workspace' }, [ruler, menu, preview])
    // 问题列表带计数的严重程度开关放进它所在卡片的面板头
    const issueSummary = issues.summary
    issueSummary.slot = 'issues-actions'
    const frame = createGeneratedElement(doc, 'xh-designer-frame', { 'data-part': 'frame' }, [menubar.element, toolbar, palette, workspace, pageStrip.element, properties, issues, issueSummary]) as XhDesignerFrameElement
    frame.addEventListener('layout-change', this.#onLayoutChange)
    // 拖动工具开关了：工具栏「拖动」钮的按下状态跟着重画
    frame.addEventListener('canvas-tool-change', () => this.requestUpdate())
    const selectionStatus = createStatusItem(doc, { value: '' })
    selectionStatus.element.slot = 'status-start'
    const clientStatus = createStatusItem(doc, { value: '' })
    clientStatus.element.slot = 'status-end'
    const zoomStatus = createStatusItem(doc, { value: '', action: () => this.zoomToActual() })
    zoomStatus.element.slot = 'status-end'
    frame.append(selectionStatus.element, clientStatus.element, zoomStatus.element)
    const settings = createGeneratedElement(doc, 'xh-designer-settings', { 'data-part': 'settings' }) as XhDesignerSettingsElement
    settings.editors = { [PRINT_CLIENT_STATUS_CONTROL]: this.#clientStatus.editor }
    settings.frame = frame
    settings.addEventListener('settings-change', this.#onSettingsChange)
    settings.addEventListener('settings-command', this.#onSettingsCommand)
    const fieldImport = createGeneratedElement(doc, 'xh-designer-field-import', { 'data-part': 'field-import' }) as XhDesignerFieldImportElement
    fieldImport.contents = FIELD_CONTENTS
    fieldImport.inference = { detectImages: true }
    fieldImport.offerSample = true
    fieldImport.addEventListener('fields-import', this.#onFieldsImport)
    const paletteActions = createPanelActions<PrintDesignerContext>(doc, PRINT_DESIGNER_PANELS.palette)
    const minimap = createGeneratedElement(doc, 'xh-designer-minimap', { 'data-part': 'minimap', 'slot': PRINT_DESIGNER_PANELS.minimap }) as XhDesignerMinimapElement
    minimap.addEventListener('navigate', this.#onMinimapNavigate)
    frame.append(paletteActions.element, minimap)
    const jsonEditor = createGeneratedElement(doc, 'xh-designer-json-editor', { 'data-part': 'json-editor' }) as XhDesignerJsonEditorElement
    jsonEditor.addEventListener('json-apply', this.#onJsonApply)
    const tour = createGeneratedElement(doc, 'xh-designer-tour', { 'data-part': 'tour' }) as XhDesignerTourElement
    tour.frame = frame
    tour.addEventListener('tour-end', this.#onTourEnd)
    this.append(frame, settings, fieldImport, jsonEditor, tour)
    const panelHost = createPanelHost<PrintDesignerContext>(frame, { commands: () => this.#model().commands })

    viewport.addEventListener('pointerdown', this.#onPanToolPointerDown, true)
    viewport.addEventListener('pointerdown', this.#onPointerDown)
    viewport.addEventListener('dblclick', this.#onDoubleClick)
    viewport.addEventListener('contextmenu', this.#onContextMenu)
    viewport.addEventListener('dragover', this.#onNativeDragOver)
    viewport.addEventListener('drop', this.#onNativeDrop)
    viewport.addEventListener('wheel', this.#onWheel, { passive: false })
    viewport.addEventListener('pointermove', this.#onHover)
    viewport.addEventListener('pointerleave', this.#onHoverEnd)
    this.addEventListener('keydown', this.#onPanToolEscape, true)
    this.addEventListener('keydown', this.#onKeyDown)
    this.addEventListener('keyup', this.#onKeyUp)
    this.addEventListener('focusout', this.#onFocusOut)
    this.addEventListener('copy', this.#onCopy)
    this.addEventListener('cut', this.#onCut)
    this.addEventListener('paste', this.#onPaste)
    this.#layers = { frame, panelHost, menubar, palette, issues, properties, toolbar, commandBar, selectionBar, pageStrip, workspace, menu, ruler, menuContent, viewport, overlay, world, paper, grid, frames, elements, watermark, decorations, bandMenus, preview, settings, fieldImport, jsonEditor, tour, minimap, paletteActions, selectionStatus, clientStatus, zoomStatus }
    this.#regions = undefined
    panelHost.assign(this.#model().list, this.#context())
    return this.#layers
  }

  #commandEnabled(command: Command): boolean {
    const editable = !this.#readOnly && this.mode === 'design'
    const selected = this.#editor.selection.elements.length
    switch (command) {
      case 'copy':
        return selected > 0
      case 'cut':
      case 'duplicate':
      case 'delete':
      case 'bring-to-front':
      case 'bring-forward':
      case 'send-backward':
      case 'send-to-back':
        return editable && selected > 0
      case 'paste':
        return editable
      case 'select-all':
        return this.mode === 'design'
      case 'align-left':
      case 'align-center':
      case 'align-right':
      case 'align-top':
      case 'align-middle':
      case 'align-bottom':
        return editable && selected >= 2
      case 'distribute-horizontal':
      case 'distribute-vertical':
        return editable && selected >= 3
      case 'zoom-out':
      case 'zoom-in':
      case 'zoom-to-fit':
      case 'zoom-to-actual':
      case 'grid':
      case 'snap':
        return this.mode === 'design'
      case 'design':
      case 'preview':
      case 'print':
        return true
      case 'edit-table':
        return editable && this.#selectedTable() !== undefined && this.#tableEdit === undefined
      case 'exit-table-edit':
        return this.#tableEdit !== undefined
      case 'previous-page':
        return this.mode === 'design' && this.#pageIndex() > 0
      case 'next-page':
        return this.mode === 'design' && this.#pageIndex() < this.#editor.document.pages.length - 1
      case 'add-page':
      case 'duplicate-page':
        return editable
      case 'remove-page':
        return editable && this.#editor.document.pages.length > 1
      case 'move-page-up':
        return editable && this.#pageIndex() > 0
      case 'move-page-down':
        return editable && this.#pageIndex() < this.#editor.document.pages.length - 1
      default: {
        const table = this.#editTable()
        if (!editable || table === undefined)
          return false
        const planned = planTableCommand(table, this.#editor.selection.tablePart, command, this.#translations())
        return planned !== undefined && planned.plan.ok
      }
    }
  }

  #run(command: Command): void {
    if (!this.#commandEnabled(command))
      return
    const pages = this.#editor.document.pages
    const pageIndex = pages.findIndex(page => page.id === this.#editor.activePageId)
    switch (command) {
      case 'cut':
        this.cut()
        return
      case 'copy':
        this.copy()
        return
      case 'paste':
        this.paste()
        return
      case 'duplicate':
        this.duplicate()
        return
      case 'delete':
        this.deleteSelection()
        return
      case 'select-all':
        this.#editor.selectAll()
        return
      case 'distribute-horizontal':
        this.distribute('horizontal')
        return
      case 'distribute-vertical':
        this.distribute('vertical')
        return
      case 'zoom-out':
        this.zoomOut()
        return
      case 'zoom-in':
        this.zoomIn()
        return
      case 'zoom-to-fit':
        this.zoomToFit()
        return
      case 'zoom-to-actual':
        this.zoomToActual()
        return
      case 'grid':
        this.#writeSetting(PRINT_SETTING_KEYS.showGrid, this.#resolvedSettings[PRINT_SETTING_KEYS.showGrid] !== true)
        return
      case 'snap':
        this.#writeSetting(PRINT_SETTING_KEYS.snap, this.#resolvedSettings[PRINT_SETTING_KEYS.snap] === false)
        return
      case 'design':
      case 'preview':
        this.mode = command
        return
      case 'print':
        void this.print().catch(() => undefined)
        return
      case 'edit-table':
        this.#enterTableEdit(this.#selectedTable()!.id)
        return
      case 'exit-table-edit':
        this.#exitTableEdit()
        return
      case 'previous-page':
      case 'next-page':
        this.#editor.setActivePage(pages[command === 'previous-page' ? pageIndex - 1 : pageIndex + 1]!.id)
        return
      case 'add-page':
        this.#editor.addPage(pageIndex + 1)
        return
      case 'duplicate-page':
        this.#editor.duplicatePage(this.#editor.activePageId)
        return
      case 'remove-page':
        this.#editor.removePage(this.#editor.activePageId)
        return
      case 'move-page-up':
        this.#editor.movePage(this.#editor.activePageId, pageIndex - 1)
        return
      case 'move-page-down':
        this.#editor.movePage(this.#editor.activePageId, pageIndex + 1)
        return
    }
    if (Object.hasOwn(ALIGN, command)) {
      this.align(ALIGN[command]!)
      return
    }
    if (Object.hasOwn(REORDER, command)) {
      this.reorder(REORDER[command]!)
      return
    }
    const table = this.#editTable()
    if (table === undefined)
      return
    const planned = planTableCommand(table, this.#editor.selection.tablePart, command as TableCommand, this.#translations())
    if (planned !== undefined && this.#editor.applyTablePlan(table.id, planned.plan) && planned.part !== undefined)
      this.#editor.select({ elements: [table.id], tablePart: planned.part })
  }

  #commandChecked(command: Command): boolean {
    if (command === 'grid')
      return this.#resolvedSettings[PRINT_SETTING_KEYS.showGrid] === true
    return command === 'snap' ? this.#resolvedSettings[PRINT_SETTING_KEYS.snap] !== false : this.mode === command
  }

  /** 菜单栏：按命令表与 commandLayout 的 menubar:<菜单> 排出各张菜单，条目的状态取此刻的设计器。 */
  #renderMenubar(layers: Layers): void {
    const { commands, menubarMenus } = this.#model()
    const context = this.#context()
    layers.menubar.update(arrangeMenubar(menubarMenus, commands, printMenubarLayout(commands, this.#model().runtime.elements), this.commandLayout), commands, context, context.commands)
  }

  #renderToolbar(layers: Layers): void {
    const { commands } = this.#model()
    const context = this.#context()
    // 按钮的显示方式只取设置的 toolbar.display：换方式不重铺按钮，放不下的按新宽度收进「更多」
    layers.commandBar.setDisplay(toolbarDisplayOf(this.#resolvedSettings))
    const arranged = arrangeCommands('toolbar', commands, PRINT_TOOLBAR_LAYOUT, this.commandLayout)
    layers.commandBar.update(applyToolbarCustomization(arranged, toolbarCustomizationOf(this.#resolvedSettings)), commands, context, context.commands.toolbar)
    // 设置对话框的「工具栏」页按宿主排好的这一份列出按钮表，用户的定制压在它上面
    const source = toolbarSettingsSource(arranged, commands, context)
    const sourceKey = JSON.stringify(source)
    if (sourceKey !== this.#toolbarSourceKey) {
      this.#toolbarSourceKey = sourceKey
      layers.settings.toolbar = source
    }
  }

  /** 画布右侧的翻页条：外框里的画布浮动件，显隐由布局管；预览态不登记它。 */
  #renderPageStrip(layers: Layers, t: PrintDesignerTranslations): void {
    if (this.mode === 'preview')
      return
    const { commands } = this.#model()
    layers.pageStrip.update(PRINT_PAGE_STRIP_LAYOUT, commands, this.#context(), t.pages)
  }

  /**
   * 状态栏：左段没有选中时写当前页面模板与它上面的元素个数，选中一个写元素种类与位置尺寸（mm），选中多个写个数；
   * 右段写打印客户端的连接状态（给了 printClient 时）与缩放。
   */
  #renderStatus(layers: Layers, t: PrintDesignerTranslations): void {
    const ids = this.#editor.selection.elements
    const visible = this.#editor.visibleElements()
    const single = ids.length === 1 ? visible.find(item => item.element.id === ids[0])?.element : undefined
    if (ids.length > 1) {
      layers.selectionStatus.update({ value: t.selectedCount(ids.length) })
    }
    else if (single !== undefined) {
      layers.selectionStatus.update({ label: elementName(t, this.#model(), single.type), value: t.statusGeometry(this.#formatMm(single.x), this.#formatMm(single.y), this.#formatMm(single.width), this.#formatMm(single.height)) })
    }
    else {
      const index = this.#pageIndex()
      layers.selectionStatus.update({ label: this.#editor.page.name ?? t.pageTitle(index + 1), value: t.statusElements(visible.length) })
    }
    this.#watchClient(layers)
    this.#renderClientStatus(layers, t)
    this.#renderZoomStatus(layers, t)
  }

  #renderZoomStatus(layers: Layers, t: PrintDesignerTranslations): void {
    layers.zoomStatus.update({ label: t.statusZoom, value: `${Math.round(this.#viewport.zoom / PX_PER_MM * 100)}%` })
  }

  /** 打印客户端一项：没给 printClient 时收起；连上时带 success 语气，正在连或重连时带 warning。 */
  #renderClientStatus(layers: Layers, t: PrintDesignerTranslations): void {
    const client = this.printClient
    layers.clientStatus.element.hidden = client === undefined
    if (client === undefined)
      return
    const state: PrintClientState = client.state
    const tone: Tone | undefined = state === 'open' ? 'success' : state === 'connecting' || state === 'reconnecting' ? 'warning' : undefined
    layers.clientStatus.update({ label: t.statusClient, value: t.statusClientStates[state], ...(tone === undefined ? {} : { tone }) })
  }

  /** 换了 printClient 就退订旧的、订阅新的：连接状态变了当场刷新那一项，不等下一轮更新；设置对话框里的连接状态一并重订。 */
  #watchClient(layers: Layers): void {
    const client = this.printClient
    if (this.#clientWatch?.client === client)
      return
    this.#clientWatch?.off()
    this.#clientWatch = client === undefined ? undefined : { client, off: client.on('state', () => this.#renderClientStatus(layers, this.#translations())) }
    this.#clientStatus.refresh()
  }

  /** 当前页面模板在文档里的序号。 */
  #pageIndex(): number {
    return this.#editor.document.pages.findIndex(page => page.id === this.#editor.activePageId)
  }

  #renderPaper(layers: Layers, t: PrintDesignerTranslations): void {
    const doc = this.ownerDocument
    const page = this.#editor.page
    const bands = this.#editor.bands
    const paper = getPaperSize(page)
    layers.paper.style.width = `${paper.width}mm`
    layers.paper.style.height = `${paper.height}mm`
    this.#paintGrid(layers)
    const header = page.header[bands.header] ?? page.header.default
    const footer = page.footer[bands.footer] ?? page.footer.default
    const headerRect = getBandRect(page, 'header', header)
    const footerRect = getBandRect(page, 'footer', footer)
    const bodyRect = getBodyRect(page, header, footer)
    const content = getContentRect(page)

    const frame = (part: string, rect: Rect, region?: ElementRegion): HTMLElement => {
      const node = createAuthoredElement(doc, 'div', { 'data-part': part, 'data-region': region })
      rectStyle(node, rect)
      return node
    }
    layers.frames.replaceChildren(
      ...(this.#resolvedSettings[PRINT_SETTING_KEYS.showMargins] === false ? [] : [frame('margins', content)]),
      frame('band', headerRect, 'header'),
      frame('band', bodyRect, 'body'),
      frame('band', footerRect, 'footer'),
    )

    const layout = this.#layout
    const selected = new Set(this.#editor.selection.elements)
    const boxes: LayoutBox[] = layout === undefined ? [] : [...layout.header, ...layout.body, ...layout.footer]
    const designHeights = new Map(this.#editor.visibleElements().map(item => [item.element.id, item.element.height]))
    const overflows: Rect[] = []
    layers.elements.replaceChildren(...boxes.flatMap((box) => {
      const node = renderBox(doc, box, this.#model().runtime.renderers)
      node.toggleAttribute('data-selected', selected.has(box.elementId))
      node.setAttribute('aria-label', t.elementLabel(elementName(t, this.#model(), box.elementType), box.elementId))
      const designHeight = designHeights.get(box.elementId)
      if (box.region !== 'body' || designHeight === undefined || box.height <= designHeight + DESIGN_EPSILON)
        return [node]
      const overflow = { x: box.x, y: box.y + designHeight, width: box.width, height: box.height - designHeight }
      overflows.push(overflow)
      return [node, frame('design-overflow', overflow)]
    }))
    const watermark = layout?.watermark === undefined ? undefined : renderWatermark(doc, layout.watermark)
    layers.watermark.replaceChildren(...(watermark === undefined ? [] : [watermark]))

    const decorations: HTMLElement[] = overflows.map(rect => frame('design-bound', { x: rect.x, y: rect.y, width: rect.width, height: 0 }))
    if (!this.#readOnly) {
      for (const region of ['header', 'footer'] as const) {
        const rect = region === 'header' ? headerRect : footerRect
        const y = region === 'header' ? rect.y + rect.height : rect.y
        const handle = createAuthoredElement(doc, 'div', { 'data-part': 'band-handle', 'data-region': region, 'role': 'separator', 'aria-orientation': 'horizontal', 'aria-label': t.resizeBand(region) })
        handle.style.left = `${content.x}mm`
        handle.style.width = `${content.width}mm`
        handle.style.top = `${y}mm`
        decorations.push(handle)
      }
    }
    decorations.push(...this.#tableDecorations(t))
    layers.decorations.replaceChildren(...decorations)
    this.#renderBandMenus(layers, t, headerRect, footerRect)
  }

  #renderBandMenus(layers: Layers, t: PrintDesignerTranslations, headerRect: Rect, footerRect: Rect): void {
    const doc = this.ownerDocument
    const page = this.#editor.page
    const bands = this.#editor.bands
    const signature = JSON.stringify([page.id, bands, PAGE_BAND_KEYS.map(key => [page.header[key] !== undefined, page.footer[key] !== undefined]), headerRect, footerRect, this.#readOnly, t.regions, t.bandVariants])
    if (layers.bandMenus.dataset.signature === signature)
      return
    layers.bandMenus.dataset.signature = signature
    layers.bandMenus.replaceChildren(...(['header', 'footer'] as const).map((region) => {
      const current = bands[region]
      const set = page[region]
      const items: HTMLElement[] = PAGE_BAND_KEYS.map((key) => {
        const exists = set[key] !== undefined
        const value = exists ? `show:${key}` : `add:${key}`
        const text = exists ? t.bandVariants[key] : `${t.addBandVariant} · ${t.bandVariants[key]}`
        return createAuthoredElement(doc, 'div', { 'data-xh-part': 'item', value, 'aria-disabled': !exists && this.#readOnly ? 'true' : undefined, 'aria-current': key === current ? 'true' : undefined }, [
          createAuthoredElement(doc, 'span', { 'data-xh-part': 'item-text' }, [text]),
        ])
      })
      if (current !== 'default' && !this.#readOnly) {
        items.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'separator' }))
        items.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'item', 'value': 'remove', 'data-tone': 'danger' }, [createAuthoredElement(doc, 'span', { 'data-xh-part': 'item-text' }, [t.removeBandVariant])]))
      }
      const rect = region === 'header' ? headerRect : footerRect
      const menu = createAuthoredElement(doc, 'xh-menu', { 'size': 'sm', 'data-part': 'band-menu', 'data-region': region }, [
        createAuthoredElement(doc, 'xh-button', { 'data-xh-part': 'trigger', 'variant': 'subtle', 'size': 'sm' }, [
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button' }, [`${t.regions[region]} · ${t.bandVariants[current]}`]),
        ]),
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'positioner' }, [createAuthoredElement(doc, 'div', { 'data-xh-part': 'content' }, items)]),
      ])
      menu.style.top = `${rect.y}mm`
      menu.addEventListener('item-select', event => this.#selectBand(region, (event as CustomEvent<{ value: string }>).detail.value))
      return menu
    }))
  }

  #tableDecorations(t: PrintDesignerTranslations): HTMLElement[] {
    const table = this.#editTable()
    const box = this.#tableBox()
    if (table === undefined || box === undefined)
      return []
    const doc = this.ownerDocument
    const result: HTMLElement[] = []
    const outline = createAuthoredElement(doc, 'div', { 'data-part': 'table-edit' })
    rectStyle(outline, { x: box.x, y: box.y, width: box.width, height: box.height })
    result.push(outline)
    const part = this.#editor.selection.tablePart
    const highlight = part === undefined ? undefined : this.#partRect(table, box, part)
    if (highlight !== undefined) {
      const node = createAuthoredElement(doc, 'div', { 'data-part': 'table-part' })
      rectStyle(node, highlight)
      result.push(node)
    }
    if (!this.#readOnly) {
      for (const { column, x } of columnBoundaries(table)) {
        const handle = createAuthoredElement(doc, 'div', { 'data-part': 'column-handle', 'data-column-id': column.id, 'role': 'separator', 'aria-orientation': 'vertical', 'aria-label': t.resizeColumn(column.title) })
        handle.style.left = `${x}mm`
        handle.style.top = `${box.y}mm`
        handle.style.height = `${box.height}mm`
        result.push(handle)
      }
    }
    return result
  }

  #partRect(table: TableElement, box: TableLayoutBox, part: PrintTablePart): Rect | undefined {
    const rows = box.rows
    const span = (selected: typeof rows): Rect | undefined => {
      if (selected.length === 0)
        return undefined
      const top = selected[0]!.y
      const last = selected.at(-1)!
      return { x: box.x, y: top, width: box.width, height: last.y + last.height - top }
    }
    switch (part.kind) {
      case 'column': {
        const bounds = columnBoundaries(table).find(item => item.column.id === part.columnId)
        return bounds === undefined ? undefined : { x: bounds.x - bounds.column.width, y: box.y, width: bounds.column.width, height: box.height }
      }
      case 'header':
        return span(rows.filter(row => row.role === 'header'))
      case 'body':
        return span(rows.filter(row => row.role === 'body' || row.role === 'filler'))
      case 'footerRow':
        return span(rows.filter(row => row.footerRowId === part.rowId))
      case 'footerCell': {
        const row = rows.find(item => item.footerRowId === part.rowId)
        const cell = row?.cells.find(item => item.columnId === part.columnId)
        return row === undefined || cell === undefined ? undefined : { x: cell.x, y: row.y, width: cell.width, height: row.height }
      }
    }
  }

  #ensurePreview(): HTMLElementTagNameMap['xh-print-preview'] {
    const layers = this.#ensureLayers()
    definePrintPreview()
    let preview = layers.preview.querySelector(PRINT_PREVIEW_TAG)
    if (preview === null) {
      preview = this.ownerDocument.createElement(PRINT_PREVIEW_TAG)
      layers.preview.append(preview)
    }
    return preview
  }

  #syncPreview(preview: HTMLElementTagNameMap['xh-print-preview']): void {
    preview.schema = this.#editor.document
    preview.data = this.data
    preview.extensions = this.#model().list
    preview.expressionEngine = this.#engine()
    preview.formatter = this.formatter ?? formatValue
    if (this.measurer !== undefined)
      preview.measurer = this.measurer
    if (this.locale !== undefined)
      preview.locale = this.locale
    if (this.timeZone !== undefined)
      preview.timeZone = this.timeZone
    preview.printClient = this.#printVia() === 'client' ? this.printClient : undefined
    preview.trace = this.#printTrace()
  }

  /**
   * 交给预览与打印的环节回调：分页日志开着时报分页的每一步，渲染日志开着时记分页、生成 DOM、等资源、合成文档与送打印各环节的耗时；
   * 两路都关着（或开发者模式关着）时为 undefined。
   */
  #printTrace(): PrintTrace | undefined {
    const pagination = this.#debug.enabled('pagination')
    const render = this.#debug.enabled('render')
    const key = `${pagination}:${render}`
    if (this.#trace?.key !== key) {
      const trace: PrintTrace | undefined = !pagination && !render
        ? undefined
        : {
            ...(pagination ? { step: (step: PaginationStep) => this.#debug.log('pagination', paginationStepTitle(step), () => step) } : {}),
            ...(render
              ? {
                  phase: (phase: PrintPhase) => {
                    const end = this.#debug.start('render', `phase: ${phase}`)
                    return (details?: Readonly<Record<string, unknown>>) => end(details === undefined ? undefined : () => details)
                  },
                }
              : {}),
          }
      this.#trace = { key, trace }
    }
    return this.#trace.trace
  }

  /** 打印方式：给了 printClient、设置里又没选浏览器时经本地客户端，否则用浏览器打印。 */
  #printVia(): PrintVia {
    return this.printClient !== undefined && this.settings?.[PRINT_SETTING_KEYS.via] !== 'browser' ? 'client' : 'browser'
  }

  /** 新元素按缺省尺寸、以 center 为中心、左上角吸附网格后的外框；类型未登记时为 undefined。 */
  #placement(type: string, center: Point): Rect | undefined {
    const prototype = this.#editor.elements.get(type)
    if (prototype === undefined)
      return undefined
    const { width, height } = prototype.defaults as { width: number, height: number }
    return { x: this.#snapValue(center.x - width / 2), y: this.#snapValue(center.y - height / 2), width, height }
  }

  // —— 内部：物料面板与拖放 ——

  /**
   * 物料面板：内置的元素分组与字段分组在前，文案、模型或字段变了才重排；各扩展的物料来源每轮现取，分组接在后面，
   * 内容没变不重设，变了时记下物料来源的条目。
   */
  #syncPalette(layers: Layers, t: PrintDesignerTranslations): void {
    layers.palette.readonly = this.#readOnly
    const model = this.#model()
    const key = JSON.stringify([t.categories, t.elements, t.fieldGroup])
    const fields = this.fields
    let palette = this.#palette
    if (key !== palette?.key || model !== palette.model || fields !== palette.fields) {
      palette = { key, model, fields, builtin: this.#builtinPaletteGroups(model, t, fields) }
      this.#palette = palette
    }
    const view = resolvePaletteSources(palette.builtin, model.paletteSources, this.#context())
    this.#paletteView = view
    const sourcedGroups = view.groups.slice(palette.builtin.length)
    const sourced = JSON.stringify(sourcedGroups)
    if (sourced === palette.sourced)
      return
    palette.sourced = sourced
    layers.palette.groups = view.groups
    const ids = new Set<string>()
    const collect = (items: readonly DesignerPaletteItem[]): void => {
      for (const item of items) {
        ids.add(item.id)
        collect(item.children ?? [])
      }
    }
    for (const group of sourcedGroups)
      collect(group.items)
    this.#sourceItems = ids
  }

  /** 内置的物料分组：元素种类按分组列出，有字段时再加一组字段。 */
  #builtinPaletteGroups(model: PrintDesignerModel, t: PrintDesignerTranslations, fields: readonly DataField[] | undefined): DesignerPaletteGroup[] {
    const groups = model.runtime.elements.groupByCategory()
    const fieldItems = fieldPaletteNodes(fields ?? [], this.#fieldDefaults()).map(fieldItem)
    return [
      ...groups.map((group): DesignerPaletteGroup => ({
        id: group.category,
        label: categoryName(t, model, group.category),
        items: group.prototypes.map((prototype) => {
          const icon = elementIcon(model, prototype.type)
          return { id: prototype.type, label: elementName(t, model, prototype.type), ...(icon === undefined ? {} : { icon }) }
        }),
      })),
      ...(fieldItems.length === 0 ? [] : [{ id: FIELD_GROUP_ID, label: t.fieldGroup, items: fieldItems }]),
    ]
  }

  /** 此刻能导入字段：设计态、不只读，宿主也没管着字段。 */
  #fieldImportAllowed(): boolean {
    return !this.#readOnly && this.mode === 'design' && this.fieldsReadonly !== true
  }

  /** 导入字段对话框跟着现有字段与扩展的字段来源走；能导入时物料面板头放一颗导入字段钮。 */
  #syncFieldImport(layers: Layers, t: PrintDesignerTranslations): void {
    const dialog = layers.fieldImport
    if (dialog.fields !== this.fields)
      dialog.fields = this.fields
    const model = this.#model()
    if (this.#fieldSources?.model !== model)
      this.#fieldSources = { model, sources: model.list.flatMap(extension => extension.fieldSources ?? []) }
    if (dialog.sources !== this.#fieldSources.sources)
      dialog.sources = this.#fieldSources.sources
    layers.paletteActions.update(this.#fieldImportAllowed() ? [DESIGNER_SHELL_COMMANDS.importFields] : [], model.commands, this.#context(), t.palette)
  }

  /** 导入字段对话框里按了「导入」：换上字段并派发 fields-change，带了样例的同样换上示例数据。 */
  readonly #onFieldsImport = (event: Event): void => {
    event.stopPropagation()
    const { fields, sample } = (event as DesignerFieldImportEventMap['fields-import']).detail
    this.fields = fields
    emitEvent(this, 'fields-change', { fields })
    if (sample !== undefined) {
      this.sampleData = sample
      emitEvent(this, 'sample-data-change', { sampleData: sample })
    }
  }

  /** 字段生成表格时的列宽合计与条码列的码制，取内置表格与条码的缺省值。 */
  #fieldDefaults(): FieldPlacementDefaults {
    const table = this.#editor.elements.get('table')!.defaults as { width: number }
    const barCode = this.#editor.elements.get('barCode')!.defaults as { format: BarCodeFormat }
    return { tableWidth: table.width, barCodeFormat: barCode.format }
  }

  /** 拖动或点选的物料要新建的元素：字段条目取它带的参数，元素条目取元素种类；放不上画布时为 undefined。 */
  #palettePlacement(id: string, payload: unknown): FieldPlacement | undefined {
    if (id.startsWith(FIELD_ITEM_PREFIX))
      return isFieldPlacement(payload) && this.#editor.elements.has(payload.type) ? payload : undefined
    return this.#editor.elements.has(id) ? { type: id as FieldPlacement['type'], overrides: {} } : undefined
  }

  /** 按物料新建元素并选中：at 是元素中心的纸张坐标（mm），缺省放在视口中央。 */
  #addFromPalette(placement: FieldPlacement, at?: Point): void {
    const center = at ?? this.#viewportCenter()
    const placed = this.#placement(placement.type, center)!
    this.#editor.addElement(placement.type, { x: placed.x, y: placed.y, region: this.#regionAt(center), overrides: placement.overrides })
  }

  /** 点物料：物料来源的条目交给来源插入（不给落点），内置的按物料新建元素放在视口中央；只读或不在设计态时什么都不做。 */
  readonly #onPaletteActivate = (event: Event): void => {
    const { id, payload } = (event as DesignerPaletteEventMap['item-activate']).detail
    if (this.#readOnly || this.mode !== 'design' || this.#paletteView?.insert(id, this.#context()) === true)
      return
    const placement = this.#palettePlacement(id, payload)
    if (placement !== undefined)
      this.#addFromPalette(placement)
  }

  /** 物料面板拖出的物料来源条目 id；只读、不在设计态或别的拖动时为 undefined。 */
  #sourceItem(payload: unknown): string | undefined {
    return !this.#readOnly && this.mode === 'design' && isPaletteDrag(payload) && this.#sourceItems.has(payload.id) ? payload.id : undefined
  }

  /**
   * 物料拖到画布上：内置物料按落点画出新元素的外框，藏起跟手预览；物料来源的条目照常接收，跟手预览照常显示，
   * 新元素的样子由来源定，不画外框。
   */
  #dropOver(point: Point, payload: unknown): DropOver {
    if (this.#sourceItem(payload) !== undefined) {
      this.#setOverlayHover(undefined)
      return { accept: true }
    }
    const placement = !this.#readOnly && this.mode === 'design' && isPaletteDrag(payload) ? this.#palettePlacement(payload.id, payload.payload) : undefined
    const placed = placement === undefined ? undefined : this.#placement(placement.type, this.clientToWorld(point.x, point.y))
    this.#setOverlayHover(placed)
    return placed === undefined ? { accept: false } : { accept: true, ghost: 'hide' }
  }

  /** 放下物料：物料来源的条目交给来源，落点是放下处的纸张坐标与所在的区；内置的在落点新建元素并选中。 */
  #drop(point: Point, payload: unknown): void {
    this.#setOverlayHover(undefined)
    const sourced = this.#sourceItem(payload)
    if (sourced !== undefined) {
      const at = this.clientToWorld(point.x, point.y)
      this.#stopAutoFit()
      this.#paletteView?.insert(sourced, this.#context(), { x: at.x, y: at.y, region: this.#regionAt(at) })
      this.#layers?.viewport.focus({ preventScroll: true })
      return
    }
    const placement = !this.#readOnly && this.mode === 'design' && isPaletteDrag(payload) ? this.#palettePlacement(payload.id, payload.payload) : undefined
    if (placement === undefined)
      return
    this.#stopAutoFit()
    this.#addFromPalette(placement, this.clientToWorld(point.x, point.y))
    this.#layers?.viewport.focus({ preventScroll: true })
  }

  /** 覆盖层的悬停框，也用来画拖放落点与问题所在的元素。 */
  #setOverlayHover(rect: Rect | undefined): void {
    this.#hoverId = undefined
    this.#ensureLayers().overlay.hover = rect
  }

  // —— 内部：属性面板 ——

  /** 按选择换编辑对象；分组、属性名、选项与单位的文案只在对象种类或文案变化时重新交给面板。 */
  #syncProperties(layers: Layers, t: PrintDesignerTranslations): void {
    const panel = layers.properties
    const editors = this.#propertyEditors()
    const subjects = propertySubjects(this.#editor, this.#tableEdit, (kind, descriptor) => resolvePropertyEditor(editors, kind, descriptor) !== undefined)
    this.#subjects = subjects
    const kind = subjects.length > 0 && subjects.every(subject => subject.kind === subjects[0]!.kind) ? subjects[0]!.kind : ''
    const usable = (descriptor: DesignerPropertyDescriptor): boolean =>
      BUILTIN_CONTROLS.has(descriptor.control.kind) || resolvePropertyEditor(editors, kind, descriptor) !== undefined
    panel.targets = subjects.map(subject => ({ kind: subject.kind, id: subject.id, value: subject.value, descriptors: subject.descriptors.filter(usable) }))
    panel.errors = this.#propertyErrors(subjects, t)
    panel.heading = this.#propertyHeading(subjects, t)
    panel.readonly = this.#readOnly
    const inputs = [kind, editors, this.fields, t.propertyGroups, t.propertyNames, t.propertyPart, t.propertyOptions, t.units]
    if (inputs.length === this.#panelInputs.length && inputs.every((input, index) => input === this.#panelInputs[index]))
      return
    this.#panelInputs = inputs
    panel.editors = editors
    panel.dataFields = this.fields
    this.#labelProperties(panel, kind, t)
  }

  /** 属性零件的分组次序与文案：分组名、属性名（对象种类上的压过通用的，拆开的分项写成「父项 · 分项」）、选项名与单位。 */
  #labelProperties(panel: XhDesignerPropertiesElement, kind: string, t: PrintDesignerTranslations): void {
    panel.groupOrder = kind === 'page' ? PAGE_PROPERTY_GROUPS : PROPERTY_GROUPS
    panel.groupLabel = group => t.propertyGroups[group as PropertyGroup] ?? group
    panel.labelOf = descriptor => this.#propertyName(kind, descriptor, t)
    panel.optionLabel = (descriptor, option) => {
      const value = String(option.value)
      return option.label ?? t.propertyOptions[`${formatJsonPath(descriptor.path)}=${value}`] ?? t.propertyOptions[value] ?? value
    }
    panel.unitLabel = unit => t.units[unit as PropertyUnit] ?? unit
  }

  /** 属性名：对象种类上的压过通用的，拆开的分项写成「父项 · 分项」，都没有时用描述里的 label 或路径。 */
  #propertyName(kind: string, descriptor: DesignerPropertyDescriptor, t: PrintDesignerTranslations): string {
    const name = (key: string): string | undefined => t.propertyNames[`${kind}:${key}`] ?? t.propertyNames[key]
    const key = formatJsonPath(descriptor.path)
    const { labelKey, labelParent } = descriptor as ExpandedDescriptor
    const own = name(key)
    if (own !== undefined || labelKey === undefined)
      return own ?? descriptor.label ?? key
    const part = name(labelKey) ?? labelKey
    return labelParent === undefined ? part : t.propertyPart(name(labelParent) ?? labelParent, part)
  }

  /** 落在编辑对象内的校验问题，路径换成相对对象；页面设置不收元素上的问题。 */
  #propertyErrors(subjects: readonly PropertySubject[], t: PrintDesignerTranslations): DesignerPropertyError[] {
    const errors: DesignerPropertyError[] = []
    for (const subject of subjects) {
      for (const issue of this.#issues) {
        if (subject.kind === 'page' && issue.target?.kind === 'element')
          continue
        if (issue.path.length <= subject.path.length || !subject.path.every((segment, index) => issue.path[index] === segment))
          continue
        errors.push({ target: { kind: subject.kind, id: subject.id }, path: issue.path.slice(subject.path.length), message: t.issue(issue) })
      }
    }
    return errors
  }

  /** 面板标题下的一行：页面设置、元素名、「表格 · 部位」或选中的个数。 */
  #propertyHeading(subjects: readonly PropertySubject[], t: PrintDesignerTranslations): string | undefined {
    const first = subjects[0]
    if (first === undefined)
      return undefined
    if (first.kind === 'page')
      return t.pageSettings
    if (subjects.length > 1)
      return t.selectedCount(subjects.length)
    const elementId = this.#tableEdit !== undefined && Object.values(TABLE_PART_KINDS).includes(first.kind) ? this.#tableEdit : first.id
    const element = findElement(this.#editor.document, elementId)?.element
    if (element === undefined)
      return undefined
    const label = t.elementLabel(elementName(t, this.#model(), element.type), element.name ?? element.id)
    const part = this.#editor.selection.tablePart
    return elementId === first.id || part === undefined ? label : `${label} · ${t.tableParts[part.kind]}`
  }

  /** 面板上的一处修改：对每个对象各写一份，按面板给的合并键并成一步撤销，直到封口。 */
  readonly #onPropertyChange = (event: Event): void => {
    const { path, value, targets, merge } = (event as DesignerPropertiesEventMap['property-change']).detail
    if (this.#readOnly)
      return
    const subjects = new Map(this.#subjects.map(subject => [subject.id, subject]))
    const operations = targets.flatMap((target) => {
      const subject = subjects.get(target.id)
      return subject === undefined ? [] : [subject.write(path, value)]
    })
    if (operations.length > 0)
      this.#editor.execute(operations, { merge, mergeWithin: Number.POSITIVE_INFINITY, ...this.#propertyLabel(this.#subjects[0], path) })
  }

  /** 改一项属性的说明「修改「属性名」」，属性名与面板上的一致；找不到这一项时不给，交给 describe。 */
  #propertyLabel(subject: PropertySubject | undefined, path: JsonPath): { readonly label?: HistoryLabel } {
    const descriptor = subject?.descriptors.find(item => jsonEquals(item.path, path))
    if (subject === undefined || descriptor === undefined)
      return {}
    const kind = subject.kind
    return { label: () => {
      const t = this.#translations()
      return t.history.editProperty(this.#propertyName(kind, descriptor, t))
    } }
  }

  /** 交给面板的编辑器：各扩展的编辑器按顺序合成一张，设计器自带的在最底下。 */
  #propertyEditors(): PropertyEditorTable<DesignerPropertyEditor> {
    return this.#model().editors
  }

  /** 表格的列或表尾行列成条目，点一下进入表格编辑态并选中该部位；某一列或某一行里的问题写在它的条目下面。 */
  #partList(kind: 'column' | 'footerRow'): DesignerPropertyEditor {
    return (initial) => {
      const doc = this.ownerDocument
      const ids = createCounterIdGenerator('xh-print-part-list')
      const list = createAuthoredElement(doc, 'div', { 'data-part': 'part-list', 'role': 'group' })
      const render = (context: typeof initial): void => {
        const tableId = context.target.length === 1 ? context.target[0]!.id : undefined
        const items = Array.isArray(context.value) ? context.value as readonly { id?: unknown, title?: unknown }[] : []
        const t = this.#translations()
        list.replaceChildren(...items.flatMap((item, index) => {
          const id = String(item.id)
          const title = typeof item.title === 'string' && item.title !== '' ? item.title : undefined
          const text = kind === 'column' ? title ?? t.newColumnTitle(index + 1) : `${t.tableParts.footerRow} ${index + 1}`
          const face = createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button', 'disabled': tableId === undefined }, [text])
          const button = createAuthoredElement(doc, 'xh-button', { 'variant': 'ghost', 'size': 'sm', 'full-width': true, 'data-part': 'part-item' }, [face])
          button.addEventListener('click', () => {
            if (tableId !== undefined)
              this.#selectTablePart(tableId, kind === 'column' ? { kind, elementId: tableId, columnId: id } : { kind, elementId: tableId, rowId: id })
          })
          const issue = createIssueText(doc, ids.scopeId())
          issue.show(issuesUnder(context.issues, [index])[0]?.message, { focusable: face, ariaInvalid: true })
          return [button, issue.element]
        }))
      }
      render(initial)
      return { element: list, update: render, nestedIssues: true }
    }
  }

  /**
   * 页码格式：一行文本，行尾的菜单把 {{$page}}、{{$pages}} 插到光标处，下面按第 1 页、共 3 页显示示例，
   * 数字写法取页码元素的 numeral。
   */
  #pageNumberFormat(): DesignerPropertyEditor {
    return (initial) => {
      const doc = this.ownerDocument
      let context = initial
      const input = createAuthoredElement(doc, 'input', { 'data-xh-part': 'input' }) as HTMLInputElement
      const menu = createAuthoredElement(doc, 'xh-menu', { size: 'sm', placement: 'bottom-end' }) as XhMenuElement
      const field = createAuthoredElement(doc, 'xh-text-field', { size: 'sm' }, [
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [
          createAuthoredElement(doc, 'div', { 'data-xh-part': 'control' }, [
            input,
            createAuthoredElement(doc, 'span', { 'data-xh-part': 'suffix' }, [menu]),
          ]),
        ]),
      ]) as XhTextFieldElement
      field.setAttribute('data-xh-part', 'control')
      // 示例是字段的说明：放进字段时文本框铺满面板，读屏也会把示例当说明读出
      const sample = createAuthoredElement(doc, 'p', { 'data-xh-part': 'description' })
      const root = createAuthoredElement(doc, 'xh-field', { 'data-part': 'page-number-format' }, [
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [field, sample]),
      ])
      const current = (): string => typeof context.value === 'string' ? context.value : ''
      field.addEventListener('value-change', (event) => {
        event.stopPropagation()
        const { value } = (event as CustomEvent<{ value: string }>).detail
        field.value = value
        context.setValue(value)
      })
      field.addEventListener('focusout', () => context.commit())
      // 菜单的事件只在编辑器里用，不冒到设计器
      menu.addEventListener('open-change', event => event.stopPropagation())
      menu.addEventListener('item-select', (event) => {
        event.stopPropagation()
        const token = `{{${(event as CustomEvent<{ value: string }>).detail.value}}}`
        const text = current()
        const start = input.selectionStart ?? text.length
        const end = input.selectionEnd ?? start
        const next = text.slice(0, start) + token + text.slice(end)
        field.value = next
        context.setValue(next)
        context.commit()
        void field.updateComplete.then(() => {
          input.focus()
          input.setSelectionRange(start + token.length, start + token.length)
        })
      })
      const render = (next: typeof initial): void => {
        context = next
        const t = this.#translations()
        const kind = next.target[0]?.kind ?? ''
        const name = t.propertyNames[`${kind}:format`] ?? t.propertyNames.format ?? 'format'
        if (input.getAttribute('aria-label') !== name)
          input.setAttribute('aria-label', name)
        const value = current()
        if (field.value !== value)
          field.value = value
        field.readOnly = next.readonly
        menu.disabled = next.readonly
        menu.label = t.pageNumberInsert
        menu.collection = [
          { value: '$page', label: t.pageNumberTokens.page, shortcut: '{{$page}}' },
          { value: '$pages', label: t.pageNumberTokens.pages, shortcut: '{{$pages}}' },
        ]
        const numeral = (next.target[0]?.value as { numeral?: NumeralStyle } | undefined)?.numeral
        const formatter = this.formatter ?? formatValue
        const options = this.locale === undefined ? {} : { locale: this.locale }
        const number = (n: number): string => numeral === undefined ? String(n) : formatter(n, { kind: 'numeral', style: numeral }, options)
        sample.textContent = t.pageNumberSample(fillTextTemplate(value, { $page: number(1), $pages: number(3) }).text)
      }
      render(initial)
      return { element: root, update: render }
    }
  }

  /** 进入表格编辑态并选中部位。 */
  #selectTablePart(tableId: string, part: PrintTablePart): void {
    this.#tableEdit = tableId
    this.#editor.select({ elements: [tableId], tablePart: part })
    this.requestUpdate()
  }

  readonly #onPropertyCommit = (): void => {
    this.#editor.seal()
  }

  // —— 内部：问题列表 ——

  #syncIssues(layers: Layers, t: PrintDesignerTranslations): void {
    layers.issues.readonly = this.#readOnly
    const document = this.#editor.document
    const key = JSON.stringify([document.pages.map(page => [page.id, page.name]), t.pageTitle(1), t.elements])
    if (this.#listed?.issues === this.#issues && this.#listed.key === key && layers.issues.items !== undefined)
      return
    this.#listed = { issues: this.#issues, key }
    layers.issues.items = this.#issueItems(this.#issues, this.#editor.document, t)
  }

  /** 问题列表的条目：问题、说明与所在对象的名字（按 document 取页面与元素；不给就不写）。 */
  #issueItems(issues: readonly ValidationIssue[], document: PrintDocument | undefined, t: PrintDesignerTranslations): DesignerIssueItem[] {
    return issues.map((issue): DesignerIssueItem => {
      const subject = document === undefined ? undefined : this.#issueSubject(issue, document, t)
      return { issue, message: t.issue(issue), ...(subject === undefined ? {} : { subject }) }
    })
  }

  /** JSON 编辑框里的一份模板：按打印的登记表与表达式引擎校验；连页面列表都没有时不写问题所在对象的名字。 */
  #jsonIssues(value: JsonValue): DesignerIssueItem[] {
    const { issues } = validateDocument(value, { extensions: this.#model().list, expressionEngine: this.#engine() })
    const pages = isPlainObject(value) ? value.pages : undefined
    const document = Array.isArray(pages) ? value as unknown as PrintDocument : undefined
    return this.#issueItems(issues, document, this.#translations())
  }

  /** JSON 编辑框里按了「应用」：整份换上，记一步撤销。 */
  readonly #onJsonApply = (event: Event): void => {
    event.stopPropagation()
    if (this.#readOnly)
      return
    const { value } = (event as DesignerJsonEditorEventMap['json-apply']).detail
    this.#tableEdit = undefined
    this.#editor.execute([{ type: 'replaceDocument', document: value as unknown as PrintDocument }])
  }

  /** 问题所在对象的名字：页面名，或「页面 · 元素」。 */
  #issueSubject(issue: ValidationIssue, document: PrintDocument, t: PrintDesignerTranslations): string | undefined {
    const target = issue.target
    if (target === undefined)
      return undefined
    const pages = document.pages
    const pageName = (index: number): string => pages[index]?.name ?? t.pageTitle(index + 1)
    if (target.kind === 'page') {
      const index = pages.findIndex(page => page.id === target.id)
      return index < 0 ? target.id : pageName(index)
    }
    const found = target.kind === 'element' ? findElement(document, target.id) : undefined
    if (found === undefined)
      return target.id
    const type = found.element.type
    return `${pageName(pages.indexOf(found.page))} · ${t.elementLabel(elementName(t, this.#model(), type), found.element.name ?? found.element.id)}`
  }

  /** 点选问题：切到所在页面模板；落在元素上时选中元素并移进视口。 */
  readonly #onIssueActivate = (event: Event): void => {
    const target = (event as DesignerIssuesEventMap['issue-activate']).detail.issue.target
    if (target?.kind === 'page' && this.#editor.document.pages.some(page => page.id === target.id)) {
      this.#editor.setActivePage(target.id)
      return
    }
    if (target?.kind !== 'element' || findElement(this.#editor.document, target.id) === undefined)
      return
    this.revealElement(target.id)
    this.#editor.select({ elements: [target.id] })
  }

  /** 指针在问题上时，画布上框出所在元素。 */
  readonly #onIssueHover = (event: Event): void => {
    const target = (event as DesignerIssuesEventMap['issue-hover']).detail.issue?.target
    const item = target?.kind === 'element' ? this.#editor.visibleElements().find(visible => visible.element.id === target.id) : undefined
    this.#setOverlayHover(item === undefined ? undefined : elementRect(item.element))
  }

  /** 侧边面板里的按键与剪贴板事件归面板自己。 */
  #fromPanel(target: Element | undefined): boolean {
    return target?.closest('xh-designer-palette, xh-designer-outline, xh-designer-properties, xh-designer-issues') != null
  }

  // —— 内部：标尺与参考线 ——

  /** 标尺显示时画布放进标尺框，不显示时直接放在工作区；预览态两者都收起。标尺显示着时宿主带 data-rulers。 */
  #placeCanvas(layers: Layers, preview: boolean): void {
    const rulers = !preview && this.#resolvedSettings[PRINT_SETTING_KEYS.rulers] !== false
    if (rulers && !layers.ruler.contains(layers.menu))
      layers.ruler.append(layers.menu)
    else if (!rulers && layers.ruler.contains(layers.menu))
      layers.workspace.insertBefore(layers.menu, layers.preview)
    layers.ruler.hidden = !rulers
    layers.menu.hidden = preview
    this.toggleAttribute('data-rulers', rulers)
  }

  /** 标尺上的参考线取当前页面模板，选中元素的范围画成淡底。 */
  #syncRuler(layers: Layers): void {
    const selected = new Set(this.#editor.selection.elements)
    layers.ruler.readonly = this.#readOnly
    layers.ruler.guides = this.#editor.page.guides ?? NO_GUIDES
    layers.ruler.highlight = unionRects(this.#editor.visibleElements().filter(item => selected.has(item.element.id)).map(item => elementRect(item.element)))
  }

  /** 参考线写回页面模板；全部删掉时去掉 guides。 */
  readonly #onGuidesChange = (event: Event): void => {
    if (this.#readOnly)
      return
    const { guides } = (event as DesignerRulerEventMap['guides-change']).detail
    const value = guides.x.length === 0 && guides.y.length === 0 ? undefined : { x: [...guides.x], y: [...guides.y] }
    this.#editor.execute([{ type: 'updatePage', pageId: this.#editor.activePageId, changes: [{ path: ['guides'], value }] }])
  }

  // —— 内部：变换覆盖层 ——

  #formatMm(value: number): string {
    return formatLength(value, { locale: this.locale })
  }

  /** 覆盖层上的选中项：表格编辑态与预览态下没有；锁定的元素不能缩放与旋转。 */
  #overlayItems(): DesignerTransformItem[] {
    if (this.#tableEdit !== undefined || this.mode !== 'design')
      return []
    const selected = new Set(this.#editor.selection.elements)
    return this.#editor.visibleElements().filter(item => selected.has(item.element.id)).map(({ element }) => {
      const prototype = this.#editor.elements.get(element.type)
      return {
        id: element.id,
        rect: elementRect(element),
        handles: element.locked === true ? false : resizeHandles(element),
        rotatable: element.locked !== true && 'rotation' in element,
        keepAspect: element.type === 'matrixCode',
        ...(prototype === undefined ? {} : { minSize: prototype.minSize }),
      }
    })
  }

  #syncOverlay(layers: Layers): void {
    layers.overlay.readonly = this.#readOnly
    layers.overlay.items = this.#overlayItems()
  }

  /** 吸附选项：其它元素、页边距、各区边界与参考线；关掉吸附时只吸网格。 */
  #snapOptions(): DesignerSnapOptions | undefined {
    const size = this.#gridSize()
    const grid = size > 0 ? size : undefined
    if (this.#resolvedSettings[PRINT_SETTING_KEYS.snap] === false)
      return grid === undefined ? undefined : { targets: [], grid }
    const page = this.#editor.page
    const bands = this.#editor.bands
    const header = page.header[bands.header] ?? page.header.default
    const footer = page.footer[bands.footer] ?? page.footer.default
    const selected = new Set(this.#editor.selection.elements)
    const targets = [
      ...this.#editor.visibleElements().filter(item => !selected.has(item.element.id)).map(item => elementRect(item.element)),
      getContentRect(page),
      getBandRect(page, 'header', header),
      getBodyRect(page, header, footer),
      getBandRect(page, 'footer', footer),
    ]
    return {
      targets,
      ...(page.guides === undefined ? {} : { lines: { x: page.guides.x, y: page.guides.y } }),
      ...(grid === undefined ? {} : { grid }),
    }
  }

  /** 在选中元素上按下：同步覆盖层的选中项后交给它移动；只读或有锁定的元素时不动。 */
  #startMove(event: PointerEvent): void {
    const layers = this.#ensureLayers()
    this.#syncOverlay(layers)
    const selected = new Set(this.#editor.selection.elements)
    if (this.#readOnly || this.#editor.visibleElements().some(item => selected.has(item.element.id) && item.element.locked === true))
      return
    layers.overlay.startMove(event)
  }

  /** 把覆盖层算出的矩形换成编辑操作。 */
  #transformOperations(kind: DesignerTransformEventMap['transform']['detail']['kind'], rects: ReadonlyMap<string, Rect>): PrintOperation[] {
    const elements = new Map(this.#editor.visibleElements().map(item => [item.element.id, item.element]))
    const entries = [...rects].filter(([id]) => elements.has(id))
    if (kind === 'move') {
      const delta = this.#moveDelta(rects)
      return delta === undefined ? [] : this.#moveOperations(entries.map(([id]) => id), delta.dx, delta.dy)
    }
    if (kind === 'resize')
      return entries.map(([id, rect]) => ({ type: 'resizeElement', id, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }))
    return entries.map(([id, rect]) => ({ type: 'updateElement', id, changes: [{ path: ['rotation'], value: normalizeAngle(rect.rotation ?? 0) }] }))
  }

  /** 移动手势的位移：取第一个仍可见的选中项，新矩形与它当前位置之差。 */
  #moveDelta(rects: ReadonlyMap<string, Rect>): { readonly dx: number, readonly dy: number } | undefined {
    const elements = new Map(this.#editor.visibleElements().map(item => [item.element.id, item.element]))
    for (const [id, rect] of rects) {
      const element = elements.get(id)
      if (element !== undefined)
        return { dx: rect.x - element.x, dy: rect.y - element.y }
    }
    return undefined
  }

  /**
   * 平移一组元素。中心落进另一个区（页眉、正文、页脚）的元素在同一步里从原容器删掉、加到该区当前显示的带区，
   * 层级在最上；跨页延展的元素只能在正文区，留在原容器。
   */
  #moveOperations(ids: readonly string[], dx: number, dy: number): PrintOperation[] {
    const page = this.#editor.page
    const bands = this.#editor.bands
    const stay: string[] = []
    const moved: PrintOperation[] = []
    for (const id of ids) {
      const found = findElement(this.#editor.document, id)
      if (found === undefined)
        continue
      const { element, container } = found
      const rect = elementRect(element)
      const region = this.#editor.elements.get(element.type)?.flow === true
        ? container.region
        : this.#regionAt({ x: rect.x + dx + rect.width / 2, y: rect.y + dy + rect.height / 2 })
      if (region === container.region) {
        stay.push(id)
        continue
      }
      const target: ElementContainerRef = region === 'body'
        ? { pageId: page.id, region }
        : { pageId: page.id, region, band: page[region][bands[region]] === undefined ? 'default' : bands[region] }
      moved.push({ type: 'removeElement', id }, { type: 'addElement', container: target, element: { ...element, x: element.x + dx, y: element.y + dy } })
    }
    return stay.length === 0 || (dx === 0 && dy === 0) ? moved : [{ type: 'moveElements', ids: stay, dx, dy }, ...moved]
  }

  /** 拖动中每帧回滚到手势开始时再执行一次，画布按新矩形重排；松手提交为一步撤销，Alt 拖动时改为复制到新位置。 */
  readonly #onTransform = (event: Event): void => {
    const { phase, kind, rects, copy } = (event as DesignerTransformEventMap['transform']).detail
    const history = this.#editor.history
    if (phase === 'start') {
      this.#stopAutoFit()
      const phrase = kind === 'move' ? 'move' : kind === 'resize' ? 'resize' : 'rotate'
      this.#gestureLabel = elementsLabel(phrase, identitiesIn(this.#editor.document, [...rects.keys()]), this.#labelSource)
      history.begin(this.#gestureLabel)
      return
    }
    if (!history.inTransaction)
      return
    history.rollback()
    if (phase === 'cancel')
      return
    const copying = phase === 'end' && copy === true && kind === 'move'
    history.begin(copying ? elementsLabel('copy', identitiesIn(this.#editor.document, [...rects.keys()]), this.#labelSource) : this.#gestureLabel)
    if (copying) {
      const delta = this.#moveDelta(rects)
      const duplicated = this.#editor.duplicate({ offset: 0 })
      if (delta !== undefined)
        this.#editor.execute(this.#moveOperations(duplicated.elements, delta.dx, delta.dy))
    }
    else {
      this.#editor.execute(this.#transformOperations(kind, rects))
    }
    if (phase === 'end')
      history.commit()
  }

  /** 在尺寸徽标里改了宽或高：按新矩形改尺寸；连续点加减钮或按方向键并成一步撤销，输入后确认的单独一步。 */
  readonly #onMeasureChange = (event: Event): void => {
    const { id, rect, axis, source } = (event as DesignerTransformEventMap['measure-change']).detail
    if (this.#readOnly || this.mode !== 'design')
      return
    this.#stopAutoFit()
    const operation: PrintOperation = { type: 'resizeElement', id, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    const label = elementsLabel('resize', identitiesIn(this.#editor.document, [id]), this.#labelSource)
    this.#editor.execute([operation], source === 'step' ? { merge: `measure:${id}:${axis}`, label } : { label })
  }

  readonly #onMarquee = (event: Event): void => {
    const { phase, rect, mode, additive } = (event as DesignerTransformEventMap['marquee']).detail
    if (phase !== 'end')
      return
    const visible = this.#editor.visibleElements()
    const ids = selectInMarquee(rect, visible.map(item => elementRect(item.element)), mode).map(index => visible[index]!.element.id)
    this.#editor.select({ elements: ids }, additive ? 'add' : 'replace')
  }

  readonly #onPanRequest = (event: Event): void => {
    const { dx, dy } = (event as CustomEvent<PanRequestDetail>).detail
    this.#stopAutoFit()
    this.#moveTo(panBy(this.#viewport, -dx, -dy))
  }

  readonly #onHover = (event: PointerEvent): void => {
    if (this.mode !== 'design' || event.buttons !== 0 || this.#tableEdit !== undefined)
      return
    const hit = this.#elementAt(this.clientToWorld(event.clientX, event.clientY))
    if (hit?.id === this.#hoverId)
      return
    this.#hoverId = hit?.id
    this.#ensureLayers().overlay.hover = hit === undefined ? undefined : elementRect(hit)
  }

  readonly #onHoverEnd = (): void => {
    if (this.#hoverId === undefined)
      return
    this.#hoverId = undefined
    this.#ensureLayers().overlay.hover = undefined
  }

  // —— 内部：表格编辑态 ——

  #selectedTable(): TableElement | undefined {
    const ids = this.#editor.selection.elements
    if (ids.length !== 1)
      return undefined
    const found = this.#editor.visibleElements().find(item => item.element.id === ids[0])
    return found?.element.type === 'table' ? found.element : undefined
  }

  #editTable(): TableElement | undefined {
    if (this.#tableEdit === undefined)
      return undefined
    const table = this.#selectedTable()
    return table?.id === this.#tableEdit ? table : undefined
  }

  #tableBox(): TableLayoutBox | undefined {
    const id = this.#tableEdit
    const box = id === undefined ? undefined : this.#layout?.body.find(item => item.elementId === id)
    return box?.kind === 'table' ? box : undefined
  }

  #enterTableEdit(id: string): void {
    this.#tableEdit = id
    this.#editor.select({ elements: [id], tablePart: { kind: 'body', elementId: id } })
    this.requestUpdate()
  }

  #exitTableEdit(): void {
    const id = this.#tableEdit
    this.#tableEdit = undefined
    if (id !== undefined)
      this.#editor.select({ elements: [id] })
    this.requestUpdate()
  }

  // —— 内部：指针、键盘、剪贴板 ——

  #track(event: PointerEvent, handlers: { readonly onActivate?: () => void, readonly onMove: (dx: number, dy: number) => void, readonly onEnd: (active: boolean) => void, readonly onCancel?: () => void }): void {
    const start = { x: event.clientX, y: event.clientY }
    const gesture: Gesture = {
      active: false,
      cancel: () => handlers.onCancel?.(),
      session: createPointerSession({
        doc: resolveSessionDoc(this),
        pointerId: event.pointerId,
        onMove: ({ point }) => {
          const dx = point.clientX - start.x
          const dy = point.clientY - start.y
          if (!gesture.active) {
            if (!shouldActivate({ x: dx, y: dy }))
              return
            gesture.active = true
            handlers.onActivate?.()
          }
          handlers.onMove(dx, dy)
        },
        onEnd: () => {
          gesture.session.dispose()
          if (this.#gesture === gesture)
            this.#gesture = undefined
          handlers.onEnd(gesture.active)
        },
      }),
    }
    this.#gesture = gesture
  }

  #cancelGesture(): void {
    const gesture = this.#gesture
    if (!gesture)
      return
    gesture.session.dispose()
    this.#gesture = undefined
    gesture.cancel()
    if (this.#editor.history.inTransaction)
      this.#editor.history.rollback()
    this.requestUpdate()
  }

  /** 按住拖动平移视口：只点一下（没拖起来）什么都不做；拖动中宿主带 data-panning。 */
  #pan(event: PointerEvent): void {
    const origin = this.#viewport
    this.#stopAutoFit()
    this.toggleAttribute('data-panning', true)
    this.#track(event, {
      onMove: (dx, dy) => this.#moveTo(panBy(origin, dx, dy)),
      onEnd: () => this.toggleAttribute('data-panning', false),
      onCancel: () => {
        this.toggleAttribute('data-panning', false)
        this.#moveTo(origin)
      },
    })
  }

  /** 外框此刻是拖动工具，且在设计态。 */
  #panTool(): boolean {
    return this.mode === 'design' && this.#layers?.frame.canvasTool === 'pan'
  }

  /**
   * 拖动工具开着时，画布上按下（捕获阶段，先于元素、控制柄与表格把手）一律走平移：不选中、不挪元素，只点一下不取消选择。
   * 选中工具条、尺寸徽标与页眉页脚变体菜单这些控件照常可用。
   */
  readonly #onPanToolPointerDown = (event: PointerEvent): void => {
    if (!this.#panTool() || this.#gesture || event.button !== 0)
      return
    const target = event.target instanceof Element ? event.target : undefined
    if (target?.closest('[data-part="band-menu"], xh-designer-transform > [data-part="toolbar"], xh-designer-transform > [data-part="measure"]'))
      return
    event.preventDefault()
    event.stopPropagation()
    this.#layers!.viewport.focus({ preventScroll: true })
    this.#pan(event)
  }

  /** 拖动工具开着、正在拖动时按 Esc：只取消这次拖动并接走按键，外框就不会同时退出拖动工具。 */
  readonly #onPanToolEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#panTool() || !this.#gesture)
      return
    this.#cancelGesture()
    event.preventDefault()
  }

  #dragBand(event: PointerEvent, region: 'header' | 'footer'): void {
    const page = this.#editor.page
    const key = this.#editor.bands[region]
    const startHeight = (page[region][key] ?? page[region].default).height
    const zoom = this.#viewport.zoom
    this.#track(event, {
      onActivate: () => this.#editor.history.begin(() => this.#translations().resizeBand(region)),
      onMove: (_dx, dy) => {
        const delta = (region === 'header' ? dy : -dy) / zoom
        this.#editor.setBandHeight(region, key, Math.max(0, this.#snapValue(startHeight + delta)))
      },
      onEnd: (active) => {
        if (active && this.#editor.history.inTransaction)
          this.#editor.history.commit()
      },
    })
  }

  #dragColumn(event: PointerEvent, columnId: string): void {
    const table = this.#editTable()
    const column = table?.columns.find(item => item.id === columnId)
    if (table === undefined || column === undefined)
      return
    const last = table.columns.at(-1)?.id === columnId
    const zoom = this.#viewport.zoom
    const title = column.title
    this.#track(event, {
      onActivate: () => this.#editor.history.begin(() => this.#translations().resizeColumn(title)),
      onMove: (dx) => {
        const width = this.#snapValue(column.width + dx / zoom)
        this.#editor.applyTablePlan(table.id, planResizeTableColumn(table, columnId, width, last ? 'resize' : 'keep'))
      },
      onEnd: (active) => {
        if (active && this.#editor.history.inTransaction)
          this.#editor.history.commit()
      },
    })
  }

  /** 纸张坐标上的最上层可见元素。 */
  #elementAt(point: Point): PrintElement | undefined {
    const elements = this.#editor.visibleElements().map(item => item.element)
    const index = hitTest(point, elements.map(elementRect))
    return index < 0 ? undefined : elements[index]
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#gesture || this.mode !== 'design')
      return
    this.#layers?.viewport.focus({ preventScroll: true })
    if (event.button === 1 || (event.button === 0 && this.#spacePan)) {
      event.preventDefault()
      this.#pan(event)
      return
    }
    if (event.button !== 0)
      return
    const target = event.target instanceof Element ? event.target : undefined
    if (target?.closest('[data-part="band-menu"]'))
      return
    const bandHandle = target?.closest<HTMLElement>('[data-part="band-handle"]')
    if (bandHandle && !this.#readOnly) {
      this.#stopAutoFit()
      this.#dragBand(event, bandHandle.dataset.region as 'header' | 'footer')
      return
    }
    const columnHandle = target?.closest<HTMLElement>('[data-part="column-handle"]')
    if (columnHandle && !this.#readOnly) {
      this.#stopAutoFit()
      this.#dragColumn(event, columnHandle.dataset.columnId!)
      return
    }
    const point = this.clientToWorld(event.clientX, event.clientY)
    const tableBox = this.#tableBox()
    if (tableBox !== undefined) {
      const part = tablePartAt(tableBox, point)
      if (part !== undefined) {
        this.#editor.select({ elements: [tableBox.elementId], tablePart: part })
        return
      }
    }
    const hit = this.#elementAt(point)
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    if (hit !== undefined && additive) {
      this.#editor.select({ elements: [hit.id] }, 'toggle')
      return
    }
    if (hit !== undefined) {
      if (!this.#editor.selection.elements.includes(hit.id))
        this.#editor.select({ elements: [hit.id] })
      this.#startMove(event)
      return
    }
    if (!additive)
      this.#editor.clearSelection()
    this.#ensureLayers().overlay.startMarquee(event, { additive })
  }

  readonly #onDoubleClick = (event: MouseEvent): void => {
    if (this.mode !== 'design' || this.#panTool())
      return
    const point = this.clientToWorld(event.clientX, event.clientY)
    const tableBox = this.#tableBox()
    if (tableBox !== undefined) {
      const part = tablePartAt(tableBox, point)
      if (part?.kind === 'column')
        this.#editor.select({ elements: [tableBox.elementId], tablePart: { kind: 'header', elementId: tableBox.elementId } })
      return
    }
    const hit = this.#elementAt(point)
    if (hit === undefined)
      return
    if (hit.type === 'table' && !this.#readOnly)
      this.#enterTableEdit(hit.id)
    emitEvent(this, 'element-dblclick', { id: hit.id })
  }

  readonly #onContextMenu = (event: MouseEvent): void => {
    if (this.mode !== 'design')
      return
    const point = this.clientToWorld(event.clientX, event.clientY)
    const position = { x: event.clientX, y: event.clientY }
    const tableBox = this.#tableBox()
    const part = tableBox === undefined ? undefined : tablePartAt(tableBox, point)
    if (tableBox !== undefined && part !== undefined) {
      this.#editor.select({ elements: [tableBox.elementId], tablePart: part })
      if (!emitEvent(this, 'table-contextmenu', { id: tableBox.elementId, part, ...position }, { cancelable: true })) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      this.#prepareMenu('table')
      return
    }
    const hit = this.#elementAt(point)
    if (hit !== undefined && !this.#editor.selection.elements.includes(hit.id))
      this.#editor.select({ elements: [hit.id] })
    const proceed = hit !== undefined
      ? emitEvent(this, 'element-contextmenu', { id: hit.id, ...position }, { cancelable: true })
      : emitEvent(this, 'blank-contextmenu', position, { cancelable: true })
    if (!proceed) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    this.#prepareMenu(hit === undefined ? 'blank' : 'element')
  }

  #prepareMenu(subject: PrintMenuSubject): void {
    this.#fillMenu(this.#ensureLayers().menuContent, subject)
  }

  /** 按对象换上右键菜单的条目；条目的可用状态取此刻设计器的状态。 */
  #fillMenu(content: HTMLElement, subject: PrintMenuSubject): void {
    const { commands } = this.#model()
    const groups = arrangeCommands(`menu:${subject}`, commands, printMenuLayout(subject, this.#selectedTable() !== undefined), this.commandLayout)
    renderCommandMenu(content, groups, commands, this.#context(), { platform: this.#kbdPlatform() })
  }

  readonly #onMenuSelect = (event: Event): void => {
    // 页眉页脚菜单在画布里，它的 item-select 会冒泡到这里
    if (event.target !== event.currentTarget)
      return
    runCommand(this.#model().commands, (event as CustomEvent<{ value: string }>).detail.value, this.#context())
  }

  readonly #onWheel = (event: WheelEvent): void => {
    if (this.mode !== 'design')
      return
    event.preventDefault()
    this.#stopAutoFit()
    if (event.ctrlKey || event.metaKey) {
      const box = this.#layers!.viewport.getBoundingClientRect()
      this.#moveTo(zoomBy(this.#viewport, wheelZoomFactor(event.deltaY, event.deltaMode), { x: event.clientX - box.left, y: event.clientY - box.top }, ZOOM_LIMITS))
      return
    }
    const size = this.#size()
    const pixels = wheelPixels(event, size === undefined ? {} : { page: size.height })
    this.#moveTo(panBy(this.#viewport, -pixels.x, -pixels.y))
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || this.mode !== 'design')
      return
    const target = event.target instanceof Element ? event.target : undefined
    if (target && target !== this.#layers?.viewport && (target.closest('input, textarea, select, [contenteditable]') || this.#fromPanel(target)))
      return
    if (event.altKey && event.key === 'F10') {
      // Alt+F10 把焦点交给选中工具条（没有时交给尺寸徽标），在里面按 Esc 回到这里
      if (this.#layers?.overlay.focusToolbar() || this.#layers?.overlay.focusMeasure())
        event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      if (this.#gesture)
        this.#cancelGesture()
      else if (this.#tableEdit !== undefined)
        this.#exitTableEdit()
      else
        this.#editor.clearSelection()
      event.preventDefault()
      return
    }
    if (this.#gesture)
      return
    const context = this.#context()
    const hit = commandForShortcut(this.#model().commands.values(), event, context, this.#kbdPlatform())
    if (hit) {
      hit.run(context)
      event.preventDefault()
      return
    }
    const command = event.ctrlKey || event.metaKey
    if (command && !event.altKey ? this.#onCommandKey(event) : !command && !event.altKey && this.#onPlainKey(event))
      event.preventDefault()
  }

  /** 命令没有接住的 Ctrl / ⌘ 组合：设计器占用的组合此刻不可用时也不交给浏览器。 */
  #onCommandKey(event: KeyboardEvent): boolean {
    return RESERVED_COMMAND_KEYS.has(event.key.toLowerCase())
  }

  #onPlainKey(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        return this.deleteSelection()
      case ' ':
        if (event.target !== this.#layers?.viewport)
          return false
        if (!event.repeat)
          this.#setSpacePan(true)
        return true
      case 'Enter': {
        const table = this.#selectedTable()
        if (table === undefined || this.#readOnly || this.#tableEdit !== undefined)
          return false
        this.#enterTableEdit(table.id)
        return true
      }
    }
    const step = this.#gridSize() || 1
    const delta = nudgeDelta(event.key, { large: event.shiftKey, step, largeStep: NUDGE_LARGE_STEP })
    if (!delta)
      return false
    const ids = this.#editor.selection.elements
    if (ids.length > 0 && !this.#readOnly && this.#tableEdit === undefined) {
      this.#editor.moveElements(ids, delta.dx, delta.dy, { merge: nudgeMergeKey(ids), mergeWithin: HISTORY_NUDGE_MERGE_WITHIN })
      return true
    }
    this.#stopAutoFit()
    this.#moveTo(panBy(this.#viewport, -Math.sign(delta.dx) * PAN_STEP, -Math.sign(delta.dy) * PAN_STEP))
    return true
  }

  #setSpacePan(value: boolean): void {
    this.#spacePan = value
    this.toggleAttribute('data-space-pan', value)
  }

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ' && this.#spacePan)
      this.#setSpacePan(false)
  }

  readonly #onFocusOut = (): void => {
    if (this.#spacePan)
      this.#setSpacePan(false)
  }

  #clipboardText(): string | undefined {
    const clipboard = this.#editor.copy()
    return clipboard === undefined ? undefined : encodeClipboard(CLIPBOARD_PRODUCT, CLIPBOARD_VERSION, clipboard as unknown as JsonValue)
  }

  #writeClipboard(event: ClipboardEvent): boolean {
    if (this.mode !== 'design' || !this.#ownsClipboardEvent(event))
      return false
    const text = this.#clipboardText()
    if (text === undefined || event.clipboardData === null)
      return false
    event.clipboardData.setData(clipboardMimeType(CLIPBOARD_PRODUCT), text)
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    return true
  }

  #ownsClipboardEvent(event: ClipboardEvent): boolean {
    const target = event.target instanceof Element ? event.target : undefined
    return target === undefined || target === this.#layers?.viewport || !(target.closest('input, textarea, select, [contenteditable]') || this.#fromPanel(target))
  }

  readonly #onCopy = (event: ClipboardEvent): void => {
    this.#writeClipboard(event)
  }

  readonly #onCut = (event: ClipboardEvent): void => {
    if (!this.#readOnly && this.#writeClipboard(event))
      this.#editor.deleteSelection()
  }

  readonly #onPaste = (event: ClipboardEvent): void => {
    if (this.#readOnly || this.mode !== 'design' || !this.#ownsClipboardEvent(event) || event.clipboardData === null)
      return
    const data = event.clipboardData
    const result = decodeClipboard(data.getData(clipboardMimeType(CLIPBOARD_PRODUCT)) || data.getData('text/plain'), CLIPBOARD_PRODUCT)
    if (result.ok && result.version === CLIPBOARD_VERSION) {
      const clipboard = this.#readClipboard(result.payload)
      if (clipboard === undefined)
        return
      event.preventDefault()
      this.#editor.paste(clipboard)
      return
    }
    if (this.#import(importSources(data, 'clipboard'), this.#viewportCenter()))
      event.preventDefault()
  }

  /** 有导入器时画布接受从外部拖进来的文件与文本。 */
  readonly #onNativeDragOver = (event: DragEvent): void => {
    if (this.#readOnly || this.mode !== 'design' || event.dataTransfer === null || this.#model().importers.length === 0)
      return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  readonly #onNativeDrop = (event: DragEvent): void => {
    if (this.#readOnly || this.mode !== 'design' || event.dataTransfer === null || this.#model().importers.length === 0)
      return
    event.preventDefault()
    if (this.#import(importSources(event.dataTransfer, 'drop'), this.clientToWorld(event.clientX, event.clientY)))
      this.#stopAutoFit()
  }

  /** 依次把来源交给导入器，按扩展顺序第一个接下的导入；没有导入器接下时返回 false。 */
  #import(sources: readonly DesignerImportSource[], at: Point): boolean {
    const found = findImporter(this.#model().importers, sources)
    if (found === undefined)
      return false
    void this.#runImport(found.importer, found.source, at)
    return true
  }

  /** 导入并放下：元素整体挪到以 at 为中心，校验通过后按粘贴的规则放进当前页面模板；出错时派发 import-error。 */
  async #runImport(importer: PrintDesignerImporter, source: DesignerImportSource, at: Point): Promise<void> {
    try {
      const fragment = await importer.import(source, this.#context())
      if (fragment === undefined || fragment.elements.length === 0 || this.#readOnly || this.mode !== 'design')
        return
      const bounds = unionRects(fragment.elements.map(elementRect))!
      const dx = this.#snapValue(at.x - bounds.width / 2) - bounds.x
      const dy = this.#snapValue(at.y - bounds.height / 2) - bounds.y
      const elements = fragment.elements.map(element => ({ ...element, x: element.x + dx, y: element.y + dy }))
      const clipboard = this.#readClipboard({ elements, region: fragment.region ?? this.#regionAt(at) })
      if (clipboard === undefined)
        throw new TypeError(`[xh-print] 导入器 ${importer.id} 给出的元素没有通过校验`)
      this.#editor.paste(clipboard, { offset: 0 })
    }
    catch (error) {
      emitEvent(this, 'import-error', { importer: importer.id, source, error })
    }
  }

  /** 校验粘贴进来的载荷：元素放进一张临时页面按当前登记表校验，有 error 级问题时不粘贴。 */
  #readClipboard(payload: unknown): PrintClipboard | undefined {
    if (typeof payload !== 'object' || payload === null)
      return undefined
    const { elements, region } = payload as { elements?: unknown, region?: unknown }
    if (!Array.isArray(elements) || elements.length === 0 || (region !== 'body' && region !== 'header' && region !== 'footer'))
      return undefined
    const current = this.#editor.page
    const page = createPage({ id: '__clipboard', paper: current.paper, orientation: current.orientation, margins: current.margins })
    page.elements = elements as PrintElement[]
    const report = validateDocument(createDocument({ pages: [page] }), { extensions: this.#model().list })
    return report.valid ? { elements: elements as PrintElement[], region } : undefined
  }
}

/** 注册 <xh-print-designer>；重复调用不报错。 */
export function definePrintDesigner(): void {
  definePrintPreview()
  defineDesignerShellElement('xh-designer-frame', XhDesignerFrameElement)
  defineDesignerShellElement('xh-designer-transform', XhDesignerTransformElement)
  defineDesignerShellElement('xh-designer-ruler', XhDesignerRulerElement)
  defineDesignerShellElement('xh-designer-palette', XhDesignerPaletteElement)
  defineDesignerShellElement('xh-designer-issues', XhDesignerIssuesElement)
  defineDesignerShellElement('xh-designer-properties', XhDesignerPropertiesElement)
  defineDesignerShellElement('xh-designer-settings', XhDesignerSettingsElement)
  defineDesignerShellElement('xh-designer-field-import', XhDesignerFieldImportElement)
  defineDesignerShellElement('xh-designer-tour', XhDesignerTourElement)
  defineDesignerShellElement('xh-designer-json-editor', XhDesignerJsonEditorElement)
  defineDesignerShellElement('xh-designer-minimap', XhDesignerMinimapElement)
  defineXhElement('xh-toolbar', XhToolbarElement)
  defineXhElement('xh-toggle-group', XhToggleGroupElement)
  defineXhElement('xh-button', XhButtonElement)
  defineXhElement('xh-menu', XhMenuElement)
  defineXhElement('xh-text-field', XhTextFieldElement)
  defineXhElement('xh-field', XhFieldElement)
  defineXhElement('xh-context-menu', XhContextMenuElement)
  defineXhElement('xh-tabs', XhTabsElement)
  defineXhElement('xh-switch', XhSwitchElement)
  defineXhElement('xh-number-field', XhNumberFieldElement)
  defineXhElement('xh-select', XhSelectElement)
  defineXhElement('xh-color-field', XhColorFieldElement)
  defineXhElement('xh-format-input', XhFormatInputElement)
  defineXhElement('xh-field-array', XhFieldArrayElement)
  defineXhElement('xh-expression-input', XhExpressionInputElement)
  registerElement(PRINT_DESIGNER_TAG, XhPrintDesigner)
}

declare global {
  interface HTMLElementTagNameMap {
    'xh-print-designer': XhPrintDesigner
  }
}
