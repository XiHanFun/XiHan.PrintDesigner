/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 冒烟的 Node 侧：core 不碰 DOM，在 Node 里建一份模板并校验，没有 error 级问题即通过。
import { createDocument, createElementRegistry, createPage, validateDocument } from '@xihan-print/core'

const registry = createElementRegistry()
const page = createPage({ id: 'smoke' })
page.elements = [registry.createElement('text', { id: 'title', x: 10, y: 10, overrides: { width: 60, height: 8 } })]
const report = validateDocument(createDocument({ pages: [page] }))
if (!report.valid) {
  console.error('[smoke] ✗ Node 里建的模板校验不通过：', report.issues)
  process.exit(1)
}
console.log('[smoke] Node 侧：@xihan-print/core 导入、建模板与校验正常')
