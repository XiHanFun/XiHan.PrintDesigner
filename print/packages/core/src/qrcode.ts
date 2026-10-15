/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { QrErrorCorrectionLevel } from './schema/options'

/** 二维码编码模式：数字、字母数字、字节（UTF-8）。 */
export type QrEncodingMode = 'numeric' | 'alphanumeric' | 'byte'

/** 二维码最大版本（40）在各编码模式、纠错等级下的容量；数字与字母数字按字符计，字节按 UTF-8 字节计。 */
export const QR_MAX_CAPACITY: Readonly<Record<QrEncodingMode, Readonly<Record<QrErrorCorrectionLevel, number>>>> = {
  numeric: { L: 7089, M: 5596, Q: 3993, H: 3057 },
  alphanumeric: { L: 4296, M: 3391, Q: 2420, H: 1852 },
  byte: { L: 2953, M: 2331, Q: 1663, H: 1273 },
}

const NUMERIC_PATTERN = /^\d*$/
const ALPHANUMERIC_PATTERN = /^[0-9A-Z $%*+\-./:]*$/

/** 计算字符串按 UTF-8 编码的字节数，孤立代理项按替换字符计 3 字节。 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint < 0x80)
      bytes += 1
    else if (codePoint < 0x800)
      bytes += 2
    else if (codePoint < 0x10000)
      bytes += 3
    else
      bytes += 4
  }
  return bytes
}

/** 选出能容纳整段文本的单一编码模式：全为数字用数字模式，全在字母数字字符集内用字母数字模式，否则用字节模式。 */
export function selectQrEncodingMode(text: string): QrEncodingMode {
  if (NUMERIC_PATTERN.test(text))
    return 'numeric'
  if (ALPHANUMERIC_PATTERN.test(text))
    return 'alphanumeric'
  return 'byte'
}

/** 二维码容量测算结果。 */
export interface QrCapacity {
  mode: QrEncodingMode
  /** 按所选模式计的长度：数字与字母数字为字符数，字节为 UTF-8 字节数。 */
  length: number
  /** 所选模式在该纠错等级下的最大容量。 */
  max: number
}

/** 测算文本以单一编码模式写入二维码时的长度与容量上限。 */
export function measureQrCapacity(text: string, level: QrErrorCorrectionLevel): QrCapacity {
  const mode = selectQrEncodingMode(text)
  const length = mode === 'byte' ? utf8ByteLength(text) : text.length
  return { mode, length, max: QR_MAX_CAPACITY[mode][level] }
}
