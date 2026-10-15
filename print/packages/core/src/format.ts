/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { Decimal } from './decimal'
import type { ExpressionDiagnostic, ExpressionEvaluator } from './expression'
import type { DateFormat, MapFormat, NumberFormat, PercentFormat, ValueFormat } from './schema/common'
import { toDisplayText } from './data'
import { decimalToString, roundDecimal, shiftDecimal, toDecimal } from './decimal'

/** 格式化失败的原因：不是数字、不是可识别的日期、超出可表示范围、未提供求值接口、求值失败、结果不是标量。 */
export type FormatProblem
  = | 'notNumber'
    | 'invalidDate'
    | 'outOfRange'
    | 'expressionUnavailable'
    | 'expressionFailed'
    | 'notScalar'

/** 格式化结果；失败时 `text` 为原值的显示文本或空串，并给出原因。 */
export interface FormatResult {
  text: string
  problem?: FormatProblem
  /** 表达式求值失败时求值方给出的问题。 */
  diagnostics?: readonly ExpressionDiagnostic[]
}

/** 格式化选项。 */
export interface FormatOptions {
  /** 日期格式化使用的 IANA 时区，缺省为运行环境时区。 */
  timeZone?: string
  /** 表达式格式的求值接入点。 */
  evaluator?: ExpressionEvaluator
}

const CHINESE_DIGITS = '零壹贰叁肆伍陆柒捌玖'
const CHINESE_UNITS = ['', '拾', '佰', '仟']
const CHINESE_GROUP_UNITS = ['', '万', '亿', '万亿']

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(?:\d{3})+$)/g, ',')
}

function fixed(decimal: Decimal, decimals: number, thousands: boolean): string {
  const text = decimalToString(roundDecimal(decimal, decimals))
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [whole = '0', fraction] = unsigned.split('.')
  const grouped = thousands ? groupThousands(whole) : whole
  return `${negative ? '-' : ''}${fraction === undefined ? grouped : `${grouped}.${fraction}`}`
}

function formatNumber(value: unknown, format: NumberFormat): FormatResult {
  const decimal = toDecimal(value)
  if (decimal === undefined)
    return { text: toDisplayText(value).text, problem: 'notNumber' }
  return { text: `${format.prefix ?? ''}${fixed(decimal, format.decimals, format.thousands)}${format.suffix ?? ''}` }
}

function formatPercent(value: unknown, format: PercentFormat): FormatResult {
  const decimal = toDecimal(value)
  if (decimal === undefined)
    return { text: toDisplayText(value).text, problem: 'notNumber' }
  return { text: `${fixed(shiftDecimal(decimal, 2), format.decimals, false)}%` }
}

function integerToChinese(whole: string): string {
  const groups: string[] = []
  for (let end = whole.length; end > 0; end -= 4)
    groups.unshift(whole.slice(Math.max(0, end - 4), end))
  let text = ''
  let pendingZero = false
  groups.forEach((group, index) => {
    const padded = group.padStart(4, '0')
    let groupText = ''
    for (let position = 0; position < 4; position++) {
      const digit = Number(padded[position])
      if (digit === 0) {
        if (text.length > 0 || groupText.length > 0)
          pendingZero = true
        continue
      }
      if (pendingZero) {
        groupText += '零'
        pendingZero = false
      }
      groupText += `${CHINESE_DIGITS[digit]}${CHINESE_UNITS[3 - position]}`
    }
    if (groupText.length === 0)
      return
    const level = groups.length - 1 - index
    const nextGroupEmpty = Number(groups[index + 1] ?? '0') === 0
    text += `${groupText}${level === 3 && !nextGroupEmpty ? '万' : CHINESE_GROUP_UNITS[level]}`
  })
  return text
}

/** 人民币金额大写：四舍五入到分，整数部分不超过 16 位；超出时返回 undefined。 */
export function formatChineseAmount(decimal: Decimal): string | undefined {
  const text = decimalToString(roundDecimal(decimal, 2))
  const negative = text.startsWith('-')
  const [whole = '0', fraction = '00'] = (negative ? text.slice(1) : text).split('.')
  const trimmed = whole.replace(/^0+(?=\d)/, '')
  if (trimmed.length > 16)
    return undefined
  const jiao = Number(fraction[0])
  const fen = Number(fraction[1])
  const integer = trimmed === '0' ? '' : integerToChinese(trimmed)
  let result = integer.length > 0 ? `${integer}元` : ''
  if (jiao === 0 && fen === 0) {
    result = `${result.length > 0 ? result : '零元'}整`
  }
  else {
    if (jiao !== 0)
      result += `${CHINESE_DIGITS[jiao]}角`
    else if (result.length > 0)
      result += '零'
    if (fen !== 0)
      result += `${CHINESE_DIGITS[fen]}分`
  }
  return negative ? `负${result}` : result
}

