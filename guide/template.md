来源：https://print.docs.xihanfun.com/guide/template

# 模板结构

模板是一份纯 JSON：不含函数、不含脚本，可以原样存进数据库、放进文件或经接口传输。这一章讲模板由哪些部分组成，每个字段的类型见[模板类型](../reference/schema)，每种元素的属性见[元素](../reference/elements)。

## 单位与坐标

| 量 | 单位 |
| --- | --- |
| 坐标、宽高、边距、带区高度、线宽、间距 | mm |
| 字号、字间距 | pt |
| 旋转角度 | 度，元素绕中心顺时针旋转；水印逆时针 |
| 文本行高 | 字号的倍数；表格单元格的行高是 mm |
| 颜色 | `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent` |

所有元素的坐标都相对纸张左上角，页眉、正文与页脚里的元素都一样。纸张横放时，坐标按横放后的纸张算。

## 一份最小的模板

一张 A6 纵向页面，正文里一行绑定数据的文字。这就是完整的模板：

```ts
export const schema: PrintDocument = {
  schemaVersion: 1,
  name: '取件凭条',
  pages: [
    {
      id: 'page-1',
      paper: { preset: 'A6', width: 105, height: 148 },
      orientation: 'portrait',
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      header: { default: { height: 0, elements: [] }, singleSheet: 'first' },
      footer: { default: { height: 0, elements: [] }, singleSheet: 'last' },
      numbering: { continuous: true, start: 1 },
      elements: [
        {
          id: 'pickup-code',
          type: 'text',
          x: 8,
          y: 12,
          width: 89,
          height: 12,
          content: { kind: 'template', template: '取件码 {{code}}' },
          style: {
            fontSize: 18,
            bold: true,
            italic: false,
            underline: false,
            lineThrough: false,
            color: '#000000',
            align: 'center',
            verticalAlign: 'middle',
            lineHeight: 1.2,
            letterSpacing: 0,
          },
          wrap: false,
          overflow: 'shrink',
          rotation: 0,
        },
      ],
    },
  ],
}
```

## 文档

`PrintDocument` 是模板的根：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 模板 schema 版本，当前为 1。不认识的版本校验报错 |
| `name` | 模板名称，可省 |
| `pages` | 页面模板，至少一张 |
| `meta` | 宿主附加数据，组件不读，原样保留 |

一张页面模板按数据排出一张或多张输出页。有多张页面模板时依次排：比如第一张是封面、第二张是明细，明细多了就排出多张输出页，接在封面后面。

## 页面模板

