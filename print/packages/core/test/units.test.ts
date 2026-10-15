/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import { convertLength, mmToPt, mmToPx, ptToMm, pxToMm } from '../src'

describe('长度换算', () => {
  it('一英寸在三种单位间互换', () => {
    expect(convertLength(25.4, 'mm', 'pt')).toBeCloseTo(72, 10)
    expect(convertLength(25.4, 'mm', 'px')).toBeCloseTo(96, 10)
    expect(convertLength(72, 'pt', 'px')).toBeCloseTo(96, 10)
    expect(convertLength(96, 'px', 'mm')).toBeCloseTo(25.4, 10)
  })

  it('同单位原样返回', () => {
    expect(convertLength(12.3, 'mm', 'mm')).toBe(12.3)
  })

  it('像素按给定 dpi 换算', () => {
    expect(convertLength(25.4, 'mm', 'px', { dpi: 300 })).toBeCloseTo(300, 10)
    expect(mmToPx(25.4, 203)).toBeCloseTo(203, 10)
    expect(pxToMm(203, 203)).toBeCloseTo(25.4, 10)
  })

  it('快捷函数与通用换算一致且可往返', () => {
    expect(mmToPt(10)).toBeCloseTo(convertLength(10, 'mm', 'pt'), 12)
    expect(ptToMm(mmToPt(37.5))).toBeCloseTo(37.5, 12)
    expect(pxToMm(mmToPx(210))).toBeCloseTo(210, 12)
  })

  it('dpi 非正或非有限时抛出 RangeError', () => {
    expect(() => convertLength(1, 'mm', 'px', { dpi: 0 })).toThrow(RangeError)
    expect(() => convertLength(1, 'px', 'mm', { dpi: Number.NaN })).toThrow(RangeError)
    expect(() => mmToPx(1, -96)).toThrow(RangeError)
  })
})
