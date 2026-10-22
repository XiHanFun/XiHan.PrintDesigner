来源：https://print.docs.xihanfun.com/guide/host

# 与宿主集成

组件只管设计、排版与打印，不发网络请求，也不碰存储与权限。把它嵌进业务系统时，下面这些由宿主来做：

| 事情 | 宿主做什么 | 组件给什么 |
| --- | --- | --- |
| 模板的保存 | 存模板 JSON，管名称、分类、版本与审核 | `schema`、`schema-change`、`save`、`dirty`、`markSaved()` |
| 取数 | 调接口取业务数据，整理成模板要的结构 | `data`、`sampleData`、`fields` |
| 权限 | 决定谁能看、谁能改、谁能打印，服务端再复核 | `readonly`、`defaultLayout`、`settingsPolicy`、`extensions` |
| 校验 | 保存前拦住有错误的模板，服务端复核 | `validate()`、`issues-change`、`validateDocument` |
| 打印记录 | 记下谁在什么时候打了什么 | `print()` 的结果、客户端任务的状态 |

## 模板的保存

模板是一份完整的 JSON，原样存、原样取，不要拆成字段存。`schemaVersion` 记录模板格式的版本；`meta`（文档、页面与元素上都有）放宿主自己的数据，组件不读、原样保留。

打开时把取回的模板赋给 `schema`，保存时取 `schema` 交给后端，成功后 `markSaved()`：

