来源：https://print.docs.xihanfun.com/guide/rich-text

# 富文本

富文本元素 `richText` 排一段带格式的文字：标题、段落、列表与分隔线，文字可以加粗、换颜色、改字号、加链接，还能嵌入行内字段。它和长文本一样随内容延展、跨页续排，只能放在正文区。

内容是 XiHan.UI 的富文本模型 `@xihan-ui/core/rich-text`，整份是 JSON，不存 HTML。模型的完整定义、HTML 白名单与问题码见 [XiHan.UI 的富文本模型](https://ui.docs.xihanfun.com/runtime/rich-text)，本页只讲打印怎么用它。


## 内容来源

| 来源 | 写法 | 说明 |
| --- | --- | --- |
| 写死的文档 | `{ kind: 'static', document }` | 模板里存一份富文本文档 |
| 字段里的 HTML | `{ kind: 'field', field, source: 'html' }` | 字段值是 HTML 串，打印时按白名单换成文档 |
| 字段里的文档 | `{ kind: 'field', field, source: 'document' }` | 字段值已是富文本文档对象 |

### 写死的文档

上面的停电检修通知，正文就是写死的文档：

```ts
const notice: RichTextContent = {
  kind: 'static',
  document: {
    blocks: [
      { type: 'heading', level: 1, align: 'center', runs: [{ type: 'text', text: '停电检修通知' }] },
      {
        type: 'paragraph',
        runs: [
          { type: 'text', text: '因供电线路检修，' },
          { type: 'field', field: 'building', marks: { bold: true } },
          { type: 'text', text: '将于 ' },
          { type: 'field', field: 'start', format: { kind: 'date', pattern: 'M 月 d 日 HH:mm' }, marks: { color: '#c0392b' } },
          { type: 'text', text: ' 起停电，预计持续 ' },
          { type: 'field', field: 'hours' },
          { type: 'text', text: ' 小时。请提前做好以下准备：' },
        ],
      },
      {
        type: 'list',
        ordered: true,
        items: [
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '保存正在编辑的文件，关闭电脑与显示器。' }] }] },
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '冰箱里的易腐物品', marks: { bold: true } }, { type: 'text', text: '请当天带走。' }] }] },
          { blocks: [{ type: 'paragraph', runs: [{ type: 'text', text: '电梯暂停运行，请走楼梯。' }] }] },
        ],
      },
      { type: 'divider' },
      { type: 'paragraph', align: 'right', runs: [{ type: 'text', text: '物业服务中心', marks: { italic: true } }] },
    ],
  },
}
```

- 行内字段 `{ type: 'field', field, format?, marks? }` 按字段路径从数据的根取值，`format` 是[值格式](./binding#值格式)，`marks` 是这截文字的样式；取到空值时什么都不显示。
- 文档里的链接只能是 `http`、`https`、`mailto`、`tel` 与相对地址，颜色写十六进制，字号单位 pt。

### 字段里的 HTML

业务系统里用富文本编辑器写的内容，通常以 HTML 存着，直接绑定字段即可：

```ts
page.elements = [
  registry.createElement('richText', {
    id: 'body',
    x: 12,
    y: 12,
    overrides: { width: 124, height: 40, content: notice, style: { ...baseStyle, fontSize: 11 } },
  }),
  registry.createElement('richText', {
    id: 'remark',
    x: 12,
    y: 58,
    overrides: { width: 124, height: 20, content: { kind: 'field', field: 'remark', source: 'html' }, style: { ...baseStyle, fontSize: 10, color: '#444444' } },
  }),
]
```

```ts
export const data = {
  building: '3 号楼',
  start: '2026-10-24 08:30:00',
  hours: 4,
  remark: '<h3>补充说明</h3><p>如有<strong>医疗设备</strong>等不能断电的情况，请在 <u>10 月 22 日前</u>联系物业登记。</p><script>track()</script>',
}
```

- 打印时按白名单把 HTML 换成文档：认识的标签与 `style` 属性换成块与样式，`script`、`img`、`iframe` 这类连同内容去掉，表格这类去掉标签、留下文字。规则见 [XiHan.UI 的解析 HTML](https://ui.docs.xihanfun.com/runtime/rich-text#解析-html)。
- 连同内容去掉或降级了标签时，给出警告诊断 `richText.droppedContent`，`params.field` 是字段路径，`params.names` 是去掉的标签名；`style` 属性与链接地址的取舍不报。上面的数据带了一段 `script`，所以会有这条警告。
- HTML 里的 `<span data-field="路径">` 也是行内字段，按同一份数据取值。

### 字段里的文档

字段值是富文本文档对象时用 `source: 'document'`。值先按模板里同样的规则检查，不合规时整段不画，给出错误级诊断 `richText.invalidData`：`params.field` 是字段路径，`params.code` 是问题码，`params.path` 是出问题的位置（如 `blocks[0].type`）。字段值是 JSON 串时也不合规，先在宿主这边解析成对象。

字段为空（`null`、`undefined` 或空串）时没有内容，不报诊断。

## 基准样式

元素的 `style` 是基准样式：字体、字号、颜色、行高倍数、字间距、对齐与垂直对齐。块的 `align` 与文字的 `marks` 在它之上覆写，没写的取基准样式。

## 排版规则

- 按元素内宽（扣掉左右内边距）逐块排。段落与标题的折行与普通文本是同一套规则：中日韩文字逐字可断，拉丁文按词断，一个单词跨两种样式时不拆开。
- 行高是这一行里最大的字号乘以行高倍数。上标与下标的字号缩到 0.7 倍，行高仍按原字号算。
- 一、二、三级标题的字号是基准字号的 1.6、1.35、1.15 倍，并且加粗；文字上写 `bold: false` 可以取消加粗。
- 顶层的块与块之间空半个基准字号；列表项之间、列表项里的块之间不空。
- 列表每层缩进两个基准字号。无序列表三层依次用 `•`、`◦`、`▪`，有序列表从 `start` 编号（缺省 1）；符号或序号的右边离文字半个基准字号。
- 分隔线单独占一行基准行高，用基准颜色画 0.2 mm 的横线。
- 两端对齐的块里，最后一行与换行之前的那一行不拉伸。
- 链接写成带地址的链接，外观只取这截文字自己的样式。

这些倍数都是 `@xihan-print/core` 导出的常量，见[模型层 core](../reference/core#layout-rich-text)。

## 跨页

跨页与长文本相同：按整行切到后续输出页，段落可以从中间切开；每段都带上下内边距，续排那一段的第一行不留段距；只有一段时高度不小于设计高度。富文本下面的元素随它下推，规则见[运行时](./runtime#正文元素的位置)。

不做孤行与寡行控制：标题可能单独留在一页的最后一行。

## 在设计器里

- 属性面板的「内容」先选来源；选「字段」时再选绑定的字段与内容格式（HTML 或富文本文档）。
- 写死的文档在属性面板上不能编辑，用代码写进模板（如上面的例子），或从存量模板迁移过来。
- 画布按设计态排版显示；不给示例数据时，字段显示为 `{路径}` 占位。

## 校验

| 问题码 | 级别 | 说明 |
| --- | --- | --- |
| `richText.invalidDocument` | 错误 | 文档结构不对，`params.code` 是 XiHan.UI 的[检查](https://ui.docs.xihanfun.com/runtime/rich-text#检查)给出的问题码 |
| `field.invalidPath` | 错误 | 行内字段的路径写法不对 |
| `format.*`、`invalid-option` 等 | 错误 | 行内字段的值格式不对，与文本内容的值格式同一套规则 |
| `richText.empty` | 警告 | 写死的文档没有任何文字、行内字段、分隔线或列表项 |
| `element.flowInBand` | 错误 | 放进了页眉或页脚 |

## 从存量 HTML 元素迁移

存量模板里的 HTML 元素，有的在模板里存一段 HTML，有的存一个返回 HTML 的函数。迁移到富文本由宿主完成：解析器是 `@xihan-ui/core/rich-text` 的 `parseRichTextHtml`，不依赖 DOM，Node.js 里也能跑，可以写成一次性的迁移脚本或放在服务端。

| 旧写法 | 迁移成 |
| --- | --- |
| 写死的 HTML | 解析成 `{ kind: 'static', document }` |
| 绑定字段，字段值是 HTML | `{ kind: 'field', field, source: 'html' }`，打印时再解析 |
| 函数只返回一个字符串字面量 | 静态取出这段字面量（不执行函数），再按写死的 HTML 处理 |
| 函数里有拼接、条件、取数等逻辑 | 不能自动迁移，记进报告人工改写成富文本加行内字段、带表达式的文本或其它元素 |
| HTML 里的表格、图片 | 解析时去掉并记进丢弃清单；表格改用表格元素，图片另起图片元素 |

迁移时不执行模板里的任何代码。

### 迁移报告

每个元素迁移后留一条记录，汇总起来就是迁移报告。报告的形状由宿主自定，打印的包里没有发布这些类型与函数；下面的 `migrateHtmlContent`、`RichTextMigrationEntry` 与 `needsReview` 只是一种写法，可以照着改成自己的：

```ts
import type { RichTextContent } from '@xihan-print/core'
import type { RichTextDrop } from '@xihan-ui/core/rich-text'
import { parseRichTextHtml } from '@xihan-ui/core/rich-text'

/** 旧元素里与迁移有关的三种写法。 */
export type LegacyHtmlContent
  = | { kind: 'html', html: string } // 写死的 HTML，或从只返回一个字符串字面量的函数里静态取出的 HTML
    | { kind: 'field', field: string } // 绑定字段，字段值是 HTML
    | { kind: 'code', source: string } // 其余的函数源码

/** 迁移报告里的一条：一个元素一条。 */
export interface RichTextMigrationEntry {
  /** 原元素的标识。 */
  elementId: string
  /** static：已换成写死的文档；field：改成绑定字段，打印时再解析；manual：要人工改写。 */
  outcome: 'static' | 'field' | 'manual'
  /** 解析时丢掉的东西，即 parseRichTextHtml 的 dropped；绑定字段与人工改写的为空。 */
  dropped: readonly RichTextDrop[]
  /** 人工改写时参考的原始内容。 */
  source?: string
}

export function migrateHtmlContent(elementId: string, legacy: LegacyHtmlContent): { content?: RichTextContent, entry: RichTextMigrationEntry } {
  switch (legacy.kind) {
    case 'html': {
      const { document, dropped } = parseRichTextHtml(legacy.html)
      return { content: { kind: 'static', document }, entry: { elementId, outcome: 'static', dropped } }
    }
    case 'field':
      return { content: { kind: 'field', field: legacy.field, source: 'html' }, entry: { elementId, outcome: 'field', dropped: [] } }
    case 'code':
      return { entry: { elementId, outcome: 'manual', dropped: [], source: legacy.source } }
  }
}

/** 要人工复核的条目：要人工改写的，以及丢了标签或连同内容去掉了东西（表格、图片、脚本等）的。 */
export function needsReview(entry: RichTextMigrationEntry): boolean {
  return entry.outcome === 'manual' || entry.dropped.some(drop => drop.kind === 'element' || drop.kind === 'content')
}
```

- `outcome` 是迁移结果：`static` 已换成写死的文档，`field` 改成绑定字段，`manual` 要人工改写，`source` 留着原来的内容供参考。
- `dropped` 直接取 `parseRichTextHtml` 的丢弃清单，每项是 `{ kind, name, count }`：`element` 去掉或降级了标签、文字保留，`content` 连同内容去掉，`style` 是不认识或取值不合法的 `style` 属性，`link` 是没通过判定的链接地址。同类同名合成一条并计数，详见 [XiHan.UI 的丢弃清单](https://ui.docs.xihanfun.com/runtime/rich-text#丢弃清单)。
- `dropped` 里有 `element` 或 `content` 的要人工复核，表格与图片要另外补上；只有 `style` 与 `link` 的通常可以忽略。
- 绑定字段的元素在迁移时还不知道数据里的 HTML 会丢什么，打印时由 `richText.droppedContent` 诊断报出。
