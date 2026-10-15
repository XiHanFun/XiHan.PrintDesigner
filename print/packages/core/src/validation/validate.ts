/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { JsonPath, JsonPathSegment } from '@xihan-ui/core/json'
import type { Rect, Size } from '@xihan-ui/designer-kit'
import type { SchemaIssueTarget } from '@xihan-ui/designer-kit/schema'
import type { ExpressionEngine } from '@xihan-ui/expression'
import type { ElementRegistry } from '../registry/registry'
import type { AnyElementPrototype, ElementValidationContext, PropertyDescriptor } from '../registry/types'
import type { Edges } from '../schema/common'
import type { PrintElement } from '../schema/elements'
import type { PageBandKey, PageOrientation } from '../schema/options'
import type { ElementRegion } from '../traverse'
import type { IssueSink, ValidationIssue, ValidationReport } from './issues'
import { findJsonViolation, isPlainObject } from '@xihan-ui/core/json'
import { expandRect, isPaperPresetName, PAPER_PRESET_NAMES, PAPER_PRESETS, rectContains } from '@xihan-ui/designer-kit'
import { readArray, readBoolean, readNumber, readObject, readOneOf, readString } from '@xihan-ui/designer-kit/schema'
import { getBandRect, getBodyRect, getContentRect, getElementRect, getPaperSize } from '../geometry'
import { createElementRegistry } from '../registry/registry'
import { PRINT_SCHEMA_VERSION } from '../schema/document'
import { PAGE_ORIENTATIONS, SINGLE_SHEET_PREFERENCES } from '../schema/options'
import { PAGE_BAND_KEYS } from '../traverse'
import { field, readColor, readFields, readTextTemplate } from './checks'
import { validateControlValue, validateEdges } from './controls'
import { LENGTH_TOLERANCE } from './element-rules'
import { createIssueSink } from './issues'

type Path = JsonPath

/** 校验选项。 */
export interface ValidateDocumentOptions {
  /** 元素类型登记表，默认为内置元素的登记表。 */
  registry?: ElementRegistry
  /** 受限表达式接入点；缺省时只检查表达式源码非空。 */
  expressionEngine?: ExpressionEngine
}

interface DescriptorNode {
  descriptor?: PropertyDescriptor
  children: Map<string, DescriptorNode>
  required: boolean
}

interface DocumentContext {
  registry: ElementRegistry
  expressionEngine?: ExpressionEngine
  issues: ValidationIssue[]
  ids: Set<string>
  trees: Map<AnyElementPrototype, DescriptorNode>
}

interface PageGeometry {
  paper: Size
  margins: Edges
  orientation: PageOrientation
}

interface ElementPlacement {
  region: ElementRegion
  paper?: Size
  bandRect?: Rect
  bodyRect?: Rect
}

function buildDescriptorTree(descriptors: readonly PropertyDescriptor[]): DescriptorNode {
  const root: DescriptorNode = { children: new Map(), required: false }
  for (const descriptor of descriptors) {
    let node = root
    for (const segment of descriptor.path) {
      const key = String(segment)
      let child = node.children.get(key)
      if (child === undefined) {
        child = { children: new Map(), required: false }
        node.children.set(key, child)
      }
      if (descriptor.present)
        child.required = true
      node = child
    }
    node.descriptor = descriptor
  }
  return root
}

/** 按属性描述树读取对象：缺少的必填属性、描述之外的属性与不合编辑方式的取值都报出。 */
function validateDescriptorNode(
  value: unknown,
  node: DescriptorNode,
  path: Path,
  sink: IssueSink,
  extraKeys: readonly string[],
): void {
  const children = [...node.children]
  const object = readObject(sink, value, path, {
    required: children.filter(([, child]) => child.required).map(([key]) => key),
    allowed: [...node.children.keys(), ...extraKeys],
  })
  if (object === undefined)
    return
  for (const [key, child] of children) {
    const item = object[key]
    if (item === undefined)
      continue
    if (child.descriptor !== undefined)
      validateControlValue(child.descriptor.control, item, [...path, key], sink)
    else
      validateDescriptorNode(item, child, [...path, key], sink, [])
  }
}

