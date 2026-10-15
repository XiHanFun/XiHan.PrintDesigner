/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { BarcodeSymbology } from './schema/options'

/** 条码内容不合法的原因：为空、含不支持的字符、位数不对、校验位错误。 */
export type BarcodeValueProblem = 'empty' | 'invalidCharacters' | 'invalidLength' | 'invalidChecksum'

const CODE39_PATTERN = /^[0-9A-Z\-. $/+%]+$/
const DIGITS_PATTERN = /^\d+$/

/** GTIN 族（EAN-13、EAN-8、UPC-A、ITF-14）不含校验位的数字位数。 */
const GTIN_DATA_LENGTHS: Readonly<Record<'ean13' | 'ean8' | 'upca' | 'itf14', number>> = {
  ean13: 12,
  ean8: 7,
  upca: 11,
  itf14: 13,
}

/** 计算 GTIN 族条码的模 10 校验位：自右向左按 3、1 交替加权。 */
export function computeGtinCheckDigit(digits: string): number {
  let sum = 0
  for (let index = 0; index < digits.length; index++) {
    const digit = Number(digits[digits.length - 1 - index])
    sum += index % 2 === 0 ? digit * 3 : digit
  }
  return (10 - sum % 10) % 10
}

/**
 * 检查条码内容是否符合码制：Code 128 接受 ASCII 0–127；Code 39 接受数字、大写字母与 `-. $/+%`；
 * EAN-13、EAN-8、UPC-A、ITF-14 接受不含或含校验位的数字串，含校验位时核对校验位。合法时返回 undefined。
 */
export function checkBarcodeValue(symbology: BarcodeSymbology, value: string): BarcodeValueProblem | undefined {
  if (value.length === 0)
    return 'empty'
  switch (symbology) {
    case 'code128':
      for (let index = 0; index < value.length; index++) {
        if (value.charCodeAt(index) > 127)
          return 'invalidCharacters'
      }
      return undefined
    case 'code39':
      return CODE39_PATTERN.test(value) ? undefined : 'invalidCharacters'
    default: {
      if (!DIGITS_PATTERN.test(value))
        return 'invalidCharacters'
      const dataLength = GTIN_DATA_LENGTHS[symbology]
      if (value.length === dataLength)
        return undefined
      if (value.length !== dataLength + 1)
        return 'invalidLength'
      const expected = computeGtinCheckDigit(value.slice(0, dataLength))
      return Number(value[dataLength]) === expected ? undefined : 'invalidChecksum'
    }
  }
}
