/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { IssueParams, PaginateOptions, PrintCoreExtension } from '@xihan-print/core'
import type { ExpressionEngine, ValueFormatter } from '@xihan-ui/expression'
import type { TextMeasurer } from '@xihan-ui/viz'
import { formatValue } from '@xihan-ui/expression'

/** 分页用到的注入项：预览元素的属性与 printDocument 的选项共用这一组。 */
export interface PrintRenderOptions {
  /** 文字度量器；缺省用所在文档的 Canvas 度量器（@xihan-ui/viz 的 createCanvasMeasurer），拿不到 2D 上下文时报 measurer.unavailable。 */
  readonly measurer?: TextMeasurer
  /** 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 */
  readonly expressionEngine?: ExpressionEngine
  /** 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 */
  readonly formatter?: ValueFormatter
  /** 交给格式化器的区域。 */
  readonly locale?: string
  /** 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称。 */
  readonly timeZone?: string
  /** 输出页总数上限，缺省同 @xihan-print/core 的 paginate。 */
  readonly maxSheets?: number
  /** 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前。 */
  readonly extensions?: readonly PrintCoreExtension[]
}

/** 运行时无法完成分页或打印的原因：拿不到文字度量器、没有给模板。 */
export type PrintRuntimeErrorCode = 'measurer.unavailable' | 'schema.missing'

/** 运行时无法完成分页或打印时抛出的错误，`code` 与 `params` 供调用方判断与生成文案。 */
export class PrintRuntimeError extends Error {
  readonly code: PrintRuntimeErrorCode
  readonly params: IssueParams

  constructor(code: PrintRuntimeErrorCode, params: IssueParams = {}) {
    super(`${code} ${JSON.stringify(params)}`)
    this.name = 'PrintRuntimeError'
    this.code = code
    this.params = params
  }
}

/** 注入项没给时的缺省来源。 */
export interface RenderDefaults {
  measurer: () => TextMeasurer | null
  expressionEngine: () => ExpressionEngine
}

/** 把注入项与缺省来源合成 paginate 的选项；拿不到度量器时抛 PrintRuntimeError。 */
export function resolvePaginateOptions(options: PrintRenderOptions, defaults: RenderDefaults): PaginateOptions {
  const measurer = options.measurer ?? defaults.measurer()
  if (measurer === null)
    throw new PrintRuntimeError('measurer.unavailable')
  const resolved: PaginateOptions = {
    measurer,
    expressionEngine: options.expressionEngine ?? defaults.expressionEngine(),
    formatter: options.formatter ?? formatValue,
  }
  if (options.locale !== undefined)
    resolved.locale = options.locale
  if (options.timeZone !== undefined)
    resolved.timeZone = options.timeZone
  if (options.maxSheets !== undefined)
    resolved.maxSheets = options.maxSheets
  if (options.extensions !== undefined)
    resolved.extensions = options.extensions
  return resolved
}
