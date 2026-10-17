/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PaginationDiagnostic, PaginationResult } from '@xihan-print/core'
import { paginate } from '@xihan-print/core'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { describe, expect, it } from 'vitest'
import { mergePaginationResults, renderSheets } from '../src'
import { createFakeMeasurer, documentOf, pageOf, textElement } from './fixtures'

function layout(...ids: string[]): PaginationResult {
  return paginate(documentOf(...ids.map(id => pageOf(id, [textElement(`${id}-title`, id)]))), {}, { measurer: createFakeMeasurer(), expressionEngine: createExpressionEngine(), formatter: formatValue })
}

const overflow: PaginationDiagnostic = { code: 'text.overflow', path: ['pages', 0, 'elements', 0], severity: 'warning', target: { kind: 'element', id: 'a-title' } }

describe('mergePaginationResults', () => {
  it('输出页按顺序接上，每份保留自己的页码与总页数；诊断记来自第几份，parts 给出每份占的输出页', () => {
    const first = { ...layout('a', 'b'), diagnostics: [overflow] }
    const second = layout('c')
    const merged = mergePaginationResults([first, second])
    expect(merged.sheets.map(sheet => [sheet.pageId, sheet.pageNumber, sheet.totalPages])).toEqual([['a', 1, 2], ['b', 2, 2], ['c', 1, 1]])
    expect(merged.sheets[2]).toBe(second.sheets[0])
    expect(merged.parts).toEqual([{ start: 0, count: 2 }, { start: 2, count: 1 }])
    expect(merged.diagnostics).toEqual([{ ...overflow, part: 0 }])
    expect(mergePaginationResults([])).toEqual({ sheets: [], diagnostics: [], parts: [] })

    const container = document.createElement('div')
    expect(renderSheets(merged, container).map(sheet => sheet.dataset.pageNumber)).toEqual(['1', '2', '1'])
  })
})
