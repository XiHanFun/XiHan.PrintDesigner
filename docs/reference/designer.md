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
| `fields` | — | `readonly DataField[] \| undefined` | 可绑定的字段树：物料面板「字段」组与属性面板的字段选择器读它；导入字段时设计器换掉它并派发 fields-change。 |
| `fieldsReadonly` | `fields-readonly` | `boolean` | 字段由宿主管着、不许在设计器里导入：物料面板头没有导入字段钮，import-fields 命令不可用。attribute 为 fields-readonly。 |
| `expressionEngine` | — | `ExpressionEngine \| undefined` | 受限表达式引擎；缺省为 @xihan-ui/expression 的 createExpressionEngine()。 |
| `formatter` | — | `ValueFormatter \| undefined` | 值格式化器；缺省为 @xihan-ui/expression 的 formatValue。 |
| `measurer` | — | `TextMeasurer \| undefined` | 文字度量器；缺省用所在文档的 Canvas 度量器。 |
| `printClient` | — | `PrintClient \| undefined` | 本地打印客户端：给了时打印先交给它静默打印，连不上客户端才退回浏览器打印；设置里的打印方式选了浏览器时直接用浏览器打印。给了它，设置对话框才有打印方式一项与「本地客户端」一页。 |
| `clientDownloadUrl` | `client-download-url` | `string \| undefined` | 设置对话框「本地客户端」一页里「下载客户端」链接的地址，缺省 PRINT_CLIENT_DOWNLOAD_URL；attribute 为 client-download-url。 |
| `locale` | `locale` | `string \| undefined` | 交给格式化器的区域，只决定小数点与千分位符号；同名 attribute。 |
| `timeZone` | `time-zone` | `string \| undefined` | 交给格式化器的时区：`UTC`、`±HH:mm` 或 IANA 名称；attribute 为 time-zone。 |
| `translations` | — | `Partial<PrintDesignerTranslations> \| undefined` | 元素自己的文案，压在全局配置之上。 |
| `readonly` | `readonly` | `boolean` | 只读：可以选择、浏览与预览，不能修改。attribute 三态：不写或移除为不只读，写 "false" 为不只读，其余写法为只读。 |
| `mode` | `mode` | `PrintDesignerMode` | 设计态或预览态，缺省 design；同名 attribute。 |
| `defaultLayout` | — | `DesignerLayout \| undefined` | 宿主的缺省面板布局：用户没存过布局（settings 里没有 layout.panels）时用它，「恢复默认布局」也回到它；写了的字段整项覆盖内置缺省。面板 id 见 PRINT_DESIGNER_PANELS。 |
| `commandLayout` | — | `DesignerCommandLayout \| undefined` | 工具栏与右键菜单的排列：位置（toolbar、menu:blank、menu:element、menu:table）→ 若干组命令 id，内置与扩展的命令可以混排。写了某个位置就只显示列出的命令；写了没登记的命令 id 时抛 TypeError。 |
| `settings` | — | `DesignerSettings \| undefined` | 设置的值：扁平的键值，键是「分区 id.条目 id」，如 general.theme、print.showGrid；没写的键取条目的缺省值。赋值即生效；用户在设置对话框里或用工具栏上的网格、吸附开关改了以后，设计器换成新的一份并派发 settings-change。 |
| `settingsPolicy` | — | `DesignerSettingsPolicy \| undefined` | 宿主对设置条目的管控：键是条目键或分区 id，hidden 不显示，locked 只读、说明换成「由所在系统管理」。 |
| `settingsStorageKey` | `settings-storage-key` | `string \| undefined` | 设置存在根所在窗口 localStorage 的哪个键下：给了，连上文档时若没赋 settings 就从这里读，用户改了设置就写回去，标了 secret 的条目不存；读写失败派发 settings-storage-error。不给就不读写。同名 attribute settings-storage-key。 |
| `brands` | — | `readonly PropertySwatchOption[] \| undefined` | 设置里主题色的预设：value 是品牌 id（写成设计器根上的 data-brand），color 是色板格子的颜色。不给且没给 registerBrand 时没有主题色这一项。 |
| `registerBrand` | — | `((id: string, color: string) => () => void) \| undefined` | 注册自定义主题色，形状与 @xihan-ui/tokens 的 registerBrand 相同；给了才许在设置里自定义主题色。 |
| `autoTour` | `auto-tour` | `boolean \| undefined` | 第一次在设计态显示出来（画布有了尺寸）后自动开始新手引导，缺省开；设置里记过 help.tourDone（走完、跳过或关上过一次）时不再自动开始。写 false 关掉，start-tour 命令、帮助页的「开始引导」与 startTour() 照样能开始。同名 attribute auto-tour，写 "false" 是关。 |

