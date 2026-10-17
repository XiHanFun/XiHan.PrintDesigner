# 预览与打印

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

`@xihan-print/runtime` 的公开接口：预览元素、直接打印的函数与相关类型。样式在 `@xihan-print/runtime/style.css`。

## `<xh-print-preview>`

注册 &lt;xh-print-preview&gt;；同一构造器重复注册不报错，没有 customElements 的环境跳过。

### 属性

| 属性 | attribute | 类型 | 说明 |
| --- | --- | --- | --- |
| `schema` | — | `PrintDocument \| undefined` | 打印模板。 |
| `data` | — | `unknown` | 绑定的数据。 |
| `expressionEngine` | — | `ExpressionEngine \| undefined` | 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 |
| `formatter` | — | `ValueFormatter \| undefined` | 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 |
| `measurer` | — | `TextMeasurer \| undefined` | 文字度量器；缺省用所在文档的 Canvas 度量器，字体加载完成后自动重排。 |
| `translations` | — | `Partial<PrintPreviewTranslations> \| undefined` | 元素自己的文案，压在全局配置之上。 |
| `locale` | `locale` | `string \| undefined` | 交给格式化器的区域。 |
| `timeZone` | `time-zone` | `string \| undefined` | 交给格式化器的时区。 |
| `zoom` | `zoom` | `number \| undefined` | 显示缩放倍数，缺省 1；写在宿主的 --xh-print-zoom 上，由 style.css 作用到输出页，只影响预览、不影响打印。 |
| `printClient` | — | `PrintClient \| undefined` | 本地打印客户端（@xihan-print/runtime/client 的 createPrintClient）：给了时 print() 先交给它静默打印，连不上客户端才退回浏览器打印。 |

### 存取器

| 属性 | 读写 | 类型 | 说明 |
| --- | --- | --- | --- |
| `extensions` | 可读写 | `readonly PrintCoreExtension[] \| undefined` | 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前。赋值时当场合并查重，冲突抛 DesignerExtensionError、什么都不变；同一个数组只合并一次，宿主要保持引用稳定。 |
| `result` | 只读 | `PaginationResult \| undefined` | 最近一次分页的结果；还没分页或分页失败时为 undefined。 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `paginate(): PaginationResult \| undefined` | 立即按当前属性重新分页并渲染，返回分页结果；没有模板或分页失败时返回 undefined，失败另派发 pagination-error。 |
| `print(options?: PrintPreviewPrintOptions): Promise<PrintOutcome>` | 打印当前模板：按当前属性重新分页后送去打印，只在预览中显示的元素不打印。没有模板或分页失败时抛错。给了 printClient 时先交给本地打印客户端，等到交给打印池；只在连不上客户端时退回浏览器打印，其它错误照常抛出。 |

### 事件

事件都是冒泡的 `CustomEvent`。

| 事件 | detail | 说明 |
| --- | --- | --- |
| `paginated` | `{ readonly sheets: number, readonly diagnostics: readonly PaginationDiagnostic[] }` | 分页并渲染完成。 |
| `pagination-error` | `PaginationErrorDetail` | 分页失败，已清空预览。 |

## 函数

### printDocument() {#printdocument}

```ts
declare function printDocument(schema: PrintDocument, data: unknown, options?: PrintOptions): Promise<PrintOutcome>
```

按数据排出模板并直接打印，不需要页面上有预览元素。度量器缺省用发起打印的文档里的 Canvas 度量器，表达式引擎与格式化器缺省同预览元素。文档不合法或拿不到度量器时抛错，不打开打印对话框。

### printSheets() {#printsheets}

```ts
declare function printSheets(result: PaginationResult, options?: PrintSheetsOptions): Promise<void>
```

把排好的输出页送去打印：在隐藏 iframe 里渲染（只在预览中显示的元素不画），纸张尺寸不同的输出页分到各自的具名 @page，带上源文档的字体，等样式表、图片与字体就绪后调起打印对话框，对话框关闭后移除 iframe。

### definePrintPreview() {#defineprintpreview}

```ts
declare function definePrintPreview(): void
```

注册 &lt;xh-print-preview&gt;；同一构造器重复注册不报错，没有 customElements 的环境跳过。

### renderSheets() {#rendersheets}

```ts
declare function renderSheets(result: PaginationResult, container: Element, options?: RenderSheetsOptions): HTMLDivElement[]
```

把分页结果渲染进 container：先清空 container，再按顺序放入每张输出页，返回这些输出页元素。输出页按纸张尺寸定宽高，元素按毫米绝对定位；只用标准 HTML 与 SVG，任何文档里都能渲染，不依赖自定义元素注册。

## 类型

### PrintRenderOptions {#printrenderoptions}

分页用到的注入项：预览元素的属性与 printDocument 的选项共用这一组。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `measurer?` | `TextMeasurer` | 文字度量器；缺省用所在文档的 Canvas 度量器（@xihan-ui/viz 的 createCanvasMeasurer），拿不到 2D 上下文时报 measurer.unavailable。 |
| `expressionEngine?` | `ExpressionEngine` | 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 |
| `formatter?` | `ValueFormatter` | 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 |
| `locale?` | `string` | 交给格式化器的区域。 |
| `timeZone?` | `string` | 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称。 |
| `maxSheets?` | `number` | 输出页总数上限，缺省同 @xihan-print/core 的 paginate。 |
| `extensions?` | `readonly PrintCoreExtension[]` | 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前。 |

