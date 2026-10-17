/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// <xh-print-designer>：打印模板设计器。画布按纸张显示一张页面模板（页眉、正文、页脚三区），元素用 runtime 的渲染代码画；
// 点选与 Shift / Ctrl 追加选择，拖动元素移动，控制柄缩放与旋转，拖空白框选，按住空格或中键拖动平移，Ctrl / ⌘ + 滚轮缩放；
// 画布外有毫米标尺，从标尺拖出的参考线存进页面模板；右侧属性面板编辑选中元素、表格部位或页面设置，
// 下方问题列表点选即定位；页眉页脚可切换变体、拖边界改高度；
// 双击表格进入表格编辑态；键盘撤销重做、删除、微移、层级与系统剪贴板；可切到 <xh-print-preview> 预览与打印。
// 整体版式用 @xihan-ui/designer-shell 的外框，panels 决定显示哪些区。

import type {
  DesignLayout,
  ElementCategory,
  ElementContainerRef,
  ElementRegion,
  LayoutBox,
  PageBandKey,
  PrintDocument,
  PrintElement,
  PrintElementType,
  PrintOperation,
  PropertyGroup,
  PropertyUnit,
  ReorderTarget,
  TableElement,
  TableLayoutBox,
  ValidationIssue,
} from '@xihan-print/core'
import type { PrintDesignerTranslations, PrintOutcome, PrintPreviewPrintOptions } from '@xihan-print/runtime'
import type { PrintClient } from '@xihan-print/runtime/client'
import type { JsonValue } from '@xihan-ui/core/json'
import type { AlignMode, DataField, DistributeAxis, ExecuteOptions, ExtensionHost, Point, Rect, Viewport } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type {
  DesignerFrameRegion,
  DesignerGuides,
  DesignerIssueItem,
  DesignerIssuesEventMap,
  DesignerPaletteDragPayload,
  DesignerPaletteEventMap,
  DesignerPaletteGroup,
  DesignerPropertiesEventMap,
  DesignerPropertyDescriptor,
  DesignerPropertyEditor,
  DesignerPropertyError,
  DesignerRulerEventMap,
  DesignerSnapOptions,
  DesignerTransformEventMap,
  DesignerTransformItem,
  DropOver,
  PanRequestDetail,
} from '@xihan-ui/designer-shell'
import type { ExpressionEngine, NumeralStyle, ValueFormatter } from '@xihan-ui/expression'
import type { PointerSession } from '@xihan-ui/pointer'
import type { CanvasMeasurer, TextMeasurer } from '@xihan-ui/viz'
import type { PropertyValues } from '@xihan-ui/web-components/authoring'
import type { PrintClipboard, PrintSelection, PrintTablePart } from './editor'
import type { PrintDesignerContext, PrintDesignerExtension, PrintDesignerModel } from './extensions'
import type { CompositeEditorHost } from './property-editors'
import type { ExpandedDescriptor } from './property-expand'
import type { PropertySubject } from './property-targets'
import type { TableCommand } from './table-edit'
import {
  createDocument,
  createPage,
  findElement,
  getBandRect,
  getBodyRect,
  getContentRect,
  getPaperSize,
  layoutDesign,
  PAGE_BAND_KEYS,
  PAGE_PROPERTY_GROUPS,
  planResizeTableColumn,
  PROPERTY_GROUPS,
  validateDocument,
} from '@xihan-print/core'
import { definePrintPreview, PRINT_PREVIEW_TAG, renderBox, renderWatermark } from '@xihan-print/runtime'
import { formatJsonPath } from '@xihan-ui/core/json'
import { fillTextTemplate } from '@xihan-ui/core/template'
import {
  centerOn,
  clipboardMimeType,
  createExtensionHost,
  decodeClipboard,
  encodeClipboard,
  fitRect,
  hitTest,
  nudgeDelta,
  panBy,
  revealRect,
  screenToWorld,
  selectInMarquee,
  snapToGrid,
  unionRects,
  wheelZoomFactor,
  zoomBy,
} from '@xihan-ui/designer-kit'
import { BUILTIN_CONTROL_KINDS, resolvePropertyEditor } from '@xihan-ui/designer-kit/properties'
import {
  defineDesignerShellElement,
  parseDesignerPanels,
  registerDropTarget,
  XhDesignerFrameElement,
  XhDesignerIssuesElement,
  XhDesignerPaletteElement,
  XhDesignerPropertiesElement,
  XhDesignerRulerElement,
  XhDesignerTransformElement,
} from '@xihan-ui/designer-shell'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { createPointerSession, resolveSessionDoc, shouldActivate, wheelPixels } from '@xihan-ui/pointer'
import { createCanvasMeasurer } from '@xihan-ui/viz'
import { createAuthoredElement, createGeneratedElement, emitEvent, registerElement, setText, XhConfigController, XhReactiveElement } from '@xihan-ui/web-components/authoring'
import { defineXhElement, XhButtonElement, XhColorFieldElement, XhContextMenuElement, XhExpressionInputElement, XhFieldArrayElement, XhFieldElement, XhFormatInputElement, XhMenuElement, XhNumberFieldElement, XhSelectElement, XhSwitchElement, XhTabsElement, XhTextFieldElement, XhToggleGroupElement, XhToolbarElement } from '@xihan-ui/web-components/define'
import { createPrintEditor, elementRect } from './editor'
import { createPrintDesignerModel, PRINT_DESIGNER_EXTENSION_ID } from './extensions'
import { defaultIssueText } from './issue-text'
import { borderSidesEditor, valueFormatEditor } from './property-editors'
import { propertySubjects, TABLE_PART_KINDS } from './property-targets'
import { PROPERTY_GROUP_NAMES, PROPERTY_NAMES, PROPERTY_OPTION_NAMES, UNIT_NAMES } from './property-text'
import { columnBoundaries, planTableCommand, TABLE_COMMANDS, tablePartAt } from './table-edit'

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
  /** 设计态下焦点在设计器里（输入框与面板之外）时按了 Ctrl / ⌘ + S；设计器不保存，宿主保存后调用 markSaved()。 */
  'save': CustomEvent<Record<string, never>>
  /** 双击元素；双击表格时同时进入表格编辑态。 */
  'element-dblclick': CustomEvent<{ id: string }>
  /** 在元素上打开右键菜单，未选中的元素先被选中；可取消，取消后不弹设计器自带的菜单。 */
  'element-contextmenu': CustomEvent<{ id: string, x: number, y: number }>
  /** 在画布空白处打开右键菜单；可取消，取消后不弹设计器自带的菜单。 */
  'blank-contextmenu': CustomEvent<{ x: number, y: number }>
  /** 当前页面模板变了。 */
  'page-change': CustomEvent<{ pageId: string }>
  /** 在设计态与预览态之间切换了。 */
  'mode-change': CustomEvent<{ mode: PrintDesignerMode }>
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

