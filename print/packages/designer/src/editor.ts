/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印设计器的编辑模型：在历史栈之上维护当前页面模板、页眉页脚的当前变体、选择、剪贴板与编辑命令；不碰 DOM。

import type {
  ElementContainerRef,
  ElementRegion,
  ElementRegistry,
  PageBandKey,
  PageBandVariant,
  PrintCoreExtension,
  PrintDocument,
  PrintElement,
  PrintOperation,
  PrintPage,
  ReorderTarget,
  TablePlanResult,
  ValidationIssue,
} from '@xihan-print/core'
import type { AlignMode, DistributeAxis, ExecuteOptions, History, HistoryChangeKind, Rect } from '@xihan-ui/designer-kit'
import {
  applyOperation,
  collectDocumentIds,
  createPage,
  createPrintModel,
  findElement,
  validateDocument,
} from '@xihan-print/core'
import { alignRects, createHistory, createIdAllocator, distributeRects, nextFreeId, remapIds } from '@xihan-ui/designer-kit'

const NO_EXTENSIONS: readonly PrintCoreExtension[] = []

/** 表格编辑态下选中的部位。 */
export type PrintTablePart
  = | { readonly kind: 'column', readonly elementId: string, readonly columnId: string }
    | { readonly kind: 'header' | 'body', readonly elementId: string }
    | { readonly kind: 'footerRow', readonly elementId: string, readonly rowId: string }
    | { readonly kind: 'footerCell', readonly elementId: string, readonly rowId: string, readonly columnId: string }

/** 选择：都在当前页面模板的正文与当前显示的页眉页脚变体里；tablePart 只在表格编辑态下出现。 */
export interface PrintSelection {
  readonly elements: readonly string[]
  readonly tablePart?: PrintTablePart
}

/** 选择方式：替换、追加或切换。 */
export type PrintSelectMode = 'replace' | 'add' | 'toggle'

/** 剪贴板内容：被复制的元素与它们所在的区域。 */
export interface PrintClipboard {
  readonly elements: readonly PrintElement[]
  readonly region: ElementRegion
}

/** 当前页面模板显示的页眉与页脚变体。 */
export interface PrintBandView {
  readonly header: PageBandKey
  readonly footer: PageBandKey
}

/** 编辑模型的变化：文档变化带上历史变化的种类与实际应用的操作；视图变化指当前页面、带区变体或选择变了。 */
export type PrintEditorChange
  = | { readonly kind: 'document', readonly cause: HistoryChangeKind, readonly document: PrintDocument, readonly operations: readonly PrintOperation[] }
    | { readonly kind: 'selection', readonly selection: PrintSelection }
    | { readonly kind: 'page', readonly pageId: string }
    | { readonly kind: 'bands', readonly bands: PrintBandView }

export interface PrintEditorOptions {
  readonly document: PrintDocument
  /** 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前。 */
  readonly extensions?: readonly PrintCoreExtension[]
  /** 撤销步数上限，缺省 100。 */
  readonly historyLimit?: number
  /** 同一合并键相隔多少毫秒内并入上一步，缺省 1000。 */
  readonly mergeWithin?: number
  readonly now?: () => number
}

/** 新建元素的参数：位置为左上角，单位 mm；region 缺省为正文，页眉页脚放进当前显示的变体。 */
export interface PrintAddElementInit {
  readonly x: number
  readonly y: number
  readonly region?: ElementRegion
  /** 压在元素种类缺省值之上的顶层属性，如绑定的字段；id、type 与位置不受它影响。 */
  readonly overrides?: Readonly<Record<string, unknown>>
}

