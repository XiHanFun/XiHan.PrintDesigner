/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { LayoutBox, VerticalAlign } from '@xihan-print/core'
import { mm, setStyles } from './css'

/** 垂直对齐对应的主轴排布。 */
export const JUSTIFY: Readonly<Record<VerticalAlign, string>> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }

/** 建一个元素的外框：按纸张坐标绝对定位，带元素标识与种类；旋转绕中心顺时针。 */
export function boxFrame(doc: Document, box: LayoutBox): HTMLDivElement {
  const frame = doc.createElement('div')
  frame.dataset.part = 'box'
  frame.dataset.kind = box.kind
  frame.dataset.elementId = box.elementId
  if (box.previewOnly)
    frame.dataset.previewOnly = ''
  setStyles(frame, {
    'position': 'absolute',
    'left': mm(box.x),
    'top': mm(box.y),
    'width': mm(box.width),
    'height': mm(box.height),
    'box-sizing': 'border-box',
  })
  const rotation = 'rotation' in box ? box.rotation : 0
  if (rotation !== 0)
    frame.style.setProperty('transform', `rotate(${rotation}deg)`)
  return frame
}
