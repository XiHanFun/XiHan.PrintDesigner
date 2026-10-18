# 设计器

`<xh-print-designer>` 是可视化的模板设计器：画布按纸张显示一张页面模板的页眉、正文与页脚，旁边是物料、属性与问题列表。它只吃模板与数据、吐模板与事件，模板存在哪里、谁能改，都由宿主决定。属性、方法与事件的完整列表见[设计器参考](../reference/designer)。

## 接入

```bash
pnpm add @xihan-print/designer @xihan-print/runtime @xihan-ui/styles @xihan-ui/designer-shell
```

设计器用到 XiHan.UI 的设计器零件，样式要四份一起引入。`definePrintDesigner()` 注册设计器、它内部用到的预览与 UI 元素，重复调用不报错：

<<< @/examples/demos/designer.ts#setup

把模板交给 `schema`，可绑定的字段树交给 `fields`：属性面板里选字段时从这棵树里选，物料面板也多出「字段」一组，字段可以直接拖上画布（见下文「字段物料」）：

<<< @/examples/demos/designer.ts#fields

<<< @/examples/demos/designer.ts#render

- `sampleData` 是画布上显示用的示例数据，给了就按它显示实际值，不给时字段显示成 <code v-pre>{path}</code> 占位。
- `data` 是切到预览态与打印时用的数据。

<PrintDemo name="designer" />

## 界面

`panels` attribute 决定显示哪些区，空格分隔，不写就全部显示。预览态只保留工具栏。

| 区 | `panels` 里的名字 | 作用 |
| --- | --- | --- |
| 工具栏 | `toolbar` | 撤销重做；剪切、复制、粘贴、创建副本、删除；对齐与等距分布；层级；缩放、网格与吸附开关；设计与预览切换；打印；面板、设置与帮助 |
| 物料 | `palette` | 点一下把元素加到视口中央，拖到画布上放在落点 |
| 翻页条 | `pages` | 画布右侧中间的一列：上一页、页码、下一页，新增、复制、删除页面模板。点页码列出全部页面模板，点一项切过去，下面是上移、下移页面 |
| 标尺 | `rulers` | 毫米标尺；从标尺拖出参考线，参考线存进页面模板，只用于对位、不打印 |
| 属性 | `properties` | 编辑选中的元素，多选时只显示共同的属性；没有选中时编辑页面设置；表格编辑态里编辑选中的表格部位 |
| 状态栏 | `status` | 左边写选中的对象：没有选中时是当前页面模板与上面的元素个数，选中一个是种类与位置尺寸（mm），选中多个是个数；右边写打印客户端的连接状态（给了 `printClient` 时）与缩放，点缩放回到实际尺寸。设置里可以关掉 |
| 问题 | `issues` | 校验问题列表，点一下切到问题所在的页面模板并定位到元素；错误、警告数在面板头上，点一下只看或不看这一级 |

工具栏缺省只显示图标（设置里可以换成文字或图标加文字），翻页条只显示图标；按钮的名字与快捷键报给读屏，悬停或键盘聚焦到按钮时提示命令的文字与快捷键；会删掉内容的命令按危险色显示。

物料、属性与问题是外框里的卡片：面板头写标题，属性面板的标题下面写正在编辑的对象，「?」里是这块面板的用法。点面板头的「×」收起这块面板，设计器随之改写 `panels` 并派发 `panels-change { panels }`，宿主存起来、下次赋回即可。

扩展登记的面板也放进外框，`panels` 里写它的区名同样能开关，见下文「面板」。各区的属性见[元素](../reference/elements)，属性面板的分组与中文名与它一致。

## 字段物料

给了 `fields` 时，物料面板最后多出「字段」一组，按字段树显示：带子字段的可以展开、收起，键盘与读屏按树的约定，搜索也能按字段名称与路径找。点一下把绑好字段的元素加到视口中央，拖到画布上放在落点：

| 字段 | 生成 |
| --- | --- |
| `value`，`content` 不写或为 `text` | 文本，内容绑定这个字段 |
| `value`，`content` 为 `image` | 图片，地址取这个字段 |
| `value`，`content` 为 `barcode` | 条码（缺省码制），内容绑定这个字段 |
| `value`，`content` 为 `qrcode` | 二维码，内容绑定这个字段 |
| `list` | 表格：`dataField` 指向它，各列取它的 `value` 子字段（进入对象、不进入嵌套的列表），列标题取字段名称，列宽均分表格宽度；`content` 为图片、条码、二维码的子字段对应同类单元格 |
| `object` | 不生成元素，只作分组 |