### 存取器

| 属性 | 读写 | 类型 | 说明 |
| --- | --- | --- | --- |
| `schema` | 可读写 | `PrintDocument` | 打印模板。赋值即装载：清空历史与选择，按实际大小放到视口左上（赋回当前这一份不重新装载）；读取时得到当前模板。 |
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
| `openSettings(section?: string): void` | 打开设置对话框，给了分区 id 就显示那一页：基础是 general，设计器自己的「画布」是 print。 |
| `openJsonEditor(): void` | 打开编辑整份模板 JSON 的对话框：写出当前模板，边改边按打印的校验报问题；没有错误时「应用」整份换上，记一步撤销。只读时只能看、不能应用。 |
| `startTour(): boolean` | 从头开始新手引导：通用步骤加打印与扩展的步骤，同一页里别的引导开着时先收起它；预览态或没有能走的步骤时返回 false。 |
| `openFieldImport(source?: string): void` | 打开导入字段对话框，给了页 id 就显示那一页：内置的是 sample 与 json-schema，扩展的字段来源用它的 id。 |
| `validate(): ValidationIssue[]` | 按当前登记表与表达式引擎校验模板。 |
| `getViewport(): Viewport` | 视口：屏幕坐标 = 纸张坐标（mm）× zoom × 96 / 25.4 + (x, y)；zoom 为 1 时是实际尺寸。 |
| `setViewport(viewport: Viewport): void` | 设置视口；此后尺寸变化不再自动适配。 |
| `zoomToFit(): void` | 让整张纸连同左侧的页眉页脚标签落在视口中央，让开浮在画布一侧的翻页条（让出的宽度与四周留白取较大的那个），不放大到实际尺寸以上；此后尺寸变化时重新适配，直到设置视口或在画布上操作。 |
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
| `settings-change` | `{ key: string, value: JsonValue \| undefined, settings: DesignerSettings }` | 改了一条设置（设置对话框里，或工具栏上的网格、吸附开关）：设计器已换成新的 settings 并生效；value 为 undefined 表示删掉这个键、回到缺省值。宿主存起来，下次赋回 settings。 |
| `settings-storage-error` | `VisualEnvironmentStorageError` | 读写 settingsStorageKey 指的本机存储失败（内容不是对象、无痕窗口、配额满）；设置留在内存里。 |
| `fields-change` | `{ fields: readonly DataField[] }` | 在导入字段对话框里导入了字段：设计器已换成新的 fields。宿主存起来，下次赋回 fields。 |
| `sample-data-change` | `{ sampleData: JsonValue }` | 导入字段时勾了「同时作为示例数据」：设计器已换成新的 sampleData。宿主存起来，下次赋回 sampleData。 |

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
| `grid` | `string` | 显示网格的开关。 |
| `snap` | `string` | 吸附其它元素与参考线的开关。 |
| `print` | `string` |  |
| `pages` | `string` | 画布右侧翻页条的可访问名。 |
| `minimap` | `string` | 画布左下角小地图的名字：面板菜单与设置的「布局」页里用。 |
| `previousPage` | `string` |  |
| `nextPage` | `string` |  |
| `addPage` | `string` |  |
| `duplicatePage` | `string` |  |
| `removePage` | `string` |  |
| `movePageUp` | `string` |  |
| `movePageDown` | `string` |  |
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
| `history` | `PrintHistoryTranslations` | 撤销历史里一步的说明。 |
| `palette` | `string` | 物料面板的标题。 |
| `fieldGroup` | `string` | 物料面板里按 fields 列出的字段那一组的名称。 |
| `properties` | `string` | 属性面板的标题。 |
| `issues` | `string` | 问题列表的标题。 |
| `paletteHelp` | `string` | 物料面板头里的帮助。 |
| `propertiesHelp` | `string` | 属性面板头里的帮助。 |
| `issuesHelp` | `string` | 问题列表面板头里的帮助。 |
| `settingsPrint` | `string` | 设置对话框里设计器自己那一页（打印方式与画布偏好）的名称。 |
| `settingsShowGrid` | `string` |  |
| `settingsShowGridHint` | `string` |  |
| `settingsGridSize` | `string` |  |
| `settingsGridSizeHint` | `string` |  |
| `settingsSnap` | `string` |  |
| `settingsSnapHint` | `string` |  |
| `settingsShowMargins` | `string` |  |
| `settingsShowMarginsHint` | `string` |  |
| `settingsRulers` | `string` | 设置「打印」分区：标尺开关。 |
| `settingsRulersHint` | `string` |  |
| `tourSteps` | `Readonly<Record<PrintTourStepKey, PrintTourStepTranslations>>` | 新手引导里打印自己的几步：页眉页脚、页面模板、字段物料与打印。 |
| `helpNotes` | `readonly string[]` | 设置对话框「帮助」页的几段操作说明。 |
| `shortcutSave` | `string` | 快捷键表里 Ctrl / ⌘ + S 那一行：派发 save，请宿主保存。 |
| `shortcutNudge` | `string` | 快捷键表「通用」里方向键那一行：移动选中的元素，没有选中时平移画布。 |
| `shortcutCancel` | `string` | 快捷键表「通用」里 Esc 那一行：取消拖动、退出表格编辑或取消选择。 |
| `settingsVia` | `string` | 「打印」页里打印方式一项：经本地打印客户端，还是浏览器的打印对话框。 |
| `settingsViaHint` | `string` |  |
| `settingsViaOptions` | `Readonly<Record<'client' \| 'browser', string>>` |  |
| `settingsClient` | `string` | 设置对话框里「本地客户端」那一页的名称。 |
| `settingsClientStatus` | `string` | 「本地客户端」页里连接状态一项。 |
| `settingsClientStatusHint` | `string` |  |
| `settingsClientStates` | `Readonly<Record<'connected' \| 'disconnected' \| 'missing', string>>` | 连接状态的三种说法：已连接；未连接；最近一次测试连接没找到客户端时是未安装。 |
| `settingsClientTest` | `string` |  |
| `settingsClientDownload` | `string` |  |
| `statusZoom` | `string` | 状态栏右段缩放一项的标签。 |
| `statusClient` | `string` | 状态栏右段打印客户端一项的标签。 |
| `statusClientStates` | `Readonly<Record<PrintClientState, string>>` | 打印客户端连接状态的说法。 |
| `insertToolbar` | `string` | 顶栏插入钮那一条工具栏的名字。 |
| `selectionToolbar` | `string` | 选中元素后浮在选中框上方的选中工具条的名字。 |
| `alignTextLeft` | `string` |  |
| `alignTextCenter` | `string` |  |
| `alignTextRight` | `string` |  |
| `propertyGroups` | `Readonly<Record<PropertyGroup, string>>` | 属性分组的名称。 |
| `propertyNames` | `Readonly<Record<string, string>>` | 属性名：键为 formatJsonPath(path)；「对象种类:路径」覆盖同一路径在该种类上的名字，对象种类是 page、元素种类或 table-column 等表格部位。复合属性拆开后的分项用「复合种类/分项」作键，如 stroke/width、edges/top。 |
| `propertyOptions` | `Readonly<Record<string, string>>` | select 选项名：键为选项值；「路径=选项值」覆盖该属性上的名字。 |
| `units` | `Readonly<Record<PropertyUnit, string>>` | 数值属性的单位。 |
| `pageSettings` | `string` | 属性面板在没有选中时编辑页面设置，标题下的一行。 |
| `pageNumberInsert` | `string` | 页码格式编辑器里插入变量的菜单按钮。 |
| `pageNumberTokens` | `Readonly<{ page: string, pages: string }>` | 页码格式里能插入的两个变量：当前页码与总页数。 |
| `valueFormatKind` | `string` | 值格式编辑器里种类下拉的名字。 |
| `valueFormatKinds` | `Readonly<{ none: string, format: string, map: string, expression: string }>` | 值格式的种类：不设格式、常用格式（数字、百分比、日期、人民币大写、数字字形）、值映射、表达式。 |
| `valueMapColumns` | `Readonly<{ value: string, label: string }>` | 值映射表的两列：数据值与显示文本。 |
| `valueMapFallback` | `string` | 值映射里没有命中任何一项时显示的文本。 |