interface DateParts {
  YYYY: string
  MM: string
  DD: string
  HH: string
  mm: string
  ss: string
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/
const DATE_TOKEN_PATTERN = /YYYY|MM|DD|HH|mm|ss/g

function zonedParts(time: number, timeZone: string | undefined): DateParts | undefined {
  if (!Number.isFinite(time))
    return undefined
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(time)))
    parts[part.type] = part.value
  return {
    YYYY: (parts.year ?? '').padStart(4, '0'),
    MM: parts.month ?? '',
    DD: parts.day ?? '',
    HH: parts.hour ?? '',
    mm: parts.minute ?? '',
    ss: parts.second ?? '',
  }
}

function dateParts(value: unknown, timeZone: string | undefined): DateParts | undefined {
  if (value instanceof Date)
    return zonedParts(value.getTime(), timeZone)
  if (typeof value === 'number')
    return zonedParts(value, timeZone)
  if (typeof value !== 'string')
    return undefined
  const local = LOCAL_DATE_PATTERN.exec(value.trim())
  if (local !== null) {
    const [, year = '', month = '', day = '', hour = '00', minute = '00', second = '00'] = local
    return { YYYY: year, MM: month, DD: day, HH: hour, mm: minute, ss: second }
  }
  return zonedParts(Date.parse(value), timeZone)
}

/**
 * 日期格式化。不带时区的 `YYYY-MM-DD[ HH:mm[:ss]]` 字符串按字面取值；
 * 带时区的字符串、时间戳与 Date 按 `timeZone` 换算。
 */
function formatDate(value: unknown, format: DateFormat, timeZone: string | undefined): FormatResult {
  const parts = dateParts(value, timeZone)
  if (parts === undefined)
    return { text: toDisplayText(value).text, problem: 'invalidDate' }
  return { text: format.pattern.replace(DATE_TOKEN_PATTERN, token => parts[token as keyof DateParts]) }
}

function formatMap(value: unknown, format: MapFormat): FormatResult {
  const display = toDisplayText(value)
  const entry = format.entries.find(item => item.value === display.text)
  if (entry !== undefined)
    return { text: entry.text }
  return { text: format.fallback ?? display.text }
}

/** 判断值是否为空：null、undefined 或空字符串。 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/** 把表达式求值结果转成文本。 */
export function evaluateToText(
  evaluator: ExpressionEvaluator | undefined,
  source: string,
  scope: Readonly<Record<string, unknown>>,
): FormatResult & { value?: unknown } {
  if (evaluator === undefined)
    return { text: '', problem: 'expressionUnavailable' }
  const result = evaluator.evaluate(source, scope)
  if (!result.ok)
    return { text: '', problem: 'expressionFailed', diagnostics: result.diagnostics }
  const display = toDisplayText(result.value)
  return display.scalar ? { text: display.text, value: result.value } : { text: '', problem: 'notScalar' }
}

/** 按值格式把数据值转成显示文本；空值不经格式化直接为空串，表达式格式除外。 */
export function formatValue(value: unknown, format: ValueFormat, options: FormatOptions = {}): FormatResult {
  if (format.kind === 'expression')
    return evaluateToText(options.evaluator, format.expression, { value })
  if (isEmptyValue(value))
    return { text: '' }
  switch (format.kind) {
    case 'number':
      return formatNumber(value, format)
    case 'percent':
      return formatPercent(value, format)
    case 'date':
      return formatDate(value, format, options.timeZone)
    case 'chineseAmount': {
      const decimal = toDecimal(value)
      if (decimal === undefined)
        return { text: toDisplayText(value).text, problem: 'notNumber' }
      const text = formatChineseAmount(decimal)
      return text === undefined ? { text: toDisplayText(value).text, problem: 'outOfRange' } : { text }
    }
    case 'map':
      return formatMap(value, format)
  }
}
