/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { BarCodeValueIssue, MatrixCodeLevel, MatrixCodeValueIssue } from '@xihan-ui/headless'
import type { BarCodeFormat, MatrixCodeFormat } from './schema/options'
import type { IssueParams } from './validation/issues'
import { checkMatrixCodeValue, matrixCodeLevelFit } from '@xihan-ui/headless'

/** 条码内容问题的参数：码制、问题码 `reason` 与问题附带的数据。 */
export function barCodeIssueParams(format: BarCodeFormat, issue: BarCodeValueIssue): IssueParams {
  switch (issue.code) {
    case 'invalid-character':
      return { format, reason: issue.code, character: issue.character }
    case 'invalid-length':
      return { format, reason: issue.code, length: issue.length, lengths: issue.lengths.map(String) }
    case 'invalid-check-digit':
      return { format, reason: issue.code, expected: issue.expected, actual: issue.actual }
    case 'invalid-number-system':
      return { format, reason: issue.code, actual: issue.actual }
    case 'unknown-format':
      return { format, reason: issue.code }
  }
}

/** 二维码内容问题的参数：码制与问题码 `reason`。 */
export function matrixCodeIssueParams(format: MatrixCodeFormat, issue: MatrixCodeValueIssue): IssueParams {
  return { format, reason: issue.code }
}

/** 按码制检查二维码内容；纠错级别不适用时按没给级别检查，级别本身的问题由调用方另报。 */
export function checkMatrixCodeContent(format: MatrixCodeFormat, value: string, level: MatrixCodeLevel | undefined): MatrixCodeValueIssue | undefined {
  return checkMatrixCodeValue(format, value, level === undefined || matrixCodeLevelFit(format, level) !== 'valid' ? {} : { level })
}
