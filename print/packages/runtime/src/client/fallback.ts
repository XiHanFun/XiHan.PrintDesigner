/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintDocument } from '@xihan-print/core'
import type { PrintOptions } from '../print'
import type { PrintClient, PrintClientDocumentOptions } from './client'
import { printDocument } from '../print'
import { shouldFallBack } from './errors'

/** printWithFallback 的结果：走了哪条路，与送去打印的页数。 */
export interface PrintWithFallbackOutcome {
  readonly via: 'client' | 'browser'
  readonly sheets: number
}

/** printWithFallback 的选项：客户端打印选项、分页注入项，退回浏览器打印时另用 title。 */
export interface PrintWithFallbackOptions extends PrintClientDocumentOptions, Pick<PrintOptions, 'title'> {}

/**
 * 先交给本地打印客户端打印，等到交给打印池；只在连不上客户端（CLIENT_UNAVAILABLE、PROTOCOL_UNSUPPORTED）时
 * 退回浏览器的打印对话框。打印机报错、拒绝授权等其它错误照常抛出，免得用户以为已经静默打出来了。
 */
export async function printWithFallback(client: PrintClient, schema: PrintDocument, data: unknown, options: PrintWithFallbackOptions = {}): Promise<PrintWithFallbackOutcome> {
  try {
    const status = await client.printDocument(schema, data, options).done
    return { via: 'client', sheets: status.sheets ?? 0 }
  }
  catch (error) {
    if (!shouldFallBack(error))
      throw error
  }
  const outcome = await printDocument(schema, data, options)
  return { via: 'browser', sheets: outcome.sheets }
}
