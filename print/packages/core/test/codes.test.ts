/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { MATRIX_CODE_FORMATS } from '@xihan-ui/headless'
import { describe, expect, it } from 'vitest'
import { isSafeImageUrl, isValidColor, QR_ERROR_CORRECTION_LEVELS } from '../src'
import { canEncodeBarCode, canEncodeMatrixCode, fitMatrixCodeLevel } from '../src/codes'

describe('纠错等级取值', () => {
  it('与 @xihan-ui/headless 的 QrLevel 逐一对应', () => {
    expect(QR_ERROR_CORRECTION_LEVELS).toEqual(['L', 'M', 'Q', 'H'])
  })
})

describe('一维条码', () => {
  it.each([
    ['ean13', '4006381333931', true],
    ['ean13', '400638133393', true],
    ['ean13', '4006381333932', false],
    ['ean8', '963850', false],
    ['upce', '01234565', true],
    ['code39', 'ABC-123', true],
    ['code39', 'abc', false],
    ['code128', 'Ab-12', true],
    ['code128', '中文', false],
  ] as const)('%s「%s」能否编码：%s', (format, value, expected) => {
    expect(canEncodeBarCode(format, value)).toBe(expected)
  })
})

describe('二维码', () => {
  it('纠错级别按码制判断', () => {
    expect(fitMatrixCodeLevel('qr', undefined)).toBe('valid')
    expect(fitMatrixCodeLevel('qr', 'H')).toBe('valid')
    expect(fitMatrixCodeLevel('qr', 3)).toBe('invalid')
    expect(fitMatrixCodeLevel('pdf417', 8)).toBe('valid')
    expect(fitMatrixCodeLevel('pdf417', 9)).toBe('invalid')
    expect(fitMatrixCodeLevel('pdf417', 'M')).toBe('invalid')
    expect(fitMatrixCodeLevel('aztec', 23)).toBe('valid')
    expect(fitMatrixCodeLevel('aztec', 4)).toBe('invalid')
    expect(fitMatrixCodeLevel('aztec', 50.5)).toBe('invalid')
    expect(fitMatrixCodeLevel('data-matrix', 'M')).toBe('ignored')
    expect(fitMatrixCodeLevel('data-matrix', undefined)).toBe('valid')
  })

  it('按码制与纠错级别判断内容能否编码', () => {
    for (const format of MATRIX_CODE_FORMATS)
      expect(canEncodeMatrixCode(format, '1234567890'), format).toBe(true)
    expect(canEncodeMatrixCode('qr', '中'.repeat(425), 'H')).toBe(false)
    expect(canEncodeMatrixCode('qr', '中'.repeat(425), 'L')).toBe(true)
    expect(canEncodeMatrixCode('pdf417', 'ABC', 2)).toBe(true)
    expect(canEncodeMatrixCode('aztec', 'ABC', 50)).toBe(true)
  })
})

describe('颜色与图片地址', () => {
  it('颜色只接受带 # 的十六进制与 transparent', () => {
    for (const color of ['#fff', '#ffff', '#FFFFFF', '#00000080', 'transparent'])
      expect(isValidColor(color), color).toBe(true)
    for (const color of ['fff', ' #fff', '#fff ', '#fffff', 'red', 'rgb(0,0,0)', '#gggggg'])
      expect(isValidColor(color), color).toBe(false)
  })

  it('图片地址拒绝脚本与非图片 data 地址', () => {
    expect(isSafeImageUrl('img/a.png')).toBe(true)
    expect(isSafeImageUrl('//cdn.example.com/a.png')).toBe(true)
    expect(isSafeImageUrl('DATA:IMAGE/SVG+XML,<svg/>')).toBe(true)
    expect(isSafeImageUrl('\u0000javascript:alert(1)')).toBe(false)
    expect(isSafeImageUrl('data:,hello')).toBe(false)
  })
})
