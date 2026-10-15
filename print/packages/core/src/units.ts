/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 长度单位：毫米、磅（1/72 英寸）、像素（按 dpi 折算）。 */
export type LengthUnit = 'mm' | 'pt' | 'px'

/** 每英寸毫米数。 */
export const MM_PER_INCH = 25.4

/** 每英寸磅数。 */
export const PT_PER_INCH = 72

/** CSS 像素的每英寸像素数。 */
export const CSS_PX_PER_INCH = 96

/** 长度换算选项。 */
export interface LengthConversionOptions {
  /** 像素换算使用的每英寸像素数，默认 96（CSS 像素）。 */
  dpi?: number
}

function unitsPerInch(unit: LengthUnit, dpi: number): number {
  switch (unit) {
    case 'mm':
      return MM_PER_INCH
    case 'pt':
      return PT_PER_INCH
    case 'px':
      return dpi
  }
}

function resolveDpi(options: LengthConversionOptions | undefined): number {
  const dpi = options?.dpi ?? CSS_PX_PER_INCH
  if (!Number.isFinite(dpi) || dpi <= 0)
    throw new RangeError(`dpi must be a positive finite number, received ${dpi}`)
  return dpi
}

/** 在 mm、pt、px 之间换算长度。 */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit, options?: LengthConversionOptions): number {
  if (from === to)
    return value
  const dpi = resolveDpi(options)
  return value / unitsPerInch(from, dpi) * unitsPerInch(to, dpi)
}

/** 毫米转磅。 */
export function mmToPt(mm: number): number {
  return mm / MM_PER_INCH * PT_PER_INCH
}

/** 磅转毫米。 */
export function ptToMm(pt: number): number {
  return pt / PT_PER_INCH * MM_PER_INCH
}

/** 毫米转像素，默认按 CSS 像素（96 dpi）。 */
export function mmToPx(mm: number, dpi: number = CSS_PX_PER_INCH): number {
  return convertLength(mm, 'mm', 'px', { dpi })
}

/** 像素转毫米，默认按 CSS 像素（96 dpi）。 */
export function pxToMm(px: number, dpi: number = CSS_PX_PER_INCH): number {
  return convertLength(px, 'px', 'mm', { dpi })
}