| 方法 | 说明 |
| --- | --- |
| `pagePosition(position: number, count: number, name: string): string` | 翻页条上页码按钮的名字：含按钮上写的「第几个 / 共几个」，再加页面名称（没有名称时是 pageTitle），position 从 1 开始。按钮上看得见的字要包含在名字里。 |
| `pageTitle(position: number): string` | 没有名称的页面模板的标题，position 从 1 开始。 |
| `resizeBand(region: 'header' \| 'footer'): string` | 拖动调整页眉或页脚高度的把手的可访问名。 |
| `elementLabel(type: string, name: string): string` | 画布上一个元素的可访问名：种类名加元素名称或标识。 |
| `resizeColumn(title: string): string` | 拖动调整列宽的把手的可访问名。 |
| `newColumnTitle(position: number): string` | 新插入的列的标题，position 从 1 开始。 |
| `statusElements(count: number): string` | 状态栏左段没有选中时的值：当前页面模板上可见的元素个数。 |
| `statusGeometry(x: string, y: string, width: string, height: string): string` | 状态栏左段选中一个元素时的值：入参是格式化后的位置与尺寸（mm）。 |
| `insertElement(label: string): string` | 顶栏插入钮的名字，label 是元素种类的名称。 |
| `fontSizeMenu(size: string): string` | 格式工具条上字号菜单的名字：含按钮上写的字号，选中的几处字号不一时是 —。 |
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
| `describe(operations: readonly PrintOperation[], before: PrintDocument): HistoryLabel \| undefined` | 没给说明的一步，按正向操作与应用前的文档生成说明。 |

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
| `duplicatePage(pageId: string, options?: ExecuteOptions): PrintPage` | 复制页面模板：页面与其中的元素换新 id，放在原页之后并切到它；页面不存在时抛错。 |
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
| `createPrintDesignerModel` | 函数 | 合出设计器用的模型；任何一处重名（含设置分区与设计器自己的 print、内建的 general 重名，引导步骤 id 重名或用了 shell. 前缀，物料来源 id 重名）都抛 DesignerExtensionError，物料项给了别处登记的元素类型时抛 TypeError。 |
| `PRINT_DESIGNER_EXTENSION_ID` | 常量 | 设计器自带的扩展的 id：内置命令，以及表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 |
| `PRINT_DESIGNER_HELP_URL` | 常量 | 内置命令 help 打开的帮助页：打印文档站的设计器一页。 |
| `PRINT_DESIGNER_PANELS` | 常量 | 设计器的面板 id：宿主写 defaultLayout、settingsPolicy（layout.panels.&lt;面板 id&gt;）时用。 |
| `PRINT_PAGE_STRIP_LAYOUT` | 常量 | 画布右侧翻页条上的命令，排列固定：上一页、页码、下一页，新增、复制、删除页面。 |
| `PRINT_TOOLBAR_LAYOUT` | 常量 | 工具栏的缺省排列；commandLayout 没写 toolbar 时用它，再把 placement 含 toolbar 的扩展命令追加成一组。 |
| `PrintDesignerCommand` | 类型 | 设计器的命令：工具栏按钮、右键菜单项与快捷键共用。 |
| `PrintDesignerContext` | 接口 | 扩展装上时拿到的上下文。 |
| `PrintDesignerExtension` | 接口 | 打印设计器层的扩展：运行时层的全部字段（元素种类、渲染、编辑方式与规则），加上属性编辑器、命令、面板、设置分区、导入器、物料项、物料来源与 setup。 |
| `PrintDesignerImporter` | 类型 | 导入器：把粘贴或拖放进来的外部内容换成一组元素；返回 undefined 即不放任何元素。 |
| `PrintDesignerModel` | 接口 | 一组设计器扩展合出的东西：交给 core 函数与预览的列表、运行时的模型、属性编辑器表、命令表、导入器、物料项与物料来源。 |
| `PrintImportFragment` | 接口 | 导入的结果：一组元素，整体挪到落点（粘贴时为视口中央）后按粘贴的规则放进当前页面模板。 |
| `printMenuLayout` | 函数 | 右键菜单的缺省排列；选中的是一张表格时，元素菜单最前面加「编辑表格」。 |
| `PrintMenuSubject` | 类型 | 右键菜单落在哪类对象上：画布空白处、元素，或表格编辑态里的表格部位。 |
| `PrintPaletteDrop` | 接口 | 物料来源的条目拖到画布上放下的落点：纸张坐标（mm，以纸张左上角为原点），以及这一点落在页眉、正文还是页脚。 |
| `PrintPaletteEntry` | 接口 | 物料面板里的一项：扩展元素的名称与图标。 |
| `printSelectionLayout` | 函数 | 选中工具条（命令落点 selection:&lt;主体&gt;）的缺省排列：文字类元素多出字号、粗体、斜体、下划线、删除线与左中右对齐；多选多出对齐与分布；都有层级、创建副本、复制与删除。 |
| `PrintSelectionSubject` | 类型 | 选中工具条落在哪类选中上：都是文字类元素（文本、长文本、富文本、页码）、单个别的元素，或几个元素里有别的种类。 |

