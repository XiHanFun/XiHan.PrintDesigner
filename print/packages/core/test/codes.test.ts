/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { checkBarCodeValue } from '@xihan-ui/headless'
import { describe, expect, it } from 'vitest'
import { isValidColor } from '../src'
import { barCodeIssueParams, checkMatrixCodeContent, matrixCodeIssueParams } from '../src/codes'

describe('条码问题参数', () => {
  it.each([
    ['ean13', '4006381333932', { format: 'ean13', reason: 'invalid-check-digit', expected: 1, actual: 2 }],
    ['ean8', '963850', { format: 'ean8', reason: 'invalid-length', length: 6, lengths: ['7', '8'] }],
    ['code39', 'abc', { format: 'code39', reason: 'invalid-character', character: 'a' }],
    ['upce', '2123456', { format: 'upce', reason: 'invalid-number-system', actual: '2' }],
  ] as const)('%s「%s」', (format, value, params) => {
    const issue = checkBarCodeValue(format, value)
    expect(issue).toBeDefined()
    expect(barCodeIssueParams(format, issue!)).toEqual(params)
  })

  it('不认识的码制只带码制与问题码', () => {
    expect(barCodeIssueParams('ean13', { code: 'unknown-format' })).toEqual({ format: 'ean13', reason: 'unknown-format' })
  })
})

describe('二维码内容', () => {
  it('纠错级别适用时按级别检查', () => {
    expect(checkMatrixCodeContent('qr', '中'.repeat(425), 'H')).toEqual({ code: 'capacity-exceeded' })
    expect(checkMatrixCodeContent('qr', '中'.repeat(425), 'L')).toBeUndefined()
  })

  it('纠错级别不适用或被忽略时按没给级别检查', () => {
    expect(checkMatrixCodeContent('pdf417', 'ABC', 'H')).toBeUndefined()
    expect(checkMatrixCodeContent('data-matrix', 'ABC', 'M')).toBeUndefined()
  })

  it('问题参数带码制与问题码', () => {
    expect(matrixCodeIssueParams('qr', { code: 'capacity-exceeded' })).toEqual({ format: 'qr', reason: 'capacity-exceeded' })
  })
})

describe('颜色', () => {
  it('颜色只接受带 # 的十六进制与 transparent', () => {
    for (const color of ['#fff', '#ffff', '#FFFFFF', '#00000080', 'transparent'])
      expect(isValidColor(color), color).toBe(true)
    for (const color of ['fff', ' #fff', '#fff ', '#fffff', 'red', 'rgb(0,0,0)', '#gggggg'])
      expect(isValidColor(color), color).toBe(false)
  })
})
