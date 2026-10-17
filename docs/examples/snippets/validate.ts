/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 保存或导入模板前先校验：有错误级问题的模板不能分页。

// #region example
import type { PrintDocument, ValidationIssue } from '@xihan-print/core'
import { validateDocument } from '@xihan-print/core'
import { createExpressionEngine } from '@xihan-ui/expression'

export function checkTemplate(schema: PrintDocument): ValidationIssue[] {
  const report = validateDocument(schema, { expressionEngine: createExpressionEngine() })
  // report.valid 为 false 时 issues 里至少有一个 severity 为 error 的问题
  return report.issues
}
// #endregion example