### print-designer

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `definePrintDesigner` | 函数 | 注册 &lt;xh-print-designer&gt;；重复调用不报错。 |
| `PRINT_DESIGNER_TAG` | 常量 | 设计器的标签名。 |
| `PrintDesignerEventMap` | 接口 | 设计器派发的事件；x / y 为浏览器视口坐标。 |
| `PrintDesignerMode` | 类型 | 设计态或预览态。 |
| `PrintSchemaChangeKind` | 类型 | schema-change 的种类：执行操作、撤销、重做，或宿主装载了新模板。 |
| `XhPrintDesigner` | 类 |  |

### settings

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PRINT_CLIENT_DOWNLOAD_URL` | 常量 | 「下载客户端」链接的缺省地址：打印文档站的客户端一页。 |
| `PRINT_CLIENT_SETTINGS_SECTION` | 常量 | 设计器「本地客户端」分区的 id，扩展同样不能再用；只在宿主给了 printClient 时出现。 |
| `PRINT_CLIENT_STATUS_CONTROL` | 常量 | 「本地客户端」分区里连接状态那一条的编辑方式种类：设计器自己铺状态、「测试连接」钮与下载链接，这一条不存值。 |
| `PRINT_SETTING_KEYS` | 常量 | 「打印」分区各条目的键，即 settings 里的键（分区 id.条目 id）。 |
| `PRINT_SETTINGS_SECTION` | 常量 | 设计器「打印」分区的 id，扩展不能再用。 |
| `printClientSettingsSection` | 函数 | 「本地客户端」分区：一条连接状态，按 PRINT_CLIENT_STATUS_CONTROL 铺。 |
| `PrintClientSettingsSectionOptions` | 接口 | printClientSettingsSection 的选项。 |
| `PrintClientStatusControl` | 接口 | 连接状态那一条的编辑方式：带着「下载客户端」链接的地址。 |
| `printSettingsSection` | 函数 | 「打印」分区：打印方式缺省经本地客户端；网格间距缺省 1 mm，吸附对齐、边距线与标尺缺省打开，网格缺省不显示。 |
| `PrintSettingsSectionOptions` | 接口 | printSettingsSection 的选项。 |
| `PrintVia` | 类型 | 打印方式：经本地打印客户端，或浏览器的打印对话框。 |

### version

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PRINT_VERSION` | 常量 | @xihan-print/designer 的版本号。 |
