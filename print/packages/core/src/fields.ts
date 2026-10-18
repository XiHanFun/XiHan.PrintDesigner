/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 列出一份模板引用了哪些数据字段：按元素原型的 fields 钩子收集引用，再合成去重的字段树。

import type { JsonPath } from '@xihan-ui/core/json'
import type { DataField, DataFieldContent } from '@xihan-ui/designer-kit'
import type { PrintCoreExtension } from './extensions'
import type { ElementFieldReference, ElementFieldsContext } from './registry/types'
import type { TextContent } from './schema/common'
import type { PrintDocument } from './schema/document'
import { parseJsonPath } from '@xihan-ui/core/json'
import { parseTextTemplate } from '@xihan-ui/core/template'
import { collectReferences, parse } from '@xihan-ui/expression'
import { createPrintModel } from './extensions'
import { getContainerElements, listContainers } from './traverse'

const NO_REFERENCES: readonly ElementFieldReference[] = []

/** 以 $ 开头的是宿主变量（页码的 $page、汇总的 $values），不是数据字段。 */
function isHostVariable(path: JsonPath): boolean {
  const head = path[0]
  return typeof head === 'string' && head.startsWith('$')
}

function references(paths: readonly JsonPath[]): readonly ElementFieldReference[] {
  return paths.filter(path => path.length > 0 && !isHostVariable(path)).map(path => ({ path }))
}

function fieldReferences(path: string): readonly ElementFieldReference[] {
  try {
    return references([parseJsonPath(path)])
  }
  catch {
    return NO_REFERENCES
  }
}

function templateReferences(source: string): readonly ElementFieldReference[] {
  return references(parseTextTemplate(source).segments.flatMap(segment => (segment.kind === 'path' ? [segment.path] : [])))
}

function expressionReferences(source: string): readonly ElementFieldReference[] {
  const result = parse(source)
  return result.ok ? references(collectReferences(result.ast).map(reference => reference.path)) : NO_REFERENCES
}

function textReferences(content: TextContent): readonly ElementFieldReference[] {
  switch (content.kind) {
    case 'field':
      return fieldReferences(content.field)
    case 'template':
      return templateReferences(content.template)
    case 'expression':
      return expressionReferences(content.expression)
    default:
      return NO_REFERENCES
  }
}

/** 元素原型的 fields 钩子拿到的帮手。 */
export const ELEMENT_FIELDS_CONTEXT: ElementFieldsContext = Object.freeze({
  field: fieldReferences,
  template: templateReferences,
  expression: expressionReferences,
  text: textReferences,
})

/** collectDocumentFields 的选项。 */
export interface CollectDocumentFieldsOptions {
  /** 扩展：扩展元素原型的 fields 钩子报出它引用的字段；扩展被去掉的元素不计。 */
  readonly extensions?: readonly PrintCoreExtension[]
}

interface FieldNode {
  kind: 'value' | 'object' | 'list'
  /** 字段的值当什么用：先出现的文字以外那一种。 */
  content?: DataFieldContent
  readonly children: Map<string, FieldNode>
}

function nodeAt(level: Map<string, FieldNode>, name: string): FieldNode {
  let node = level.get(name)
  if (node === undefined) {
    node = { kind: 'value', children: new Map() }
    level.set(name, node)
  }
  return node
}

/** 把一处引用并进字段树：数字下标与 rows 都把前一段记成列表，之后的段落在列表一行里。 */
function addReference(level: Map<string, FieldNode>, reference: ElementFieldReference): void {
  let current = level
  let node: FieldNode | undefined
  for (const segment of reference.path) {
    if (typeof segment === 'number') {
      if (node !== undefined)
        node.kind = 'list'
      continue
    }
    if (node !== undefined && node.kind === 'value')
      node.kind = 'object'
    node = nodeAt(current, segment)
    current = node.children
  }
  if (node !== undefined && node.content === undefined && reference.content !== undefined && reference.content !== 'text')
    node.content = reference.content
  if (node === undefined || reference.rows === undefined)
    return
  node.kind = 'list'
  for (const row of reference.rows) {
    if (!isHostVariable(row.path))
      addReference(node.children, row)
  }
}

function toDataFields(level: Map<string, FieldNode>): DataField[] {
  return [...level].map(([name, node]): DataField => (node.kind === 'value'
    ? { name, kind: 'value', ...(node.content === undefined ? {} : { content: node.content }) }
    : { name, kind: node.kind, children: toDataFields(node.children) }))
}

/**
 * 列出一份模板引用了哪些数据字段，合成去重的字段树，形状同设计器的 fields。
 *
 * 字段来自各元素原型的 fields 钩子（文本、长文本、条码、二维码的内容，图片与富文本的字段来源，表格的 dataField、
 * 各列与表尾），以及页面水印里的 `{{path}}`。表格的 dataField 记成 list，列与汇总里的行内字段挂在它的 children 下；
 * 路径里的数字下标同样把前一段记成 list。表达式里的路径经 @xihan-ui/expression 的语法取，模板串经 @xihan-ui/core/template；
 * 以 $ 开头的宿主变量不算字段。字段按在模板里首次出现的顺序排；只知道路径，所以不带 label 与 type。
 *
 * value 字段带上 content：被图片的字段来源引用记 image；被条码、二维码的内容直接取用记 barcode、qrcode，
 * 表格里单元格类型为图片、条码、二维码的列同样；模板串与表达式里的字段只是内容的一部分，不记。
 * 一个字段被几种元素引用时取文字以外的那一种；文字以外的种类有冲突时取在模板里先出现的那一种。
 * 扩展元素的 fields 钩子在引用上给 content 即一并汇总。
 */
export function collectDocumentFields(document: PrintDocument, options: CollectDocumentFieldsOptions = {}): DataField[] {
  const elements = createPrintModel(options.extensions).elements
  const root = new Map<string, FieldNode>()
  const add = (list: readonly ElementFieldReference[]): void => {
    for (const reference of list) {
      if (!isHostVariable(reference.path))
        addReference(root, reference)
    }
  }
  for (const page of document.pages) {
    if (page.watermark !== undefined)
      add(templateReferences(page.watermark.text))
    for (const container of listContainers(page)) {
      for (const element of getContainerElements(page, container) ?? []) {
        const prototype = elements.get(element.type) as { fields?: (element: unknown, context: ElementFieldsContext) => readonly ElementFieldReference[] } | undefined
        add(prototype?.fields?.(element, ELEMENT_FIELDS_CONTEXT) ?? NO_REFERENCES)
      }
    }
  }
  return toDataFields(root)
}