```ts
import type { PrintDocument, ValidationIssue } from '@xihan-print/core'
import type { XhPrintDesigner } from '@xihan-print/designer'
import type { JsonValue } from '@xihan-ui/core/json'
import type { DataField } from '@xihan-ui/designer-kit'
import { collectDocumentFields, validateDocument } from '@xihan-print/core'
import { inferDataFields } from '@xihan-ui/designer-kit/field-inference'

export async function openTemplate(designer: XhPrintDesigner, id: string): Promise<void> {
  const response = await fetch(`/api/print-templates/${encodeURIComponent(id)}`)
  designer.schema = await response.json() as PrintDocument

  designer.addEventListener('save', async () => {
    const issues = designer.validate().filter(issue => issue.severity === 'error')
    if (issues.length > 0)
      return
    const saved = await fetch(`/api/print-templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(designer.schema),
    })
    if (saved.ok)
      designer.markSaved()
  })
}
```

设计器在内存里改模板，页面关掉修改就没了。有未保存的修改时提醒用户：

```ts
export function guardUnsaved(designer: XhPrintDesigner): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (designer.dirty)
      event.preventDefault()
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}
```

用户在设置里打开自动保存时，未保存的修改另存一份这台浏览器里的草稿，下次打开同一个模板时问要不要恢复；宿主给设计器写 `draftKey`（模板 id）区分不同模板，存完照旧调 `markSaved()`，草稿随之删掉，见[自动保存本机草稿](./designer#自动保存本机草稿)。

### 关闭编辑器

设计器占满一整页、编辑完要回到模板列表时，给它写 `closable`：菜单栏最右端多一颗关闭钮，按下派发 `close`。设计器自己不关、不问，宿主接 `close`，有未保存的修改时先问，再离开：

```ts
export function closeToList(designer: XhPrintDesigner, host: { readonly confirmLeave: () => Promise<boolean>, readonly backToList: () => void }): void {
  designer.closable = true
  designer.addEventListener('close', async () => {
    if (designer.dirty && !await host.confirmLeave())
      return
    host.backToList()
  })
}
```

## 取数

- **打印时**：宿主调接口取业务数据，交给预览的 `data` 或 `printDocument`。字段路径对的是这份数据的结构，接口返回的结构与模板不一致时，在宿主这边转换好再交给组件。
- **设计时**：`fields` 告诉设计器有哪些字段可以绑定，物料面板的「字段」一组也按它列出，字段写了 `content`（`image`、`barcode`、`qrcode`）时拖上画布生成对应的元素，见[字段物料](./designer#字段物料)；`sampleData` 让画布显示实际的值。用户可以在设计器里从 JSON 样例或 JSON Schema 导入字段（见[导入字段](./designer#导入字段)），宿主收 `fields-change` 与 `sample-data-change` 存起来；字段由后端定、不许用户改时写 `fields-readonly`。宿主也可以自己按一份示例数据生成字段树，用的是同一个推断函数：

```ts
/** 按一份示例数据生成字段树：对象是 object，对象数组是 list（子字段取各项键的并集），其余是带类型的 value。 */
export function fieldsOf(sample: JsonValue): readonly DataField[] {
  return inferDataFields(sample, { detectImages: true }).fields
}
```

- 反过来，`collectDocumentFields(document)` 列出一份模板引用了哪些字段，形状同 `fields`：文本、长文本、条码与二维码的内容（字段、`{{path}}` 模板串与表达式里的路径），图片与富文本的字段来源，表格的 `dataField`（记成 `list`，各列与汇总里的行内字段挂在它下面），以及页面水印。以 `$` 开头的宿主变量（如 `$page`）不算；只知道路径，所以不带 `label` 与 `type`。值字段带上 `content`：被图片的字段来源引用记 `image`，被条码、二维码的内容直接取用记 `barcode`、`qrcode`，表格里单元格类型是图片、条码、二维码的列同样；模板串与表达式里的字段只是内容的一部分，不记。一个字段被几种元素引用时取文字以外的那一种，文字以外的种类有冲突时取模板里先出现的那一种。没有数据源的模板可以按它生成示例数据的表单，有数据源的可以拿它核对模板里有没有数据源没有的字段。用了扩展元素时把 `extensions` 一并传进去：

```ts
/** 列出模板引用的字段，与宿主给的字段树比对，找出数据源里没有的那些路径。 */
export function missingFields(document: PrintDocument, known: readonly DataField[]): string[] {
  const missing: string[] = []
  const walk = (used: readonly DataField[], offered: readonly DataField[] | undefined, prefix: string): void => {
    for (const field of used) {
      const path = prefix === '' ? field.name : `${prefix}.${field.name}`
      const match = offered?.find(item => item.name === field.name)
      if (match === undefined)
        missing.push(path)
      else if (field.children)
        walk(field.children, match.children, path)
    }
  }
  walk(collectDocumentFields(document), known, '')
  return missing
}
```

- 图片地址由宿主提供：放在宿主的文件服务里，模板里写地址或绑定数据里的地址字段。要经打印客户端打印的图片，文件服务要允许跨源读取（CORS）。

## 存量模板迁移

整份存量模板（别的打印组件存的模板）的迁移由宿主写转换函数：把旧模板读成 `PrintDocument`，过 `validateDocument`，没有错误级问题时再赋给设计器的 `schema`。纸张、方向、页边距、页眉页脚变体与多页模板都在转换函数里一并换好：

```ts
/** 打开一份存量模板：转换函数由宿主写，产出的模板先校验，没有错误级问题才交给设计器。 */
export function openLegacyTemplate(designer: XhPrintDesigner, legacy: unknown, convert: (legacy: unknown) => PrintDocument): ValidationIssue[] {
  const document = convert(legacy)
  const errors = validateDocument(document).issues.filter(issue => issue.severity === 'error')
  if (errors.length === 0)
    designer.schema = document
  return errors
}
```

- 转换在宿主里跑，可以在前端打开旧模板时转，也可以在服务端批量转好再存；`@xihan-print/core` 不依赖 DOM，两边都能校验。
- 设计器的导入器只把粘贴、拖进来的外部内容换成元素，不负责整份模板。
- 旧模板里的 HTML 元素怎么换成富文本，见[富文本](./rich-text#从存量-html-元素迁移)。

## 权限

- 只能看的用户把设计器设成 `readonly`：能选择、浏览、预览与打印，不能修改。
- 只让调整局部的场景，用 `settingsPolicy` 的 `layout.panels.<面板 id>` 去掉物料等面板（面板 id 见 `PRINT_DESIGNER_PANELS`），用自定义属性编辑器限定可选的值。
- 这些都只在前端生效。模板保存、删除与打印的权限要在服务端判断；保存时服务端也应复核模板本身。

## 服务端复核

`@xihan-print/core` 不依赖 DOM，可以在 Node.js 后端直接校验收到的模板：

```ts
/** 服务端收到模板时复核：只有错误级问题才拒收，返回这些问题的问题码与路径。 */
export function reviewTemplate(body: string): { valid: boolean, errors: string[] } {
  const report = validateDocument(JSON.parse(body) as PrintDocument)
  const errors = report.issues
    .filter(issue => issue.severity === 'error')
    .map(issue => `${issue.code} @ ${issue.path.join('.')}`)
  return { valid: report.valid, errors }
}
```

后端不是 JavaScript 时，前端在提交前用 `validate()` 拦住有错误的模板；服务端把模板当作不透明的 JSON 存取，需要时另起一个 Node.js 服务做复核。

## 在前端框架里使用

预览与设计器是原生 Web Components，任何框架都能用：在应用启动时调用一次 `definePrintPreview()` 或 `definePrintDesigner()`，之后像普通元素一样放进模板。模板、数据这类对象要交给元素的属性，不要写成 attribute。

在 Vue 里，先告诉编译器 `xh-` 开头的标签是自定义元素，免得被当成组件去解析：

```ts
// vite.config.ts 里 @vitejs/plugin-vue 的选项
vue({
  template: {
    compilerOptions: {
      isCustomElement: tag => tag.startsWith('xh-'),
    },
  },
})
```

对象用 `.prop` 修饰交给属性，事件用 `@` 监听：

```vue
<script setup lang="ts">
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 在 Vue 里使用预览元素：对象经 .prop 交给元素的属性，事件用 @ 监听。

import type { PrintPreviewEventMap } from '@xihan-print/runtime'
import { definePrintPreview } from '@xihan-print/runtime'
import { ref } from 'vue'
import { data, schema } from '../templates/delivery'

definePrintPreview()

const status = ref('')

function onPaginated(event: Event): void {
  const { sheets } = (event as PrintPreviewEventMap['paginated']).detail
  status.value = `共 ${sheets} 张输出页`
}
</script>

<template>
  <p>{{ status }}</p>
  <xh-print-preview :schema.prop="schema" :data.prop="data" @paginated="onPaginated" />
</template>
```


React 19 起会把对象直接赋给自定义元素的同名属性；事件可以用 `ref` 拿到元素后 `addEventListener` 监听。

## 一个页面里放多个实例

组件不往 `window` 上挂对象，也不读写固定键名的本地存储，同一页面里的多个预览、多个设计器互不影响。只有语言包是全局的：`setXhConfig` 对页面上所有元素生效，单个实例的文案用它的 `translations` 属性覆写。
