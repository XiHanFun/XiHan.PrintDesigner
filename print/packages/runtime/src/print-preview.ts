/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// <xh-print-preview>：按数据排出打印模板并逐页显示，可直接打印。属性变化后自动重新分页。

import type { IssueParams, PaginationDiagnostic, PaginationResult, PrintDocument, PrintLayoutErrorCode, ValidationIssue } from '@xihan-print/core'
import type { ExpressionEngine, ValueFormatter } from '@xihan-ui/expression'
import type { CanvasMeasurer, TextMeasurer } from '@xihan-ui/viz'
import type { PropertyValues } from '@xihan-ui/web-components/authoring'
import type { PrintClient } from './client/client'
import type { ClientPrintOptions } from './client/protocol'
import type { PrintRuntimeExtension } from './extensions'
import type { PrintRuntimeErrorCode } from './options'
import type { PrintOutcome, PrintSheetsOptions } from './print'
import type { PrintPreviewTranslations } from './translations'
import { paginate, PrintLayoutError } from '@xihan-print/core'
import { createExpressionEngine } from '@xihan-ui/expression'
import { createCanvasMeasurer } from '@xihan-ui/viz'
import { createGeneratedElement, emitEvent, registerElement, XhConfigController, XhReactiveElement } from '@xihan-ui/web-components/authoring'
import { shouldFallBack } from './client/errors'
import { createPrintRuntimeModel } from './extensions'
import { PrintRuntimeError, resolvePaginateOptions } from './options'
import { printSheets } from './print'
import { renderSheets } from './render/sheets'
import { DEFAULT_PRINT_PREVIEW_TRANSLATIONS } from './translations'

/** 预览元素的标签名。 */
export const PRINT_PREVIEW_TAG = 'xh-print-preview'

/** 分页失败的原因：core 的 PrintLayoutError 或运行时的 PrintRuntimeError。 */
export interface PaginationErrorDetail {
  readonly code: PrintLayoutErrorCode | PrintRuntimeErrorCode
  readonly params: IssueParams
  /** 文档不合法时的校验问题。 */
  readonly issues: readonly ValidationIssue[]
}

/** 预览元素派发的事件。 */
export interface PrintPreviewEventMap {
  /** 分页并渲染完成。 */
  'paginated': CustomEvent<{ readonly sheets: number, readonly diagnostics: readonly PaginationDiagnostic[] }>
  /** 分页失败，已清空预览。 */
  'pagination-error': CustomEvent<PaginationErrorDetail>
}

/** 影响分页结果的属性，任一变化都重新分页。 */
const PAGINATION_PROPS = ['schema', 'data', 'expressionEngine', 'formatter', 'locale', 'timeZone', 'measurer', 'extensions'] as const

function errorDetail(error: unknown): PaginationErrorDetail | undefined {
  if (error instanceof PrintLayoutError)
    return { code: error.code, params: error.params, issues: error.issues }
  if (error instanceof PrintRuntimeError)
    return { code: error.code, params: error.params, issues: [] }
  return undefined
}

/** print() 的选项：浏览器打印时的标题，以及交给本地打印客户端的打印选项。 */
export interface PrintPreviewPrintOptions extends Pick<PrintSheetsOptions, 'title'>, ClientPrintOptions {}

export class XhPrintPreview extends XhReactiveElement {
  static override properties = {
    schema: { attribute: false },
    data: { attribute: false },
    expressionEngine: { attribute: false },
    formatter: { attribute: false },
    measurer: { attribute: false },
    translations: { attribute: false },
    locale: { type: String },
    timeZone: { type: String, attribute: 'time-zone' },
    zoom: { type: Number },
    printClient: { attribute: false },
  }

  /** 打印模板。 */
  declare schema: PrintDocument | undefined
  /** 绑定的数据。 */
  declare data: unknown
  /** 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 */
  declare expressionEngine: ExpressionEngine | undefined
  /** 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 */
  declare formatter: ValueFormatter | undefined
  /** 文字度量器；缺省用所在文档的 Canvas 度量器，字体加载完成后自动重排。 */
  declare measurer: TextMeasurer | undefined
  /** 元素自己的文案，压在全局配置之上。 */
  declare translations: Partial<PrintPreviewTranslations> | undefined
  /** 交给格式化器的区域。 */
  declare locale: string | undefined
  /** 交给格式化器的时区。 */
  declare timeZone: string | undefined
  /** 显示缩放倍数，缺省 1；写在宿主的 --xh-print-zoom 上，由 style.css 作用到输出页，只影响预览、不影响打印。 */
  declare zoom: number | undefined
  /** 本地打印客户端（@xihan-print/runtime/client 的 createPrintClient）：给了时 print() 先交给它静默打印，连不上客户端才退回浏览器打印。 */
  declare printClient: PrintClient | undefined

  readonly #config = new XhConfigController(this)
  #extensions: readonly PrintRuntimeExtension[] | undefined
  #root: HTMLDivElement | undefined
  #sheets: HTMLDivElement | undefined
  #result: PaginationResult | undefined
  /** 还没按当前属性分过页。 */
  #stale = true
  #canvasMeasurer: CanvasMeasurer | null | undefined
  #engine: ExpressionEngine | undefined
  #fonts: FontFaceSet | undefined
  readonly #onFontsLoaded = (): void => {
    if (this.measurer !== undefined || !this.#canvasMeasurer)
      return
    this.#canvasMeasurer.refresh()
    this.#repaginate()
  }

