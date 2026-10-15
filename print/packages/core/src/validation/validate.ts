/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Rect } from '../geometry'
import type { PathSegment } from '../json'
import type { Size } from '../paper'
import type { ElementRegistry } from '../registry/registry'
import type { AnyElementPrototype, ElementValidationContext, PropertyDescriptor } from '../registry/types'
import type { Edges } from '../schema/common'
import type { PrintElement } from '../schema/elements'
import type { PageBandKey, PageOrientation } from '../schema/options'
import type { ElementRegion } from '../traverse'
import type { IssueScope, IssueSink, ValidationIssue, ValidationReport } from './issues'
import { getBandRect, getBodyRect, getContentRect, getElementRect, getPaperSize, rectContains } from '../geometry'
import { isJsonValue, isPlainObject, listJsonProblems } from '../json'
import { PAPER_PRESET_NAMES, PAPER_PRESETS } from '../paper'
import { createElementRegistry } from '../registry/registry'
import { PRINT_SCHEMA_VERSION } from '../schema/document'
import { PAGE_ORIENTATIONS, SINGLE_SHEET_PREFERENCES } from '../schema/options'
import { PAGE_BAND_KEYS } from '../traverse'
import {
  checkFields,
  expectArray,
  expectBoolean,
  expectColor,
  expectNumber,
  expectObject,
  expectOption,
  expectString,
  expectTextTemplate,
  field,
  reportUnknownKeys,
} from './checks'
import { validateControlValue, validateEdges } from './controls'
import { LENGTH_TOLERANCE } from './element-rules'
import { createIssueSink } from './issues'

type Path = readonly PathSegment[]

/** 校验选项。 */
export interface ValidateDocumentOptions {
  /** 元素类型登记表，默认为内置元素的登记表。 */
  registry?: ElementRegistry
}

interface DescriptorNode {
  descriptor?: PropertyDescriptor
  children: Map<string, DescriptorNode>
  required: boolean
}

interface DocumentContext {
  registry: ElementRegistry
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
      let child = node.children.get(segment)
      if (child === undefined) {
        child = { children: new Map(), required: false }
        node.children.set(segment, child)
      }
      if (descriptor.required)
        child.required = true
      node = child
    }
    node.descriptor = descriptor
  }
  return root
}

function validateDescriptorNode(
  object: Record<string, unknown>,
  node: DescriptorNode,
  path: Path,
  sink: IssueSink,
  extraKeys: readonly string[],
): void {
  for (const [key, child] of node.children) {
    const value = object[key]
    const childPath = [...path, key]
    if (value === undefined) {
      if (child.required)
        sink.report('schema.missingProperty', childPath, { property: key })
      continue
    }
    if (child.descriptor !== undefined)
      validateControlValue(child.descriptor.control, value, childPath, sink)
    else if (expectObject(value, childPath, sink))
      validateDescriptorNode(value, child, childPath, sink, [])
  }
  reportUnknownKeys(object, [...node.children.keys(), ...extraKeys], path, sink)
}

function scopeOfPath(input: unknown, path: Path): IssueScope {
  const scope: IssueScope = {}
  let current = input
  for (let index = 0; index < path.length; index++) {
    if (typeof current !== 'object' || current === null)
      break
    current = (current as Record<PathSegment, unknown>)[path[index] as PathSegment]
    const parent = path[index - 1]
    if ((parent === 'pages' || parent === 'elements') && isPlainObject(current) && typeof current.id === 'string') {
      if (parent === 'pages')
        scope.pageId = current.id
      else
        scope.elementId = current.id
    }
  }
  return scope
}

function checkId(value: unknown, path: Path, sink: IssueSink, ids: Set<string>): void {
  if (!expectString(value, path, sink, { nonEmpty: true }))
    return
  if (ids.has(value))
    sink.report('id.duplicate', path, { id: value })
  ids.add(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readPageGeometry(page: Record<string, unknown>): PageGeometry | undefined {
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
  if (!expectObject(value, path, sink))
    return
  const size = (item: unknown, itemPath: Path): boolean => expectNumber(item, itemPath, sink, { exclusiveMin: 0 })
  checkFields(value, [
    field('preset', false, (item, itemPath) => expectOption(item, PAPER_PRESET_NAMES, itemPath, sink)),
    field('width', true, size),
    field('height', true, size),
  ], path, sink)
  const preset = value.preset
  if (typeof preset !== 'string' || !(PAPER_PRESET_NAMES as readonly string[]).includes(preset))
    return
  const expected = PAPER_PRESETS[preset as keyof typeof PAPER_PRESETS]
  const matches = isFiniteNumber(value.width) && isFiniteNumber(value.height)
    && Math.abs(value.width - expected.width) <= LENGTH_TOLERANCE
    && Math.abs(value.height - expected.height) <= LENGTH_TOLERANCE
  if (!matches)
    sink.report('page.presetMismatch', path, { preset })
}

function validateBand(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  checkFields(value, [
    field('height', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: 0 })),
    field('elements', true, (item, itemPath) => expectArray(item, itemPath, sink)),
  ], path, sink)
}