const DEFAULT_TRANSLATIONS: PrintDesignerTranslations = {
  label: 'Print designer',
  canvas: 'Canvas',
  toolbar: 'Designer actions',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  duplicate: 'Duplicate',
  delete: 'Delete',
  selectAll: 'Select all',
  alignLeft: 'Align left',
  alignCenter: 'Align centers horizontally',
  alignRight: 'Align right',
  alignTop: 'Align top',
  alignMiddle: 'Align centers vertically',
  alignBottom: 'Align bottom',
  distributeHorizontal: 'Distribute horizontally',
  distributeVertical: 'Distribute vertically',
  bringToFront: 'Bring to front',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
  sendToBack: 'Send to back',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomToFit: 'Zoom to fit',
  zoomToActual: 'Actual size',
  grid: 'Grid',
  snap: 'Snap',
  design: 'Design',
  preview: 'Preview',
  print: 'Print',
  pages: 'Page templates',
  addPage: 'Add page',
  removePage: 'Remove page',
  movePageLeft: 'Move page left',
  movePageRight: 'Move page right',
  pageTitle: position => `Page ${position}`,
  regions: { header: 'Header', body: 'Body', footer: 'Footer' },
  bandVariants: { default: 'Default', first: 'First page', last: 'Last page', odd: 'Odd pages', even: 'Even pages' },
  bandVariant: region => `${region === 'header' ? 'Header' : 'Footer'} variant`,
  addBandVariant: 'Add variant',
  removeBandVariant: 'Remove variant',
  resizeBand: region => `Resize ${region}`,
  categories: { text: 'Text', media: 'Media', data: 'Data', shape: 'Shapes', code: 'Codes' },
  elements: {
    text: 'Text',
    longText: 'Long text',
    richText: 'Rich text',
    table: 'Table',
    image: 'Image',
    line: 'Line',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    barCode: 'Barcode',
    matrixCode: '2D code',
    pageNumber: 'Page number',
  },
  elementLabel: (type, name) => `${type} ${name}`,
  tableParts: { column: 'Column', header: 'Header', body: 'Body', footerRow: 'Footer row', footerCell: 'Footer cell' },
  editTable: 'Edit table',
  exitTableEdit: 'Exit table editing',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  removeColumn: 'Remove column',
  moveColumnLeft: 'Move column left',
  moveColumnRight: 'Move column right',
  insertFooterRowAbove: 'Insert footer row above',
  insertFooterRowBelow: 'Insert footer row below',
  removeFooterRow: 'Remove footer row',
  mergeCellRight: 'Merge with right cell',
  splitCell: 'Split cell',
  resizeColumn: title => `Resize column ${title}`,
  newColumnTitle: position => `Column ${position}`,
  measure: (width, height) => `${width} × ${height} mm`,
  palette: 'Elements',
  properties: 'Properties',
  issues: 'Issues',
  issue: defaultIssueText,
  propertyGroups: PROPERTY_GROUP_NAMES,
  propertyNames: PROPERTY_NAMES,
  propertyPart: (parent, part) => `${parent} · ${part}`,
  propertyOptions: PROPERTY_OPTION_NAMES,
  units: UNIT_NAMES,
  pageSettings: 'Page settings',
  selectedCount: count => `${count} elements selected`,
  pageNumberInsert: 'Insert',
  pageNumberTokens: { page: 'Current page', pages: 'Total pages' },
  pageNumberSample: text => `Preview: ${text}`,
  valueFormatKind: 'Format type',
  valueFormatKinds: { none: 'No format', format: 'Common format', map: 'Value map', expression: 'Expression' },
  valueMapColumns: { value: 'Value', text: 'Display text' },
  valueMapCell: (index, column) => `${column} of entry ${index}`,
  valueMapAdd: 'Add entry',
  valueMapFallback: 'Text when nothing matches',
}

type StringKey = { [K in keyof PrintDesignerTranslations]: PrintDesignerTranslations[K] extends string ? K : never }[keyof PrintDesignerTranslations]

/** 工具栏与右键菜单共用的命令。 */
type Command
  = | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'duplicate' | 'delete' | 'select-all'
    | 'align-left' | 'align-center' | 'align-right' | 'align-top' | 'align-middle' | 'align-bottom'
    | 'distribute-horizontal' | 'distribute-vertical'
    | 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'
    | 'zoom-out' | 'zoom-in' | 'zoom-to-fit' | 'zoom-to-actual' | 'grid' | 'snap'
    | 'design' | 'preview' | 'print' | 'edit-table' | 'exit-table-edit'
    | 'add-page' | 'remove-page' | 'move-page-left' | 'move-page-right'
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

