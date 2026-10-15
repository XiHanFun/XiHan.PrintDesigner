/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { IssueParams } from '../validation/issues'

/** 操作无法执行的原因。 */
export type PrintOperationErrorCode
  = | 'element.notFound'
    | 'page.notFound'
    | 'band.notFound'
    | 'band.exists'
    | 'id.duplicate'
    | 'path.invalid'
    | 'path.protected'
    | 'value.invalid'
    | 'index.outOfRange'
    | 'operation.unknown'

/** 操作无法执行时抛出的错误，`code` 与 `params` 供调用方判断与生成文案。 */
export class PrintOperationError extends Error {
  readonly code: PrintOperationErrorCode
  readonly params: IssueParams

  constructor(code: PrintOperationErrorCode, params: IssueParams = {}) {
    super(`${code} ${JSON.stringify(params)}`)
    this.name = 'PrintOperationError'
    this.code = code
    this.params = params
  }
}