function validateBandSet(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  const band = (item: unknown, itemPath: Path): void => validateBand(item, itemPath, sink)
  checkFields(value, [
    ...PAGE_BAND_KEYS.map(key => field(key, key === 'default', band)),
    field('singleSheet', true, (item, itemPath) => expectOption(item, SINGLE_SHEET_PREFERENCES, itemPath, sink)),
  ], path, sink)
}

function validateNumbering(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  checkFields(value, [
    field('continuous', true, (item, itemPath) => expectBoolean(item, itemPath, sink)),
    field('start', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: 0, integer: true })),
  ], path, sink)
}

function validateWatermark(value: unknown, path: Path, sink: IssueSink): void {
  if (!expectObject(value, path, sink))
    return
  const gap = (item: unknown, itemPath: Path): boolean => expectNumber(item, itemPath, sink, { min: 0 })
  checkFields(value, [
    field('text', true, (item, itemPath) => {
      if (!expectTextTemplate(item, itemPath, sink))
        return
      if (item.trim().length === 0)
        sink.report('watermark.emptyText', itemPath)
    }),
    field('fontFamily', false, (item, itemPath) => expectString(item, itemPath, sink)),
    field('fontSize', true, (item, itemPath) => expectNumber(item, itemPath, sink, { exclusiveMin: 0, max: 500 })),
    field('color', true, (item, itemPath) => expectColor(item, itemPath, sink)),
    field('opacity', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: 0, max: 1 })),
    field('rotation', true, (item, itemPath) => expectNumber(item, itemPath, sink, { min: -360, max: 360 })),
    field('gapX', true, gap),
    field('gapY', true, gap),
  ], path, sink)
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
  const scope: IssueScope = {}
  if (pageId !== undefined)
    scope.pageId = pageId
  if (elementId !== undefined)
    scope.elementId = elementId
  const sink = createIssueSink(context.issues, scope)
  if (!expectObject(value, path, sink))
    return

  const firstIssue = context.issues.length
  if (value.id === undefined)
    sink.report('schema.missingProperty', [...path, 'id'], { property: 'id' })
  else
    checkId(value.id, [...path, 'id'], sink, context.ids)

  if (value.type === undefined) {
    sink.report('schema.missingProperty', [...path, 'type'], { property: 'type' })
    return
  }
  if (!expectString(value.type, [...path, 'type'], sink))
    return
  const prototype = context.registry.get(value.type)
  if (prototype === undefined) {
    sink.report('element.unknownType', [...path, 'type'], { type: value.type })
    return
  }

  validateDescriptorNode(value, descriptorTree(context, prototype), path, sink, ['id', 'type', 'meta'])
  if (value.meta !== undefined)
    expectObject(value.meta, [...path, 'meta'], sink)
  if (context.issues.slice(firstIssue).some(issue => issue.severity === 'error') || !isJsonValue(value))
    return

  const element = value as unknown as PrintElement
  const rect = getElementRect(element)
  if (element.width < prototype.minSize.width || element.height < prototype.minSize.height)
    sink.report('element.tooSmall', path, { minWidth: prototype.minSize.width, minHeight: prototype.minSize.height })
  if (placement.paper !== undefined) {
    const paperRect = { x: 0, y: 0, ...placement.paper }
    if (!rectContains(paperRect, rect, LENGTH_TOLERANCE))
      sink.report('element.outsidePaper', path)
  }
  if (placement.region !== 'body') {
    if (prototype.flow)
      sink.report('element.flowInBand', path, { type: prototype.type })
    else if (placement.bandRect !== undefined && !rectContains(placement.bandRect, rect, LENGTH_TOLERANCE))
      sink.report('element.outsideBand', path, { region: placement.region })
  }
  else if (prototype.flow && placement.bodyRect !== undefined && !rectContains(placement.bodyRect, rect, LENGTH_TOLERANCE)) {
    sink.report('element.flowOutsideBody', path)
  }

  const elementContext: ElementValidationContext = {
    region: placement.region,
    report: (code, relativePath = [], params) => sink.report(code, [...path, ...relativePath], params),
  }
  if (placement.bodyRect !== undefined)
    elementContext.bodyRect = placement.bodyRect
  const validate = prototype.validate as ((element: PrintElement, context: ElementValidationContext) => void) | undefined
  validate?.(element, elementContext)
}

