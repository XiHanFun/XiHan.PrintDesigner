来源：https://print.docs.xihanfun.com/quickstart

# 快速开始

这一页在任意前端项目里装上运行时，把一张送货单模板按数据排成输出页显示出来，再调起浏览器的打印对话框。页面上的示例就是下面这几段代码在运行。

## 安装

```bash
pnpm add @xihan-print/core @xihan-print/runtime @xihan-ui/styles
```

| 包 | 用途 |
| --- | --- |
| `@xihan-print/core` | 模板的类型与构造函数，这一页用它写模板 |
| `@xihan-print/runtime` | `<xh-print-preview>` 与浏览器打印 |
| `@xihan-ui/styles` | 设计令牌与组件皮肤，预览外框的颜色与间距都取自它 |

包都是 ESM，用 Vite、webpack 等打包器引入即可。模板也可以直接写成 JSON、或从接口取回，这时业务页面只需要 `@xihan-print/runtime`。

## 注册元素并引入样式

元素不在 import 时注册，调用 `definePrintPreview()` 之后页面上才能用 `<xh-print-preview>`，重复调用不报错。`../templates/delivery` 是下一节写的模板。

```ts
import { definePrintPreview } from '@xihan-print/runtime'
import { data, schema } from '../templates/delivery'
import '@xihan-ui/styles/index.css'
import '@xihan-print/runtime/style.css'

definePrintPreview()
```

## 写一张模板

模板是纯 JSON。下面用 `@xihan-print/core` 的构造函数写：`createPage` 生成一张 A5 横向、四边留 10 mm 的页面模板，元素登记表的 `createElement` 按元素的缺省值生成元素，只覆盖需要改的属性。坐标与尺寸的单位都是 mm，原点在纸张左上角。

页眉放标题，页脚放页码，页码格式里的 `{{$page}}` 与 `{{$pages}}` 换成当前页码与总页数：

```ts
const page = createPage({ id: 'delivery', paper: 'A5', orientation: 'landscape', margins: 10 })

page.header.default = {
  height: 14,
  elements: [
    registry.createElement('text', {
      id: 'title',
      x: 10,
      y: 12,
      overrides: {
        width: 190,
        height: 10,
        content: { kind: 'static', text: '送货单' },
        style: { ...textStyle, fontSize: 16, bold: true, align: 'center' },
      },
    }),
  ],
}

page.footer.default = {
  height: 8,
  elements: [
    registry.createElement('pageNumber', {
      id: 'page-number',
      x: 80,
      y: 131,
      overrides: { width: 50, format: '第 {{$page}} 页 / 共 {{$pages}} 页' },
    }),
  ],
}
```

正文放客户、日期与明细表格。客户用 `{{customer.name}}` 占位，日期按 `yyyy年M月d日` 格式化；表格绑定数组字段 `items`，第一列是跨页连续的行序号，金额列保留两位小数并加千分位，末页加一行合计：

```ts
const money = { kind: 'number', decimals: 2, grouping: true } as const

function column(id: string, title: string, width: number, field: string, align: TableColumn['align'] = 'left'): TableColumn {
  return { id, title, width, align, content: { kind: 'field', field, format: money }, cellType: 'text' }
}

page.elements.push(
  registry.createElement('text', {
    id: 'customer',
    x: 10,
    y: 26,
    overrides: { width: 120, content: { kind: 'template', template: '客户：{{customer.name}}' } },
  }),
  registry.createElement('text', {
    id: 'date',
    x: 140,
    y: 26,
    overrides: {
      width: 60,
      content: { kind: 'field', field: 'date', format: { kind: 'date', pattern: 'yyyy年M月d日' } },
      style: { ...textStyle, align: 'right' },
    },
  }),
  registry.createElement('table', {
    id: 'items',
    x: 10,
    y: 36,
    overrides: {
      width: 190,
      dataField: 'items',
      columns: [
        { id: 'no', title: '序号', width: 14, align: 'center', content: { kind: 'rowNumber' }, cellType: 'text' },
        { id: 'name', title: '品名', width: 80, align: 'left', content: { kind: 'field', field: 'name' }, cellType: 'text' },
        { id: 'qty', title: '数量', width: 28, align: 'right', content: { kind: 'field', field: 'qty' }, cellType: 'text' },
        column('price', '单价', 34, 'price', 'right'),
        column('amount', '金额', 34, 'amount', 'right'),
      ],
      footerRows: [
        {
          id: 'total',
          placement: 'lastPage',
          height: 7,
          style: { ...registry.get('table')!.defaults.body.style, bold: true },
          cells: [
            { columnId: 'no', colSpan: 4, content: { kind: 'static', text: '合计' }, align: 'right' },
            { columnId: 'amount', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all', format: money } },
          ],
        },
      ],
    },
  }),
)
```