  /**
   * 扩展：元素种类、渲染、编辑方式与规则，内置扩展自动排在最前。
   * 赋值时当场合并查重，冲突抛 DesignerExtensionError、什么都不变；同一个数组只合并一次，宿主要保持引用稳定。
   */
  get extensions(): readonly PrintRuntimeExtension[] | undefined {
    return this.#extensions
  }

  set extensions(value: readonly PrintRuntimeExtension[] | undefined) {
    if (value === this.#extensions)
      return
    createPrintRuntimeModel(value)
    const old = this.#extensions
    this.#extensions = value
    this.requestUpdate('extensions', old)
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.#fonts = (this.ownerDocument as Document & { fonts?: FontFaceSet }).fonts
    this.#fonts?.addEventListener('loadingdone', this.#onFontsLoaded)
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#fonts?.removeEventListener('loadingdone', this.#onFontsLoaded)
    this.#fonts = undefined
  }

  /** 打印时交下去的扩展，与分页用同一份。 */
  #extensionOptions(): { extensions?: readonly PrintRuntimeExtension[] } {
    return this.#extensions === undefined ? {} : { extensions: this.#extensions }
  }

  /** 最近一次分页的结果；还没分页或分页失败时为 undefined。 */
  get result(): PaginationResult | undefined {
    return this.#result
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed)
    this.#ensureLayers()
    const zoom = this.zoom
    this.style.setProperty('--xh-print-zoom', typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? String(zoom) : '1')
    if (this.#stale || PAGINATION_PROPS.some(name => changed.has(name)))
      this.#repaginate()
    else
      this.#label()
  }

  /** 立即按当前属性重新分页并渲染，返回分页结果；没有模板或分页失败时返回 undefined，失败另派发 pagination-error。 */
  paginate(): PaginationResult | undefined {
    this.#repaginate()
    return this.#result
  }

  /**
   * 打印当前模板：按当前属性重新分页后送去打印，只在预览中显示的元素不打印。没有模板或分页失败时抛错。
   * 给了 printClient 时先交给本地打印客户端，等到交给打印池；只在连不上客户端时退回浏览器打印，其它错误照常抛出。
   */
  async print(options: PrintPreviewPrintOptions = {}): Promise<PrintOutcome> {
    const result = this.#compute()
    const { title, ...clientOptions } = options
    if (this.printClient !== undefined) {
      try {
        const status = await this.printClient.printSheets(result, { ...clientOptions, document: this.ownerDocument, ...this.#extensionOptions() }).done
        return { sheets: status.sheets ?? result.sheets.length, diagnostics: result.diagnostics, via: 'client' }
      }
      catch (error) {
        if (!shouldFallBack(error))
          throw error
      }
    }
    const sheetsOptions: PrintSheetsOptions = title === undefined
      ? { document: this.ownerDocument, ...this.#extensionOptions() }
      : { document: this.ownerDocument, title, ...this.#extensionOptions() }
    await printSheets(result, sheetsOptions)
    return { sheets: result.sheets.length, diagnostics: result.diagnostics, via: 'browser' }
  }

  #compute(): PaginationResult {
    if (this.schema === undefined)
      throw new PrintRuntimeError('schema.missing')
    return paginate(this.schema, this.data, resolvePaginateOptions(this, {
      measurer: () => {
        if (this.#canvasMeasurer === undefined)
          this.#canvasMeasurer = createCanvasMeasurer(this.ownerDocument)
        return this.#canvasMeasurer
      },
      expressionEngine: () => {
        this.#engine ??= createExpressionEngine()
        return this.#engine
      },
    }))
  }

  #repaginate(): void {
    this.#stale = false
    const sheets = this.#ensureLayers()
    if (this.schema === undefined) {
      this.#result = undefined
      sheets.replaceChildren()
      return
    }
    try {
      const result = this.#compute()
      this.#result = result
      renderSheets(result, sheets, { renderers: createPrintRuntimeModel(this.#extensions).renderers })
      this.#label()
      emitEvent(this, 'paginated', { sheets: result.sheets.length, diagnostics: result.diagnostics })
    }
    catch (error) {
      const detail = errorDetail(error)
      if (detail === undefined)
        throw error
      this.#result = undefined
      sheets.replaceChildren()
      emitEvent(this, 'pagination-error', detail)
    }
  }

  #label(): void {
    const root = this.#root
    const sheets = this.#sheets
    if (root === undefined || sheets === undefined)
      return
    const t = this.#config.translations<PrintPreviewTranslations>(PRINT_PREVIEW_TAG, DEFAULT_PRINT_PREVIEW_TRANSLATIONS, this.translations)
    root.setAttribute('aria-label', t.label)
    const items = Array.from(sheets.children)
    items.forEach((sheet, index) => {
      sheet.setAttribute('role', 'group')
      sheet.setAttribute('aria-label', t.sheetLabel(index + 1, items.length))
    })
  }

  #ensureLayers(): HTMLDivElement {
    if (this.#root?.parentElement === this && this.#sheets !== undefined)
      return this.#sheets
    const doc = this.ownerDocument
    const root = createGeneratedElement(doc, 'div')
    root.dataset.part = 'viewport'
    root.setAttribute('role', 'region')
    const sheets = doc.createElement('div')
    sheets.dataset.part = 'sheets'
    root.append(sheets)
    this.append(root)
    this.#root = root
    this.#sheets = sheets
    return sheets
  }
}

/** 注册 <xh-print-preview>；同一构造器重复注册不报错，没有 customElements 的环境跳过。 */
export function definePrintPreview(): void {
  registerElement(PRINT_PREVIEW_TAG, XhPrintPreview)
}

declare global {
  interface HTMLElementTagNameMap {
    'xh-print-preview': XhPrintPreview
  }
}
