/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { RichTextLayoutBox, RichTextLine, RichTextSpan } from '@xihan-print/core'
import { DEFAULT_FONT_FAMILY } from '@xihan-print/core'
import { applyBoxStyle, mm, pt, setStyles } from './css'
import { boxFrame, JUSTIFY } from './frame'

/** 一截文字：有链接时是带 href 的 a，外观只取这一截的样式。 */
function renderSpan(doc: Document, span: RichTextSpan, part: 'span' | 'marker'): HTMLElement {
  const element = doc.createElement(span.link === undefined ? 'span' : 'a')
  element.dataset.part = part
  if (span.link !== undefined)
    element.setAttribute('href', span.link)
  element.textContent = span.text
  const decoration = [span.underline ? 'underline' : '', span.lineThrough ? 'line-through' : ''].filter(Boolean).join(' ')
  setStyles(element, {
    'font-family': span.fontFamily ?? DEFAULT_FONT_FAMILY,
    'font-size': pt(span.fontSize),
    'font-weight': span.bold ? '700' : '400',
    'font-style': span.italic ? 'italic' : 'normal',
    'letter-spacing': pt(span.letterSpacing),
    'color': span.color,
    'background-color': span.background,
    'text-decoration-line': decoration === '' ? 'none' : decoration,
    'vertical-align': span.script,
  })
  return element
}

/** 一行：定高，段距写成上外边距，缩进写成左内边距；项目符号与分隔线按行内的绝对位置画。 */
function renderLine(doc: Document, line: RichTextLine): HTMLDivElement {
  const element = doc.createElement('div')
  element.dataset.part = 'line'
  setStyles(element, {
    'position': 'relative',
    'flex': 'none',
    'height': mm(line.height),
    'line-height': mm(line.height),
    'margin-top': line.gap === 0 ? undefined : mm(line.gap),
    'padding-left': line.indent === 0 ? undefined : mm(line.indent),
    'text-align': line.align,
    'text-align-last': line.align === 'justify' ? 'justify' : undefined,
    'white-space': 'pre',
  })
  if (line.marker !== undefined) {
    const marker = renderSpan(doc, line.marker.span, 'marker')
    setStyles(marker, { position: 'absolute', left: mm(line.marker.x), top: '0' })
    element.append(marker)
  }
  if (line.divider !== undefined) {
    const rule = doc.createElement('div')
    rule.dataset.part = 'divider'
    setStyles(rule, {
      'position': 'absolute',
      'left': mm(line.indent),
      'right': '0',
      'top': mm((line.height - line.divider.width) / 2),
      'border-top': `${mm(line.divider.width)} solid ${line.divider.color}`,
    })
    element.append(rule)
  }
  for (const span of line.spans)
    element.append(renderSpan(doc, span, 'span'))
  return element
}

/** 富文本：按 core 排好的行逐行输出，行内不再折行。 */
export function renderRichText(doc: Document, box: RichTextLayoutBox): HTMLDivElement {
  const frame = boxFrame(doc, box)
  applyBoxStyle(frame, box.box)
  frame.style.setProperty('overflow', 'hidden')
  const content = doc.createElement('div')
  content.dataset.part = 'text'
  setStyles(content, {
    'display': 'flex',
    'flex-direction': 'column',
    'justify-content': JUSTIFY[box.verticalAlign],
    'height': '100%',
  })
  for (const line of box.lines)
    content.append(renderLine(doc, line))
  frame.append(content)
  return frame
}
