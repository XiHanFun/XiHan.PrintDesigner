/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { isValidFieldPath } from './field-path'

/** 文本模板片段：原样文本或字段占位。 */
export type TextTemplateSegment
  = | { kind: 'text', text: string }
    | { kind: 'field', field: string }

/** 文本模板解析问题：未闭合的占位、空占位、占位内字段路径不合法。 */
export type TextTemplateErrorCode = 'unclosedPlaceholder' | 'emptyPlaceholder' | 'invalidPath'

/** 文本模板解析问题及其在模板字符串中的起始位置。 */
export interface TextTemplateError {
  code: TextTemplateErrorCode
  offset: number
  /** 不合法的占位内容。 */
  field?: string
}

/** 文本模板解析结果；有问题的占位按原样文本保留在片段中。 */
export interface TextTemplateParseResult {
  segments: TextTemplateSegment[]
  errors: TextTemplateError[]
}

/** 解析含 `{{path}}` 占位的文本模板，占位两侧空白忽略。 */
export function parseTextTemplate(template: string): TextTemplateParseResult {
  const segments: TextTemplateSegment[] = []
  const errors: TextTemplateError[] = []

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
  while (cursor < template.length) {
    const open = template.indexOf('{{', cursor)
    if (open === -1) {
      pushText(template.slice(cursor))
      break
    }
    pushText(template.slice(cursor, open))
    const close = template.indexOf('}}', open + 2)
    if (close === -1) {
      errors.push({ code: 'unclosedPlaceholder', offset: open })
      pushText(template.slice(open))
      break
    }
    const raw = template.slice(open, close + 2)
    const field = template.slice(open + 2, close).trim()
    if (field.length === 0) {
      errors.push({ code: 'emptyPlaceholder', offset: open })
      pushText(raw)
    }
    else if (!isValidFieldPath(field)) {
      errors.push({ code: 'invalidPath', offset: open, field })
      pushText(raw)
    }
    else {
      segments.push({ kind: 'field', field })
    }
    cursor = close + 2
  }

  return { segments, errors }
}
