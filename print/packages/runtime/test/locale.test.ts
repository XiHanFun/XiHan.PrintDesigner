/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { RichTextIssueCode } from '@xihan-ui/core/rich-text'
import type { PrintDesignerTranslations, PrintPreviewTranslations } from '../src'
import { PAGINATION_DIAGNOSTIC_SEVERITIES, VALIDATION_ISSUE_SEVERITIES } from '@xihan-print/core'
import { designerShellEnUS } from '@xihan-ui/designer-shell/locale'
import * as uiLocales from '@xihan-ui/web-components/locale'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_PRINT_DESIGNER_TRANSLATIONS } from '../src'
import * as locales from '../src/locale'
import { DEFAULT_PRINT_PREVIEW_TRANSLATIONS } from '../src/translations'

type Bucket = Record<string, unknown>

const packs = Object.entries(locales).map(([name, pack]) => [name, pack.translations as unknown as Record<string, Bucket>] as const)
const english = locales.printEnUS.translations as unknown as Record<string, Bucket>

function designerOf(translations: Record<string, Bucket>): PrintDesignerTranslations {
  return translations['xh-print-designer'] as unknown as PrintDesignerTranslations
}

function previewOf(translations: Record<string, Bucket>): PrintPreviewTranslations {
  return translations['xh-print-preview'] as unknown as PrintPreviewTranslations
}

const BUILTIN_ISSUE_CODES = [...new Set([...Object.keys(VALIDATION_ISSUE_SEVERITIES), ...Object.keys(PAGINATION_DIAGNOSTIC_SEVERITIES)])]

const RICH_TEXT_ISSUE_CODES = ['invalid-document', 'unknown-block', 'unknown-inline', 'unknown-mark', 'unknown-key', 'missing', 'invalid-value', 'unsafe-link', 'conflicting-marks', 'list-too-deep'] as const satisfies readonly RichTextIssueCode[]

describe('各语言的语言包', () => {
  it('语言与 UI 的内建语言包一一对应，导出名是 print 加 UI 的语言包名', () => {
    const expected = Object.keys(uiLocales).map(name => `print${name[0]!.toUpperCase()}${name.slice(1)}`).sort()
    expect(packs.map(([name]) => name).sort()).toEqual(expected)
  })

  it('英文包与预览、设计器的缺省文案相同，并带上 designer-shell 的英文', () => {
    expect(previewOf(english)).toEqual(DEFAULT_PRINT_PREVIEW_TRANSLATIONS)
    const designer = designerOf(english) as unknown as Bucket
    expect(Object.keys(designer).sort()).toEqual(Object.keys(DEFAULT_PRINT_DESIGNER_TRANSLATIONS).sort())
    for (const [key, value] of Object.entries(DEFAULT_PRINT_DESIGNER_TRANSLATIONS)) {
      if (key !== 'issue')
        expect(designer[key], key).toEqual(value)
    }
    for (const [tag, bucket] of Object.entries(designerShellEnUS.translations ?? {}))
      expect(english[tag], tag).toEqual(bucket)
  })

  it.each(packs)('%s 的零件、键与对照表和英文一致，文案都不空', (_name, translations) => {
    expect(Object.keys(translations).sort()).toEqual(Object.keys(english).sort())
    for (const [tag, bucket] of Object.entries(translations)) {
      const reference = english[tag]!
      expect(Object.keys(bucket).sort(), tag).toEqual(Object.keys(reference).sort())
      for (const [key, value] of Object.entries(bucket)) {
        expect(typeof value, `${tag}.${key}`).toBe(typeof reference[key])
        if (typeof value === 'string')
          expect(value.trim(), `${tag}.${key}`).not.toBe('')
        if (typeof value === 'object' && value !== null) {
          expect(Object.keys(value).sort(), `${tag}.${key}`).toEqual(Object.keys(reference[key] as Bucket).sort())
          for (const [entry, text] of Object.entries(value)) {
            if (!(key === 'units' && entry === 'count'))
              expect(String(text).trim(), `${tag}.${key}.${entry}`).not.toBe('')
          }
        }
      }
    }
  })

  it.each(packs)('%s 的带参文案把入参写进去', (_name, translations) => {
    const preview = previewOf(translations)
    expect(preview.sheetLabel(2, 5)).toMatch(/2[\s\S]*5|5[\s\S]*2/)
    const t = designerOf(translations)
    expect(t.pageTitle(7)).toContain('7')
    expect(t.bandVariant('header')).not.toBe(t.bandVariant('footer'))
    expect(t.resizeBand('header')).not.toBe(t.resizeBand('footer'))
    expect(t.resizeColumn('Qty')).toContain('Qty')
    expect(t.newColumnTitle(4)).toContain('4')
    expect(t.elementLabel('Kind', 'n1')).toMatch(/Kind[\s\S]*n1/)
    expect(t.propertyPart('Outer', 'Inner')).toMatch(/Outer[\s\S]*Inner/)
    expect(t.selectedCount(3)).toContain('3')
    expect(t.selectedCount(21)).toContain('21')
    expect(t.pageNumberSample('S-1')).toContain('S-1')
    expect(t.valueMapCell(2, 'Col')).toMatch(/2[\s\S]*Col|Col[\s\S]*2/)
  })
})

