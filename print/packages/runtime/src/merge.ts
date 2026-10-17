/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 把几份分页结果接成一份：批量打印时一次交给 renderSheets、printSheets 或本地打印客户端。

import type { PaginationDiagnostic, PaginationResult } from '@xihan-print/core'

/** 合并结果里的一条诊断：原样带着，另记它来自第几份结果。 */
export type MergedPaginationDiagnostic = PaginationDiagnostic & {
  /** 来自第几份结果，从 0 开始；path 与 target 相对那一份的文档。 */
  readonly part: number
}

/** 一份结果在合并结果里占的输出页。 */
export interface MergedPaginationPart {
  /** 第一张输出页在合并结果里的下标。 */
  readonly start: number
  readonly count: number
}

/** 合并后的分页结果。 */
export interface MergedPaginationResult extends PaginationResult {
  diagnostics: MergedPaginationDiagnostic[]
  /** 每份结果占的输出页，顺序同传入的结果。 */
  readonly parts: readonly MergedPaginationPart[]
}

/**
 * 按顺序把几份分页结果接成一份。输出页原样接上，每份保留自己的页码与总页数（第二份仍从第 1 页起）；
 * 诊断按顺序接上，各记来自第几份。输出页与传入的是同一份对象，不复制。
 */
export function mergePaginationResults(results: readonly PaginationResult[]): MergedPaginationResult {
  const sheets: PaginationResult['sheets'] = []
  const diagnostics: MergedPaginationDiagnostic[] = []
  const parts: MergedPaginationPart[] = []
  results.forEach((result, part) => {
    parts.push({ start: sheets.length, count: result.sheets.length })
    sheets.push(...result.sheets)
    for (const diagnostic of result.diagnostics)
      diagnostics.push({ ...diagnostic, part })
  })
  return { sheets, diagnostics, parts }
}
