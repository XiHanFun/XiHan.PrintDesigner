/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导出 @xihan-print/core 的公共接口。

export * from './factory'
export * from './geometry'
export { MIN_SHRINK_FONT_SIZE, SHRINK_FONT_STEP } from './layout/boxes'
export { DESIGN_FILLER_ROWS, DESIGN_SAMPLE_ROWS, layoutDesign } from './layout/design'
export type { DesignLayout, DesignLayoutOptions } from './layout/design'
export { DEFAULT_MAX_SHEETS, paginate } from './layout/paginate'
export {
  RICH_TEXT_BLOCK_GAP,
  RICH_TEXT_DIVIDER_WIDTH,
  RICH_TEXT_HEADING_SCALES,
  RICH_TEXT_LIST_INDENT,
  RICH_TEXT_MARKER_GAP,
  RICH_TEXT_SCRIPT_SCALE,
} from './layout/rich-text'
export { DEFAULT_FONT_FAMILY } from './layout/text-measure'
export * from './layout/types'
export { applyOperation, applyOperations } from './operations/apply'
export type { ApplyOperationOptions } from './operations/apply'
export * from './operations/errors'
export * from './operations/table-plans'
export * from './operations/types'
export * from './registry/builtins'
export * from './registry/part-properties'
export * from './registry/registry'
export * from './registry/types'
export * from './schema/common'
export * from './schema/document'
export * from './schema/elements'
export * from './schema/options'
export * from './schema/table'
export * from './traverse'
export { isValidColor } from './validation/checks'
export type {
  IssueParams,
  ValidationIssue,
  ValidationIssueCode,
  ValidationReport,
} from './validation/issues'
export { VALIDATION_ISSUE_SEVERITIES } from './validation/issues'
export type { ValidateDocumentOptions } from './validation/validate'
export { validateDocument } from './validation/validate'
