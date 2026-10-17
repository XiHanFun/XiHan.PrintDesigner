/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { FontSpec, TextMeasurer } from '@xihan-ui/viz'
import { convertLength } from '@xihan-ui/designer-kit'
import { wrapText } from '@xihan-ui/viz'

/** 文字样式没写字体时，量字与渲染共用的字体族。 */
export const DEFAULT_FONT_FAMILY = 'sans-serif'

/** 量字用到的字体属性：字号与字间距单位 pt。 */
export interface MeasureFont {
  fontFamily?: string
  fontSize: number
  bold: boolean
  italic: boolean
  letterSpacing: number
}

/** 排好的文字行与最宽一行的宽度，单位 mm。 */
export interface TextLines {
  lines: string[]
  width: number
}

/** 换成度量器用的字体：字号由 pt、行高由 mm 换成 CSS 像素。 */
export function fontSpec(font: MeasureFont, lineHeight: number): FontSpec {
  return {
    family: font.fontFamily ?? DEFAULT_FONT_FAMILY,
    size: convertLength(font.fontSize, 'pt', 'px'),
    weight: font.bold ? 700 : 400,
    lineHeight: convertLength(lineHeight, 'mm', 'px'),
    style: font.italic ? 'italic' : 'normal',
  }
}

/**
 * 按可用宽度（mm）排文字。`wrap` 时按 @xihan-ui/viz 的 wrapText 折行，行首行尾的空格去掉；
 * 否则只在换行符处断行。空串没有行。宽度由度量器量出、加上字间距后换回 mm。
 */
export function layoutTextLines(
  measurer: TextMeasurer,
  text: string,
  font: MeasureFont,
  lineHeight: number,
  maxWidth: number,
  wrap: boolean,
): TextLines {
  if (text === '')
    return { lines: [], width: 0 }
  const spec = fontSpec(font, lineHeight)
  const letterSpacing = convertLength(font.letterSpacing, 'pt', 'px')
  const lines = wrap
    ? wrapText(text, convertLength(Math.max(0, maxWidth), 'mm', 'px'), spec, measurer, { letterSpacing })
    : text.split(/\r?\n/)
  let width = 0
  for (const line of lines)
    width = Math.max(width, measurer.measure(line, spec).width + letterSpacing * Array.from(line).length)
  return { lines, width: convertLength(width, 'px', 'mm') }
}