- 字段写了 `label` 时，新元素的名称就是它；条目上同时显示字段路径。
- 列表的子字段相对数组的一行，只作浏览、不能拖出：要放行里的字段，先放表格，再在属性面板里改列。
- `content` 是 XiHan.UI 字段树 `DataField` 的可选项，说明这个值代表什么；`type` 是数据类型，与生成哪种元素无关。

页码的格式是一行文本，行尾的「插入」菜单把当前页码 <code v-pre>{{$page}}</code> 或总页数 <code v-pre>{{$pages}}</code> 插到光标处，下面按第 1 页、共 3 页显示示例，数字写法跟着「数字写法」一栏。

边框分上、右、下、左四个页签，每边一个开关：打开时这一边照已有的边画线，还没有边时是 0.2 毫米黑色实线，下面可以改线宽、线型与颜色；四边都关掉就是没有边框。多选的元素边框不同时，从四边都不画开始改，改动对每个元素整体写入。

值格式先选种类：常用格式（数字、百分比、日期、人民币大写、数字字形）在下面填参数并显示示例；值映射是「数据值、显示文本」两列的表，可以增删，下面填没有命中时显示的文本；表达式以 `value` 引用待格式化的值，边输入边检查。换种类时整体换成这一种的缺省值，选「不设格式」即去掉格式。

## 画布操作

- **选择**：点选元素；按住 Shift、Ctrl 或 ⌘ 点击切换某个元素的选中；在空白处拖动框选。
- **移动与变换**：拖动元素移动，拖控制柄缩放；文本、图片、矩形、椭圆、条码与二维码还能旋转。锁定的元素不能拖动与缩放。
- **换区**：元素中心拖进页眉、正文或页脚，就放进那个区；表格、长文本与富文本只能留在正文区。
- **页眉页脚**：在区的标签上切换当前编辑的变体（缺省、首页、末页、奇数页、偶数页），可以新增或删除变体；拖动区的边界改高度。
- **平移与缩放**：滚轮平移，Ctrl / ⌘ + 滚轮以指针为中心缩放；按住空格或鼠标中键拖动平移。
- **吸附**：拖动、新建与缩放元素时吸附到网格间距（设置「画布」一页，缺省 1 mm，写 0 不吸附网格）；「吸附对齐」打开时还吸附其它元素、页边距、区边界与参考线，并显示对齐线。工具栏上的「网格」开关显示或收起网格线，「吸附」开关就是「吸附对齐」，两者改的都是设置。
- **表格编辑态**：双击表格或选中后按 Enter 进入。可以分别选中列、表头、表体、表尾行与表尾单元格，在属性面板里编辑；拖列边界改列宽；右键菜单里插入、删除、左右移动列，插入、删除表尾行，合并与拆分表尾单元格。按 Esc 退出。
- **右键菜单**：在空白处、元素上与表格编辑态里各有一套，带快捷键的条目在行尾显示快捷键。设计器先派发可取消的 `blank-contextmenu`、`element-contextmenu` 或 `table-contextmenu`（表格编辑态里，右键处的部位先被选中），宿主取消后不弹自带的菜单，可以换成自己的。

## 设置

设置是用户偏好，每人每机一份，不随模板保存。`openSettings(section?)` 打开设置对话框，左边一个分区一页：

- 「基础」（`general`）：主题（跟随页面、跟随系统、亮色、暗色）、主题色、工具栏按钮的显示方式（图标、文字、图标和文字，缺省只显示图标）与状态栏开关。工具栏的显示方式只走设置，没有单独的属性；画布上的翻页条总是只显示图标。
- 「画布」（`print`）：显示网格、网格间距、吸附对齐、显示边距线。网格缺省不显示，间距缺省 1 mm，按当前缩放挤得太密时改按间距的整数倍画；边距线缺省显示。
- 扩展登记的分区，排在后面。分区 id 与 `general`、`print` 或别的扩展重名时，给 `extensions` 赋值就抛 `DesignerExtensionError`。

<<< @/examples/snippets/settings.ts#open

