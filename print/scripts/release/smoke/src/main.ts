/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 冒烟页面：照文档站快速开始与设计器一页的接法，注册预览与设计器、引入样式、切换语言，把同一份模板交给两者。

import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'
import { definePrintDesigner } from '@xihan-print/designer'
import { definePrintPreview } from '@xihan-print/runtime'
import { createPrintClient } from '@xihan-print/runtime/client'
import { printZhCN } from '@xihan-print/runtime/locale'
import { mergeXhConfig, setXhConfig } from '@xihan-ui/web-components'
import { zhCN } from '@xihan-ui/web-components/locale'
import '@xihan-ui/styles/index.css'
import '@xihan-ui/designer-shell/style.css'
import '@xihan-print/runtime/style.css'
import '@xihan-print/designer/style.css'

setXhConfig(mergeXhConfig(zhCN, printZhCN))
definePrintPreview()
definePrintDesigner()

const registry = createElementRegistry()
const page = createPage({ id: 'smoke' })
page.elements = [registry.createElement('text', { id: 'title', x: 10, y: 10, overrides: { width: 60, height: 8 } })]
const schema = createDocument({ pages: [page] })

const preview = document.createElement('xh-print-preview')
preview.schema = schema
preview.data = {}

const designer = document.createElement('xh-print-designer')
designer.schema = schema
designer.printClient = createPrintClient()
designer.addEventListener('schema-change', () => void designer.schema)

document.body.append(preview, designer)
