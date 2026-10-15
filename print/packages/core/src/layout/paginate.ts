/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect } from '@xihan-ui/designer-kit'
import type { PageBand, PrintDocument, PrintPage } from '../schema/document'
import type { PageNumberElement, PrintElement } from '../schema/elements'
import type { PageBandKey } from '../schema/options'
import type { IssueParams } from '../validation/issues'
import type { BodyItem } from './body'
import type { DiagnosticScope, LayoutContext } from './context'
import type { BodyGeometry } from './placement'
import type {
  LayoutBox,
  LayoutSheet,
  PaginateOptions,
  PaginationDiagnostic,
  PaginationDiagnosticCode,
  PaginationResult,
  TextLayoutBox,
} from './types'
import { getBandRect, getBodyRect, getPaperSize, resolvePageBandKey } from '../geometry'
import { validateDocument } from '../validation/validate'
import { layoutBody } from './body'
import { fillPageNumber, layoutFixedElement, pageNumberBox } from './boxes'
import { templateText } from './content'
import { createLayoutContext } from './context'
import { prepareLongText } from './long-text'
import { prepareTable } from './table'
import { PrintLayoutError } from './types'

/** 输出页总数上限的缺省值。 */
export const DEFAULT_MAX_SHEETS = 1000

interface SheetInfo {
  headerKey: PageBandKey
  footerKey: PageBandKey
  header: PageBand
  footer: PageBand
  body: Rect
}

interface PageNumberFixup {
  box: TextLayoutBox
  element: PageNumberElement
  sheet: LayoutSheet
}

interface PageLayout {
  sheets: LayoutSheet[]
  fixups: PageNumberFixup[]
}

function isPageNumber(element: PrintElement): element is PageNumberElement {
  return element.type === 'pageNumber'
}

function prepareBodyItem(element: PrintElement, index: number, context: LayoutContext, scope: DiagnosticScope): BodyItem {
  switch (element.type) {
    case 'table':
      return { kind: 'table', element, index, prepared: prepareTable(element, context, scope) }
    case 'longText':
      return { kind: 'longText', element, index, prepared: prepareLongText(element, context, scope) }
    case 'pageNumber':
      return { kind: 'fixed', element, index, box: pageNumberBox(element, 'body') }
    default:
      return { kind: 'fixed', element, index, box: layoutFixedElement(element, 'body', context, scope) }
  }
}

/** 把一次排版尝试中的诊断暂存起来，只有采用的那次才提交。 */
function bufferedContext(context: LayoutContext): { context: LayoutContext, commit: () => void } {
  const buffer: [PaginationDiagnosticCode, DiagnosticScope, IssueParams | undefined][] = []
  return {
    context: { ...context, report: (code, scope, params) => buffer.push([code, scope, params]) },
    commit: () => {
      for (const [code, scope, params] of buffer)
        context.report(code, scope, params)
    },
  }
}

function layoutPage(page: PrintPage, firstNumber: number, limit: number, context: LayoutContext): PageLayout {
  const paper = getPaperSize(page)
  const elementsById = new Map(page.elements.map(element => [element.id, element]))
  const items = page.elements.map((element, index) =>
    prepareBodyItem(element, index, context, { pageId: page.id, elementId: element.id }),
  )

  const bandBoxes = new Map<string, { box: LayoutBox, element: PrintElement }[]>()
  const boxesOfBand = (region: 'header' | 'footer', key: PageBandKey, band: PageBand): { box: LayoutBox, element: PrintElement }[] => {
    const cacheKey = `${region}:${key}`
    let boxes = bandBoxes.get(cacheKey)
    if (boxes === undefined) {
      boxes = band.elements.flatMap<{ box: LayoutBox, element: PrintElement }>((element) => {
        const scope = { pageId: page.id, elementId: element.id }
        if (isPageNumber(element))
          return [{ box: pageNumberBox(element, region), element }]
        if (element.type === 'table' || element.type === 'longText')
          return []
        return [{ box: layoutFixedElement(element, region, context, scope), element }]
      })
      bandBoxes.set(cacheKey, boxes)
    }
    return boxes
  }

  const sheetInfo = (sheet: number, assumedLast: number): SheetInfo => {
    const position = { isFirst: sheet === 0, isLast: sheet === assumedLast, pageNumber: firstNumber + sheet }
    const headerKey = resolvePageBandKey(page.header, position)
    const footerKey = resolvePageBandKey(page.footer, position)
    const header = page.header[headerKey] ?? page.header.default
    const footer = page.footer[footerKey] ?? page.footer.default
    return { headerKey, footerKey, header, footer, body: getBodyRect(page, header, footer) }
  }

  let assumedLast = 0
  let pass: ReturnType<typeof layoutBody>
  let commit: () => void
  let sheetCount: number
  for (;;) {
    const geometry: BodyGeometry = { bodyRect: sheet => sheetInfo(sheet, assumedLast).body, limit }
    const attempt = bufferedContext(context)
    pass = layoutBody(items, geometry, attempt.context, page.id)
    commit = attempt.commit
    const used = pass.sheetCount
    if (used === assumedLast + 1 || pass.truncated) {
      sheetCount = Math.min(used, limit)
      break
    }
    if (used < assumedLast + 1) {
      sheetCount = assumedLast + 1
      break
    }
    assumedLast = used - 1
  }
  commit()

  const watermark = page.watermark === undefined
    ? undefined
    : { ...page.watermark, text: templateText(page.watermark.text, context.data, context, { pageId: page.id }) }
  const fixups: PageNumberFixup[] = []
  const sheets: LayoutSheet[] = []
  for (let index = 0; index < sheetCount; index++) {
    const info = sheetInfo(index, sheetCount - 1)
    const sheet: LayoutSheet = {
      pageId: page.id,
      sheetIndex: index,
      pageNumber: firstNumber + index,
      totalPages: 0,
      size: paper,
      orientation: page.orientation,
      margins: page.margins,
      header: { key: info.headerKey, rect: getBandRect(page, 'header', info.header) },
      footer: { key: info.footerKey, rect: getBandRect(page, 'footer', info.footer) },
      body: info.body,
      boxes: [],
    }
    if (watermark !== undefined)
      sheet.watermark = watermark

    const collect = (box: LayoutBox, element: PrintElement): void => {
      const copy = { ...box }
      sheet.boxes.push(copy)
      if (isPageNumber(element) && copy.kind === 'text')
        fixups.push({ box: copy, element, sheet })
    }
    for (const { box, element } of boxesOfBand('header', info.headerKey, info.header))
      collect(box, element)
    for (const placed of pass.boxes) {
      if (placed.sheet === index)
        collect(placed.box, elementsById.get(placed.box.elementId) as PrintElement)
    }
    for (const { box, element } of boxesOfBand('footer', info.footerKey, info.footer))
      collect(box, element)
    sheets.push(sheet)
  }
  return { sheets, fixups }
}

