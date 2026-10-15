/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPathSegment, JsonValue } from '@xihan-ui/core/json'
import type { Rect } from '@xihan-ui/designer-kit'
import type { ElementRegistry } from '../registry/registry'
import type { PageBand, PageBandSet, PrintDocument, PrintPage } from '../schema/document'
import type { PrintElement } from '../schema/elements'
import type { PageBandKey } from '../schema/options'
import type { ElementContainerRef, ElementLocation } from '../traverse'
import type {
  AddBandOperation,
  AddElementOperation,
  AddPageOperation,
  MoveElementsOperation,
  MovePageOperation,
  OperationResult,
  PrintOperation,
  PropertyChange,
  RemoveBandOperation,
  RemoveElementOperation,
  RemovePageOperation,
  ReorderElementOperation,
  ResizeElementOperation,
  UpdateDocumentOperation,
  UpdateElementOperation,
  UpdatePageOperation,
} from './types'
import { cloneJson, findJsonViolation, isPlainObject, jsonEquals } from '@xihan-ui/core/json'
import { collectDocumentIds } from '../factory'
import { createElementRegistry } from '../registry/registry'
import { PAGE_BAND_VARIANTS } from '../schema/options'
import { findElement, findPage, getContainerElements, PAGE_BAND_KEYS } from '../traverse'
import { PrintOperationError } from './errors'
import { writeChanges } from './path'

/** 操作选项。 */
export interface ApplyOperationOptions {
  /** 提供元素专属缩放行为的登记表，默认为内置元素的登记表。 */
  registry?: ElementRegistry
}

/** 深拷贝已确认是纯 JSON 的模板数据。 */
function copy<T>(value: T): T {
  return cloneJson(value as unknown as JsonValue) as unknown as T
}

const PAGE_SETTING_KEYS: readonly string[] = ['name', 'paper', 'orientation', 'margins', 'numbering', 'watermark', 'meta']

function unchanged(document: PrintDocument): OperationResult {
  return { document, inverse: [] }
}

function requireElement(document: PrintDocument, id: string): ElementLocation {
  const location = findElement(document, id)
  if (location === undefined)
    throw new PrintOperationError('element.notFound', { id })
  return location
}

function requirePage(document: PrintDocument, pageId: string): { page: PrintPage, index: number } {
  const found = findPage(document, pageId)
  if (found === undefined)
    throw new PrintOperationError('page.notFound', { pageId })
  return found
}

function requireFinite(values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value))
      throw new PrintOperationError('value.invalid', { field: name })
  }
}

function requireInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined)
    return length
  if (!Number.isInteger(index) || index < 0 || index > length)
    throw new PrintOperationError('index.outOfRange', { index, length })
  return index
}

function requireNewIds(document: PrintDocument, ids: readonly string[]): void {
  const used = collectDocumentIds(document)
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0)
      throw new PrintOperationError('value.invalid', { field: 'id' })
    if (used.has(id))
      throw new PrintOperationError('id.duplicate', { id })
    used.add(id)
  }
}

function requireJson(value: unknown, field: string): void {
  if (!isPlainObject(value) || findJsonViolation(value) !== undefined)
    throw new PrintOperationError('value.invalid', { field })
}

function replacePage(document: PrintDocument, index: number, page: PrintPage): PrintDocument {
  const pages = document.pages.slice()
  pages[index] = page
  return { ...document, pages }
}

function replaceBand(set: PageBandSet, key: PageBandKey, band: PageBand | undefined): PageBandSet {
  const next = { ...set }
  if (band === undefined)
    delete next[key]
  else
    next[key] = band
  return next
}

function bandNotFound(pageId: string, region: string, variant: string): PrintOperationError {
  return new PrintOperationError('band.notFound', { pageId, region, variant })
}

function withContainerElements(page: PrintPage, container: ElementContainerRef, elements: PrintElement[]): PrintPage {
  if (container.region === 'body')
    return { ...page, elements }
  const set = page[container.region]
  const band = set[container.band]
  if (band === undefined)
    throw bandNotFound(page.id, container.region, container.band)
  return { ...page, [container.region]: replaceBand(set, container.band, { ...band, elements }) }
}

