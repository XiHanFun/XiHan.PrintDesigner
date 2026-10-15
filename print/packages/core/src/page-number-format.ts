/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 页码格式中的记号：current 当前页码，total 总页数。 */
export type PageNumberToken = 'current' | 'total'

/** 页码格式片段。 */
export type PageNumberFormatSegment
  = | { kind: 'text', text: string }
    | { kind: 'token', token: PageNumberToken }

/** 页码格式解析结果；未知记号按原样文本保留，并列入 `unknownTokens`。 */
export interface PageNumberFormatParseResult {
  segments: PageNumberFormatSegment[]
  unknownTokens: string[]
}

const TOKEN_PATTERN = /\{([a-z]+)\}/gi

function isPageNumberToken(name: string): name is PageNumberToken {
  return name === 'current' || name === 'total'
}

/** 解析页码格式，记号写作 `{current}`、`{total}`。 */
export function parsePageNumberFormat(format: string): PageNumberFormatParseResult {
  const segments: PageNumberFormatSegment[] = []
  const unknownTokens: string[] = []

  const pushText = (text: string): void => {
    if (text.length === 0)
      return
    const last = segments.at(-1)
    if (last?.kind === 'text')
      last.text += text
    else
      segments.push({ kind: 'text', text })
  }

  let cursor = 0
  for (const match of format.matchAll(TOKEN_PATTERN)) {
    const name = match[1] ?? ''
    pushText(format.slice(cursor, match.index))
    if (isPageNumberToken(name)) {
      segments.push({ kind: 'token', token: name })
    }
    else {
      unknownTokens.push(name)
      pushText(match[0])
    }
    cursor = match.index + match[0].length
  }
  pushText(format.slice(cursor))

  return { segments, unknownTokens }
}

/** 按页码格式生成文本。 */
export function formatPageNumber(format: string, values: { current: number, total: number }): string {
  const { segments } = parsePageNumberFormat(format)
  return segments.map(segment => segment.kind === 'text' ? segment.text : String(values[segment.token])).join('')
}