function checkOptions(options: PaginateOptions): number {
  if (typeof options?.measurer?.measure !== 'function')
    throw new PrintLayoutError('option.invalid', { option: 'measurer' })
  const maxSheets = options.maxSheets ?? DEFAULT_MAX_SHEETS
  if (!Number.isInteger(maxSheets) || maxSheets < 1)
    throw new PrintLayoutError('option.invalid', { option: 'maxSheets' })
  if (options.format !== undefined && typeof options.format !== 'function')
    throw new PrintLayoutError('option.invalid', { option: 'format' })
  return maxSheets
}

/**
 * 按数据排出模板文档的全部输出页，返回每页每个元素的布局盒。
 * 文档有 error 级校验问题、选项不合法、测量或格式化结果不合法时抛出 PrintLayoutError。
 */
export function paginate(document: PrintDocument, data: unknown, options: PaginateOptions): PaginationResult {
  const maxSheets = checkOptions(options)
  const validationOptions: Parameters<typeof validateDocument>[1] = {}
  if (options.registry !== undefined)
    validationOptions.registry = options.registry
  if (options.expressions !== undefined)
    validationOptions.expressions = options.expressions
  const validation = validateDocument(document, validationOptions)
  if (!validation.valid) {
    const errors = validation.issues.filter(issue => issue.severity === 'error')
    throw new PrintLayoutError('document.invalid', { errors: errors.length }, errors)
  }

  const diagnostics: PaginationDiagnostic[] = []
  const contextOptions: Parameters<typeof createLayoutContext>[2] = {}
  if (options.expressions !== undefined)
    contextOptions.expressions = options.expressions
  if (options.format !== undefined)
    contextOptions.format = options.format
  const formatOptions: { locale?: string, timeZone?: string } = {}
  if (options.locale !== undefined)
    formatOptions.locale = options.locale
  if (options.timeZone !== undefined)
    formatOptions.timeZone = options.timeZone
  contextOptions.formatOptions = formatOptions
  const context = createLayoutContext(data, options.measurer, contextOptions, diagnostics)

  const sheets: LayoutSheet[] = []
  const fixups: PageNumberFixup[] = []
  const runs: LayoutSheet[][] = []
  let lastNumber: number | undefined
  for (const page of document.pages) {
    const budget = maxSheets - sheets.length
    if (budget <= 0) {
      context.report('layout.sheetLimit', { pageId: page.id }, { limit: maxSheets })
      break
    }
    const continues = page.numbering.continuous && lastNumber !== undefined
    const firstNumber = continues ? (lastNumber as number) + 1 : page.numbering.start
    const layout = layoutPage(page, firstNumber, budget, context)
    if (!continues || runs.length === 0)
      runs.push([])
    runs.at(-1)?.push(...layout.sheets)
    sheets.push(...layout.sheets)
    fixups.push(...layout.fixups)
    lastNumber = firstNumber + layout.sheets.length - 1
  }

  for (const run of runs) {
    for (const sheet of run)
      sheet.totalPages = run.length
  }
  for (const { box, element, sheet } of fixups)
    fillPageNumber(box, element, { current: sheet.pageNumber, total: sheet.totalPages }, context)

  return { sheets, diagnostics }
}
