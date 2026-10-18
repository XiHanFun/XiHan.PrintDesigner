/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 与宿主集成：模板的读取与保存、按示例数据生成字段树、列出模板引用的字段、离开前提醒未保存、服务端复核模板。

// #region save
import type { PrintDocument } from '@xihan-print/core'
import type { XhPrintDesigner } from '@xihan-print/designer'
import type { DataField } from '@xihan-ui/designer-kit'
import { collectDocumentFields, validateDocument } from '@xihan-print/core'

export async function openTemplate(designer: XhPrintDesigner, id: string): Promise<void> {
  const response = await fetch(`/api/print-templates/${encodeURIComponent(id)}`)
  designer.schema = await response.json() as PrintDocument

  designer.addEventListener('save', async () => {
    const issues = designer.validate().filter(issue => issue.severity === 'error')
    if (issues.length > 0)
      return
    const saved = await fetch(`/api/print-templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(designer.schema),
    })
    if (saved.ok)
      designer.markSaved()
  })
}
// #endregion save

// #region leave
export function guardUnsaved(designer: XhPrintDesigner): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (designer.dirty)
      event.preventDefault()
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}
// #endregion leave

// #region fields
/** 按一份示例数据生成字段树：对象是 object，数组按第一项生成 list，其余是 value。 */
export function fieldsOf(sample: Record<string, unknown>): DataField[] {
  return Object.entries(sample).map(([name, value]): DataField => {
    if (Array.isArray(value)) {
      const first: unknown = value[0]
      return { name, kind: 'list', children: typeof first === 'object' && first !== null ? fieldsOf(first as Record<string, unknown>) : [] }
    }
    if (typeof value === 'object' && value !== null)
      return { name, kind: 'object', children: fieldsOf(value as Record<string, unknown>) }
    return { name, kind: 'value' }
  })
}
// #endregion fields

// #region collect
/** 列出模板引用的字段，与宿主给的字段树比对，找出数据源里没有的那些路径。 */
export function missingFields(document: PrintDocument, known: readonly DataField[]): string[] {
  const missing: string[] = []
  const walk = (used: readonly DataField[], offered: readonly DataField[] | undefined, prefix: string): void => {
    for (const field of used) {
      const path = prefix === '' ? field.name : `${prefix}.${field.name}`
      const match = offered?.find(item => item.name === field.name)
      if (match === undefined)
        missing.push(path)
      else if (field.children)
        walk(field.children, match.children, path)
    }
  }
  walk(collectDocumentFields(document), known, '')
  return missing
}
// #endregion collect

// #region server
/** 服务端收到模板时复核：只有错误级问题才拒收，返回这些问题的问题码与路径。 */
export function reviewTemplate(body: string): { valid: boolean, errors: string[] } {
  const report = validateDocument(JSON.parse(body) as PrintDocument)
  const errors = report.issues
    .filter(issue => issue.severity === 'error')
    .map(issue => `${issue.code} @ ${issue.path.join('.')}`)
  return { valid: report.valid, errors }
}
// #endregion server
