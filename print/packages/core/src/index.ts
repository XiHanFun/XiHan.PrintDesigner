/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导出 @xihan-print/core 的公共接口。

export * from './barcode'
export * from './expression'
export * from './factory'
export * from './field-path'
export type { FormatSpec, ValueFormatter } from './format'
export * from './geometry'
export * from './json'
export { MIN_SHRINK_FONT_SIZE, SHRINK_FONT_STEP } from './layout/boxes'
export { DEFAULT_MAX_SHEETS, paginate } from './layout/paginate'
export * from './layout/types'
export { applyOperation, applyOperations } from './operations/apply'
export type { ApplyOperationOptions } from './operations/apply'
export * from './operations/errors'
export { readPath, writePath } from './operations/path'
export type { PathWriteResult } from './operations/path'
export * from './operations/types'
export * from './page-number-format'
export * from './paper'
export * from './qrcode'
export * from './registry/builtins'
export * from './registry/registry'
export * from './registry/types'
export * from './schema/common'
export * from './schema/document'
export * from './schema/elements'
export * from './schema/options'
export * from './schema/table'
export * from './text-template'
export * from './traverse'
export * from './units'
export { isValidColor } from './validation/checks'
export { isSafeImageUrl } from './validation/controls'
export type {
  IssueParams,
  IssueSeverity,
  ValidationIssue,
  ValidationIssueCode,
  ValidationReport,
} from './validation/issues'
export { VALIDATION_ISSUE_SEVERITIES } from './validation/issues'
export type { ValidateDocumentOptions } from './validation/validate'
export { validateDocument } from './validation/validate'
