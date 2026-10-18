# @xihan-print/core

曦寒打印设计器的模型层：打印模板的结构与构造函数、单位换算与页面几何、元素类型登记表、模板校验与问题码、编辑操作，以及按数据分页排版。纯 TypeScript，不依赖 DOM，浏览器与 Node 里都能用。

**谁会装它**：在代码里写模板、校验模板，或在服务端按数据排版时直接引；只在页面上预览、打印或设计模板时，装 `@xihan-print/runtime` 或 `@xihan-print/designer` 就会带上它。

## 用法

```ts
import { createDocument, createElementRegistry, createPage, validateDocument } from '@xihan-print/core'

const registry = createElementRegistry()
const page = createPage({ id: 'delivery' })
page.elements = [registry.createElement('text', { id: 'title', x: 10, y: 10, overrides: { width: 60, height: 8 } })]
const schema = createDocument({ pages: [page] })
const { valid, issues } = validateDocument(schema)
```

## 装

```bash
pnpm add @xihan-print/core
```

完整文档见 [https://print.docs.xihanfun.com](https://print.docs.xihanfun.com)。

许可：MIT