值是扁平的键值，键是「分区 id.条目 id」，如 `general.theme`、`print.showGrid`，没写的键取缺省值。宿主给缺省、锁定条目或读值时用常量，不手写键：「画布」分区的 id 与各条目的键是包入口导出的 `PRINT_SETTINGS_SECTION` 与 `PRINT_SETTING_KEYS`，「基础」分区的键是 `@xihan-ui/designer-shell` 的 `DESIGNER_SETTING_KEYS`。`settings` 赋值即生效；用户在对话框里或用工具栏的网格、吸附开关改了一条，设计器换成新的一份并派发 `settings-change`，宿主存起来、下次赋回。`settingsPolicy` 隐藏或锁定条目，键是条目键或分区 id：`hidden` 不显示，一个分区的条目全藏了就没有这一页；`locked` 只读，说明换成「由所在系统管理」。

<<< @/examples/snippets/settings.ts#host

- **主题只作用于设计器**：主题与主题色写在 `<xh-print-designer>` 自己的 `data-theme`、`data-brand` 上，页面其余部分不变；设置对话框、菜单这些浮层跟着设计器变。主题色的预设由宿主给 `brands`（品牌 id 与色板格子的颜色，品牌 id 可以用 `@xihan-ui/tokens` 的 `BRAND_PRESETS`）；给了 `registerBrand`（形状同 `@xihan-ui/tokens` 的 `registerBrand`）才许自定义颜色。两样都不给时没有主题色这一项。
- **扩展读设置**：命令、面板与扩展从上下文的 `settings` 读值，各分区没写的条目已经取了缺省值，如 `context.settings['print.gridSize']`。

独立使用、没有宿主替你存时，给 `settingsStorageKey`：连上文档时若没赋 `settings` 就从根所在窗口的 localStorage 读，用户改了设置就写回去；标了 `secret` 的文本条目（如密钥）不存。读写失败派发 `settings-storage-error`，设置留在内存里。不给就不读写存储。

<<< @/examples/snippets/settings.ts#storage

## 快捷键

焦点在设计器里、且不在输入框与面板里时生效，只在设计态。