/** 路径经过的最内层页面或元素，作问题落在的对象。 */
function targetOfPath(input: unknown, path: Path): SchemaIssueTarget | undefined {
  let target: SchemaIssueTarget | undefined
  let current = input
  for (let index = 0; index < path.length; index++) {
    if (typeof current !== 'object' || current === null)
      break
    current = (current as Record<JsonPathSegment, unknown>)[path[index] as JsonPathSegment]
    const parent = path[index - 1]
    if ((parent === 'pages' || parent === 'elements') && isPlainObject(current) && typeof current.id === 'string')
      target = { kind: parent === 'pages' ? 'page' : 'element', id: current.id }
  }
  return target
}

/** 把 JSON Pointer 换成路径数组，数组中的片段换成下标。 */
function pointerToPath(root: unknown, pointer: string): JsonPathSegment[] {
  const path: JsonPathSegment[] = []
  let current = root
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    const segment: JsonPathSegment = Array.isArray(current) ? Number(key) : key
    path.push(segment)
    current = typeof current === 'object' && current !== null ? (current as Record<JsonPathSegment, unknown>)[segment] : undefined
  }
  return path
}

function valueAtPath(root: unknown, path: readonly JsonPathSegment[]): unknown {
  let current = root
  for (const segment of path)
    current = typeof current === 'object' && current !== null ? (current as Record<JsonPathSegment, unknown>)[segment] : undefined
  return current
}

/** 非 JSON 值的种类：undefined、非有限数字、函数、symbol、bigint 或非普通对象。 */
function jsonViolationKind(value: unknown): string {
  if (typeof value === 'number')
    return 'nonFiniteNumber'
  if (typeof value === 'object' && value !== null)
    return 'nonPlainObject'
  return typeof value
}

function checkId(value: unknown, path: Path, sink: IssueSink, ids: Set<string>): void {
  const id = readString(sink, value, path, { nonEmpty: true })
  if (id === undefined)
    return
  if (ids.has(id))
    sink.report('duplicate-id', path, { params: { id } })
  ids.add(id)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readPageGeometry(page: Readonly<Record<string, unknown>>): PageGeometry | undefined {
  const { paper, margins, orientation } = page
  if (!isPlainObject(paper) || !isPlainObject(margins))
    return undefined
  if (!isFiniteNumber(paper.width) || !isFiniteNumber(paper.height) || paper.width <= 0 || paper.height <= 0)
    return undefined
  if (!(PAGE_ORIENTATIONS as readonly unknown[]).includes(orientation))
    return undefined
  const sides = [margins.top, margins.right, margins.bottom, margins.left]
  if (!sides.every(side => isFiniteNumber(side) && side >= 0))
    return undefined
  return {
    paper: { width: paper.width, height: paper.height },
    margins: margins as unknown as Edges,
    orientation: orientation as PageOrientation,
  }
}

function readBandHeight(set: unknown, key: PageBandKey): number | undefined {
  if (!isPlainObject(set))
    return undefined
  const band = set[key]
  if (!isPlainObject(band) || !isFiniteNumber(band.height) || band.height < 0)
    return undefined
  return band.height
}

function findBandsOverflow(
  header: unknown,
  footer: unknown,
  contentHeight: number,
): { header: PageBandKey, footer: PageBandKey } | undefined {
  for (const headerKey of PAGE_BAND_KEYS) {
    const headerHeight = readBandHeight(header, headerKey)
    if (headerHeight === undefined)
      continue
    for (const footerKey of PAGE_BAND_KEYS) {
      const footerHeight = readBandHeight(footer, footerKey)
      if (footerHeight !== undefined && headerHeight + footerHeight >= contentHeight)
        return { header: headerKey, footer: footerKey }
    }
  }
  return undefined
}

function validatePaper(value: unknown, path: Path, sink: IssueSink): void {
  const size = (item: unknown, itemPath: Path): void => {
    readNumber(sink, item, itemPath, { exclusiveMin: 0 })
  }
  const paper = readFields(sink, value, path, [
    field('preset', false, (item, itemPath) => readOneOf(sink, item, itemPath, PAPER_PRESET_NAMES)),
    field('width', true, size),
    field('height', true, size),
  ])
  if (paper === undefined || !isPaperPresetName(paper.preset))
    return
  const expected = PAPER_PRESETS[paper.preset]
  const matches = isFiniteNumber(paper.width) && isFiniteNumber(paper.height)
    && Math.abs(paper.width - expected.width) <= LENGTH_TOLERANCE
    && Math.abs(paper.height - expected.height) <= LENGTH_TOLERANCE
  if (!matches)
    sink.report('page.presetMismatch', path, { params: { preset: paper.preset } })
}

function validateBand(value: unknown, path: Path, sink: IssueSink): void {
  readFields(sink, value, path, [
    field('height', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 0 })),
    field('elements', true, (item, itemPath) => readArray(sink, item, itemPath)),
  ])
}