| 字段 | 说明 |
| --- | --- |
| `id` | 页面标识，整份模板内唯一，与元素标识也不能重复 |
| `paper` | 纸张：`width`、`height` 写纵向尺寸；`preset` 记来源预设，自定义纸张不填。预设见[纸张预设](../reference/elements#page) |
| `orientation` | `portrait` 纵向、`landscape` 横向；横向时宽高互换 |
| `margins` | 四边页边距 |
| `header`、`footer` | 页眉与页脚，见下一节 |
| `elements` | 正文元素 |
| `numbering` | 页码编号：`continuous` 是否接续上一张页面模板的页码，`start` 是不接续时的起始页码 |
| `watermark` | 平铺文字水印，可省 |
| `guides` | 设计器里的参考线，只用于对位，不参与分页也不打印 |
| `meta` | 宿主附加数据 |

用 `createPage` 生成时，缺省是 A4 纵向、四边 10 mm，页码接续上一张页面模板。

### 页码编号

页码元素的格式里，`{{$page}}` 是当前页码，`{{$pages}}` 是所在编号段的总页数。`numbering.continuous` 为 `true` 的页面模板接着上一张的页码往下编，并与它算作同一个编号段；为 `false` 时从 `start` 重新开始一个编号段。

比如封面 `continuous: false, start: 1`、正文 `continuous: false, start: 1`：封面自己是「第 1 页 / 共 1 页」，正文从第 1 页重新编。

### 水印

水印在输出页上平铺文字，文字里可以用 `{{path}}` 占位取数据。`fontSize` 单位 pt，`opacity` 为 0 到 1，`rotation` 逆时针旋转，`gapX`、`gapY` 是相邻水印的间距（mm）。

## 页眉、正文与页脚

```text
┌──────────────── 纸张 ────────────────┐
│                上边距                │
│  ┌──────── 页眉 header ──────────┐  │
│  ├──────── 正文 elements ────────┤  │
│  │                               │  │
│  ├──────── 页脚 footer ──────────┤  │
│                下边距                │
└──────────────────────────────────────┘
```

- 页眉在上边距之下，页脚在下边距之上，高度由带区的 `height` 决定；两者之间是正文区。
- 页眉、页脚里的元素每张输出页都画一遍；正文元素按数据排，长文本、富文本与表格可以续排到后面的输出页。
- 长文本、富文本与表格只能放在正文区，放进页眉页脚校验报错。

### 首页、末页与奇偶页

页眉与页脚各有一个缺省带区 `default`，还可以有四个变体：`first` 首页、`last` 末页、`odd` 奇数页、`even` 偶数页。每张输出页按下面的顺序选带区：

1. 是首页且有 `first`，或是末页且有 `last`：用对应的变体；既是首页又是末页、两个变体都有时，按 `singleSheet` 选 `first` 或 `last`。
2. 否则按页码奇偶，有 `odd` 或 `even` 就用。
3. 都没有时用 `default`。

首页、末页按这张页面模板排出的输出页算，奇偶按页码算。带区高度不同时，每张输出页的正文区跟着变：首页页眉高一些，首页的正文区就短一些。

## 元素

每个元素都有这些字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 元素标识，整份模板内唯一 |
| `type` | 元素类型，如 `text`、`table` |
| `name` | 设计器里显示的名称，可省 |
| `x`、`y`、`width`、`height` | 元素框，相对纸张左上角 |
| `locked` | 锁定后在设计器里不能拖动与缩放 |
| `previewOnly` | 只在设计器与预览里显示，不打印，适合画套打底图 |
| `meta` | 宿主附加数据 |

其余字段随元素类型不同，见[元素](../reference/elements)。

- 同一区里的元素按数组顺序叠放，越靠后的画在越上面。
- 元素框超出纸张或超出所在的页眉、页脚，校验给出警告，照样分页。
- 固定尺寸的文本放不下时按 `overflow` 处理：`clip` 裁掉，`shrink` 缩小字号直到放下（最小 4 pt），`visible` 照常显示超出的部分。

### 用代码生成元素

元素登记表登记了全部内置元素的缺省值。`createElement` 按缺省值生成元素，`overrides` 只覆盖顶层属性；要改样式里的一项，先展开缺省的样式：

```ts
import type { PrintDocument, TableColumn } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

const registry = createElementRegistry()
const textStyle = registry.get('text')!.defaults.style
```

快速开始里的送货单就是这样写的：标题用缺省文本样式，只改字号、粗体与对齐。

## 表格

表格绑定数据里的一个数组，每个元素一行，行数多了续排到后面的输出页。

| 部分 | 说明 |
| --- | --- |
| `dataField` | 数组的字段路径，如 `items`、`order.lines` |
| `columns` | 列：标题、列宽、对齐、单元格内容与单元格类型 |
| `header` | 表头：是否显示、跨页时是否每页重复、行高、样式 |
| `body` | 表体：行高与行高方式（`fixed` 固定，`minimum` 以行高为下限按内容撑高）、样式 |
| `footerRows` | 表尾行：每页都出现（`everyPage`）或只在表格结束的那一页出现（`lastPage`） |
| `maxRowsPerPage` | 每页最多几行数据，缺省按可用高度排满 |
| `fillEmptyRows` | 数据行不足时用空行补齐到每页最多行数或可用高度 |
| `border` | 网格线：线型，以及外框、横线、竖线各画不画 |

列的宽度合计应等于表格宽度，不一致时校验给出警告；在设计器里拖动表格宽度时列宽按比例缩放。

### 单元格

表体单元格的内容取自行对象：

| 内容 | 说明 |
| --- | --- |
| `field` | 行内字段，可带格式与空值时显示的文字 |
| `template` | 按行对象替换 `{{path}}` 占位 |
| `rowNumber` | 从 1 开始、跨页连续的行序号 |
| `expression` | 受限表达式，变量是行对象的顶层字段 |

单元格类型 `cellType` 决定怎么画：`text` 文字，`image` 把内容当图片地址，`barCode` 按列的 `barCodeFormat` 画一维条码，`matrixCode` 画 QR 码。

### 表尾行

表尾单元格从起始列 `columnId` 开始向右跨 `colSpan` 列，内容可以是固定文字、根数据的字段或模板，也可以是汇总：

| 汇总 | 说明 |
| --- | --- |
| `fn` | `sum` 求和、`avg` 平均、`count` 计数、`min` 最小、`max` 最大 |
| `field` | 参与汇总的行内字段；`count` 不给字段时统计行数 |
| `scope` | `page` 本页的数据行，`cumulative` 截至本页的累计，`all` 全部数据 |

「本页小计」放在 `everyPage` 的表尾行里、用 `scope: 'page'`；「合计」放在 `lastPage` 的表尾行里、用 `scope: 'all'`。送货单的表格：

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

表格跨页的规则见[运行时](./runtime#表格)。

## 校验

模板保存前、导入时都可以先校验。`validateDocument` 返回全部问题，每个问题有问题码、严重程度与路径；有错误级问题的模板不能分页。问题码见[问题码与诊断](../reference/issues)。

```ts
import type { PrintDocument, ValidationIssue } from '@xihan-print/core'
import { validateDocument } from '@xihan-print/core'
import { createExpressionEngine } from '@xihan-ui/expression'

export function checkTemplate(schema: PrintDocument): ValidationIssue[] {
  const report = validateDocument(schema, { expressionEngine: createExpressionEngine() })
  // report.valid 为 false 时 issues 里至少有一个 severity 为 error 的问题
  return report.issues
}
```