function replaceElementAt(document: PrintDocument, location: ElementLocation, element: PrintElement): PrintDocument {
  const page = document.pages[location.pageIndex] as PrintPage
  const elements = (getContainerElements(page, location.container) ?? []).slice()
  elements[location.index] = element
  return replacePage(document, location.pageIndex, withContainerElements(page, location.container, elements))
}

function diffChanges(previous: PrintElement, next: PrintElement): PropertyChange[] {
  const before = previous as unknown as Record<string, PropertyChange['value']>
  const after = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: PropertyChange[] = []
  for (const key of keys) {
    if (jsonEquals(before[key], after[key] as JsonValue | undefined))
      continue
    changes.push(before[key] === undefined ? { path: [key] } : { path: [key], value: before[key] })
  }
  return changes
}

function addElement(document: PrintDocument, operation: AddElementOperation): OperationResult {
  const { page, index: pageIndex } = requirePage(document, operation.container.pageId)
  const { container } = operation
  if (!['body', 'header', 'footer'].includes(container.region))
    throw new PrintOperationError('value.invalid', { field: 'container' })
  const elements = getContainerElements(page, container)
  if (elements === undefined)
    throw bandNotFound(page.id, container.region, container.region === 'body' ? '' : container.band)
  requireJson(operation.element, 'element')
  requireNewIds(document, [operation.element.id])
  const index = requireInsertIndex(operation.index, elements.length)
  const next = elements.slice()
  next.splice(index, 0, copy(operation.element))
  return {
    document: replacePage(document, pageIndex, withContainerElements(page, operation.container, next)),
    inverse: [{ type: 'removeElement', id: operation.element.id }],
  }
}

function removeElement(document: PrintDocument, operation: RemoveElementOperation): OperationResult {
  const location = requireElement(document, operation.id)
  const elements = (getContainerElements(location.page, location.container) ?? []).slice()
  elements.splice(location.index, 1)
  return {
    document: replacePage(document, location.pageIndex, withContainerElements(location.page, location.container, elements)),
    inverse: [{ type: 'addElement', container: location.container, element: location.element, index: location.index }],
  }
}

function updateElement(document: PrintDocument, operation: UpdateElementOperation): OperationResult {
  const location = requireElement(document, operation.id)
  for (const change of operation.changes) {
    if (change.path[0] === 'id' || change.path[0] === 'type')
      throw new PrintOperationError('path.protected', { path: change.path.map(String) })
  }
  const { root, undo } = writeChanges(location.element, operation.changes)
  if (undo.length === 0)
    return unchanged(document)
  return {
    document: replaceElementAt(document, location, root),
    inverse: [{ type: 'updateElement', id: operation.id, changes: undo }],
  }
}

function moveElements(document: PrintDocument, operation: MoveElementsOperation): OperationResult {
  requireFinite({ dx: operation.dx, dy: operation.dy })
  if (new Set(operation.ids).size !== operation.ids.length)
    throw new PrintOperationError('value.invalid', { field: 'ids' })
  const locations = operation.ids.map(id => requireElement(document, id))
  if ((operation.dx === 0 && operation.dy === 0) || locations.length === 0)
    return unchanged(document)
  let next = document
  const inverse: PrintOperation[] = []
  for (const location of locations) {
    const { element } = location
    const moved = { ...element, x: element.x + operation.dx, y: element.y + operation.dy } as PrintElement
    next = replaceElementAt(next, location, moved)
    inverse.push({ type: 'updateElement', id: element.id, changes: diffChanges(element, moved) })
  }
  return { document: next, inverse }
}

function resizeElement(document: PrintDocument, operation: ResizeElementOperation, options: ApplyOperationOptions): OperationResult {
  const { x, y, width, height } = operation.bounds
  requireFinite({ x, y, width, height })
  if (width < 0 || height < 0)
    throw new PrintOperationError('value.invalid', { field: 'bounds' })
  const location = requireElement(document, operation.id)
  const { element } = location
  const bounds: Rect = { x, y, width, height }
  const registry = options.registry ?? createElementRegistry()
  const resize = registry.get(element.type)?.resize as ((element: PrintElement, bounds: Rect) => PrintElement) | undefined
  const resized = resize === undefined ? { ...element, ...bounds } as PrintElement : resize(element, bounds)
  const changes = diffChanges(element, resized)
  if (changes.length === 0)
    return unchanged(document)
  return {
    document: replaceElementAt(document, location, resized),
    inverse: [{ type: 'updateElement', id: element.id, changes }],
  }
}