function validateBandSet(value: unknown, path: Path, sink: IssueSink): void {
  const band = (item: unknown, itemPath: Path): void => validateBand(item, itemPath, sink)
  readFields(sink, value, path, [
    ...PAGE_BAND_KEYS.map(key => field(key, key === 'default', band)),
    field('singleSheet', true, (item, itemPath) => readOneOf(sink, item, itemPath, SINGLE_SHEET_PREFERENCES)),
  ])
}

function validateNumbering(value: unknown, path: Path, sink: IssueSink): void {
  readFields(sink, value, path, [
    field('continuous', true, (item, itemPath) => readBoolean(sink, item, itemPath)),
    field('start', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 0, integer: true })),
  ])
}

function validateWatermark(value: unknown, path: Path, sink: IssueSink): void {
  const gap = (item: unknown, itemPath: Path): void => {
    readNumber(sink, item, itemPath, { min: 0 })
  }
  readFields(sink, value, path, [
    field('text', true, (item, itemPath) => {
      const text = readTextTemplate(sink, item, itemPath)
      if (text !== undefined && text.trim().length === 0)
        sink.report('watermark.emptyText', itemPath)
    }),
    field('fontFamily', false, (item, itemPath) => readString(sink, item, itemPath)),
    field('fontSize', true, (item, itemPath) => readNumber(sink, item, itemPath, { exclusiveMin: 0, max: 500 })),
    field('color', true, (item, itemPath) => readColor(sink, item, itemPath)),
    field('opacity', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: 0, max: 1 })),
    field('rotation', true, (item, itemPath) => readNumber(sink, item, itemPath, { min: -360, max: 360 })),
    field('gapX', true, gap),
    field('gapY', true, gap),
  ])
}

function descriptorTree(context: DocumentContext, prototype: AnyElementPrototype): DescriptorNode {
  let tree = context.trees.get(prototype)
  if (tree === undefined) {
    tree = buildDescriptorTree(prototype.properties)
    context.trees.set(prototype, tree)
  }
  return tree
}

