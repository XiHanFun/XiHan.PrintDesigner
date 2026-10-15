/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 宽高尺寸，单位 mm。 */
export interface Size {
  width: number
  height: number
}

/** 内置纸张预设名。 */
export type PaperPresetName = 'A3' | 'A4' | 'A5' | 'A6' | 'B4' | 'B5' | 'Letter' | 'Legal'

/** 内置纸张预设的纵向尺寸，单位 mm。 */
export const PAPER_PRESETS: Readonly<Record<PaperPresetName, Readonly<Size>>> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
}

/** 内置纸张预设名列表，按 `PAPER_PRESETS` 的声明顺序。 */
export const PAPER_PRESET_NAMES: readonly PaperPresetName[] = ['A3', 'A4', 'A5', 'A6', 'B4', 'B5', 'Letter', 'Legal']

/** 判断字符串是否为内置纸张预设名。 */
export function isPaperPresetName(value: unknown): value is PaperPresetName {
  return typeof value === 'string' && (PAPER_PRESET_NAMES as readonly string[]).includes(value)
}
