# 设计器

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

`@xihan-print/designer` 的公开接口。样式在 `@xihan-print/designer/style.css`，还要同时引入 `@xihan-ui/designer-shell/style.css` 与 `@xihan-print/runtime/style.css`。

## `<xh-print-designer>`

注册 &lt;xh-print-designer&gt;；重复调用不报错。

### 属性

| 属性 | attribute | 类型 | 说明 |
| --- | --- | --- | --- |
| `data` | — | `unknown` | 预览分页用的数据。 |
| `sampleData` | — | `unknown` | 示例数据：给出时画布按它显示实际值，不给时字段显示 {path} 占位。 |
| `fields` | — | `readonly DataField[] \| undefined` | 可绑定的字段树，供属性面板的字段选择器。 |
| `expressionEngine` | — | `ExpressionEngine \| undefined` | 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 |
| `formatter` | — | `ValueFormatter \| undefined` | 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 |
| `measurer` | — | `TextMeasurer \| undefined` | 文字度量器；缺省用所在文档的 Canvas 度量器。 |
| `printClient` | — | `PrintClient \| undefined` | 本地打印客户端：给了时打印先交给它静默打印，连不上客户端才退回浏览器打印。 |
| `locale` | `locale` | `string \| undefined` | 交给格式化器的区域，只决定小数点与千分位符号；同名 attribute。 |
| `timeZone` | `time-zone` | `string \| undefined` | 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称；attribute 为 time-zone。 |
| `translations` | — | `Partial<PrintDesignerTranslations> \| undefined` | 元素自己的文案，压在全局配置之上。 |
| `readonly` | `readonly` | `boolean` | 只读：可以选择、浏览与预览，不能修改。attribute 三态：不写或移除为不只读，写 "false" 为不只读，其余写法为只读。 |
| `mode` | `mode` | `PrintDesignerMode` | 设计态或预览态，缺省 design；同名 attribute。 |
| `grid` | — | `number \| false` | 吸附网格边长，mm，缺省 1；false 不吸附网格。 |
| `snap` | — | `boolean` | 吸附其它元素、页边距、区边界与参考线并显示对齐线，缺省 true。 |
| `panels` | `panels` | `string \| undefined` | 要显示的面板，空格分隔：toolbar palette pages rulers properties issues；不写即全部显示。同名 attribute。 |
| `commandLayout` | — | `DesignerCommandLayout \| undefined` | 工具栏与右键菜单的排列：位置（toolbar、menu:blank、menu:element、menu:table）→ 若干组命令 id，内置与扩展的命令可以混排。写了某个位置就只显示列出的命令；写了没登记的命令 id 时抛 TypeError。 |

### 存取器