const LABELS: Readonly<Record<Command, StringKey>> = {
  'undo': 'undo',
  'redo': 'redo',
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
  'grid': 'grid',
  'snap': 'snap',
  'design': 'design',
  'preview': 'preview',
  'print': 'print',
  'edit-table': 'editTable',
  'exit-table-edit': 'exitTableEdit',
  'add-page': 'addPage',
  'remove-page': 'removePage',
  'move-page-left': 'movePageLeft',
  'move-page-right': 'movePageRight',
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

const TOOLBAR_GROUPS: readonly (readonly Command[])[] = [
  ['undo', 'redo'],
  ['cut', 'copy', 'paste', 'duplicate', 'delete'],
  ['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-horizontal', 'distribute-vertical'],
  ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'],
  ['zoom-out', 'zoom-in', 'zoom-to-fit', 'zoom-to-actual', 'grid', 'snap'],
  ['design', 'preview', 'print'],
]

const PAGE_COMMANDS: readonly Command[] = ['add-page', 'remove-page', 'move-page-left', 'move-page-right']

const NO_GUIDES: DesignerGuides = { x: [], y: [] }

/** 属性面板自带编辑器的编辑方式。 */
const BUILTIN_CONTROLS: ReadonlySet<string> = new Set(BUILTIN_CONTROL_KINDS)

/** 外框的命名区：上方是工具栏与页面模板页签，左侧物料，中间画布；label 是分隔条名称里的区名。 */
function frameRegions(t: PrintDesignerTranslations): DesignerFrameRegion[] {
  return [
    { name: 'toolbar', position: 'top' },
    { name: 'pages', position: 'top' },
    { name: 'palette', position: 'start', size: 16, label: t.palette },
    { name: 'canvas', position: 'center' },
    { name: 'properties', position: 'end', size: 22, label: t.properties },
    { name: 'issues', position: 'bottom', size: 22, label: t.issues },
  ]
}

function isPaletteDrag(payload: unknown): payload is DesignerPaletteDragPayload {
  return typeof payload === 'object' && payload !== null && (payload as { source?: unknown }).source === 'palette' && typeof (payload as { id?: unknown }).id === 'string'
}

interface Layers {
  readonly frame: XhDesignerFrameElement
  readonly palette: XhDesignerPaletteElement
  readonly issues: XhDesignerIssuesElement
  readonly properties: XhDesignerPropertiesElement
  readonly toolbar: HTMLElement
  readonly toolbarRoot: HTMLElement
  readonly items: Map<Command, HTMLButtonElement>
  readonly pages: HTMLElement
  readonly workspace: HTMLElement
  readonly menu: HTMLElement
  readonly ruler: XhDesignerRulerElement
  readonly menuContent: HTMLElement
  readonly viewport: HTMLElement
  readonly overlay: XhDesignerTransformElement
  readonly world: HTMLElement
  readonly paper: HTMLElement
  readonly frames: HTMLElement
  readonly elements: HTMLElement
  readonly watermark: HTMLElement
  readonly decorations: HTMLElement
  readonly bandMenus: HTMLElement
  readonly preview: HTMLElement
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

/** 元素类型的名字：内置类型取语言包，扩展的类型取扩展给的名称，都没有时用类型名。 */
function elementName(t: PrintDesignerTranslations, model: PrintDesignerModel, type: string): string {
  return Object.hasOwn(t.elements, type) ? t.elements[type as PrintElementType] : model.palette.get(type)?.label ?? type
}

/** 物料分组的名字：内置分组取语言包，扩展的分组取扩展给的名称，都没有时用分组名。 */
function categoryName(t: PrintDesignerTranslations, model: PrintDesignerModel, category: string): string {
  return Object.hasOwn(t.categories, category) ? t.categories[category as ElementCategory] : model.categories.get(category) ?? category
}

function isCommand(value: string): value is Command {
  return Object.hasOwn(LABELS, value)
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
    expressionEngine: { attribute: false },
    formatter: { attribute: false },
    measurer: { attribute: false },
    locale: { type: String },
    timeZone: { type: String, attribute: 'time-zone' },
    translations: { attribute: false },
    readonly: { type: Boolean },
    mode: { type: String },
    grid: { attribute: false },
    snap: { attribute: false },
    panels: { converter: { fromAttribute: (value: string | null) => value ?? undefined } },
    printClient: { attribute: false },
  }

  /** 预览分页用的数据。 */
  declare data: unknown
  /** 示例数据：给出时画布按它显示实际值，不给时字段显示 {path} 占位。 */
  declare sampleData: unknown
  /** 可绑定的字段树，供属性面板的字段选择器。 */
  declare fields: readonly DataField[] | undefined
  /** 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 */
  declare expressionEngine: ExpressionEngine | undefined
  /** 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 */
  declare formatter: ValueFormatter | undefined
  /** 文字度量器；缺省用所在文档的 Canvas 度量器。 */
  declare measurer: TextMeasurer | undefined
  /** 本地打印客户端：给了时打印先交给它静默打印，连不上客户端才退回浏览器打印。 */
  declare printClient: PrintClient | undefined
  /** 交给格式化器的区域，只决定小数点与千分位符号；同名 attribute。 */
  declare locale: string | undefined
  /** 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称；attribute 为 time-zone。 */
  declare timeZone: string | undefined
  /** 元素自己的文案，压在全局配置之上。 */
  declare translations: Partial<PrintDesignerTranslations> | undefined
  /** 只读：可以选择、浏览与预览，不能修改。 */
  declare readonly: boolean
  /** 设计态或预览态，缺省 design；同名 attribute。 */
  declare mode: PrintDesignerMode
  /** 吸附网格边长，mm，缺省 1；false 不吸附网格。 */
  declare grid: number | false
  /** 吸附其它元素、页边距、区边界与参考线并显示对齐线，缺省 true。 */
  declare snap: boolean
  /** 要显示的面板，空格分隔：toolbar palette pages rulers properties issues；不写即全部显示。同名 attribute。 */
  declare panels: string | undefined
  readonly #config = new XhConfigController(this)
  readonly #editor = createPrintEditor({ document: createDocument() })
  #extensions: readonly PrintDesignerExtension[] | undefined
  #builtin: PrintDesignerExtension | undefined
  #designerModel: PrintDesignerModel | undefined
  readonly #host: ExtensionHost<PrintDesignerExtension> = createExtensionHost<PrintDesignerExtension, PrintDesignerContext>({
    context: () => ({ designer: this, translations: this.#translations() }),
  })

  #layers: Layers | undefined
  /** 内部视口：世界坐标为纸张坐标（mm），zoom 为每毫米的屏幕像素。 */
  #viewport: Viewport = { x: 0, y: 0, zoom: PX_PER_MM }
  #autoFit = true
  #fitPending = true
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
  #lastGrid = 1
  #spacePan = false
  #regions: { readonly key: string, readonly regions: readonly DesignerFrameRegion[] } | undefined
  #palette: { readonly key: string, readonly model: PrintDesignerModel } | undefined
  #listed: { readonly issues: readonly ValidationIssue[], readonly key: string } | undefined
  #subjects: PropertySubject[] = []
  #panelInputs: readonly unknown[] = []
  #unregisterDrop: (() => void) | undefined
  #hoverId: string | undefined

  constructor() {
    super()
    this.readonly = false
    this.mode = 'design'
    this.grid = 1
    this.snap = true
    this.#editor.subscribe((change) => {
      if (change.kind === 'selection') {
        if (this.#tableEdit !== undefined && !(change.selection.elements.length === 1 && change.selection.elements[0] === this.#tableEdit))
          this.#tableEdit = undefined
        this.requestUpdate()
        emitEvent(this, 'selection-change', change.selection)
        return
      }
      if (change.kind === 'page') {
        this.#tableEdit = undefined
        this.#layoutStale = true
        this.#startAutoFit()
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
        return
      }
      this.#layoutStale = true
      this.requestUpdate()
      this.#onDocumentChange(change.cause, change.operations)
    })
  }

  /** 打印模板。赋值即装载：清空历史与选择，重新自动适配（赋回当前这一份不重新装载）；读取时得到当前模板。 */
  get schema(): PrintDocument {
    return this.#editor.document
  }

  set schema(value: PrintDocument) {
    if (value === this.#editor.document)
      return
    this.#tableEdit = undefined
    this.#editor.load(value)
    this.#startAutoFit()
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
    this.#host.assign(this.#extensions ?? NO_EXTENSIONS)
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#resizeObserver?.disconnect()
    this.#cancelGesture()
    this.#layers?.overlay.cancel()
    this.#unregisterDrop?.()
    this.#unregisterDrop = undefined
    this.#host.dispose()
  }

  /**
   * 扩展：元素种类、编辑方式、规则与属性编辑器都从这里来，设计器自带的扩展与内置元素自动排在最前。
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
    if (this.isConnected)
      this.#host.assign(value ?? NO_EXTENSIONS)
    const old = this.#extensions
    this.#extensions = value
    this.#designerModel = model
    this.#editor.setExtensions(model.list)
    this.requestUpdate('extensions', old)
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed)
    const layers = this.#ensureLayers()
    const t = this.#translations()
    this.#editor.setExtensions(this.#model().list)
    if (['sampleData', 'extensions', 'expressionEngine', 'formatter', 'measurer', 'locale', 'timeZone'].some(name => changed.has(name)))
      this.#layoutStale = true
    if (changed.has('extensions') || changed.has('expressionEngine'))
      this.#scheduleIssues()
    this.toggleAttribute('data-readonly', this.readonly)
    this.dataset.mode = this.mode
    if (this.mode !== this.#lastMode) {
      this.#lastMode = this.mode
      emitEvent(this, 'mode-change', { mode: this.mode })
    }
    layers.frame.panels = this.#framePanels()
    this.#syncFrameRegions(layers, t)
    this.#syncPalette(layers, t)
    this.#syncIssues(layers, t)
    this.#syncProperties(layers, t)
    this.#renderToolbar(layers, t)
    this.#renderPages(layers, t)
    layers.viewport.setAttribute('aria-label', t.canvas)
    const preview = this.mode === 'preview'
    this.#placeCanvas(layers, preview)
    layers.preview.hidden = !preview
    if (preview) {
      this.#syncPreview(this.#ensurePreview())
      return
    }
    if (this.#layoutStale) {
      this.#layout = this.#computeLayout()
      this.#layoutStale = false
    }
    this.#renderPaper(layers, t)
    this.#syncOverlay(layers)
    this.#syncRuler(layers)
    if (!this.#fitIfPending())
      this.#applyViewport(false)
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
    return !this.readonly && this.#editor.deleteSelection()
  }

  /** 复制选中的元素；没有选中时返回 undefined。 */
  copy(): PrintClipboard | undefined {
    return this.#editor.copy()
  }

  /** 复制并删除选中的元素；只读或没有选中时返回 undefined。 */
  cut(): PrintClipboard | undefined {
    return this.readonly ? undefined : this.#editor.cut()
  }

  /** 粘贴到当前页面模板并选中粘贴出的元素；缺省用最近一次复制的内容，连续粘贴依次错开。只读时不粘贴。 */
  paste(clipboard?: PrintClipboard): PrintSelection {
    return this.readonly ? this.#editor.selection : this.#editor.paste(clipboard)
  }

  /** 复制选中的元素并立即粘贴，不改动剪贴板；只读时什么都不做。 */
  duplicate(): PrintSelection {
    return this.readonly ? this.#editor.selection : this.#editor.duplicate()
  }

  /** 对齐选中的元素；少于两个或只读时什么都不做。 */
  align(mode: AlignMode): void {
    if (!this.readonly)
      this.#editor.align(mode)
  }

  /** 等距分布选中的元素；少于三个或只读时什么都不做。 */
  distribute(axis: DistributeAxis): void {
    if (!this.readonly)
      this.#editor.distribute(axis)
  }

  /** 调整选中元素的层级。 */
  reorder(target: ReorderTarget): void {
    if (!this.readonly)
      this.#editor.reorder(target)
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

  /** 让整张纸落在视口中央，不放大到实际尺寸以上；此后尺寸变化时重新适配，直到设置视口或在画布上操作。 */
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
    return preview.print(options)
  }

  // —— 内部：模型与布局 ——

  /** 当前扩展合出的设计器模型。 */
  #model(): PrintDesignerModel {
    this.#designerModel ??= createPrintDesignerModel(this.#builtinExtension(), this.#extensions ?? NO_EXTENSIONS)
    return this.#designerModel
  }

  /** 设计器自带的扩展：表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 */
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

  #syncFrameRegions(layers: Layers, t: PrintDesignerTranslations): void {
    const regions = frameRegions(t)
    const key = JSON.stringify(regions)
    if (this.#regions?.key === key)
      return
    this.#regions = { key, regions }
    layers.frame.regions = regions
  }

  /** 交给外框的 panels：预览态只留工具栏。 */
  #framePanels(): string | undefined {
    if (this.mode !== 'preview')
      return this.panels
    const shown = parseDesignerPanels(this.panels)
    return shown === undefined || shown.has('toolbar') ? 'toolbar' : ''
  }

  #translations(): PrintDesignerTranslations {
    return this.#config.translations<PrintDesignerTranslations>(PRINT_DESIGNER_TAG, DEFAULT_TRANSLATIONS, this.translations)
  }

  #snapValue(value: number): number {
    return this.grid === false || !(this.grid > 0) ? value : snapToGrid(value, this.grid)
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
  }

  #stopAutoFit(): void {
    this.#autoFit = false
    this.#fitPending = false
  }

  #onResize(): void {
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
    this.#moveTo(fitRect({ x: 0, y: 0, width: paper.width, height: paper.height }, size, { padding: FIT_PADDING, maxZoom: PX_PER_MM, limits: ZOOM_LIMITS }))
    return true
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
      this.style.setProperty('--xh-print-designer-zoom', String(scale))
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
    const items = new Map<Command, HTMLButtonElement>()
    const groups: HTMLElement[] = []
    TOOLBAR_GROUPS.forEach((group, index) => {
      if (index > 0)
        groups.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'separator' }))
      groups.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'group' }, group.map((command) => {
        const item = createAuthoredElement(doc, 'button', { 'data-xh-part': 'item', 'type': 'button', 'value': command })
        items.set(command, item)
        return item
      })))
    })
    groups.push(createAuthoredElement(doc, 'button', { 'data-xh-part': 'overflow-trigger', 'type': 'button' }))
    const toolbarRoot = createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, groups)
    const toolbar = createAuthoredElement(doc, 'div', { 'slot': 'toolbar', 'data-part': 'toolbar' }, [createAuthoredElement(doc, 'xh-toolbar', { size: 'sm' }, [toolbarRoot])])
    toolbarRoot.addEventListener('click', this.#onCommandClick)

    const pages = createAuthoredElement(doc, 'div', { 'slot': 'pages', 'data-part': 'pages' })

    const paper = createAuthoredElement(doc, 'div', { 'data-part': 'paper' })
    const frames = createAuthoredElement(doc, 'div', { 'data-part': 'frames' })
    const elements = createAuthoredElement(doc, 'div', { 'data-part': 'elements' })
    const watermark = createAuthoredElement(doc, 'div', { 'data-part': 'watermark-layer' })
    const decorations = createAuthoredElement(doc, 'div', { 'data-part': 'decorations' })
    const bandMenus = createAuthoredElement(doc, 'div', { 'data-part': 'band-menus' })
    paper.append(frames, elements, watermark, decorations, bandMenus)
    const world = createAuthoredElement(doc, 'div', { 'data-part': 'world' }, [paper])
    const overlay = createAuthoredElement(doc, 'xh-designer-transform', { 'data-part': 'overlay' }) as XhDesignerTransformElement
    overlay.viewport = this.#viewport
    overlay.getSnap = () => this.#snapOptions()
    overlay.formatMeasure = rect => this.#translations().measure(this.#formatMm(rect.width), this.#formatMm(rect.height))
    overlay.addEventListener('transform', this.#onTransform)
    overlay.addEventListener('marquee', this.#onMarquee)
    const viewport = createAuthoredElement(doc, 'div', { 'data-part': 'viewport', 'tabindex': 0, 'role': 'region' }, [world, overlay])
    viewport.addEventListener('pan-request', this.#onPanRequest)
    const menuContent = createAuthoredElement(doc, 'div', { 'data-xh-part': 'content' })
    const trigger = createAuthoredElement(doc, 'div', { 'data-xh-part': 'trigger', 'data-print-canvas': '' }, [viewport])
    const menu = createAuthoredElement(doc, 'xh-context-menu', { 'size': 'sm', 'data-print-canvas-menu': '' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'root', 'data-print-canvas-root': '' }, [trigger, createAuthoredElement(doc, 'div', { 'data-xh-part': 'positioner' }, [menuContent])]),
    ])
    menu.addEventListener('select', this.#onMenuSelect)
    this.#fillMenu(menuContent, 'blank')
    const palette = createAuthoredElement(doc, 'xh-designer-palette', { 'slot': 'palette', 'data-part': 'palette', 'collapsible': true }) as XhDesignerPaletteElement
    palette.addEventListener('item-activate', this.#onPaletteActivate)
    const issues = createAuthoredElement(doc, 'xh-designer-issues', { 'slot': 'issues', 'data-part': 'issues' }) as XhDesignerIssuesElement
    issues.addEventListener('issue-activate', this.#onIssueActivate)
    issues.addEventListener('issue-hover', this.#onIssueHover)
    const properties = createAuthoredElement(doc, 'xh-designer-properties', { 'slot': 'properties', 'data-part': 'properties', 'collapsible': true, 'toggle-limit': 4 }) as XhDesignerPropertiesElement
    properties.addEventListener('property-change', this.#onPropertyChange)
    properties.addEventListener('property-commit', this.#onPropertyCommit)
    const preview = createAuthoredElement(doc, 'div', { 'data-part': 'preview', 'hidden': true })
    const ruler = createAuthoredElement(doc, 'xh-designer-ruler', { 'unit-size': 1 }) as XhDesignerRulerElement
    ruler.viewport = this.#viewport
    ruler.snap = (_axis, value) => this.#snapValue(value)
    ruler.addEventListener('guides-change', this.#onGuidesChange)
    const workspace = createAuthoredElement(doc, 'div', { 'data-part': 'workspace' }, [ruler, menu, preview])
    const frame = createGeneratedElement(doc, 'xh-designer-frame', { 'data-part': 'frame' }, [toolbar, pages, palette, workspace, properties, issues]) as XhDesignerFrameElement
    this.append(frame)

    viewport.addEventListener('pointerdown', this.#onPointerDown)
    viewport.addEventListener('dblclick', this.#onDoubleClick)
    viewport.addEventListener('contextmenu', this.#onContextMenu)
    viewport.addEventListener('wheel', this.#onWheel, { passive: false })
    viewport.addEventListener('pointermove', this.#onHover)
    viewport.addEventListener('pointerleave', this.#onHoverEnd)
    this.addEventListener('keydown', this.#onKeyDown)
    this.addEventListener('keyup', this.#onKeyUp)
    this.addEventListener('focusout', this.#onFocusOut)
    this.addEventListener('copy', this.#onCopy)
    this.addEventListener('cut', this.#onCut)
    this.addEventListener('paste', this.#onPaste)
    this.#layers = { frame, palette, issues, properties, toolbar, toolbarRoot, items, pages, workspace, menu, ruler, menuContent, viewport, overlay, world, paper, frames, elements, watermark, decorations, bandMenus, preview }
    return this.#layers
  }

  #commandEnabled(command: Command): boolean {
    const editable = !this.readonly && this.mode === 'design'
    const selected = this.#editor.selection.elements.length
    switch (command) {
      case 'undo':
        return editable && this.#editor.history.canUndo
      case 'redo':
        return editable && this.#editor.history.canRedo
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
      case 'add-page':
        return editable
      case 'remove-page':
        return editable && this.#editor.document.pages.length > 1
      case 'move-page-left':
        return editable && this.#editor.document.pages.findIndex(page => page.id === this.#editor.activePageId) > 0
      case 'move-page-right': {
        const pages = this.#editor.document.pages
        return editable && pages.findIndex(page => page.id === this.#editor.activePageId) < pages.length - 1
      }
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
      case 'undo':
        this.undo()
        return
      case 'redo':
        this.redo()
        return
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
        if (this.grid !== false)
          this.#lastGrid = this.grid
        this.grid = this.grid === false ? this.#lastGrid : false
        return
      case 'snap':
        this.snap = !this.snap
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
      case 'add-page':
        this.#editor.addPage(pageIndex + 1)
        return
      case 'remove-page':
        this.#editor.removePage(this.#editor.activePageId)
        return
      case 'move-page-left':
        this.#editor.movePage(this.#editor.activePageId, pageIndex - 1)
        return
      case 'move-page-right':
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

  #renderToolbar(layers: Layers, t: PrintDesignerTranslations): void {
    layers.toolbarRoot.setAttribute('aria-label', t.toolbar)
    for (const [command, item] of layers.items) {
      setText(item, t[LABELS[command]])
      const disabled = !this.#commandEnabled(command)
      if (item.disabled !== disabled)
        item.disabled = disabled
      const pressed = command === 'grid' ? this.grid !== false : command === 'snap' ? this.snap : command === 'design' || command === 'preview' ? this.mode === command : undefined
      if (pressed === undefined)
        item.removeAttribute('aria-pressed')
      else
        item.setAttribute('aria-pressed', String(pressed))
    }
  }

  #renderPages(layers: Layers, t: PrintDesignerTranslations): void {
    const doc = this.ownerDocument
    const pages = this.#editor.document.pages
    const active = this.#editor.activePageId
    const titles = pages.map((page, index) => page.name ?? t.pageTitle(index + 1))
    const signature = JSON.stringify([pages.map(page => page.id), titles, active, this.readonly, this.mode, t.pages, PAGE_COMMANDS.map(command => [t[LABELS[command]], this.#commandEnabled(command)])])
    if (layers.pages.dataset.signature === signature)
      return
    layers.pages.dataset.signature = signature
    const tabs = createAuthoredElement(doc, 'xh-toggle-group', { 'value': active, 'disallow-empty': true, 'size': 'sm' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'root', 'aria-label': t.pages }, pages.map((page, index) =>
        createAuthoredElement(doc, 'button', { 'data-xh-part': 'item', 'type': 'button', 'value': page.id }, [titles[index]!]),
      )),
    ])
    tabs.addEventListener('value-change', (event) => {
      const { value } = (event as CustomEvent<{ value: string | string[] | null }>).detail
      if (typeof value === 'string' && value !== this.#editor.activePageId)
        this.#editor.setActivePage(value)
    })
    const actions = createAuthoredElement(doc, 'xh-toolbar', { size: 'sm' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'root', 'aria-label': t.pages }, [
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'group' }, PAGE_COMMANDS.map(command =>
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'item', 'type': 'button', 'value': command, 'disabled': !this.#commandEnabled(command) }, [t[LABELS[command]]]),
        )),
      ]),
    ])
    actions.addEventListener('click', this.#onCommandClick)
    layers.pages.replaceChildren(tabs, actions)
  }

  #renderPaper(layers: Layers, t: PrintDesignerTranslations): void {
    const doc = this.ownerDocument
    const page = this.#editor.page
    const bands = this.#editor.bands
    const paper = getPaperSize(page)
    layers.paper.style.width = `${paper.width}mm`
    layers.paper.style.height = `${paper.height}mm`
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
      frame('margins', content),
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
    if (!this.readonly) {
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
    const signature = JSON.stringify([page.id, bands, PAGE_BAND_KEYS.map(key => [page.header[key] !== undefined, page.footer[key] !== undefined]), headerRect, footerRect, this.readonly, t.regions, t.bandVariants])
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
        return createAuthoredElement(doc, 'div', { 'data-xh-part': 'item', value, 'aria-disabled': !exists && this.readonly ? 'true' : undefined, 'aria-current': key === current ? 'true' : undefined }, [
          createAuthoredElement(doc, 'span', { 'data-xh-part': 'item-text' }, [text]),
        ])
      })
      if (current !== 'default' && !this.readonly) {
        items.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'separator' }))
        items.push(createAuthoredElement(doc, 'div', { 'data-xh-part': 'item', 'value': 'remove' }, [createAuthoredElement(doc, 'span', { 'data-xh-part': 'item-text' }, [t.removeBandVariant])]))
      }
      const rect = region === 'header' ? headerRect : footerRect
      const menu = createAuthoredElement(doc, 'xh-menu', { 'size': 'sm', 'data-part': 'band-menu', 'data-region': region }, [
        createAuthoredElement(doc, 'xh-button', { 'data-xh-part': 'trigger', 'variant': 'subtle', 'size': 'sm' }, [
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button', 'aria-label': t.bandVariant(region) }, [`${t.regions[region]} · ${t.bandVariants[current]}`]),
        ]),
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'positioner' }, [createAuthoredElement(doc, 'div', { 'data-xh-part': 'content' }, items)]),
      ])
      menu.style.top = `${rect.y}mm`
      menu.addEventListener('select', (event) => {
        const { value } = (event as CustomEvent<{ value: string }>).detail
        const [action, key] = value.split(':') as [string, PageBandKey | undefined]
        if (action === 'show' && key !== undefined)
          this.#editor.setBandVariant(region, key)
        else if (action === 'add' && key !== undefined && key !== 'default' && !this.readonly)
          this.#editor.addBand(region, key)
        else if (action === 'remove' && current !== 'default' && !this.readonly)
          this.#editor.removeBand(region, current)
      })
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
    if (!this.readonly) {
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
    preview.printClient = this.printClient
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

  #syncPalette(layers: Layers, t: PrintDesignerTranslations): void {
    layers.palette.readonly = this.readonly
    const model = this.#model()
    const groups = model.runtime.elements.groupByCategory()
    const key = JSON.stringify([t.categories, t.elements])
    if (key === this.#palette?.key && model === this.#palette.model)
      return
    this.#palette = { key, model }
    layers.palette.groups = groups.map((group): DesignerPaletteGroup => ({
      id: group.category,
      label: categoryName(t, model, group.category),
      items: group.prototypes.map((prototype) => {
        const icon = model.palette.get(prototype.type)?.icon
        return { id: prototype.type, label: elementName(t, model, prototype.type), ...(icon === undefined ? {} : { icon }) }
      }),
    }))
  }

  readonly #onPaletteActivate = (event: Event): void => {
    const { id } = (event as DesignerPaletteEventMap['item-activate']).detail
    if (!this.readonly && this.mode === 'design' && this.#editor.elements.has(id))
      this.addElement(id)
  }

  /** 物料拖到画布上：按落点画出新元素的外框，藏起跟手预览。 */
  #dropOver(point: Point, payload: unknown): DropOver {
    const placed = !this.readonly && this.mode === 'design' && isPaletteDrag(payload)
      ? this.#placement(payload.id, this.clientToWorld(point.x, point.y))
      : undefined
    this.#setOverlayHover(placed)
    return placed === undefined ? { accept: false } : { accept: true, ghost: 'hide' }
  }

  #drop(point: Point, payload: unknown): void {
    this.#setOverlayHover(undefined)
    if (!isPaletteDrag(payload) || this.readonly || this.mode !== 'design' || !this.#editor.elements.has(payload.id))
      return
    this.#stopAutoFit()
    this.addElement(payload.id, this.clientToWorld(point.x, point.y))
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
    panel.readonly = this.readonly
    const inputs = [kind, editors, this.fields, t.propertyGroups, t.propertyNames, t.propertyPart, t.propertyOptions, t.units]
    if (inputs.length === this.#panelInputs.length && inputs.every((input, index) => input === this.#panelInputs[index]))
      return
    this.#panelInputs = inputs
    panel.editors = editors
    panel.dataFields = this.fields
    panel.groupOrder = kind === 'page' ? PAGE_PROPERTY_GROUPS : PROPERTY_GROUPS
    panel.groupLabel = group => t.propertyGroups[group as PropertyGroup] ?? group
    panel.labelOf = (descriptor) => {
      const name = (key: string): string | undefined => t.propertyNames[`${kind}:${key}`] ?? t.propertyNames[key]
      const key = formatJsonPath(descriptor.path)
      const { labelKey, labelParent } = descriptor as ExpandedDescriptor
      const own = name(key)
      if (own !== undefined || labelKey === undefined)
        return own ?? descriptor.label ?? key
      const part = name(labelKey) ?? labelKey
      return labelParent === undefined ? part : t.propertyPart(name(labelParent) ?? labelParent, part)
    }
    panel.optionLabel = (descriptor, option) => {
      const value = String(option.value)
      return option.label ?? t.propertyOptions[`${formatJsonPath(descriptor.path)}=${value}`] ?? t.propertyOptions[value] ?? value
    }
    panel.unitLabel = unit => t.units[unit as PropertyUnit] ?? unit
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
    if (this.readonly)
      return
    const subjects = new Map(this.#subjects.map(subject => [subject.id, subject]))
    const operations = targets.flatMap((target) => {
      const subject = subjects.get(target.id)
      return subject === undefined ? [] : [subject.write(path, value)]
    })
    if (operations.length > 0)
      this.#editor.execute(operations, { merge, mergeWithin: Number.POSITIVE_INFINITY })
  }

  /** 交给面板的编辑器：各扩展的编辑器按顺序合成一张，设计器自带的在最底下。 */
  #propertyEditors(): PropertyEditorTable<DesignerPropertyEditor> {
    return this.#model().editors
  }

  /** 表格的列或表尾行列成条目，点一下进入表格编辑态并选中该部位。 */
  #partList(kind: 'column' | 'footerRow'): DesignerPropertyEditor {
    return (initial) => {
      const doc = this.ownerDocument
      const list = createAuthoredElement(doc, 'div', { 'data-part': 'part-list', 'role': 'group' })
      const render = (context: typeof initial): void => {
        const tableId = context.target.length === 1 ? context.target[0]!.id : undefined
        const items = Array.isArray(context.value) ? context.value as readonly { id?: unknown, title?: unknown }[] : []
        const t = this.#translations()
        list.replaceChildren(...items.map((item, index) => {
          const id = String(item.id)
          const title = typeof item.title === 'string' && item.title !== '' ? item.title : undefined
          const text = kind === 'column' ? title ?? t.newColumnTitle(index + 1) : `${t.tableParts.footerRow} ${index + 1}`
          const button = createAuthoredElement(doc, 'xh-button', { 'variant': 'ghost', 'size': 'sm', 'full-width': true, 'data-part': 'part-item' }, [
            createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button', 'disabled': tableId === undefined }, [text]),
          ])
          button.addEventListener('click', () => {
            if (tableId !== undefined)
              this.#selectTablePart(tableId, kind === 'column' ? { kind, elementId: tableId, columnId: id } : { kind, elementId: tableId, rowId: id })
          })
          return button
        }))
      }
      render(initial)
      return { element: list, update: render }
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
      menu.addEventListener('select', (event) => {
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
    layers.issues.readonly = this.readonly
    const document = this.#editor.document
    const key = JSON.stringify([document.pages.map(page => [page.id, page.name]), t.pageTitle(1), t.elements])
    if (this.#listed?.issues === this.#issues && this.#listed.key === key && layers.issues.items !== undefined)
      return
    this.#listed = { issues: this.#issues, key }
    layers.issues.items = this.#issues.map((issue): DesignerIssueItem => {
      const subject = this.#issueSubject(issue, t)
      return { issue, message: t.issue(issue), ...(subject === undefined ? {} : { subject }) }
    })
  }

  /** 问题所在对象的名字：页面名，或「页面 · 元素」。 */
  #issueSubject(issue: ValidationIssue, t: PrintDesignerTranslations): string | undefined {
    const target = issue.target
    if (target === undefined)
      return undefined
    const pages = this.#editor.document.pages
    const pageName = (index: number): string => pages[index]?.name ?? t.pageTitle(index + 1)
    if (target.kind === 'page') {
      const index = pages.findIndex(page => page.id === target.id)
      return index < 0 ? target.id : pageName(index)
    }
    const found = target.kind === 'element' ? findElement(this.#editor.document, target.id) : undefined
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
    return target?.closest('xh-designer-palette, xh-designer-properties, xh-designer-issues') != null
  }

  // —— 内部：标尺与参考线 ——

  /** 标尺显示时画布放进标尺框，不显示时直接放在工作区；预览态两者都收起。 */
  #placeCanvas(layers: Layers, preview: boolean): void {
    const shown = parseDesignerPanels(this.panels)
    const rulers = !preview && (shown === undefined || shown.has('rulers'))
    if (rulers && !layers.ruler.contains(layers.menu))
      layers.ruler.append(layers.menu)
    else if (!rulers && layers.ruler.contains(layers.menu))
      layers.workspace.insertBefore(layers.menu, layers.preview)
    layers.ruler.hidden = !rulers
    layers.menu.hidden = preview
  }

  /** 标尺上的参考线取当前页面模板，选中元素的范围画成淡底。 */
  #syncRuler(layers: Layers): void {
    const selected = new Set(this.#editor.selection.elements)
    layers.ruler.readonly = this.readonly
    layers.ruler.guides = this.#editor.page.guides ?? NO_GUIDES
    layers.ruler.highlight = unionRects(this.#editor.visibleElements().filter(item => selected.has(item.element.id)).map(item => elementRect(item.element)))
  }

  /** 参考线写回页面模板；全部删掉时去掉 guides。 */
  readonly #onGuidesChange = (event: Event): void => {
    if (this.readonly)
      return
    const { guides } = (event as DesignerRulerEventMap['guides-change']).detail
    const value = guides.x.length === 0 && guides.y.length === 0 ? undefined : { x: [...guides.x], y: [...guides.y] }
    this.#editor.execute([{ type: 'updatePage', pageId: this.#editor.activePageId, changes: [{ path: ['guides'], value }] }])
  }

  // —— 内部：变换覆盖层 ——

  #formatMm(value: number): string {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(value)
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
    layers.overlay.readonly = this.readonly
    layers.overlay.items = this.#overlayItems()
  }

  /** 吸附选项：其它元素、页边距、各区边界与参考线；关掉吸附时只吸网格。 */
  #snapOptions(): DesignerSnapOptions | undefined {
    const grid = this.grid === false || !(this.grid > 0) ? undefined : this.grid
    if (!this.snap)
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
    if (this.readonly || this.#editor.visibleElements().some(item => selected.has(item.element.id) && item.element.locked === true))
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
      history.begin()
      return
    }
    if (!history.inTransaction)
      return
    history.rollback()
    if (phase === 'cancel')
      return
    history.begin()
    if (phase === 'end' && copy === true && kind === 'move') {
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

  #pan(event: PointerEvent): void {
    const origin = this.#viewport
    this.#stopAutoFit()
    this.#track(event, {
      onMove: (dx, dy) => this.#moveTo(panBy(origin, dx, dy)),
      onEnd: () => undefined,
      onCancel: () => this.#moveTo(origin),
    })
  }

  #dragBand(event: PointerEvent, region: 'header' | 'footer'): void {
    const page = this.#editor.page
    const key = this.#editor.bands[region]
    const startHeight = (page[region][key] ?? page[region].default).height
    const zoom = this.#viewport.zoom
    this.#track(event, {
      onActivate: () => this.#editor.history.begin(),
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
    this.#track(event, {
      onActivate: () => this.#editor.history.begin(),
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
    if (bandHandle && !this.readonly) {
      this.#stopAutoFit()
      this.#dragBand(event, bandHandle.dataset.region as 'header' | 'footer')
      return
    }
    const columnHandle = target?.closest<HTMLElement>('[data-part="column-handle"]')
    if (columnHandle && !this.readonly) {
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
    if (this.mode !== 'design')
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
    if (hit.type === 'table' && !this.readonly)
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

  #prepareMenu(subject: 'blank' | 'element' | 'table'): void {
    this.#fillMenu(this.#ensureLayers().menuContent, subject)
  }

  #fillMenu(content: HTMLElement, subject: 'blank' | 'element' | 'table'): void {
    const t = this.#translations()
    const doc = this.ownerDocument
    const separator = '|'
    const tableEntries: (Command | typeof separator)[] = this.#selectedTable() ? ['edit-table', separator] : []
    const entries: (Command | typeof separator)[] = subject === 'table'
      ? [...TABLE_COMMANDS.slice(0, 5), separator, ...TABLE_COMMANDS.slice(5), separator, 'exit-table-edit']
      : subject === 'element'
        ? [...tableEntries, 'cut', 'copy', 'duplicate', 'delete', separator, 'bring-to-front', 'bring-forward', 'send-backward', 'send-to-back']
        : ['paste', 'select-all', separator, 'zoom-to-fit']
    content.replaceChildren(...entries.map(entry => entry === separator
      ? createAuthoredElement(doc, 'div', { 'data-xh-part': 'separator' })
      : createAuthoredElement(doc, 'div', { 'data-xh-part': 'item', 'value': entry, 'aria-disabled': this.#commandEnabled(entry) ? undefined : 'true' }, [
          createAuthoredElement(doc, 'span', { 'data-xh-part': 'item-text' }, [t[LABELS[entry]]]),
        ])))
  }

  readonly #onMenuSelect = (event: Event): void => {
    const { value } = (event as CustomEvent<{ value: string }>).detail
    if (isCommand(value))
      this.#run(value)
  }

  readonly #onCommandClick = (event: MouseEvent): void => {
    const item = (event.target as Element | null)?.closest<HTMLButtonElement>('button[value]')
    if (!item || item.disabled || !isCommand(item.value))
      return
    this.#run(item.value)
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
    const command = event.ctrlKey || event.metaKey
    if (command && !event.altKey ? this.#onCommandKey(event) : !command && !event.altKey && this.#onPlainKey(event))
      event.preventDefault()
  }

  #onCommandKey(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase()
    const shortcuts: Readonly<Record<string, Command>> = {
      'a': 'select-all',
      'd': 'duplicate',
      'y': 'redo',
      ']': event.shiftKey ? 'bring-to-front' : 'bring-forward',
      '[': event.shiftKey ? 'send-to-back' : 'send-backward',
    }
    if (key === 's') {
      emitEvent(this, 'save', {})
      return true
    }
    if (key === 'z') {
      this.#run(event.shiftKey ? 'redo' : 'undo')
      return true
    }
    const shortcut = shortcuts[key]
    if (shortcut === undefined)
      return false
    this.#run(shortcut)
    return true
  }

  #onPlainKey(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        return this.deleteSelection()
      case '+':
      case '=':
        this.zoomIn()
        return true
      case '-':
        this.zoomOut()
        return true
      case '0':
        this.zoomToFit()
        return true
      case ' ':
        if (event.target !== this.#layers?.viewport)
          return false
        if (!event.repeat)
          this.#setSpacePan(true)
        return true
      case 'Enter': {
        const table = this.#selectedTable()
        if (table === undefined || this.readonly || this.#tableEdit !== undefined)
          return false
        this.#enterTableEdit(table.id)
        return true
      }
    }
    const step = this.grid === false || !(this.grid > 0) ? 1 : this.grid
    const delta = nudgeDelta(event.key, { large: event.shiftKey, step, largeStep: NUDGE_LARGE_STEP })
    if (!delta)
      return false
    const ids = this.#editor.selection.elements
    if (ids.length > 0 && !this.readonly && this.#tableEdit === undefined) {
      this.#editor.moveElements(ids, delta.dx, delta.dy, { merge: 'nudge' })
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
    if (!this.readonly && this.#writeClipboard(event))
      this.#editor.deleteSelection()
  }

  readonly #onPaste = (event: ClipboardEvent): void => {
    if (this.readonly || this.mode !== 'design' || !this.#ownsClipboardEvent(event) || event.clipboardData === null)
      return
    const text = event.clipboardData.getData(clipboardMimeType(CLIPBOARD_PRODUCT)) || event.clipboardData.getData('text/plain')
    const result = decodeClipboard(text, CLIPBOARD_PRODUCT)
    if (!result.ok || result.version !== CLIPBOARD_VERSION)
      return
    const clipboard = this.#readClipboard(result.payload)
    if (clipboard === undefined)
      return
    event.preventDefault()
    this.#editor.paste(clipboard)
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