function reorderElement(document: PrintDocument, operation: ReorderElementOperation): OperationResult {
  const location = requireElement(document, operation.id)
  const elements = getContainerElements(location.page, location.container) ?? []
  const last = elements.length - 1
  const { to } = operation
  let target: number
  if (to === 'front')
    target = last
  else if (to === 'back')
    target = 0
  else if (to === 'forward')
    target = Math.min(location.index + 1, last)
  else if (to === 'backward')
    target = Math.max(location.index - 1, 0)
  else if (Number.isInteger(to) && to >= 0 && to <= last)
    target = to
  else
    throw new PrintOperationError('index.outOfRange', { index: to, length: elements.length })
  if (target === location.index)
    return unchanged(document)
  const next = elements.slice()
  next.splice(location.index, 1)
  next.splice(target, 0, location.element)
  return {
    document: replacePage(document, location.pageIndex, withContainerElements(location.page, location.container, next)),
    inverse: [{ type: 'reorderElement', id: operation.id, to: location.index }],
  }
}

function pageElementIds(page: PrintPage): string[] {
  const ids: string[] = []
  const visit = (elements: unknown): void => {
    if (Array.isArray(elements)) {
      for (const element of elements)
        ids.push((element as PrintElement).id)
    }
  }
  visit(page.elements)
  for (const region of ['header', 'footer'] as const) {
    for (const key of PAGE_BAND_KEYS)
      visit(page[region]?.[key]?.elements)
  }
  return ids
}

function addPage(document: PrintDocument, operation: AddPageOperation): OperationResult {
  requireJson(operation.page, 'page')
  requireNewIds(document, [operation.page.id, ...pageElementIds(operation.page)])
  const index = requireInsertIndex(operation.index, document.pages.length)
  const pages = document.pages.slice()
  pages.splice(index, 0, copy(operation.page))
  return {
    document: { ...document, pages },
    inverse: [{ type: 'removePage', pageId: operation.page.id }],
  }
}

function removePage(document: PrintDocument, operation: RemovePageOperation): OperationResult {
  const { page, index } = requirePage(document, operation.pageId)
  const pages = document.pages.slice()
  pages.splice(index, 1)
  return {
    document: { ...document, pages },
    inverse: [{ type: 'addPage', page, index }],
  }
}

function movePage(document: PrintDocument, operation: MovePageOperation): OperationResult {
  const { page, index } = requirePage(document, operation.pageId)
  const target = operation.index
  if (!Number.isInteger(target) || target < 0 || target >= document.pages.length)
    throw new PrintOperationError('index.outOfRange', { index: target, length: document.pages.length })
  if (target === index)
    return unchanged(document)
  const pages = document.pages.slice()
  pages.splice(index, 1)
  pages.splice(target, 0, page)
  return {
    document: { ...document, pages },
    inverse: [{ type: 'movePage', pageId: operation.pageId, index }],
  }
}

function checkPageChange(page: PrintPage, path: readonly JsonPathSegment[]): void {
  const [head, second, third] = path
  if (typeof head === 'string' && PAGE_SETTING_KEYS.includes(head))
    return
  if (head === 'header' || head === 'footer') {
    if (path.length === 2 && second === 'singleSheet')
      return
    const isBandHeight = path.length === 3
      && third === 'height'
      && (PAGE_BAND_KEYS as readonly JsonPathSegment[]).includes(second as JsonPathSegment)
    if (isBandHeight) {
      if (page[head][second as PageBandKey] === undefined)
        throw bandNotFound(page.id, head, String(second))
      return
    }
  }
  throw new PrintOperationError('path.protected', { path: path.map(String) })
}

function updatePage(document: PrintDocument, operation: UpdatePageOperation): OperationResult {
  const { page, index } = requirePage(document, operation.pageId)
  for (const change of operation.changes)
    checkPageChange(page, change.path)
  const { root, undo } = writeChanges(page, operation.changes)
  if (undo.length === 0)
    return unchanged(document)
  return {
    document: replacePage(document, index, root),
    inverse: [{ type: 'updatePage', pageId: operation.pageId, changes: undo }],
  }
}