describe('问题说明', () => {
  it('富文本问题码列全了', () => {
    expectTypeOf<Exclude<RichTextIssueCode, (typeof RICH_TEXT_ISSUE_CODES)[number]>>().toEqualTypeOf<never>()
  })

  it.each(packs)('%s 给每个内建问题码与富文本问题码写了自己的说明', (_name, translations) => {
    const t = designerOf(translations)
    for (const code of BUILTIN_ISSUE_CODES) {
      const text = t.issue({ code, path: [] })
      expect(text.trim(), code).not.toBe('')
      expect(text, code).not.toBe(code)
    }
    const richText = RICH_TEXT_ISSUE_CODES.map(code => t.issue({ code: 'richText.invalidDocument', path: [], params: { code } }))
    expect(new Set(richText).size).toBe(RICH_TEXT_ISSUE_CODES.length)
  })

  it.each(packs)('%s 的说明带上问题参数，认不出的码原样给出', (_name, translations) => {
    const t = designerOf(translations)
    expect(t.issue({ code: 'field.invalidPath', path: [], params: { field: 'items[0].qty' } })).toContain('items[0].qty')
    expect(t.issue({ code: 'out-of-range', path: [], params: { min: 1, max: 24 } })).toMatch(/1[\s\S]*24/)
    expect(t.issue({ code: 'element.tooSmall', path: [], params: { minWidth: 5.04, minHeight: 3 } })).toMatch(/5[\s\S]*3/)
    expect(t.issue({ code: 'table.columnWidthMismatch', path: [], params: { columnsWidth: 120, width: 180 } })).toMatch(/120[\s\S]*180|180[\s\S]*120/)
    expect(t.issue({ code: 'table.rowOverflow', path: [], params: { dataIndex: 4 } })).toContain('5')
    expect(t.issue({ code: 'richText.droppedContent', path: [], params: { field: 'notice', names: ['script', 'img'] } })).toMatch(/notice[\s\S]*script|script[\s\S]*notice/)
    expect(t.issue({ code: 'seal.noImage', path: [] })).toBe('seal.noImage')
    expect(t.issue({ code: 'toString', path: [] })).toBe('toString')
  })

  it('中文与英文按码给出说明', () => {
    const zh = designerOf(locales.printZhCN.translations as unknown as Record<string, Bucket>)
    expect(zh.issue({ code: 'out-of-range', path: [], params: { min: 0, max: 360 } })).toBe('应不小于 0、不大于 360')
    expect(zh.issue({ code: 'richText.invalidDocument', path: [], params: { code: 'list-too-deep' } })).toBe('富文本的列表嵌套超过三层')
    expect(DEFAULT_PRINT_DESIGNER_TRANSLATIONS.issue({ code: 'element.outsideBand', path: [], params: { region: 'footer' } })).toBe('Extends beyond the footer')
    expect(DEFAULT_PRINT_DESIGNER_TRANSLATIONS.issues).toBe('Problems')
  })
})