| 属性 | 读写 | 类型 | 说明 |
| --- | --- | --- | --- |
| `schema` | 可读写 | `PrintDocument` | 打印模板。赋值即装载：清空历史与选择，重新自动适配（赋回当前这一份不重新装载）；读取时得到当前模板。 |
| `activePageId` | 可读写 | `string` | 当前页面模板的标识；赋值切换页面模板。 |
| `canUndo` | 只读 | `boolean` | 是否有可以撤销的修改。 |
| `canRedo` | 只读 | `boolean` | 是否有可以重做的修改。 |
| `dirty` | 只读 | `boolean` | 有未保存的修改。 |
| `extensions` | 可读写 | `readonly PrintDesignerExtension[] \| undefined` | 扩展：元素种类、编辑方式、规则、属性编辑器、命令与面板都从这里来，设计器自带的扩展与内置元素自动排在最前。赋值时当场合并查重，冲突抛 DesignerExtensionError、什么都不变；各扩展的 setup 在元素连上文档时调用、断开时清理。同一个扩展对象换了引用当作卸下再装上，宿主要保持引用稳定。 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `execute(operations: readonly PrintOperation[], options?: ExecuteOptions): PrintDocument` | 执行一组操作并记为一步撤销；返回新的模板。 |
| `undo(): boolean` | 撤销一步；没有可撤销的修改时返回 false。 |
| `redo(): boolean` | 重做一步；没有可重做的修改时返回 false。 |
| `markSaved(): void` | 把当前状态记为已保存。 |
| `addElement(type: string, at?: Point, options?: { readonly region?: ElementRegion }): PrintElement` | 新建元素并选中：at 是元素中心的纸张坐标（mm），缺省放在视口中央；位置吸附网格，region 缺省按落点所在区决定。 |
| `select(selection: Partial<PrintSelection>): void` | 替换当前选择；不在当前页面模板正文与当前显示的页眉页脚变体里的元素会被忽略。 |
| `getSelection(): PrintSelection` | 当前选择。 |
| `deleteSelection(): boolean` | 删除选中的元素；只读或没有选中时返回 false。 |
| `copy(): PrintClipboard \| undefined` | 复制选中的元素；没有选中时返回 undefined。 |
| `cut(): PrintClipboard \| undefined` | 复制并删除选中的元素；只读或没有选中时返回 undefined。 |
| `paste(clipboard?: PrintClipboard): PrintSelection` | 粘贴到当前页面模板并选中粘贴出的元素；缺省用最近一次复制的内容，连续粘贴依次错开。只读时不粘贴。 |
| `duplicate(): PrintSelection` | 复制选中的元素并立即粘贴，不改动剪贴板；只读时什么都不做。 |
| `align(mode: AlignMode): void` | 对齐选中的元素；少于两个或只读时什么都不做。 |
| `distribute(axis: DistributeAxis): void` | 等距分布选中的元素；少于三个或只读时什么都不做。 |
| `reorder(target: ReorderTarget): void` | 调整选中元素的层级。 |
| `validate(): ValidationIssue[]` | 按当前登记表与表达式引擎校验模板。 |
| `getViewport(): Viewport` | 视口：屏幕坐标 = 纸张坐标（mm）× zoom × 96 / 25.4 + (x, y)；zoom 为 1 时是实际尺寸。 |
| `setViewport(viewport: Viewport): void` | 设置视口；此后尺寸变化不再自动适配。 |
| `zoomToFit(): void` | 让整张纸落在视口中央，不放大到实际尺寸以上；此后尺寸变化时重新适配，直到设置视口或在画布上操作。 |
| `zoomIn(): void` | 以视口中心放大一档。 |
| `zoomOut(): void` | 以视口中心缩小一档。 |
| `zoomToActual(): void` | 实际尺寸，纸张居中。 |
| `scrollToElement(id: string): void` | 切到元素所在的页面模板与带区变体，并把元素居中。 |
| `revealElement(id: string): void` | 切到元素所在的页面模板与带区变体；元素没整个落在视口内时把它居中。 |
| `clientToWorld(clientX: number, clientY: number): Point` | 浏览器视口坐标换成纸张坐标（mm）。 |
| `print(options?: PrintPreviewPrintOptions): Promise<PrintOutcome>` | 按当前模板与 data 打印，等同 &lt;xh-print-preview&gt; 的 print。 |

### 事件

事件都是冒泡的 `CustomEvent`。

| 事件 | detail | 说明 |
| --- | --- | --- |
| `schema-change` | `{ schema: PrintDocument, operations: readonly PrintOperation[], kind: PrintSchemaChangeKind }` | 模板变了：schema 为变化后的模板，operations 为实际应用的操作；一次拖动、一次属性编辑等事务提交时合成一次，宿主装载新模板时 kind 为 load、operations 为空。 |
| `selection-change` | `PrintSelection` | 选择变了，detail 为当前选择。 |
| `dirty-change` | `{ dirty: boolean }` | 是否有未保存的修改变了。 |
| `issues-change` | `{ issues: readonly ValidationIssue[] }` | 模板改动或登记表、表达式引擎换了之后重新校验，detail 为全部校验问题。 |
| `viewport-change` | `{ viewport: Viewport }` | 视口变了，取值同 getViewport()。 |
| `save` | `Record<string, never>` | 设计态下焦点在设计器里（输入框与面板之外）时按了 Ctrl / ⌘ + S；设计器不保存，宿主保存后调用 markSaved()。 |
| `element-dblclick` | `{ id: string }` | 双击元素；双击表格时同时进入表格编辑态。 |
| `element-contextmenu` | `{ id: string, x: number, y: number }` | 在元素上打开右键菜单，未选中的元素先被选中；可取消，取消后不弹设计器自带的菜单。 |
| `blank-contextmenu` | `{ x: number, y: number }` | 在画布空白处打开右键菜单；可取消，取消后不弹设计器自带的菜单。 |
| `table-contextmenu` | `{ id: string, part: PrintTablePart, x: number, y: number }` | 在表格编辑态里打开右键菜单，右键处的表格部位先被选中；可取消，取消后不弹设计器自带的菜单。 |
| `import-error` | `{ importer: string, source: DesignerImportSource, error: unknown }` | 导入器没能导入粘贴或拖放进来的内容：它抛了错，或给出的元素没有通过校验；importer 是导入器的 id。 |
| `page-change` | `{ pageId: string }` | 当前页面模板变了。 |
| `mode-change` | `{ mode: PrintDesignerMode }` | 在设计态与预览态之间切换了。 |

