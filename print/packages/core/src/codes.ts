/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { MatrixCodeFormat, MatrixCodeLevel, Pdf417Level, QrLevel } from '@xihan-ui/headless'
import type { BarCodeFormat } from './schema/options'
import { aztecEncode, barEncode, dmEncode, pdf417Encode, qrEncode } from '@xihan-ui/headless'
import { QR_ERROR_CORRECTION_LEVELS } from './schema/options'

/** 判断内容能否按码制编成一维条码，以 @xihan-ui/headless 的 barEncode 为准。 */
export function canEncodeBarCode(format: BarCodeFormat, value: string): boolean {
  try {
    barEncode(format, value)
    return true
  }
  catch {
    return false
  }
}

/** 纠错级别对码制的适用情况：适用、不适用（取值超出该码制的范围）、被忽略（码制没有级别可选）。 */
export type MatrixCodeLevelFit = 'valid' | 'invalid' | 'ignored'

function isIntegerIn(level: MatrixCodeLevel, min: number, max: number): level is number {
  return typeof level === 'number' && Number.isInteger(level) && level >= min && level <= max
}

/** 判断纠错级别是否适用于码制：qr 为 L / M / Q / H，pdf417 为 0–8，aztec 为 5–95，data-matrix 没有级别。 */
export function fitMatrixCodeLevel(format: MatrixCodeFormat, level: MatrixCodeLevel | undefined): MatrixCodeLevelFit {
  if (level === undefined)
    return 'valid'
  switch (format) {
    case 'qr':
      return (QR_ERROR_CORRECTION_LEVELS as readonly unknown[]).includes(level) ? 'valid' : 'invalid'
    case 'pdf417':
      return isIntegerIn(level, 0, 8) ? 'valid' : 'invalid'
    case 'aztec':
      return isIntegerIn(level, 5, 95) ? 'valid' : 'invalid'
    case 'data-matrix':
      return 'ignored'
  }
}

/** 判断内容能否按码制与纠错级别编成二维码，以 @xihan-ui/headless 的各码制编码器为准；级别须先经 `fitMatrixCodeLevel` 确认适用。 */
export function canEncodeMatrixCode(format: MatrixCodeFormat, value: string, level?: MatrixCodeLevel): boolean {
  try {
    switch (format) {
      case 'qr':
        qrEncode(value, (level as QrLevel | undefined) ?? 'M')
        break
      case 'data-matrix':
        dmEncode(value)
        break
      case 'pdf417':
        pdf417Encode(value, level === undefined ? {} : { level: level as Pdf417Level })
        break
      case 'aztec':
        aztecEncode(value, level === undefined ? {} : { eccPercent: level as number })
        break
    }
    return true
  }
  catch {
    return false
  }
}