export interface PrintEditor {
  readonly document: PrintDocument
  /** 当前扩展合出的元素登记表。 */
  readonly elements: ElementRegistry
  readonly history: History<PrintDocument, PrintOperation>
  readonly selection: PrintSelection
  readonly activePageId: string
  /** 当前页面模板。 */
  readonly page: PrintPage
  readonly bands: PrintBandView
  /** 换一组扩展：之后的编辑操作与校验都按它；冲突时抛 DesignerExtensionError、什么都不变。 */
  readonly setExtensions: (extensions: readonly PrintCoreExtension[]) => void
  /** 装载新文档：清空历史与选择，当前页面回到第一张；文档变化的 cause 为 reset。 */
  readonly load: (document: PrintDocument) => void
  /** 执行一组操作并记为一步撤销；返回新文档。 */
  readonly execute: (operations: readonly PrintOperation[], options?: ExecuteOptions) => PrintDocument
  readonly undo: () => boolean
  readonly redo: () => boolean
  /** 封口：此后带同一合并键的修改另起一步。 */
  readonly seal: () => void
  /** 切换当前页面模板并清空选择；页面不存在时抛错。 */
  readonly setActivePage: (pageId: string) => void
  /** 切换页眉或页脚当前显示的变体；变体不存在时用 default。选择里不再显示的元素随之取消选择。 */
  readonly setBandVariant: (region: 'header' | 'footer', key: PageBandKey) => void
  readonly select: (selection: Partial<PrintSelection>, mode?: PrintSelectMode) => void
  readonly selectAll: () => void
  readonly clearSelection: () => void
  /** 当前页面模板里可见的元素（正文与当前显示的页眉页脚变体），按页眉、正文、页脚的层级顺序。 */
  readonly visibleElements: () => { readonly element: PrintElement, readonly region: ElementRegion }[]
  /** 按元素类型新建元素并选中它；类型未登记时抛错。 */
  readonly addElement: (type: string, init: PrintAddElementInit, options?: ExecuteOptions) => PrintElement
  /** 删除选中的元素；没有选中时返回 false。 */
  readonly deleteSelection: (options?: ExecuteOptions) => boolean
  /** 平移一组元素，单位 mm；位移为零或元素为空时什么都不做。 */
  readonly moveElements: (ids: readonly string[], dx: number, dy: number, options?: ExecuteOptions) => void
  /** 调整选中元素的层级；多个元素按选中先后依次调整。 */
  readonly reorder: (target: ReorderTarget, options?: ExecuteOptions) => void
  /** 对齐选中的元素；少于两个时什么都不做。 */
  readonly align: (mode: AlignMode, options?: ExecuteOptions) => void
  /** 等距分布选中的元素；少于三个时什么都不做。 */
  readonly distribute: (axis: DistributeAxis, options?: ExecuteOptions) => void
  /** 复制选中的元素；没有选中时返回 undefined。 */
  readonly copy: () => PrintClipboard | undefined
  /** 复制并删除选中的元素。 */
  readonly cut: (options?: ExecuteOptions) => PrintClipboard | undefined
  /** 粘贴到当前页面模板并选中粘贴出的元素；缺省用最近一次 copy 的内容，每次粘贴比上一次多偏移 offset（mm）。 */
  readonly paste: (clipboard?: PrintClipboard, options?: ExecuteOptions & { readonly offset?: number }) => PrintSelection
  /** 复制选中内容并立即粘贴，不改动剪贴板。 */
  readonly duplicate: (options?: ExecuteOptions & { readonly offset?: number }) => PrintSelection
  /** 在 index 处（缺省末尾）新增一张页面模板并切到它。 */
  readonly addPage: (index?: number, options?: ExecuteOptions) => PrintPage
  /** 删除页面模板；只剩一张时不删并返回 false。 */
  readonly removePage: (pageId: string, options?: ExecuteOptions) => boolean
  readonly movePage: (pageId: string, index: number, options?: ExecuteOptions) => void
  /** 为当前页面模板的页眉或页脚新增变体（高度取 default 的高度）并切到它；已存在时只切换。 */
  readonly addBand: (region: 'header' | 'footer', variant: PageBandVariant, options?: ExecuteOptions) => void
  /** 删除当前页面模板页眉或页脚的变体及其中的元素。 */
  readonly removeBand: (region: 'header' | 'footer', variant: PageBandVariant, options?: ExecuteOptions) => void
  /** 设置当前页面模板某个带区的高度，单位 mm。 */
  readonly setBandHeight: (region: 'header' | 'footer', key: PageBandKey, height: number, options?: ExecuteOptions) => void
  /** 按 core 的表格计划修改表格；计划被拒时不改文档并返回 false。 */
  readonly applyTablePlan: (tableId: string, plan: TablePlanResult, options?: ExecuteOptions) => boolean
  readonly validate: () => ValidationIssue[]
  readonly subscribe: (listener: (change: PrintEditorChange) => void) => () => void
}

const EMPTY_SELECTION: PrintSelection = { elements: [] }
const DEFAULT_BANDS: PrintBandView = { header: 'default', footer: 'default' }
const DEFAULT_PASTE_OFFSET = 5