## 类型

### PrintDesignerMode {#printdesignermode}

设计态或预览态。取值：`design`、`preview`。

### PrintSchemaChangeKind {#printschemachangekind}

schema-change 的种类：执行操作、撤销、重做，或宿主装载了新模板。取值：`execute`、`undo`、`redo`、`load`。

### PrintSelection {#printselection}

选择：都在当前页面模板的正文与当前显示的页眉页脚变体里；tablePart 只在表格编辑态下出现。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `elements` | `readonly string[]` |  |
| `tablePart?` | `PrintTablePart` |  |

### PrintTablePart {#printtablepart}

表格编辑态下选中的部位。

`| { readonly kind: 'column', readonly elementId: string, readonly columnId: string } | { readonly kind: 'header' | 'body', readonly elementId: string } | { readonly kind: 'footerRow', readonly elementId: string, readonly rowId: string } | { readonly kind: 'footerCell', readonly elementId: string, readonly rowId: string, readonly columnId: string }`

### PrintClipboard {#printclipboard}

剪贴板内容：被复制的元素与它们所在的区域。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `elements` | `readonly PrintElement[]` |  |
| `region` | `ElementRegion` |  |

### PrintDesignerTranslations {#printdesignertranslations}

设计器的文案。

文案键是 `xh-print-designer`，中文在 `@xihan-print/runtime/locale` 的 `printZhCN` 里。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 设计器的可访问名。 |
| `canvas` | `string` | 画布区域的可访问名。 |
| `grid` | `string` | 显示并吸附网格的开关。 |
| `snap` | `string` | 吸附其它元素与参考线的开关。 |
| `print` | `string` |  |
| `pages` | `string` | 页面模板页签的可访问名。 |
| `addPage` | `string` |  |
| `removePage` | `string` |  |
| `movePageLeft` | `string` |  |
| `movePageRight` | `string` |  |
| `regions` | `Readonly<Record<ElementRegion, string>>` | 页眉、正文、页脚的名称。 |
| `bandVariants` | `Readonly<Record<PageBandKey, string>>` | 页眉页脚变体的名称。 |
| `addBandVariant` | `string` |  |
| `removeBandVariant` | `string` |  |
| `elements` | `Readonly<Record<PrintElementType, string>>` | 元素种类的名称。 |
| `categories` | `Readonly<Record<ElementCategory, string>>` | 物料分组的名称。 |
| `tableParts` | `Readonly<Record<PrintTablePartKind, string>>` | 表格部位的名称。 |
| `editTable` | `string` |  |
| `exitTableEdit` | `string` |  |
| `insertColumnLeft` | `string` |  |
| `insertColumnRight` | `string` |  |
| `removeColumn` | `string` |  |
| `moveColumnLeft` | `string` |  |
| `moveColumnRight` | `string` |  |
| `insertFooterRowAbove` | `string` |  |
| `insertFooterRowBelow` | `string` |  |
| `removeFooterRow` | `string` |  |
| `mergeCellRight` | `string` |  |
| `splitCell` | `string` |  |
| `palette` | `string` | 物料面板的标题。 |
| `fieldGroup` | `string` | 物料面板里按 fields 列出的字段那一组的名称。 |
| `properties` | `string` | 属性面板的标题。 |
| `issues` | `string` | 问题列表的标题。 |
| `propertyGroups` | `Readonly<Record<PropertyGroup, string>>` | 属性分组的名称。 |
| `propertyNames` | `Readonly<Record<string, string>>` | 属性名：键为 formatJsonPath(path)；「对象种类:路径」覆盖同一路径在该种类上的名字，对象种类是 page、元素种类或 table-column 等表格部位。复合属性拆开后的分项用「复合种类/分项」作键，如 stroke/width、edges/top。 |
| `propertyOptions` | `Readonly<Record<string, string>>` | select 选项名：键为选项值；「路径=选项值」覆盖该属性上的名字。 |
| `units` | `Readonly<Record<PropertyUnit, string>>` | 数值属性的单位。 |
| `pageSettings` | `string` | 属性面板在没有选中时编辑页面设置，标题下的一行。 |
| `pageNumberInsert` | `string` | 页码格式编辑器里插入变量的菜单按钮。 |
| `pageNumberTokens` | `Readonly<{ page: string, pages: string }>` | 页码格式里能插入的两个变量：当前页码与总页数。 |
| `valueFormatKind` | `string` | 值格式编辑器里种类下拉的名字。 |
| `valueFormatKinds` | `Readonly<{ none: string, format: string, map: string, expression: string }>` | 值格式的种类：不设格式、常用格式（数字、百分比、日期、人民币大写、数字字形）、值映射、表达式。 |
| `valueMapColumns` | `Readonly<{ value: string, text: string }>` | 值映射表的两列：数据值与显示文本。 |
| `valueMapAdd` | `string` | 值映射表下面添加一项的按钮。 |
| `valueMapFallback` | `string` | 值映射里没有命中任何一项时显示的文本。 |

