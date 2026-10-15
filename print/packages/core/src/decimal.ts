/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 十进制数：值为 `sign × coefficient × 10^-scale`。 */
export interface Decimal {
  sign: 1 | -1
  coefficient: bigint
  scale: number
}

const NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function fromText(text: string): Decimal {
  const negative = text.startsWith('-')
  const unsigned = text.replace(/^[+-]/, '').toLowerCase()
  const [mantissa = '', exponent = '0'] = unsigned.split('e')
  const [whole = '', fraction = ''] = mantissa.split('.')
  let digits = `${whole}${fraction}`
  let scale = fraction.length - Number(exponent)
  if (scale < 0) {
    digits += '0'.repeat(-scale)
    scale = 0
  }
  const coefficient = BigInt(digits.length === 0 ? '0' : digits)
  return { sign: negative && coefficient !== 0n ? -1 : 1, coefficient, scale }
}

/** 把有限数字或数字字符串转成十进制数，不能识别时返回 undefined。 */
export function toDecimal(value: unknown): Decimal | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? fromText(String(value)) : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return NUMERIC_PATTERN.test(trimmed) ? fromText(trimmed) : undefined
  }
  return undefined
}

function signed(decimal: Decimal): bigint {
  return decimal.sign === -1 ? -decimal.coefficient : decimal.coefficient
}

function scaled(decimal: Decimal, scale: number): bigint {
  return signed(decimal) * 10n ** BigInt(scale - decimal.scale)
}

/** 精确相加。 */
export function addDecimals(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale)
  const sum = scaled(a, scale) + scaled(b, scale)
  return sum < 0n ? { sign: -1, coefficient: -sum, scale } : { sign: 1, coefficient: sum, scale }
}

/** 比较大小，返回负数、0 或正数。 */
export function compareDecimals(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale)
  const left = scaled(a, scale)
  const right = scaled(b, scale)
  return left === right ? 0 : left < right ? -1 : 1
}

/** 转成定点字符串，小数位数为十进制数自身的 scale。 */
export function decimalToString(decimal: Decimal): string {
  const digits = decimal.coefficient.toString().padStart(decimal.scale + 1, '0')
  const whole = digits.slice(0, digits.length - decimal.scale)
  const fraction = digits.slice(digits.length - decimal.scale)
  const sign = decimal.sign === -1 && decimal.coefficient !== 0n ? '-' : ''
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

/** 转成 JavaScript 数字。 */
export function decimalToNumber(decimal: Decimal): number {
  return Number(decimalToString(decimal))
}

/** 零。 */
export function zeroDecimal(): Decimal {
  return { sign: 1, coefficient: 0n, scale: 0 }
}