### PrintOptions {#printoptions}

printDocument 的选项：分页注入项加上打印选项。

继承 `PrintRenderOptions`、`PrintSheetsOptions`。

### PrintSheetsOptions {#printsheetsoptions}

printSheets 的选项。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `document?` | `Document` | 发起打印的文档，缺省为全局 document；隐藏 iframe 挂在它的 body 上。 |
| `title?` | `string` | 打印文档的标题，即打印对话框与另存 PDF 时的缺省文件名；缺省沿用发起打印的文档标题。 |

### PrintOutcome {#printoutcome}

一次打印的结果：送去打印的输出页数与分页诊断。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `sheets` | `number` |  |
| `diagnostics` | `readonly PaginationDiagnostic[]` |  |
| `via?` | `'client' \| 'browser'` | 送去打印的途径：client 为本地打印客户端，browser 为浏览器的打印对话框。 |

### PrintPreviewPrintOptions {#printpreviewprintoptions}

print() 的选项：浏览器打印时的标题，以及交给本地打印客户端的打印选项。

继承 `Pick<PrintSheetsOptions, 'title'>`、`ClientPrintOptions`。

### PaginationErrorDetail {#paginationerrordetail}

分页失败的原因：core 的 PrintLayoutError 或运行时的 PrintRuntimeError。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `code` | `PrintLayoutErrorCode \| PrintRuntimeErrorCode` |  |
| `params` | `IssueParams` |  |
| `issues` | `readonly ValidationIssue[]` | 文档不合法时的校验问题。 |

### PrintPreviewTranslations {#printpreviewtranslations}

预览元素的文案。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 预览区域的可访问名。 |

| 方法 | 说明 |
| --- | --- |
| `sheetLabel(position: number, count: number): string` | 一张输出页的可访问名；position 从 1 开始，count 为输出页总数。 |

## 全部导出

### options

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PrintRenderOptions` | 接口 | 分页用到的注入项：预览元素的属性与 printDocument 的选项共用这一组。 |
| `PrintRuntimeError` | 类 | 运行时无法完成分页或打印时抛出的错误，`code` 与 `params` 供调用方判断与生成文案。 |
| `PrintRuntimeErrorCode` | 类型 | 运行时无法完成分页或打印的原因：拿不到文字度量器、没有给模板。 |

### print

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `printDocument` | 函数 | 按数据排出模板并直接打印，不需要页面上有预览元素。 |
| `PrintOptions` | 接口 | printDocument 的选项：分页注入项加上打印选项。 |
| `PrintOutcome` | 接口 | 一次打印的结果：送去打印的输出页数与分页诊断。 |
| `printSheets` | 函数 | 把排好的输出页送去打印：在隐藏 iframe 里渲染（只在预览中显示的元素不画），纸张尺寸不同的输出页分到各自的具名 @page，带上源文档的字体，等样式表、图片与字体就绪后调起打印对话框，对话框关闭后移除 iframe。 |
| `PrintSheetsOptions` | 接口 | printSheets 的选项。 |

### print-preview

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `definePrintPreview` | 函数 | 注册 &lt;xh-print-preview&gt;；同一构造器重复注册不报错，没有 customElements 的环境跳过。 |
| `PaginationErrorDetail` | 接口 | 分页失败的原因：core 的 PrintLayoutError 或运行时的 PrintRuntimeError。 |
| `PRINT_PREVIEW_TAG` | 常量 | 预览元素的标签名。 |
| `PrintPreviewEventMap` | 接口 | 预览元素派发的事件。 |
| `PrintPreviewPrintOptions` | 接口 | print() 的选项：浏览器打印时的标题，以及交给本地打印客户端的打印选项。 |
| `XhPrintPreview` | 类 |  |

### render/boxes

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `renderBox` | 函数 | 按布局盒的种类渲染一个元素。 |

### render/sheets

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `renderSheets` | 函数 | 把分页结果渲染进 container：先清空 container，再按顺序放入每张输出页，返回这些输出页元素。 |
| `RenderSheetsOptions` | 接口 | renderSheets 的选项。 |
| `sheetPageName` | 函数 | 纸张尺寸对应的 CSS 具名页面，尺寸相同的输出页共用一个名字。 |

### render/watermark

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `renderWatermark` | 函数 | 按模板的水印生成覆盖整张输出页的一层；没有可印的文字时返回 undefined。 |

### translations

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PrintDesignerTranslations` | 接口 | 设计器的文案。 |
| `PrintPreviewTranslations` | 接口 | 预览元素的文案。 |
| `PrintTablePartKind` | 类型 | 表格编辑态里可以选中的部位。 |

## `@xihan-print/runtime/locale` 的导出

### locale

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `printZhCN` | 常量 | 打印预览与设计器的中文文案。 |