| 方法 | 说明 |
| --- | --- |
| `pageTitle(position: number): string` | 没有名称的页面模板的标题，position 从 1 开始。 |
| `bandVariant(region: 'header' \| 'footer'): string` | 选择当前编辑的页眉或页脚变体的控件的可访问名。 |
| `resizeBand(region: 'header' \| 'footer'): string` | 拖动调整页眉或页脚高度的把手的可访问名。 |
| `elementLabel(type: string, name: string): string` | 画布上一个元素的可访问名：种类名加元素名称或标识。 |
| `resizeColumn(title: string): string` | 拖动调整列宽的把手的可访问名。 |
| `newColumnTitle(position: number): string` | 新插入的列的标题，position 从 1 开始。 |
| `measure(width: string, height: string): string` | 拖动元素时显示的尺寸，入参是格式化后的宽与高（mm）。 |
| `issue(issue: SchemaIssue): string` | 校验问题与分页诊断的说明，按问题码与参数生成。 |
| `propertyPart(parent: string, part: string): string` | 复合属性拆开后分项的名字，如「页边距 · 上」。 |
| `selectedCount(count: number): string` | 属性面板在选中多个元素时标题下的一行。 |
| `pageNumberSample(text: string): string` | 页码格式的示例，入参是按第 1 页、共 3 页填好的文字。 |
| `valueMapCell(index: number, column: string): string` | 值映射表里一格的名字，index 从 1 起，column 是列名。 |

## 编辑模型

设计器内部的编辑模型也一并导出，不显示界面、只想按操作改模板时可以直接用。创建打印编辑模型。

```ts
declare function createPrintEditor(options: PrintEditorOptions): PrintEditor
```

### PrintEditorOptions {#printeditoroptions}

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `document` | `PrintDocument` |  |
| `extensions?` | `readonly PrintCoreExtension[]` | 扩展：元素种类、编辑方式与规则，内置扩展自动排在最前。 |
| `historyLimit?` | `number` | 撤销步数上限，缺省 100。 |
| `mergeWithin?` | `number` | 同一合并键相隔多少毫秒内并入上一步，缺省 1000。 |

| 方法 | 说明 |
| --- | --- |
| `now(): number` |  |

### PrintEditor {#printeditor}

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `document` | `PrintDocument` |  |
| `elements` | `ElementRegistry` | 当前扩展合出的元素登记表。 |
| `history` | `History<PrintDocument, PrintOperation>` |  |
| `selection` | `PrintSelection` |  |
| `activePageId` | `string` |  |
| `page` | `PrintPage` | 当前页面模板。 |
| `bands` | `PrintBandView` |  |

