# @xihan-print/runtime

曦寒打印设计器的运行时，给业务页面用：`<xh-print-preview>` 按模板与数据分页预览并调起浏览器打印；`printDocument`、`paginateDocument` 不经预览直接排版、打印。以原生 Web Components 交付，任何前端项目都能用。

子入口：

- `@xihan-print/runtime/locale`：界面语言包（`printZhCN`、`printJaJP`……），与 XiHan.UI 的内建语言一一对应。
- `@xihan-print/runtime/client`：本地打印客户端的 SDK（`createPrintClient`、`printWithFallback`），连不上客户端时退回浏览器打印。
- `@xihan-print/runtime/style.css`：预览元素的样式，只消费 `@xihan-ui/styles` 的设计令牌。

## 用法

```ts
import { definePrintPreview } from '@xihan-print/runtime'
import '@xihan-ui/styles/index.css'
import '@xihan-print/runtime/style.css'

definePrintPreview()

const preview = document.createElement('xh-print-preview')
preview.schema = schema
preview.data = data
document.body.append(preview)
await preview.print({ title: '送货单' })
```

## 装

```bash
pnpm add @xihan-print/runtime @xihan-ui/styles
```

完整文档见 [https://print.docs.xihanfun.com](https://print.docs.xihanfun.com)。

许可：MIT
