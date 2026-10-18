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

<<< @/examples/demos/quickstart.ts#setup

## 写一张模板

模板是纯 JSON。下面用 `@xihan-print/core` 的构造函数写：`createPage` 生成一张 A5 横向、四边留 10 mm 的页面模板，元素登记表的 `createElement` 按元素的缺省值生成元素，只覆盖需要改的属性。坐标与尺寸的单位都是 mm，原点在纸张左上角。

页眉放标题，页脚放页码，页码格式里的 <code v-pre>{{$page}}</code> 与 <code v-pre>{{$pages}}</code> 换成当前页码与总页数：

<<< @/examples/templates/delivery.ts#page

正文放客户、日期与明细表格。客户用 <code v-pre>{{customer.name}}</code> 占位，日期按 `yyyy年M月d日` 格式化；表格绑定数组字段 `items`，第一列是跨页连续的行序号，金额列保留两位小数并加千分位，末页加一行合计：

<<< @/examples/templates/delivery.ts#body

最后合成文档。数据是任意 JSON，字段路径按点与下标读取：

<<< @/examples/templates/delivery.ts#document

<<< @/examples/templates/delivery.ts#data

## 渲染与打印

把模板与数据交给 `<xh-print-preview>` 的 `schema` 与 `data` 属性，它立即分页并逐页显示；属性变了会自动重新分页。复杂数据走属性，不走 attribute。

<<< @/examples/demos/quickstart.ts#render

`print()` 按当前属性重新分页，在隐藏的 iframe 里渲染后调起浏览器的打印对话框，`title` 是对话框与另存 PDF 时的缺省文件名：

<<< @/examples/demos/quickstart.ts#print

<PrintDemo name="quickstart" />

明细有 18 行，表格排满第一页后续排到第二页，表头在第二页重复，合计只出现在末页。

打印用的页面里，每种纸张尺寸写成一条具名的 `@page`，边距为 0，模板自己的页边距已经排进了输出页，打印对话框里的边距保持「默认」即可。

## 不显示预览直接打印

页面上不需要预览时，用 `printDocument` 直接排版并打印：

<<< @/examples/snippets/print-directly.ts#example

模板有错误级问题或拿不到文字度量器时它会抛错，不打开打印对话框。

## 界面语言

预览与设计器的界面文字缺省是英文。打印给 XiHan.UI 的每种内建语言各出一份语言包，名字是 `print` 加 UI 语言包的名字：`zhCN` 对 `printZhCN`，`jaJP` 对 `printJaJP`。每份已含设计器零件（`@xihan-ui/designer-shell`）同一语言的文案，把 UI 与打印同一语言的两份合并后全局设置，所有实例都跟着换。下面以中文为例。这一步要另外安装 `@xihan-ui/web-components`：

<<< @/examples/snippets/locale.ts#example

## 下一步

- [模板结构](./guide/template)：页面、页眉页脚、元素与表格。
- [元素](./reference/elements)：每种元素的属性。