| 按键 | 作用 |
| --- | --- |
| Ctrl / ⌘ + Z | 撤销 |
| Ctrl / ⌘ + Shift + Z，Ctrl / ⌘ + Y | 重做 |
| Ctrl / ⌘ + C、X、V | 复制、剪切、粘贴，走系统剪贴板 |
| Ctrl / ⌘ + D | 创建副本 |
| Ctrl / ⌘ + A | 全选当前页面模板里看得见的元素 |
| Ctrl / ⌘ + S | 派发 `save` |
| Ctrl / ⌘ + ]、[ | 上移一层、下移一层 |
| Ctrl / ⌘ + Shift + ]、[ | 置于顶层、置于底层 |
| Delete、Backspace | 删除选中的元素 |
| 方向键 | 选中的元素移动一格（网格间距，写 0 时 1 mm）；没有选中时平移视口 |
| Shift + 方向键 | 选中的元素移动 10 mm |
| +、- | 放大、缩小 |
| 0 | 适合窗口 |
| Enter | 选中表格时进入表格编辑态 |
| Esc | 取消正在进行的拖动；在表格编辑态里退出；否则取消选择 |

复制的元素以 JSON 放进系统剪贴板，可以在两个设计器之间粘贴；粘贴时先按当前的元素登记表校验，有错误的内容不粘贴。别的内容（图片、旧模板等）粘贴或拖到画布上时交给扩展的导入器，见下文「导入」。

## 保存与事件

设计器不保存模板。每次修改派发 `schema-change`，`detail.schema` 是改完的模板；一次拖动、一次属性编辑合成一次。按 Ctrl / ⌘ + S 时派发 `save`，宿主保存成功后调用 `markSaved()`：

<<< @/examples/demos/designer.ts#save

- 给 `schema` 赋值即装载新模板：清空撤销历史与选择，重新适配视口，并派发 `kind` 为 `load` 的 `schema-change`。读取 `schema` 得到当前模板。
- `dirty` 表示有没有未保存的修改，变化时派发 `dirty-change`；撤销回到保存时的状态，`dirty` 也回到 `false`。
- `issues-change` 在模板改动后带上全部校验问题，宿主可以据此拦住有错误的模板，不让保存。
- 其余事件：`selection-change`、`page-change`、`mode-change`、`viewport-change`、`element-dblclick`、`panels-change`。

也可以用方法操作：`execute(operations)` 执行一组编辑操作并记为一步撤销（操作见 `@xihan-print/core` 的 `PrintOperation`），`addElement`、`select`、`copy`、`paste`、`align`、`reorder`、`zoomToFit`、`scrollToElement` 等与界面上的命令一致。`print()` 按当前模板与 `data` 打印，给了 `printClient` 时交给本地打印客户端。

## 只读与预览

- `readonly`：可以选择、浏览、预览与打印，不能修改；物料不能拖出，属性面板只读。
  - 写成 attribute 时按三态读，与 XiHan.UI 元素的布尔 attribute 同一读法：不写或移除时不只读；写 `readonly="false"` 也不只读；其余写法（`readonly`、`readonly=""`、`readonly="true"`）只读。
  - 这是行为变化：以前按原生布尔 attribute 读，只要写了就只读，`readonly="false"` 也算只读。
  - 经 property 赋值（`designer.readonly = false`）不受影响。
- `mode`：`design` 设计态，`preview` 预览态。预览态按 `data` 分页，用 `<xh-print-preview>` 显示全部输出页。

## 语言包

界面文字缺省是英文。把 XiHan.UI 与打印同一语言的语言包合并后全局设置，设计器、它内部的零件与预览都换成这种语言，见[快速开始](../quickstart#界面语言)。

只改一个实例的几处文案时，给它的 `translations` 属性，压在全局语言包之上：

<<< @/examples/snippets/designer-translations.ts#example

全部文案键见[设计器参考](../reference/designer#printdesignertranslations)。属性面板里的属性名、选项名与单位也在里面，键是属性路径，如 `style.fontSize`。

## 扩展

`extensions` 收一组扩展对象：元素种类、编辑方式、校验规则、属性编辑器、命令、面板、设置分区与导入器都经它登记。内置元素、设计器自带的编辑器与命令也是扩展，自动排在最前。同一页面上的几个设计器各给各的，互不影响。

- 扩展对象的 `id` 全局唯一，用包名加功能名，如 `@acme/print-fonts`。它也是模板里扩展数据的键：文档、页面与元素都可以带 `extensions: { [扩展 id]: { ... } }`，校验只查它是对象，编辑与复制粘贴原样带着走。
- 赋值时当场合并查重：扩展 id、元素类型、编辑方式、命令 id 与快捷键与内置的或别的扩展重名时，抛 `DesignerExtensionError`（`code` 为 `designer.extension-conflict`），设计器保持赋值前的状态。
- `setup(context)` 在设计器连上文档时调用，它返回的函数在断开、或这个扩展被去掉时调用。同一个扩展对象换了引用，当作卸下再装上，宿主要保持引用稳定。
- `rules` 是校验规则，收到文档与 `{ elements }`（合并后的元素登记表），返回问题。问题码以扩展 id 的末段加点开头，结构没有 error 时才跑。
- `controls` 是新的编辑方式：属性描述里用到这个 `kind` 时，按它的 `check` 校验取值；没登记的编辑方式报 `unknown-control`。
- 预览元素 `<xh-print-preview>` 与 `paginate`、`validateDocument` 这些函数也收 `extensions`，与设计器给同一份。

### 扩展元素

扩展的 `elements` 登记新的元素类型，`renderers` 给它们的渲染。原型与内置元素的一样，给出缺省值、尺寸下限、物料分组与属性描述；不跨页的元素（`flow` 为 `false`）另外必须给 `layout`：排版时按元素与数据算出画在元素框里的数据（只能是 JSON），元素框的位置与尺寸由排版填好。渲染收到排版盒与输出页所在的文档，返回要放进元素框的节点：

<<< @/examples/snippets/extension-element.ts#element

- 属性描述可以用 `layoutProperties`、`behaviorProperties` 与 `property` 拼，和内置元素用的是同一套。
- 引用了数据字段的元素给 `fields`：返回它引用的字段，`collectDocumentFields` 汇总模板字段时才不会漏掉它。上下文带 `field`、`template`、`expression` 与 `text` 四个帮手，分别把字段路径、<code v-pre>{{path}}</code> 模板串、表达式与文本内容来源换成引用，与内置元素同一套解析；引用的是列表时给 `rows`，里面是相对列表一行的引用。字段的值在元素里当图片地址、条码或二维码的内容用时，在引用上写 `content`（`image`、`barcode`、`qrcode`），汇总时一并记进字段树。
- 不跨页的元素没给 `layout`、跨页的元素没给 `prepare`（见下文）时，赋值时抛 `TypeError`。
- `palette` 给自己元素的物料项：名称与图标（`@xihan-ui/core` 的 `IconRecord`）。名称也用在画布与属性面板的可访问名和问题列表里，不给时显示类型名。`palette` 里写了不是本扩展登记的元素类型时，赋值时抛 `TypeError`。
- 原型的 `category` 可以是内置分组（`text`、`media`、`data`、`shape`、`code`），也可以是新的分组。新分组排在内置分组之后，按首次登记的顺序；名称写在扩展的 `categories` 里，没写时显示分组名。分组名与内置分组或别的扩展写的重名时，抛 `DesignerExtensionError`。
- 名称随扩展给出，不在设计器的语言包里。扩展包要支持多种语言，就按语言给出不同的扩展对象，例如导出一个收文案的工厂函数。
- 渲染只能用标准 HTML 与 SVG：浏览器打印与本地打印客户端用的是另一份文档，自定义元素在那里不会升级。
- 扩展去掉后，文档里已有的这类元素照样保留：设计器把它画成写着类型的虚线占位，校验报 `element.unknownType`，再装上就恢复。

跨页的元素（`flow` 为 `true`）给 `prepare` 而不是 `layout`：按元素与数据给出按顺序的若干块，每块是高度（mm）与交给渲染的数据，另可给一块 `repeat`，排在每页那一段的开头（如表头）。`prepare` 收到的上下文比 `layout` 多一个 `measureText(text, style, width)`，按文字样式与可用宽度折行量出各行与总高度：

<<< @/examples/snippets/extension-flow-element.ts#element

- 块依次排进正文区，放不下的整块挪到下一页，与长文本、表格一样把下方的元素往下推；只有一段时高度不小于设计高度。
- 每页一段，渲染每段调一次：排版盒的 `data` 是 `{ blocks, repeat }`，`blocks` 是这一段的那几块的数据，`repeat` 是重复块的数据（没给时为 `null`）；`fragment` 给出段序号与是不是最后一段。
- 一块比整页正文区还高时照样放下，分页诊断报 `element.overflow`；块高度不是不小于 0 的有限数时，排版抛 `TypeError`。
- 跨页的元素只能放在正文区，放进页眉页脚时校验报 `element.flowInBand`；设计态排成一段、按内容撑高。

### 属性编辑器

扩展的 `editors` 给属性面板换编辑器，按扩展的顺序压在设计器自带的编辑器之上。查找顺序是对象种类加属性路径、属性路径、编辑方式，都没有时用面板内建的编辑器：

| 表 | 键 | 适用 |
| --- | --- | --- |
| `byTarget` | 对象种类 → 属性路径 | 只对这种对象生效 |
| `byPath` | 属性路径，如 `style.fontFamily` | 所有带这个属性的对象 |
| `byControl` | 编辑方式，如 `color`、`stroke` | 所有这种编辑方式的属性 |

对象种类是 `page`（页面设置）、元素类型（如 `text`、`table`）与表格部位（`table-column`、`table-header`、`table-body`、`table-footer-row`、`table-footer-cell`）；编辑方式见[元素](../reference/elements)的「取值」一栏。给了编辑器的复合属性不再拆开，整个值交给编辑器。

编辑器是一个函数：收到当前值与 `setValue`、`commit`，返回一个元素；值或只读状态变化时设计器调用 `update`，移除前调用 `destroy`。元素标了 `data-xh-part="control"` 时放进字段里，标签自动接上。下面的编辑器让字体只能从几种里选：

<<< @/examples/demos/designer-editors.ts#editor

<<< @/examples/demos/designer-editors.ts#use

<PrintDemo name="designer-editors" />

- `setValue(undefined)` 清除这个属性；连续的 `setValue` 合成一步撤销，`commit()` 之后的修改另起一步。
- `context.target` 是当前全部被编辑的对象，多选时有多个。

### 命令

扩展的 `commands` 登记命令，工具栏按钮、右键菜单项与快捷键共用一条。命令 id 用扩展 id 加点加名字；`label`、`enabled` 与 `run` 收到 `{ designer, translations, commands, settings, frame }`（`commands` 是四款设计器共用的命令文案，如 `commands.undo`；`settings` 是生效的设置；`frame` 是设计器的外框），`label` 也可以直接写成文字；给了 `checked` 的是开关式命令，工具栏按钮显示按下状态：

<<< @/examples/snippets/designer-commands.ts#example

- `placement` 是命令缺省出现的位置：工具栏 `toolbar`，或右键菜单 `menu:blank`（画布空白处）、`menu:element`（元素上）、`menu:table`（表格编辑态里）。扩展命令按登记顺序排在内置命令之后，自成一组。
- `shortcut` 写成键数组，`Mod` 在 macOS 上是 ⌘、其余平台是 Ctrl。焦点在画布上、命令此刻可用时生效。
- 设计器的 `commandLayout` 改写排列：位置 → 若干组命令 id，内置命令与扩展命令可以混排；写了某个位置就只显示列出的命令，写了没登记的命令 id 时抛 `TypeError`。缺省排列是导出的 `PRINT_TOOLBAR_LAYOUT` 与 `printMenuLayout(subject, tableSelected)`，可以在它们的基础上改：

<<< @/examples/snippets/designer-commands.ts#layout

内置命令的 id：

| 用途 | 命令 id |
| --- | --- |
| 编辑 | `undo` `redo` `cut` `copy` `paste` `duplicate` `delete` `select-all` |
| 对齐与层级 | `align-left` `align-center` `align-right` `align-top` `align-middle` `align-bottom` `distribute-horizontal` `distribute-vertical` `bring-to-front` `bring-forward` `send-backward` `send-to-back` |
| 视图 | `zoom-out` `zoom-in` `zoom-to-fit` `zoom-to-actual` `grid` `snap` `design` `preview` `print` |
| 表格 | `edit-table` `exit-table-edit` `insert-column-left` `insert-column-right` `remove-column` `move-column-left` `move-column-right` `insert-footer-row-above` `insert-footer-row-below` `remove-footer-row` `merge-cell-right` `split-cell` |
| 面板、设置与帮助 | `panels` `settings` `help`：designer-shell 内置，排在工具栏末组。「面板」点开菜单开关物料、属性与问题，「设置」打开设置对话框，「帮助」在新窗口打开本站的设计器一页（`PRINT_DESIGNER_HELP_URL`） |
| 页面模板 | `previous-page` `page-menu` `next-page` `add-page` `duplicate-page` `remove-page`：固定排在翻页条上（`PRINT_PAGE_STRIP_LAYOUT`），不经 `commandLayout`；`move-page-up` `move-page-down` 在页码菜单里 |

### 面板

扩展的 `panels` 往外框里加区，放印章库、套打对位这类面板。区是 `{ name, position, size?, minSize?, label? }`：`position` 取 `top`、`start`、`end`、`bottom`，同一位置的区按扩展顺序上下排；`label` 是分隔条可访问名里的区名。`create(context)` 返回放进区里的元素；设计器状态变化时调用 `update(context)`，扩展去掉时先调用 `destroy()` 再移除：

<<< @/examples/snippets/designer-panels.ts#example

- 区名与内置区（`toolbar`、`pages`、`palette`、`canvas`、`properties`、`issues`）或别的扩展的重名时，赋值时抛 `DesignerExtensionError`，设计器保持赋值前的状态。
- `panels` attribute 照样能开关扩展的区；预览态只保留工具栏。

### 导入

扩展的 `importers` 把粘贴与拖到画布上的外部内容换成元素。来源是 `{ kind, mime?, name?, text?, file? }`：`kind` 为 `clipboard` 或 `drop`，文件带 `file`，文本按链接（`text/uri-list`）、HTML、纯文本依次给出。设计器按文件、链接、HTML、纯文本的顺序逐个问各导入器的 `accepts`，扩展靠前的先问，第一个接下的导入：

<<< @/examples/snippets/designer-importers.ts#example

- `import` 可以是异步的，返回 `{ elements, region? }`，返回 `undefined` 即什么都不放。元素整体挪到落点（粘贴时是视口中央），左上角吸附网格，再按粘贴的规则换新 id 放进当前页面模板并选中，记一步撤销。`region` 缺省按落点所在的区。
- 放下前按当前的元素登记表校验；`import` 抛错或元素没有通过校验时，设计器派发 `import-error`，带导入器的 id、来源与错误，不放任何元素。
- 设计器自己的剪贴板内容不经导入器。
- 导入器只把外部内容换成元素，放进当前页面模板，例如把拖进来的图片传到宿主的存储、换成图片元素。纸张、页眉页脚这类整份模板的设置不经导入器；整份存量模板的迁移见[与宿主集成](./host#存量模板迁移)。