function requireVariant(variant: string): void {
  if (!(PAGE_BAND_VARIANTS as readonly string[]).includes(variant))
    throw new PrintOperationError('value.invalid', { field: 'variant' })
}

function addBand(document: PrintDocument, operation: AddBandOperation): OperationResult {
  requireVariant(operation.variant)
  const { page, index } = requirePage(document, operation.pageId)
  const set = page[operation.region]
  if (set[operation.variant] !== undefined)
    throw new PrintOperationError('band.exists', { pageId: page.id, region: operation.region, variant: operation.variant })
  requireJson(operation.band, 'band')
  if (!Array.isArray(operation.band.elements))
    throw new PrintOperationError('value.invalid', { field: 'band' })
  requireNewIds(document, operation.band.elements.map(element => element.id))
  const nextPage = { ...page, [operation.region]: replaceBand(set, operation.variant, copy(operation.band)) }
  return {
    document: replacePage(document, index, nextPage),
    inverse: [{ type: 'removeBand', pageId: page.id, region: operation.region, variant: operation.variant }],
  }
}

function removeBand(document: PrintDocument, operation: RemoveBandOperation): OperationResult {
  requireVariant(operation.variant)
  const { page, index } = requirePage(document, operation.pageId)
  const set = page[operation.region]
  const band = set[operation.variant]
  if (band === undefined)
    throw bandNotFound(page.id, operation.region, operation.variant)
  const nextPage = { ...page, [operation.region]: replaceBand(set, operation.variant, undefined) }
  return {
    document: replacePage(document, index, nextPage),
    inverse: [{ type: 'addBand', pageId: page.id, region: operation.region, variant: operation.variant, band }],
  }
}

function updateDocument(document: PrintDocument, operation: UpdateDocumentOperation): OperationResult {
  for (const change of operation.changes) {
    if (change.path[0] === 'schemaVersion' || change.path[0] === 'pages')
      throw new PrintOperationError('path.protected', { path: change.path.map(String) })
  }
  const { root, undo } = writeChanges(document, operation.changes)
  if (undo.length === 0)
    return unchanged(document)
  return { document: root, inverse: [{ type: 'updateDocument', changes: undo }] }
}

/**
 * 以纯函数方式执行编辑操作：不修改传入的文档，返回新文档与逆操作数组。
 * 操作没有带来变化时返回传入的文档本身与空数组；操作无法执行时抛出 PrintOperationError，传入的文档保持不变。
 */
export function applyOperation(
  document: PrintDocument,
  operation: PrintOperation,
  options: ApplyOperationOptions = {},
): OperationResult {
  switch (operation.type) {
    case 'addElement':
      return addElement(document, operation)
    case 'removeElement':
      return removeElement(document, operation)
    case 'updateElement':
      return updateElement(document, operation)
    case 'moveElements':
      return moveElements(document, operation)
    case 'resizeElement':
      return resizeElement(document, operation, options)
    case 'reorderElement':
      return reorderElement(document, operation)
    case 'addPage':
      return addPage(document, operation)
    case 'removePage':
      return removePage(document, operation)
    case 'movePage':
      return movePage(document, operation)
    case 'updatePage':
      return updatePage(document, operation)
    case 'addBand':
      return addBand(document, operation)
    case 'removeBand':
      return removeBand(document, operation)
    case 'updateDocument':
      return updateDocument(document, operation)
    default:
      throw new PrintOperationError('operation.unknown', { type: String((operation as { type: unknown }).type) })
  }
}

/**
 * 按顺序执行一组编辑操作，整体成功或整体失败。逆操作为各操作逆操作按相反顺序的拼接；
 * 全部操作都没有带来变化时返回传入的文档本身与空数组。
 */
export function applyOperations(
  document: PrintDocument,
  operations: readonly PrintOperation[],
  options: ApplyOperationOptions = {},
): OperationResult {
  let current = document
  let inverse: PrintOperation[] = []
  for (const operation of operations) {
    const result = applyOperation(current, operation, options)
    current = result.document
    inverse = [...result.inverse, ...inverse]
  }
  return { document: current, inverse }
}