function validatePage(value: unknown, path: Path, context: DocumentContext): void {
  const pageId = isPlainObject(value) && typeof value.id === 'string' ? value.id : undefined
  const sink = createIssueSink(context.issues, pageId === undefined ? {} : { pageId })
  if (!expectObject(value, path, sink))
    return

  checkFields(value, [
    field('id', true, (item, itemPath) => checkId(item, itemPath, sink, context.ids)),
    field('name', false, (item, itemPath) => expectString(item, itemPath, sink)),
    field('paper', true, (item, itemPath) => validatePaper(item, itemPath, sink)),
    field('orientation', true, (item, itemPath) => expectOption(item, PAGE_ORIENTATIONS, itemPath, sink)),
    field('margins', true, (item, itemPath) => validateEdges(item, itemPath, sink)),
    field('header', true, (item, itemPath) => validateBandSet(item, itemPath, sink)),
    field('footer', true, (item, itemPath) => validateBandSet(item, itemPath, sink)),
    field('elements', true, (item, itemPath) => expectArray(item, itemPath, sink)),
    field('numbering', true, (item, itemPath) => validateNumbering(item, itemPath, sink)),
    field('watermark', false, (item, itemPath) => validateWatermark(item, itemPath, sink)),
    field('meta', false, (item, itemPath) => expectObject(item, itemPath, sink)),
  ], path, sink)

  const geometry = readPageGeometry(value)
  const paper = geometry === undefined ? undefined : getPaperSize(geometry)
  const content = geometry === undefined ? undefined : getContentRect(geometry)
  if (content !== undefined && (content.width <= 0 || content.height <= 0))
    sink.report('page.noContentArea', [...path, 'margins'])
  const usable = geometry !== undefined && content !== undefined && content.width > 0 && content.height > 0

  if (usable) {
    const overflow = findBandsOverflow(value.header, value.footer, content.height)
    if (overflow !== undefined)
      sink.report('page.bandsOverflow', path, overflow)
  }

  let bodyRect: Rect | undefined
  const defaultHeader = readBandHeight(value.header, 'default')
  const defaultFooter = readBandHeight(value.footer, 'default')
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
  elementsOf(value.elements, [...path, 'elements'], bodyPlacement)

  for (const region of ['header', 'footer'] as const) {
    const set = value[region]
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
  const finish = (): ValidationReport => ({ valid: !issues.some(issue => issue.severity === 'error'), issues })

  for (const problem of listJsonProblems(input)) {
    const sink = createIssueSink(issues, scopeOfPath(input, problem.path))
    if (problem.kind === 'circular')
      sink.report('json.circular', problem.path)
    else
      sink.report('json.invalidValue', problem.path, { kind: problem.kind })
  }

  const sink = createIssueSink(issues)
  if (!expectObject(input, [], sink))
    return finish()
  if (input.schemaVersion === undefined) {
    sink.report('schema.missingProperty', ['schemaVersion'], { property: 'schemaVersion' })
    return finish()
  }
  if (!expectNumber(input.schemaVersion, ['schemaVersion'], sink))
    return finish()
  if (input.schemaVersion !== PRINT_SCHEMA_VERSION) {
    sink.report('schema.unsupportedVersion', ['schemaVersion'], {
      version: input.schemaVersion,
      supported: PRINT_SCHEMA_VERSION,
    })
    return finish()
  }

  const context: DocumentContext = {
    registry: options.registry ?? createElementRegistry(),
    issues,
    ids: new Set(),
    trees: new Map(),
  }
  checkFields(input, [
    field('schemaVersion', true, () => {}),
    field('name', false, (item, itemPath) => expectString(item, itemPath, sink)),
    field('pages', true, (item, itemPath) => {
      if (!expectArray(item, itemPath, sink))
        return
      if (item.length === 0)
        sink.report('document.noPages', itemPath)
      item.forEach((page, index) => validatePage(page, [...itemPath, index], context))
    }),
    field('meta', false, (item, itemPath) => expectObject(item, itemPath, sink)),
  ], [], sink)

  return finish()
}
