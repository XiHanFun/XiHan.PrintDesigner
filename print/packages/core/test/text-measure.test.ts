/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { MeasureFont } from '../src/layout/text-measure'
import type { MeasureCall } from './layout-helpers'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_FAMILY } from '../src'
import { layoutTextLines } from '../src/layout/text-measure'
import { createFakeMeasurer } from './layout-helpers'

const FONT: MeasureFont = { fontSize: 10, bold: false, italic: false, letterSpacing: 0 }

describe('layoutTextLines', () => {
  it('空串没有行，也不去量', () => {
    const calls: MeasureCall[] = []
    expect(layoutTextLines(createFakeMeasurer(calls), '', FONT, 4, 100, true)).toEqual({ lines: [], width: 0 })
    expect(calls).toEqual([])
  })

  it('折行按可用宽度，10pt 每字 2 mm', () => {
    const { lines, width } = layoutTextLines(createFakeMeasurer(), '字'.repeat(7), FONT, 4, 10, true)
    expect(lines).toEqual(['字'.repeat(5), '字'.repeat(2)])
    expect(width).toBeCloseTo(10, 6)
  })

  it('不折行时只在换行符处断行，行内空格保留', () => {
    const { lines, width } = layoutTextLines(createFakeMeasurer(), ' ab\r\ncdef', FONT, 4, 1, false)
    expect(lines).toEqual([' ab', 'cdef'])
    expect(width).toBeCloseTo(8, 6)
  })

  it('字间距按 pt 计入每个字符之后', () => {
    const { width } = layoutTextLines(createFakeMeasurer(), 'abc', { ...FONT, letterSpacing: 1 }, 4, 100, false)
    expect(width).toBeCloseTo(6 + 3 * 25.4 / 72, 6)
  })

  it('字号、行高换成 CSS 像素，粗体、斜体与字体族一并交给度量器', () => {
    const calls: MeasureCall[] = []
    layoutTextLines(createFakeMeasurer(calls), 'a', { ...FONT, bold: true, italic: true, fontFamily: 'SimSun' }, 25.4, 100, false)
    expect(calls[0]!.font).toEqual({ family: 'SimSun', size: 40 / 3, weight: 700, lineHeight: 96, style: 'italic' })
    layoutTextLines(createFakeMeasurer(calls), 'a', FONT, 25.4, 100, false)
    expect(calls[1]!.font.family).toBe(DEFAULT_FONT_FAMILY)
  })
})