| 方法 | 说明 |
| --- | --- |
| `setExtensions(extensions: readonly PrintCoreExtension[]): void` | 换一组扩展：之后的编辑操作与校验都按它；冲突时抛 DesignerExtensionError、什么都不变。 |
| `load(document: PrintDocument): void` | 装载新文档：清空历史与选择，当前页面回到第一张；文档变化的 cause 为 reset。 |
| `execute(operations: readonly PrintOperation[], options?: ExecuteOptions): PrintDocument` | 执行一组操作并记为一步撤销；返回新文档。 |
| `undo(): boolean` |  |
| `redo(): boolean` |  |
| `seal(): void` | 封口：此后带同一合并键的修改另起一步。 |
| `setActivePage(pageId: string): void` | 切换当前页面模板并清空选择；页面不存在时抛错。 |
| `setBandVariant(region: 'header' \| 'footer', key: PageBandKey): void` | 切换页眉或页脚当前显示的变体；变体不存在时用 default。选择里不再显示的元素随之取消选择。 |
| `select(selection: Partial<PrintSelection>, mode?: PrintSelectMode): void` |  |
| `selectAll(): void` |  |
| `clearSelection(): void` |  |
| `visibleElements(): { readonly element: PrintElement, readonly region: ElementRegion }[]` | 当前页面模板里可见的元素（正文与当前显示的页眉页脚变体），按页眉、正文、页脚的层级顺序。 |
| `addElement(type: string, init: PrintAddElementInit, options?: ExecuteOptions): PrintElement` | 按元素类型新建元素并选中它；类型未登记时抛错。 |
| `deleteSelection(options?: ExecuteOptions): boolean` | 删除选中的元素；没有选中时返回 false。 |
| `moveElements(ids: readonly string[], dx: number, dy: number, options?: ExecuteOptions): void` | 平移一组元素，单位 mm；位移为零或元素为空时什么都不做。 |
| `reorder(target: ReorderTarget, options?: ExecuteOptions): void` | 调整选中元素的层级；多个元素按选中先后依次调整。 |
| `align(mode: AlignMode, options?: ExecuteOptions): void` | 对齐选中的元素；少于两个时什么都不做。 |
| `distribute(axis: DistributeAxis, options?: ExecuteOptions): void` | 等距分布选中的元素；少于三个时什么都不做。 |
| `copy(): PrintClipboard \| undefined` | 复制选中的元素；没有选中时返回 undefined。 |
| `cut(options?: ExecuteOptions): PrintClipboard \| undefined` | 复制并删除选中的元素。 |
| `paste(clipboard?: PrintClipboard, options?: ExecuteOptions & { readonly offset?: number }): PrintSelection` | 粘贴到当前页面模板并选中粘贴出的元素；缺省用最近一次 copy 的内容，每次粘贴比上一次多偏移 offset（mm）。 |
| `duplicate(options?: ExecuteOptions & { readonly offset?: number }): PrintSelection` | 复制选中内容并立即粘贴，不改动剪贴板。 |
| `addPage(index?: number, options?: ExecuteOptions): PrintPage` | 在 index 处（缺省末尾）新增一张页面模板并切到它。 |
| `removePage(pageId: string, options?: ExecuteOptions): boolean` | 删除页面模板；只剩一张时不删并返回 false。 |
| `movePage(pageId: string, index: number, options?: ExecuteOptions): void` |  |
| `addBand(region: 'header' \| 'footer', variant: PageBandVariant, options?: ExecuteOptions): void` | 为当前页面模板的页眉或页脚新增变体（高度取 default 的高度）并切到它；已存在时只切换。 |
| `removeBand(region: 'header' \| 'footer', variant: PageBandVariant, options?: ExecuteOptions): void` | 删除当前页面模板页眉或页脚的变体及其中的元素。 |
| `setBandHeight(region: 'header' \| 'footer', key: PageBandKey, height: number, options?: ExecuteOptions): void` | 设置当前页面模板某个带区的高度，单位 mm。 |
| `applyTablePlan(tableId: string, plan: TablePlanResult, options?: ExecuteOptions): boolean` | 按 core 的表格计划修改表格；计划被拒时不改文档并返回 false。 |
| `validate(): ValidationIssue[]` |  |
| `subscribe(listener: (change: PrintEditorChange) => void): () => void` |  |