/** 元素外框：带旋转角的元素按旋转后的形状参与对齐与分布。 */
export function elementRect(element: PrintElement): Rect {
  const rotation = 'rotation' in element ? element.rotation : 0
  return rotation === 0
    ? { x: element.x, y: element.y, width: element.width, height: element.height }
    : { x: element.x, y: element.y, width: element.width, height: element.height, rotation }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 创建打印编辑模型。 */
export function createPrintEditor(options: PrintEditorOptions): PrintEditor {
  let extensions = options.extensions ?? NO_EXTENSIONS
  let elements = createPrintModel(extensions).elements
  const history = createHistory<PrintDocument, PrintOperation>({
    document: options.document,
    apply: (document, operation) => applyOperation(document, operation, { extensions }),
    limit: options.historyLimit ?? 100,
    mergeWithin: options.mergeWithin ?? 1000,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const listeners = new Set<(change: PrintEditorChange) => void>()
  let selection: PrintSelection = EMPTY_SELECTION
  let activePageId = options.document.pages[0]?.id ?? ''
  const bandViews = new Map<string, PrintBandView>()
  let clipboard: PrintClipboard | undefined
  let pasteCount = 0

  const emit = (change: PrintEditorChange): void => {
    for (const listener of listeners)
      listener(change)
  }

  const currentPage = (): PrintPage => {
    const document = history.document
    return document.pages.find(page => page.id === activePageId) ?? document.pages[0] ?? createPage({ id: 'page-1' })
  }

  const bandsOf = (page: PrintPage): PrintBandView => {
    const view = bandViews.get(page.id) ?? DEFAULT_BANDS
    return {
      header: page.header[view.header] === undefined ? 'default' : view.header,
      footer: page.footer[view.footer] === undefined ? 'default' : view.footer,
    }
  }

  const visibleElements = (): { element: PrintElement, region: ElementRegion }[] => {
    const page = currentPage()
    const bands = bandsOf(page)
    const header = page.header[bands.header]?.elements ?? []
    const footer = page.footer[bands.footer]?.elements ?? []
    return [
      ...header.map(element => ({ element, region: 'header' as const })),
      ...page.elements.map(element => ({ element, region: 'body' as const })),
      ...footer.map(element => ({ element, region: 'footer' as const })),
    ]
  }

  const visibleIds = (): Set<string> => new Set(visibleElements().map(item => item.element.id))

  const tablePartValid = (part: PrintTablePart, ids: readonly string[]): boolean => {
    if (ids.length !== 1 || ids[0] !== part.elementId)
      return false
    const found = findElement(history.document, part.elementId)
    if (found?.element.type !== 'table')
      return false
    const table = found.element
    switch (part.kind) {
      case 'column':
        return table.columns.some(column => column.id === part.columnId)
      case 'footerRow':
        return table.footerRows.some(row => row.id === part.rowId)
      case 'footerCell':
        return table.footerRows.some(row => row.id === part.rowId && row.cells.some(cell => cell.columnId === part.columnId))
      default:
        return true
    }
  }

  const setSelection = (next: PrintSelection): void => {
    const visible = visibleIds()
    const elements = [...new Set(next.elements)].filter(id => visible.has(id))
    const part = next.tablePart !== undefined && tablePartValid(next.tablePart, elements) ? next.tablePart : undefined
    const same = elements.length === selection.elements.length
      && elements.every((id, index) => id === selection.elements[index])
      && JSON.stringify(part) === JSON.stringify(selection.tablePart)
    if (same)
      return
    selection = part === undefined ? { elements } : { elements, tablePart: part }
    emit({ kind: 'selection', selection })
  }

  history.subscribe((change) => {
    if (!history.document.pages.some(page => page.id === activePageId)) {
      activePageId = history.document.pages[0]?.id ?? ''
      emit({ kind: 'page', pageId: activePageId })
    }
    emit({ kind: 'document', cause: change.kind, document: change.document, operations: change.operations })
    setSelection(selection)
  })

  const taken = (): Set<string> => collectDocumentIds(history.document)

  const containerOf = (region: ElementRegion): ElementContainerRef => {
    const page = currentPage()
    if (region === 'body')
      return { pageId: page.id, region }
    return { pageId: page.id, region, band: bandsOf(page)[region] }
  }

  const selectedElements = (): PrintElement[] => {
    const byId = new Map(visibleElements().map(item => [item.element.id, item.element]))
    return selection.elements.flatMap(id => byId.get(id) ?? [])
  }

  const moveTo = (positions: { id: string, dx: number, dy: number }[], options?: ExecuteOptions): void => {
    const operations: PrintOperation[] = positions
      .filter(position => position.dx !== 0 || position.dy !== 0)
      .map(position => ({ type: 'moveElements', ids: [position.id], dx: position.dx, dy: position.dy }))
    history.execute(operations, options)
  }

  const editor: PrintEditor = {
    get document() {
      return history.document
    },
    get elements() {
      return elements
    },
    history,
    get selection() {
      return selection
    },
    get activePageId() {
      return currentPage().id
    },
    get page() {
      return currentPage()
    },
    get bands() {
      return bandsOf(currentPage())
    },
    setExtensions: (next) => {
      elements = createPrintModel(next).elements
      extensions = next
    },
    load: (document) => {
      activePageId = document.pages[0]?.id ?? ''
      bandViews.clear()
      pasteCount = 0
      const hadSelection = selection !== EMPTY_SELECTION
      selection = EMPTY_SELECTION
      history.reset(document)
      emit({ kind: 'page', pageId: activePageId })
      if (hadSelection)
        emit({ kind: 'selection', selection })
    },
    execute: (operations, options) => history.execute(operations, options),
    undo: () => history.undo(),
    redo: () => history.redo(),
    seal: () => history.seal(),
    setActivePage: (pageId) => {
      if (!history.document.pages.some(page => page.id === pageId))
        throw new Error(`[print-designer] page "${pageId}" does not exist`)
      if (pageId === activePageId)
        return
      activePageId = pageId
      emit({ kind: 'page', pageId })
      setSelection(EMPTY_SELECTION)
    },
    setBandVariant: (region, key) => {
      const page = currentPage()
      const current = bandsOf(page)
      const next = { ...current, [region]: page[region][key] === undefined ? 'default' : key }
      if (next[region] === current[region])
        return
      bandViews.set(page.id, next)
      emit({ kind: 'bands', bands: next })
      setSelection(selection)
    },
    select: (next, mode = 'replace') => {
      const ids = next.elements ?? []
      if (mode === 'replace') {
        setSelection({ elements: ids, ...(next.tablePart === undefined ? {} : { tablePart: next.tablePart }) })
        return
      }
      const current = new Set(selection.elements)
      for (const id of ids) {
        if (mode === 'toggle' && current.has(id))
          current.delete(id)
        else
          current.add(id)
      }
      setSelection({ elements: [...current] })
    },
    selectAll: () => setSelection({ elements: visibleElements().map(item => item.element.id) }),
    clearSelection: () => setSelection(EMPTY_SELECTION),
    visibleElements,
    addElement: (type, init, options) => {
      if (!elements.has(type))
        throw new Error(`[print-designer] element type "${type}" is not registered`)
      const prototype = elements.get(type)!
      const region = prototype.flow ? 'body' : init.region ?? 'body'
      const id = nextFreeId(`${type}-`, taken())
      const element = elements.createElement(type as PrintElement['type'], { id, x: init.x, y: init.y, ...(init.overrides === undefined ? {} : { overrides: init.overrides }) })
      history.execute([{ type: 'addElement', container: containerOf(region), element }], options)
      setSelection({ elements: [id] })
      return element
    },
    deleteSelection: (options) => {
      const ids = selectedElements().map(element => element.id)
      if (ids.length === 0)
        return false
      history.execute(ids.map(id => ({ type: 'removeElement', id })), options)
      return true
    },
    moveElements: (ids, dx, dy, options) => {
      if (ids.length === 0 || (dx === 0 && dy === 0))
        return
      history.execute([{ type: 'moveElements', ids: [...ids], dx, dy }], options)
    },
    reorder: (target, options) => {
      const ids = selectedElements().map(element => element.id)
      history.execute(ids.map(id => ({ type: 'reorderElement', id, to: target })), options)
    },
    align: (mode, options) => {
      const elements = selectedElements()
      if (elements.length < 2)
        return
      const points = alignRects(elements.map(elementRect), mode)
      moveTo(elements.map((element, index) => ({ id: element.id, dx: points[index]!.x - element.x, dy: points[index]!.y - element.y })), options)
    },
    distribute: (axis, options) => {
      const elements = selectedElements()
      if (elements.length < 3)
        return
      const points = distributeRects(elements.map(elementRect), axis)
      moveTo(elements.map((element, index) => ({ id: element.id, dx: points[index]!.x - element.x, dy: points[index]!.y - element.y })), options)
    },
    copy: () => {
      const elements = selectedElements()
      if (elements.length === 0)
        return undefined
      const regions = new Map(visibleElements().map(item => [item.element.id, item.region]))
      clipboard = { elements: elements.map(clone), region: regions.get(elements[0]!.id) ?? 'body' }
      pasteCount = 0
      return clipboard
    },
    cut: (options) => {
      const copied = editor.copy()
      if (copied !== undefined)
        editor.deleteSelection(options)
      return copied
    },
    paste: (source, options) => {
      const content = source ?? clipboard
      if (content === undefined || content.elements.length === 0)
        return selection
      if (source === undefined)
        pasteCount++
      const offset = (options?.offset ?? DEFAULT_PASTE_OFFSET) * (source === undefined ? pasteCount : 1)
      const allocators = new Map<string, ReturnType<typeof createIdAllocator>>()
      const used = taken()
      const ids = remapIds(content.elements.map(element => element.id), (oldId) => {
        const type = content.elements.find(element => element.id === oldId)!.type
        let allocator = allocators.get(type)
        if (allocator === undefined) {
          allocator = createIdAllocator(`${type}-`, used)
          allocators.set(type, allocator)
        }
        return allocator.next()
      })
      const operations: PrintOperation[] = content.elements.map((element) => {
        const flow = elements.get(element.type)?.flow === true
        const copy = { ...clone(element), id: ids.get(element.id)!, x: element.x + offset, y: element.y + offset }
        return { type: 'addElement', container: containerOf(flow ? 'body' : content.region), element: copy }
      })
      history.execute(operations, options)
      setSelection({ elements: [...ids.values()] })
      return selection
    },
    duplicate: (options) => {
      const elements = selectedElements()
      if (elements.length === 0)
        return selection
      const regions = new Map(visibleElements().map(item => [item.element.id, item.region]))
      return editor.paste({ elements: elements.map(clone), region: regions.get(elements[0]!.id) ?? 'body' }, options)
    },
    addPage: (index, options) => {
      const page = createPage({ id: nextFreeId('page-', taken()) })
      history.execute([{ type: 'addPage', page, ...(index === undefined ? {} : { index }) }], options)
      editor.setActivePage(page.id)
      return page
    },
    removePage: (pageId, options) => {
      const document = history.document
      if (document.pages.length <= 1 || !document.pages.some(page => page.id === pageId))
        return false
      const index = document.pages.findIndex(page => page.id === pageId)
      if (pageId === activePageId) {
        activePageId = (document.pages[index + 1] ?? document.pages[index - 1])!.id
        emit({ kind: 'page', pageId: activePageId })
        setSelection(EMPTY_SELECTION)
      }
      history.execute([{ type: 'removePage', pageId }], options)
      return true
    },
    movePage: (pageId, index, options) => {
      history.execute([{ type: 'movePage', pageId, index }], options)
    },
    addBand: (region, variant, options) => {
      const page = currentPage()
      if (page[region][variant] === undefined)
        history.execute([{ type: 'addBand', pageId: page.id, region, variant, band: { height: page[region].default.height, elements: [] } }], options)
      editor.setBandVariant(region, variant)
    },
    removeBand: (region, variant, options) => {
      const page = currentPage()
      if (page[region][variant] !== undefined)
        history.execute([{ type: 'removeBand', pageId: page.id, region, variant }], options)
    },
    setBandHeight: (region, key, height, options) => {
      const page = currentPage()
      if (page[region][key] === undefined)
        return
      history.execute([{ type: 'updatePage', pageId: page.id, changes: [{ path: [region, key, 'height'], value: height }] }], options)
    },
    applyTablePlan: (tableId, plan, options) => {
      if (!plan.ok)
        return false
      if (plan.changes.length > 0)
        history.execute([{ type: 'updateElement', id: tableId, changes: plan.changes }], options)
      return true
    },
    validate: () => validateDocument(history.document, { extensions }).issues,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return editor
}