function validateElement(
  value: unknown,
  path: Path,
  pageId: string | undefined,
  placement: ElementPlacement,
  context: DocumentContext,
): void {
  const elementId = isPlainObject(value) && typeof value.id === 'string' ? value.id : undefined
  const target: SchemaIssueTarget | undefined = elementId !== undefined
    ? { kind: 'element', id: elementId }
    : pageId === undefined ? undefined : { kind: 'page', id: pageId }
  const sink = createIssueSink(context.issues, target, context.expressionEngine)
  const object = readObject(sink, value, path)
  if (object === undefined)
    return

  const firstIssue = context.issues.length
  if (object.id === undefined)
    sink.report('required', [...path, 'id'])
  else
    checkId(object.id, [...path, 'id'], sink, context.ids)

  if (object.type === undefined) {
    sink.report('required', [...path, 'type'])
    return
  }
  const type = readString(sink, object.type, [...path, 'type'])
  if (type === undefined)
    return
  const prototype = context.registry.get(type)
  if (prototype === undefined) {
    sink.report('element.unknownType', [...path, 'type'], { params: { type } })
    return
  }

  validateDescriptorNode(object, descriptorTree(context, prototype), path, sink, ['id', 'type', 'meta'])
  readObject(sink, object.meta, [...path, 'meta'])
  if (context.issues.slice(firstIssue).some(issue => issue.severity === 'error') || findJsonViolation(object) !== undefined)
    return

  const element = object as unknown as PrintElement
  const rect = getElementRect(element)
  if (element.width < prototype.minSize.width || element.height < prototype.minSize.height)
    sink.report('element.tooSmall', path, { params: { minWidth: prototype.minSize.width, minHeight: prototype.minSize.height } })
  if (placement.paper !== undefined) {
    const paperRect = { x: 0, y: 0, ...placement.paper }
    if (!rectContains(expandRect(paperRect, LENGTH_TOLERANCE), rect))
      sink.report('element.outsidePaper', path)
  }
  if (placement.region !== 'body') {
    if (prototype.flow)
      sink.report('element.flowInBand', path, { params: { type: prototype.type } })
    else if (placement.bandRect !== undefined && !rectContains(expandRect(placement.bandRect, LENGTH_TOLERANCE), rect))
      sink.report('element.outsideBand', path, { params: { region: placement.region } })
  }
  else if (prototype.flow && placement.bodyRect !== undefined && !rectContains(expandRect(placement.bodyRect, LENGTH_TOLERANCE), rect)) {
    sink.report('element.flowOutsideBody', path)
  }

  const elementContext: ElementValidationContext = {
    region: placement.region,
    report: (code, relativePath = [], params) => sink.report(code, [...path, ...relativePath], params === undefined ? undefined : { params }),
  }
  if (placement.bodyRect !== undefined)
    elementContext.bodyRect = placement.bodyRect
  const validate = prototype.validate as ((element: PrintElement, context: ElementValidationContext) => void) | undefined
  validate?.(element, elementContext)
}

function validatePage(value: unknown, path: Path, context: DocumentContext): void {
  const pageId = isPlainObject(value) && typeof value.id === 'string' ? value.id : undefined
  const sink = createIssueSink(context.issues, pageId === undefined ? undefined : { kind: 'page', id: pageId }, context.expressionEngine)
  const page = readFields(sink, value, path, [
    field('id', true, (item, itemPath) => checkId(item, itemPath, sink, context.ids)),
    field('name', false, (item, itemPath) => readString(sink, item, itemPath)),
    field('paper', true, (item, itemPath) => validatePaper(item, itemPath, sink)),
    field('orientation', true, (item, itemPath) => readOneOf(sink, item, itemPath, PAGE_ORIENTATIONS)),
    field('margins', true, (item, itemPath) => validateEdges(item, itemPath, sink)),
    field('header', true, (item, itemPath) => validateBandSet(item, itemPath, sink)),
    field('footer', true, (item, itemPath) => validateBandSet(item, itemPath, sink)),
    field('elements', true, (item, itemPath) => readArray(sink, item, itemPath)),
    field('numbering', true, (item, itemPath) => validateNumbering(item, itemPath, sink)),
    field('watermark', false, (item, itemPath) => validateWatermark(item, itemPath, sink)),
    field('meta', false, (item, itemPath) => readObject(sink, item, itemPath)),
  ])
  if (page === undefined)
    return

  const geometry = readPageGeometry(page)
  const paper = geometry === undefined ? undefined : getPaperSize(geometry)
  const content = geometry === undefined ? undefined : getContentRect(geometry)
  if (content !== undefined && (content.width <= 0 || content.height <= 0))
    sink.report('page.noContentArea', [...path, 'margins'])
  const usable = geometry !== undefined && content !== undefined && content.width > 0 && content.height > 0

  if (usable) {
    const overflow = findBandsOverflow(page.header, page.footer, content.height)
    if (overflow !== undefined)
      sink.report('page.bandsOverflow', path, { params: overflow })
  }

  let bodyRect: Rect | undefined
  const defaultHeader = readBandHeight(page.header, 'default')
  const defaultFooter = readBandHeight(page.footer, 'default')
  if (usable && defaultHeader !== undefined && defaultFooter !== undefined) {
    const body = getBodyRect(geometry, { height: defaultHeader }, { height: defaultFooter })
    if (body.height > 0)
      bodyRect = body
  }

  const elementsOf = (container: unknown, containerPath: Path, placement: ElementPlacement): void => {
    if (!Array.isArray(container))
      return
    container.forEach((element, index) => {
      validateElement(element, [...containerPath, index], pageId, placement, context)
    })
  }

  const bodyPlacement: ElementPlacement = { region: 'body' }
  if (paper !== undefined)
    bodyPlacement.paper = paper
  if (bodyRect !== undefined)
    bodyPlacement.bodyRect = bodyRect
  elementsOf(page.elements, [...path, 'elements'], bodyPlacement)

  for (const region of ['header', 'footer'] as const) {
    const set = page[region]
    if (!isPlainObject(set))
      continue
    for (const key of PAGE_BAND_KEYS) {
      const band = set[key]
      if (!isPlainObject(band))
        continue
      const placement: ElementPlacement = { region }
      if (paper !== undefined)
        placement.paper = paper
      if (bodyRect !== undefined)
        placement.bodyRect = bodyRect
      const height = readBandHeight(set, key)
      if (usable && height !== undefined)
        placement.bandRect = getBandRect(geometry, region, { height })
      elementsOf(band.elements, [...path, region, key, 'elements'], placement)
    }
  }
}

