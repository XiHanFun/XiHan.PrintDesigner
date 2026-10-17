/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 校验 examples/templates/ 下的示例模板：每个文件导出 schema 与 data，模板不能有错误级校验问题，
// 按 data 分页不能有错误级诊断。分页用固定字宽的度量器，只检查模板与数据能排出来，不检查折行位置。

import { readdir } from 'node:fs/promises'
import process from 'node:process'
import { paginate, validateDocument } from '@xihan-print/core'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'

const templatesDir = new URL('../examples/templates/', import.meta.url)

/** 每个字符宽「字号 × 0.6」像素的度量器。 */
const measurer = {
  version: 0,
  measure: (text, font) => ({ width: Array.from(text).length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
}

const failures = []
const files = (await readdir(templatesDir)).filter(name => name.endsWith('.ts')).sort()
for (const name of files) {
  const { schema, data } = await import(new URL(name, templatesDir).href)
  const report = validateDocument(schema, { expressionEngine: createExpressionEngine() })
  const issues = report.issues.filter(issue => issue.severity === 'error')
  if (issues.length > 0) {
    failures.push(`${name}：校验问题 ${issues.map(issue => `${issue.code} @ ${issue.path.join('.')}`).join('，')}`)
    continue
  }
  const result = paginate(schema, data, { measurer, expressionEngine: createExpressionEngine(), formatter: formatValue })
  const errors = result.diagnostics.filter(item => item.severity === 'error')
  const warnings = [...report.issues, ...result.diagnostics].filter(item => item.severity === 'warning').map(item => item.code)
  if (errors.length > 0)
    failures.push(`${name}：分页诊断 ${errors.map(item => `${item.code} @ ${item.path.join('.')}`).join('，')}`)
  else
    console.log(`${name}：${result.sheets.length} 张输出页${warnings.length > 0 ? `，警告 ${warnings.join('、')}` : ''}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
