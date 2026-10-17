/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 存量模板里的 HTML 元素迁移成富文本：写死的 HTML 解析成文档，绑定字段改成打印时再解析，
// 其余写法记进报告人工改写；全程不执行模板里的代码。

// #region example
import type { RichTextContent } from '@xihan-print/core'
import type { RichTextDrop } from '@xihan-ui/core/rich-text'
import { parseRichTextHtml } from '@xihan-ui/core/rich-text'

/** 旧元素里与迁移有关的三种写法。 */
export type LegacyHtmlContent
  = | { kind: 'html', html: string } // 写死的 HTML，或从只返回一个字符串字面量的函数里静态取出的 HTML
    | { kind: 'field', field: string } // 绑定字段，字段值是 HTML
    | { kind: 'code', source: string } // 其余的函数源码

/** 迁移报告里的一条：一个元素一条。 */
export interface RichTextMigrationEntry {
  /** 原元素的标识。 */
  elementId: string
  /** static：已换成写死的文档；field：改成绑定字段，打印时再解析；manual：要人工改写。 */
  outcome: 'static' | 'field' | 'manual'
  /** 解析时丢掉的东西，即 parseRichTextHtml 的 dropped；绑定字段与人工改写的为空。 */
  dropped: readonly RichTextDrop[]
  /** 人工改写时参考的原始内容。 */
  source?: string
}

export function migrateHtmlContent(elementId: string, legacy: LegacyHtmlContent): { content?: RichTextContent, entry: RichTextMigrationEntry } {
  switch (legacy.kind) {
    case 'html': {
      const { document, dropped } = parseRichTextHtml(legacy.html)
      return { content: { kind: 'static', document }, entry: { elementId, outcome: 'static', dropped } }
    }
    case 'field':
      return { content: { kind: 'field', field: legacy.field, source: 'html' }, entry: { elementId, outcome: 'field', dropped: [] } }
    case 'code':
      return { entry: { elementId, outcome: 'manual', dropped: [], source: legacy.source } }
  }
}

/** 要人工复核的条目：要人工改写的，以及丢了标签或连同内容去掉了东西（表格、图片、脚本等）的。 */
export function needsReview(entry: RichTextMigrationEntry): boolean {
  return entry.outcome === 'manual' || entry.dropped.some(drop => drop.kind === 'element' || drop.kind === 'content')
}
// #endregion example
