/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { describe, expect, it } from 'vitest'
import {
  checkBarcodeValue,
  computeGtinCheckDigit,
  isSafeImageUrl,
  isValidColor,
  measureQrCapacity,
  QR_MAX_CAPACITY,
  selectQrEncodingMode,
  utf8ByteLength,
} from '../src'

describe('条码校验位', () => {
  it.each([
    ['400638133393', 1],
    ['03600029145', 2],
    ['9638507', 4],
    ['1001234567890', 2],
  ])('%s 的校验位为 %i', (digits, expected) => {
    expect(computeGtinCheckDigit(digits)).toBe(expected)
  })
})

describe('条码内容', () => {
  it('码制 Code 128 接受 ASCII 全集', () => {
    expect(checkBarcodeValue('code128', 'Ab-12 \t~')).toBeUndefined()
    expect(checkBarcodeValue('code128', 'é')).toBe('invalidCharacters')
  })

  it('码制 Code 39 只接受数字、大写字母与少量符号', () => {
    expect(checkBarcodeValue('code39', 'ABC-123 $/+%.')).toBeUndefined()
    expect(checkBarcodeValue('code39', 'abc')).toBe('invalidCharacters')
    expect(checkBarcodeValue('code39', 'A*B')).toBe('invalidCharacters')
  })

  it.each([
    ['ean13', '400638133393', '4006381333931', '4006381333930', '40063813339'],
    ['ean8', '9638507', '96385074', '96385075', '963850'],
    ['upca', '03600029145', '036000291452', '036000291453', '0360002914'],
    ['itf14', '1001234567890', '10012345678902', '10012345678903', '100123456789'],
  ] as const)('%s 接受不含或含正确校验位的数字串', (symbology, data, full, wrongCheck, short) => {
    expect(checkBarcodeValue(symbology, data)).toBeUndefined()
    expect(checkBarcodeValue(symbology, full)).toBeUndefined()
    expect(checkBarcodeValue(symbology, wrongCheck)).toBe('invalidChecksum')
    expect(checkBarcodeValue(symbology, short)).toBe('invalidLength')
    expect(checkBarcodeValue(symbology, `${data}00`)).toBe('invalidLength')
    expect(checkBarcodeValue(symbology, `${data.slice(1)}x`)).toBe('invalidCharacters')
  })

  it('空内容对所有码制都不合法', () => {
    expect(checkBarcodeValue('code128', '')).toBe('empty')
    expect(checkBarcodeValue('itf14', '')).toBe('empty')
  })
})

describe('二维码容量', () => {
  it('按 UTF-8 计算字节数', () => {
    expect(utf8ByteLength('a')).toBe(1)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('中')).toBe(3)
    expect(utf8ByteLength('😀')).toBe(4)
    expect(utf8ByteLength('\uD800')).toBe(3)
    expect(utf8ByteLength('')).toBe(0)
  })

  it('选出能容纳整段文本的编码模式', () => {
    expect(selectQrEncodingMode('0123')).toBe('numeric')
    expect(selectQrEncodingMode('')).toBe('numeric')
    expect(selectQrEncodingMode('HTTP://A.COM/X')).toBe('alphanumeric')
    expect(selectQrEncodingMode('https://a.com')).toBe('byte')
  })

  it('容量上限随模式与纠错等级变化', () => {
    expect(measureQrCapacity('1'.repeat(7089), 'L')).toEqual({ mode: 'numeric', length: 7089, max: 7089 })
    expect(measureQrCapacity('A'.repeat(10), 'H')).toEqual({ mode: 'alphanumeric', length: 10, max: 1852 })
    expect(measureQrCapacity('中文', 'M')).toEqual({ mode: 'byte', length: 6, max: QR_MAX_CAPACITY.byte.M })
  })
})

describe('颜色与图片地址', () => {
  it('颜色只接受十六进制与 transparent', () => {
    for (const color of ['#fff', '#FFFFFF', '#00000080', 'transparent'])
      expect(isValidColor(color), color).toBe(true)
    for (const color of ['fff', '#ffff', 'red', 'rgb(0,0,0)', '#gggggg'])
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
