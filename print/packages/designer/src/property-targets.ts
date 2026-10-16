/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 属性面板的编辑对象：按选择取页面设置、选中元素或表格编辑态下的部位，给出拆分后的属性描述、面板读值用的视图、
// 对象从文档根算起的路径，以及把面板上一处修改换成编辑操作的方法。

import type { PrintOperation, PropertyChange, PropertyDescriptor, TableElement } from '@xihan-print/core'
import type { JsonPath, JsonPathSegment, JsonValue } from '@xihan-ui/core/json'
import type { DataField } from '@xihan-ui/designer-kit'
import type { PrintEditor, PrintTablePart } from './editor'
import type { ExpandContext, ExpandedDescriptor } from './property-expand'
import {
  findElement,
  pageProperties,
  tableBodyProperties,
  tableColumnProperties,
  tableFooterCellProperties,
  tableFooterRowProperties,
  tableHeaderProperties,
} from '@xihan-print/core'
import { isJsonPathText, parseJsonPath } from '@xihan-ui/core/json'
import { expandProperties } from './property-expand'

/** 表格部位在属性面板里的对象种类。 */
export const TABLE_PART_KINDS: Readonly<Record<PrintTablePart['kind'], string>> = {
  column: 'table-column',
  header: 'table-header',
  body: 'table-body',
  footerRow: 'table-footer-row',
  footerCell: 'table-footer-cell',
}

/** 复合属性是否原样保留（宿主或设计器给了编辑器），入参是对象种类与描述。 */
export type KeepComposite = (kind: string, descriptor: PropertyDescriptor) => boolean

/** 属性面板的一个编辑对象。 */
export interface PropertySubject {
  /** 对象种类：page、元素种类或表格部位种类。 */
  readonly kind: string
  readonly id: string
  /** 面板读值用的视图：对象本身加上 $view 下的开关等值。 */
  readonly value: JsonValue
  readonly descriptors: readonly ExpandedDescriptor[]
  /** 对象从文档根算起的路径。 */
  readonly path: JsonPath
  /** 把面板上 path 处改成 value（undefined 为清除）换成编辑操作。 */
  readonly write: (path: JsonPath, value: JsonValue | undefined) => PrintOperation
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

/** 表格部位：在表格里的路径前缀与部位对象；部位已不存在时为 undefined。 */
function tablePart(table: TableElement, part: PrintTablePart): { readonly prefix: JsonPathSegment[], readonly value: unknown, readonly descriptors: PropertyDescriptor[] } | undefined {
  switch (part.kind) {
    case 'column': {
      const index = table.columns.findIndex(column => column.id === part.columnId)
      return index < 0 ? undefined : { prefix: ['columns', index], value: table.columns[index], descriptors: tableColumnProperties() }
    }
    case 'header':
      return { prefix: ['header'], value: table.header, descriptors: tableHeaderProperties() }
    case 'body':
      return { prefix: ['body'], value: table.body, descriptors: tableBodyProperties() }
    case 'footerRow': {
      const index = table.footerRows.findIndex(row => row.id === part.rowId)
      return index < 0 ? undefined : { prefix: ['footerRows', index], value: table.footerRows[index], descriptors: tableFooterRowProperties() }
    }
    case 'footerCell': {
      const rowIndex = table.footerRows.findIndex(row => row.id === part.rowId)
      const cells = table.footerRows[rowIndex]?.cells ?? []
      const index = cells.findIndex(cell => cell.columnId === part.columnId)
      return index < 0 ? undefined : { prefix: ['footerRows', rowIndex, 'cells', index], value: cells[index], descriptors: tableFooterCellProperties() }
    }
  }
}

/** 拆开对象的复合属性，组成编辑对象；toOperation 把一组相对对象的修改换成编辑操作。 */
function subject(
  kind: string,
  id: string,
  raw: unknown,
  descriptors: readonly PropertyDescriptor[],
  path: JsonPath,
  keep: KeepComposite,
  context: ExpandContext,
  toOperation: (changes: PropertyChange[]) => PrintOperation,
): PropertySubject {
  const value = asJson(raw)
  const expanded = expandProperties(descriptors, descriptor => keep(kind, descriptor), context)
  return {
    kind,
    id,
    value: expanded.view(value),
    descriptors: expanded.descriptors,
    path,
    write: (at, next) => toOperation(expanded.write(value, at, next)),
  }
}

/**
 * 按当前选择取编辑对象：表格编辑态下是选中的部位，选中元素时是这些元素，什么都没选时是当前页面设置。
 * fields 是可绑定的字段树；表格部位里相对行的字段从表格的数组字段往下列。
 */
export function propertySubjects(editor: PrintEditor, editingTable: string | undefined, keep: KeepComposite, fields?: readonly DataField[]): PropertySubject[] {
  const { document, selection } = editor
  const context: ExpandContext = fields === undefined ? {} : { fields }
  const part = selection.tablePart
  if (editingTable !== undefined && part !== undefined) {
    const found = findElement(document, editingTable)
    if (found?.element.type !== 'table')
      return []
    const table = found.element
    const located = tablePart(table, part)
    if (located === undefined)
      return []
    const rowBase = isJsonPathText(table.dataField) ? parseJsonPath(table.dataField) : undefined
    const partContext = rowBase === undefined ? context : { ...context, rowBase }
    return [subject(TABLE_PART_KINDS[part.kind], `${table.id}:${JSON.stringify(located.prefix)}`, located.value, located.descriptors, [...found.path, ...located.prefix], keep, partContext, changes => ({
      type: 'updateElement',
      id: table.id,
      changes: changes.map(change => ({ ...change, path: [...located.prefix, ...change.path] })),
    }))]
  }
  if (selection.elements.length > 0) {
    const selected = new Set(selection.elements)
    return editor.visibleElements().filter(item => selected.has(item.element.id)).flatMap(({ element }) => {
      const found = findElement(document, element.id)
      const prototype = editor.registry.get(element.type)
      if (found === undefined || prototype === undefined)
        return []
      return [subject(element.type, element.id, element, prototype.properties, found.path, keep, context, changes => ({ type: 'updateElement', id: element.id, changes }))]
    })
  }
  const page = editor.page
  return [subject('page', page.id, page, pageProperties(), ['pages', document.pages.indexOf(page)], keep, context, changes => ({ type: 'updatePage', pageId: page.id, changes }))]
}