/**
 * 校验模板文档：先检查 JSON 纯度，再按 schema、属性描述与元素专属规则逐层校验。
 * 只返回问题码、严重程度、定位与参数，不返回文案。
 */
export function validateDocument(input: unknown, options: ValidateDocumentOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = []
  let jsonPath: JsonPath | undefined
  // 非 JSON 值那一处已报过，结构读取在同一路径上的问题不再重复
  const finish = (): ValidationReport => {
    const kept = jsonPath === undefined
      ? issues
      : issues.filter((issue, index) => index === 0 || issue.path.length !== jsonPath!.length || issue.path.some((segment, at) => segment !== jsonPath![at]))
    return { valid: !kept.some(issue => issue.severity === 'error'), issues: kept }
  }

  const violation = findJsonViolation(input)
  if (violation !== undefined) {
    const path = pointerToPath(input, violation)
    jsonPath = path
    const offending = valueAtPath(input, path)
    const sink = createIssueSink(issues, targetOfPath(input, path))
    if (Array.isArray(offending) || isPlainObject(offending))
      sink.report('json.circular', path)
    else
      sink.report('invalid-value', path, { params: { kind: jsonViolationKind(offending) } })
  }

  const sink = createIssueSink(issues)
  if (!isPlainObject(input)) {
    sink.report('invalid-type', [], { params: { expected: 'object' } })
    return finish()
  }
  if (input.schemaVersion === undefined) {
    sink.report('required', ['schemaVersion'])
    return finish()
  }
  const schemaVersion = readNumber(sink, input.schemaVersion, ['schemaVersion'])
  if (schemaVersion === undefined)
    return finish()
  if (schemaVersion !== PRINT_SCHEMA_VERSION) {
    sink.report('schema.unsupportedVersion', ['schemaVersion'], { params: { version: schemaVersion, supported: PRINT_SCHEMA_VERSION } })
    return finish()
  }

  const context: DocumentContext = {
    registry: options.registry ?? createElementRegistry(),
    issues,
    ids: new Set(),
    trees: new Map(),
  }
  if (options.expressionEngine !== undefined)
    context.expressionEngine = options.expressionEngine
  readFields(sink, input, [], [
    field('schemaVersion', true, () => {}),
    field('name', false, (item, itemPath) => readString(sink, item, itemPath)),
    field('pages', true, (item, itemPath) => {
      const pages = readArray(sink, item, itemPath)
      if (pages === undefined)
        return
      if (pages.length === 0)
        sink.report('document.noPages', itemPath)
      pages.forEach((page, index) => validatePage(page, [...itemPath, index], context))
    }),
    field('meta', false, (item, itemPath) => readObject(sink, item, itemPath)),
  ])

  return finish()
}
