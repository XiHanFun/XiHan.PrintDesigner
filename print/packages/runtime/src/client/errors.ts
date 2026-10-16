/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PrintClientErrorCode } from './protocol'

/** 连不上客户端、可以退回浏览器打印的错误码：客户端没装或没运行，或协议主版本不对。 */
export const FALLBACK_CODES: readonly PrintClientErrorCode[] = ['CLIENT_UNAVAILABLE', 'PROTOCOL_UNSUPPORTED']

/** 打印客户端相关的错误，`code` 与 `details` 供调用方判断与生成文案。 */
export class PrintClientError extends Error {
  readonly code: PrintClientErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: PrintClientErrorCode, message: string = code, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'PrintClientError'
    this.code = code
    this.details = details
  }
}

/** 这个错误是否表示连不上客户端、应该退回浏览器打印；打印机报错、拒绝授权等一律不退回。 */
export function shouldFallBack(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' && (FALLBACK_CODES as readonly string[]).includes(code)
}
