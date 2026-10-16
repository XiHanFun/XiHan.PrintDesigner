/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 属性面板的编辑对象：按选择取页面设置、选中元素或表格编辑态下的部位，给出属性描述、对象从文档根算起的路径，
// 以及把对象上一处属性的修改换成编辑操作的方法。

import type { PrintOperation, PropertyDescriptor, TableElement } from '@xihan-print/core'
import type { JsonPath, JsonPathSegment, JsonValue } from '@xihan-ui/core/json'
import type { PrintEditor, PrintTablePart } from './editor'
import {
  findElement,
  pageProperties,
  tableBodyProperties,
  tableColumnProperties,
  tableFooterCellProperties,
  tableFooterRowProperties,
  tableHeaderProperties,
} from '@xihan-print/core'

/** 表格部位在属性面板里的对象种类。 */
export const TABLE_PART_KINDS: Readonly<Record<PrintTablePart['kind'], string>> = {
  column: 'table-column',
  header: 'table-header',
  body: 'table-body',
  footerRow: 'table-footer-row',
  footerCell: 'table-footer-cell',
}

/** 属性面板的一个编辑对象。 */
export interface PropertySubject {
  /** 对象种类：page、元素种类或表格部位种类。 */
  readonly kind: string
  readonly id: string
  readonly value: JsonValue
  readonly descriptors: readonly PropertyDescriptor[]
  /** 对象从文档根算起的路径。 */
  readonly path: JsonPath
  /** 把对象上 path 处的属性改成 value（undefined 为删除）的编辑操作。 */
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

/** 按当前选择取编辑对象：表格编辑态下是选中的部位，选中元素时是这些元素，什么都没选时是当前页面设置。 */
export function propertySubjects(editor: PrintEditor, editingTable: string | undefined): PropertySubject[] {
  const { document, selection } = editor
  const part = selection.tablePart
  if (editingTable !== undefined && part !== undefined) {
    const found = findElement(document, editingTable)
    if (found?.element.type !== 'table')
      return []
    const table = found.element
    const located = tablePart(table, part)
    if (located === undefined)
      return []
    const kind = TABLE_PART_KINDS[part.kind]
    return [{
      kind,
      id: `${table.id}:${JSON.stringify(located.prefix)}`,
      value: asJson(located.value),
      descriptors: located.descriptors,
      path: [...found.path, ...located.prefix],
      write: (path, value) => ({ type: 'updateElement', id: table.id, changes: [{ path: [...located.prefix, ...path], value }] }),
    }]
  }
  if (selection.elements.length > 0) {
    const selected = new Set(selection.elements)
    return editor.visibleElements().filter(item => selected.has(item.element.id)).flatMap(({ element }) => {
      const found = findElement(document, element.id)
      const prototype = editor.registry.get(element.type)
      if (found === undefined || prototype === undefined)
        return []
      return [{
        kind: element.type,
        id: element.id,
        value: asJson(element),
        descriptors: prototype.properties,
        path: found.path,
        write: (path: JsonPath, value: JsonValue | undefined): PrintOperation => ({ type: 'updateElement', id: element.id, changes: [{ path, value }] }),
      }]
    })
  }
  const page = editor.page
  return [{
    kind: 'page',
    id: page.id,
    value: asJson(page),
    descriptors: pageProperties(),
    path: ['pages', document.pages.indexOf(page)],
    write: (path, value) => ({ type: 'updatePage', pageId: page.id, changes: [{ path, value }] }),
  }]
}
