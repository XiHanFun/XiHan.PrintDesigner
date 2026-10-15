/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 水印：用 @xihan-ui/headless 的 planWatermark 算出平铺图样，作为铺满整张输出页的一层背景。

import type { LayoutWatermark } from '@xihan-print/core'
import { DEFAULT_FONT_FAMILY } from '@xihan-print/core'
import { convertLength } from '@xihan-ui/designer-kit'
import { planWatermark } from '@xihan-ui/headless'
import { setStyles } from './css'

/** 按模板的水印生成覆盖整张输出页的一层；没有可印的文字时返回 undefined。旋转方向取反：模板逆时针为正，图样顺时针为正。 */
export function renderWatermark(doc: Document, watermark: LayoutWatermark): HTMLDivElement | undefined {
  const pattern = planWatermark({
    text: watermark.text,
    rotate: -watermark.rotation,
    gapX: convertLength(watermark.gapX, 'mm', 'px'),
    gapY: convertLength(watermark.gapY, 'mm', 'px'),
    fontSize: convertLength(watermark.fontSize, 'pt', 'px'),
    opacity: watermark.opacity,
    fontFamily: watermark.fontFamily ?? DEFAULT_FONT_FAMILY,
    color: watermark.color,
  })
  if (pattern.state !== 'ready')
    return undefined
  const layer = doc.createElement('div')
  layer.dataset.part = 'watermark'
  setStyles(layer, {
    'position': 'absolute',
    'inset': '0',
    'pointer-events': 'none',
    'background-image': `url("${pattern.image}")`,
    'background-repeat': 'repeat',
    'background-size': `${pattern.tile.width}px ${pattern.tile.height}px`,
    'print-color-adjust': 'exact',
  })
  return layer
}