最后合成文档。数据是任意 JSON，字段路径按点与下标读取：

```ts
export const schema: PrintDocument = createDocument({ name: '送货单', pages: [page] })
```

```ts
const products = ['A4 复印纸', '中性笔', '订书机', '文件夹', '便利贴', '计算器']

export const data = {
  customer: { name: '曦寒商贸有限公司' },
  date: '2026-10-17',
  items: Array.from({ length: 18 }, (_, index) => {
    const qty = (index % 5) + 1
    const price = 12.5 + index * 3
    return { name: `${products[index % products.length]} ${index + 1} 号`, qty, price, amount: qty * price }
  }),
}
```

## 渲染与打印

把模板与数据交给 `<xh-print-preview>` 的 `schema` 与 `data` 属性，它立即分页并逐页显示；属性变了会自动重新分页。复杂数据走属性，不走 attribute。

```ts
const preview = document.createElement('xh-print-preview')
preview.schema = schema
preview.data = data
```

`print()` 按当前属性重新分页，在隐藏的 iframe 里渲染后调起浏览器的打印对话框，`title` 是对话框与另存 PDF 时的缺省文件名：

```ts
const button = document.createElement('button')
button.type = 'button'
button.textContent = '打印'
button.addEventListener('click', () => preview.print({ title: '送货单' }))
```


明细有 18 行，表格排满第一页后续排到第二页，表头在第二页重复，合计只出现在末页。

打印用的页面里，每种纸张尺寸写成一条具名的 `@page`，边距为 0，模板自己的页边距已经排进了输出页，打印对话框里的边距保持「默认」即可。

## 不显示预览直接打印

页面上不需要预览时，用 `printDocument` 直接排版并打印：

```ts
import type { PrintOutcome } from '@xihan-print/runtime'
import { printDocument } from '@xihan-print/runtime'
import { data, schema } from '../templates/delivery'

export async function printDelivery(): Promise<PrintOutcome> {
  // outcome.sheets 是送去打印的页数，outcome.diagnostics 是分页诊断
  const outcome = await printDocument(schema, data, { title: '送货单' })
  return outcome
}
```

模板有错误级问题或拿不到文字度量器时它会抛错，不打开打印对话框。

## 界面语言

预览与设计器的界面文字缺省是英文。打印给 XiHan.UI 的每种内建语言各出一份语言包，名字是 `print` 加 UI 语言包的名字：`zhCN` 对 `printZhCN`，`jaJP` 对 `printJaJP`。每份已含设计器零件（`@xihan-ui/designer-shell`）同一语言的文案，把 UI 与打印同一语言的两份合并后全局设置，所有实例都跟着换。下面以中文为例。这一步要另外安装 `@xihan-ui/web-components`：

```ts
import { printZhCN } from '@xihan-print/runtime/locale'
import { mergeXhConfig, setXhConfig } from '@xihan-ui/web-components'
import { zhCN } from '@xihan-ui/web-components/locale'

setXhConfig(mergeXhConfig(zhCN, printZhCN))
```

## 下一步

- [模板结构](./guide/template)：页面、页眉页脚、元素与表格。
- [元素](./reference/elements)：每种元素的属性。