## 全部导出

### editor

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `createPrintEditor` | 函数 | 创建打印编辑模型。 |
| `elementRect` | 函数 | 元素外框：带旋转角的元素按旋转后的形状参与对齐与分布。 |
| `PrintAddElementInit` | 接口 | 新建元素的参数：位置为左上角，单位 mm；region 缺省为正文，页眉页脚放进当前显示的变体。 |
| `PrintBandView` | 接口 | 当前页面模板显示的页眉与页脚变体。 |
| `PrintClipboard` | 接口 | 剪贴板内容：被复制的元素与它们所在的区域。 |
| `PrintEditor` | 接口 |  |
| `PrintEditorChange` | 类型 | 编辑模型的变化：文档变化带上历史变化的种类与实际应用的操作；视图变化指当前页面、带区变体或选择变了。 |
| `PrintEditorOptions` | 接口 |  |
| `PrintSelection` | 接口 | 选择：都在当前页面模板的正文与当前显示的页眉页脚变体里；tablePart 只在表格编辑态下出现。 |
| `PrintSelectMode` | 类型 | 选择方式：替换、追加或切换。 |
| `PrintTablePart` | 类型 | 表格编辑态下选中的部位。 |

### extensions

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `createPrintDesignerModel` | 函数 | 合出设计器用的模型；任何一处重名都抛 DesignerExtensionError，物料项给了别处登记的元素类型时抛 TypeError。 |
| `PRINT_DESIGNER_EXTENSION_ID` | 常量 | 设计器自带的扩展的 id：内置命令，以及表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 |
| `PRINT_PAGE_COMMANDS` | 常量 | 页面模板页签旁的命令，排列固定。 |
| `PRINT_TOOLBAR_LAYOUT` | 常量 | 工具栏的缺省排列；commandLayout 没写 toolbar 时用它，再把 placement 含 toolbar 的扩展命令追加成一组。 |
| `PrintDesignerCommand` | 类型 | 设计器的命令：工具栏按钮、右键菜单项与快捷键共用。 |
| `PrintDesignerContext` | 接口 | 扩展装上时拿到的上下文。 |
| `PrintDesignerExtension` | 接口 | 打印设计器层的扩展：运行时层的全部字段（元素种类、渲染、编辑方式与规则），加上属性编辑器、命令、面板、导入器、物料项与 setup。 |
| `PrintDesignerImporter` | 类型 | 导入器：把粘贴或拖放进来的外部内容换成一组元素；返回 undefined 即不放任何元素。 |
| `PrintDesignerModel` | 接口 | 一组设计器扩展合出的东西：交给 core 函数与预览的列表、运行时的模型、属性编辑器表、命令表、导入器与物料项。 |
| `PrintImportFragment` | 接口 | 导入的结果：一组元素，整体挪到落点（粘贴时为视口中央）后按粘贴的规则放进当前页面模板。 |
| `printMenuLayout` | 函数 | 右键菜单的缺省排列；选中的是一张表格时，元素菜单最前面加「编辑表格」。 |
| `PrintMenuSubject` | 类型 | 右键菜单落在哪类对象上：画布空白处、元素，或表格编辑态里的表格部位。 |
| `PrintPaletteEntry` | 接口 | 物料面板里的一项：扩展元素的名称与图标。 |

### print-designer

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `definePrintDesigner` | 函数 | 注册 &lt;xh-print-designer&gt;；重复调用不报错。 |
| `PRINT_DESIGNER_TAG` | 常量 | 设计器的标签名。 |
| `PrintDesignerEventMap` | 接口 | 设计器派发的事件；x / y 为浏览器视口坐标。 |
| `PrintDesignerMode` | 类型 | 设计态或预览态。 |
| `PrintSchemaChangeKind` | 类型 | schema-change 的种类：执行操作、撤销、重做，或宿主装载了新模板。 |
| `XhPrintDesigner` | 类 |  |
