# 设计器

`<xh-print-designer>` 是可视化的模板设计器：画布按纸张显示一张页面模板的页眉、正文与页脚，旁边是物料、属性与问题列表。它只吃模板与数据、吐模板与事件，模板存在哪里、谁能改，都由宿主决定。属性、方法与事件的完整列表见[设计器参考](../reference/designer)。

## 接入

```bash
pnpm add @xihan-print/designer @xihan-print/runtime @xihan-ui/styles @xihan-ui/designer-shell
```

设计器用到 XiHan.UI 的设计器零件，样式要四份一起引入。`definePrintDesigner()` 注册设计器、它内部用到的预览与 UI 元素，重复调用不报错：

<<< @/examples/demos/designer.ts#setup

把模板交给 `schema`，可绑定的字段树交给 `fields`，属性面板里选字段时就从这棵树里选：

<<< @/examples/demos/designer.ts#fields

<<< @/examples/demos/designer.ts#render

- `sampleData` 是画布上显示用的示例数据，给了就按它显示实际值，不给时字段显示成 <code v-pre>{path}</code> 占位。
- `data` 是切到预览态与打印时用的数据。

<PrintDemo name="designer" />

## 界面

`panels` attribute 决定显示哪些区，空格分隔，不写就全部显示。预览态只保留工具栏。

| 区 | `panels` 里的名字 | 作用 |
| --- | --- | --- |
| 工具栏 | `toolbar` | 撤销重做；剪切、复制、粘贴、再制、删除；对齐与等距分布；层级；缩放、网格与吸附开关；设计与预览切换；打印 |
| 物料 | `palette` | 点一下把元素加到视口中央，拖到画布上放在落点 |
| 页面 | `pages` | 页面模板的页签：新增、删除、左右移动 |
| 标尺 | `rulers` | 毫米标尺；从标尺拖出参考线，参考线存进页面模板，只用于对位、不打印 |
| 属性 | `properties` | 编辑选中的元素，多选时只显示共同的属性；没有选中时编辑页面设置；表格编辑态里编辑选中的表格部位 |
| 问题 | `issues` | 校验问题列表，点一下切到问题所在的页面模板并定位到元素 |

各区的属性见[元素](../reference/elements)，属性面板的分组与中文名与它一致。

页码的格式是一行文本，行尾的「插入」菜单把当前页码 <code v-pre>{{$page}}</code> 或总页数 <code v-pre>{{$pages}}</code> 插到光标处，下面按第 1 页、共 3 页显示示例，数字写法跟着「数字写法」一栏。

边框分上、右、下、左四个页签，每边一个开关：打开时这一边照已有的边画线，还没有边时是 0.2 毫米黑色实线，下面可以改线宽、线型与颜色；四边都关掉就是没有边框。多选的元素边框不同时，从四边都不画开始改，改动对每个元素整体写入。

值格式先选种类：常用格式（数字、百分比、日期、人民币大写、数字字形）在下面填参数并显示示例；值映射是「数据值、显示文本」两列的表，可以增删，下面填没有命中时显示的文本；表达式以 `value` 引用待格式化的值，边输入边检查。换种类时整体换成这一种的缺省值，选「不设格式」即去掉格式。

## 画布操作

- **选择**：点选元素；按住 Shift、Ctrl 或 ⌘ 点击切换某个元素的选中；在空白处拖动框选。
- **移动与变换**：拖动元素移动，拖控制柄缩放；文本、图片、矩形、椭圆、条码与二维码还能旋转。锁定的元素不能拖动与缩放。
- **换区**：元素中心拖进页眉、正文或页脚，就放进那个区；表格、长文本与富文本只能留在正文区。
- **页眉页脚**：在区的标签上切换当前编辑的变体（缺省、首页、末页、奇数页、偶数页），可以新增或删除变体；拖动区的边界改高度。
- **平移与缩放**：滚轮平移，Ctrl / ⌘ + 滚轮以指针为中心缩放；按住空格或鼠标中键拖动平移。
- **吸附**：`grid` 是网格边长（mm，缺省 1，`false` 不吸附网格）；`snap` 打开时还吸附其它元素、页边距、区边界与参考线，并显示对齐线。
- **表格编辑态**：双击表格或选中后按 Enter 进入。可以分别选中列、表头、表体、表尾行与表尾单元格，在属性面板里编辑；拖列边界改列宽；右键菜单里插入、删除、左右移动列，插入、删除表尾行，合并与拆分表尾单元格。按 Esc 退出。
- **右键菜单**：在空白处、元素上与表格编辑态里各有一套。设计器先派发可取消的 `blank-contextmenu` 或 `element-contextmenu`，宿主取消后不弹自带的菜单，可以换成自己的。

## 快捷键

焦点在设计器里、且不在输入框与面板里时生效，只在设计态。

| 按键 | 作用 |
| --- | --- |
| Ctrl / ⌘ + Z | 撤销 |
| Ctrl / ⌘ + Shift + Z，Ctrl / ⌘ + Y | 重做 |
| Ctrl / ⌘ + C、X、V | 复制、剪切、粘贴，走系统剪贴板 |
| Ctrl / ⌘ + D | 再制 |
| Ctrl / ⌘ + A | 全选当前页面模板里看得见的元素 |
| Ctrl / ⌘ + S | 派发 `save` |
| Ctrl / ⌘ + ]、[ | 上移一层、下移一层 |
| Ctrl / ⌘ + Shift + ]、[ | 置于顶层、置于底层 |
| Delete、Backspace | 删除选中的元素 |
| 方向键 | 选中的元素移动一格（网格边长，不吸附网格时 1 mm）；没有选中时平移视口 |
| Shift + 方向键 | 选中的元素移动 10 mm |
| +、=、- | 放大、缩小 |
| 0 | 适合窗口 |
| Enter | 选中表格时进入表格编辑态 |
| Esc | 取消正在进行的拖动；在表格编辑态里退出；否则取消选择 |

复制的元素以 JSON 放进系统剪贴板，可以在两个设计器之间粘贴；粘贴时先按当前的元素登记表校验，有错误的内容不粘贴。

## 保存与事件

设计器不保存模板。每次修改派发 `schema-change`，`detail.schema` 是改完的模板；一次拖动、一次属性编辑合成一次。按 Ctrl / ⌘ + S 时派发 `save`，宿主保存成功后调用 `markSaved()`：

<<< @/examples/demos/designer.ts#save

- 给 `schema` 赋值即装载新模板：清空撤销历史与选择，重新适配视口，并派发 `kind` 为 `load` 的 `schema-change`。读取 `schema` 得到当前模板。
- `dirty` 表示有没有未保存的修改，变化时派发 `dirty-change`；撤销回到保存时的状态，`dirty` 也回到 `false`。
- `issues-change` 在模板改动后带上全部校验问题，宿主可以据此拦住有错误的模板，不让保存。
- 其余事件：`selection-change`、`page-change`、`mode-change`、`viewport-change`、`element-dblclick`。

也可以用方法操作：`execute(operations)` 执行一组编辑操作并记为一步撤销（操作见 `@xihan-print/core` 的 `PrintOperation`），`addElement`、`select`、`copy`、`paste`、`align`、`reorder`、`zoomToFit`、`scrollToElement` 等与界面上的命令一致。`print()` 按当前模板与 `data` 打印，给了 `printClient` 时交给本地打印客户端。

## 只读与预览

- `readonly`：可以选择、浏览、预览与打印，不能修改；物料不能拖出，属性面板只读。
- `mode`：`design` 设计态，`preview` 预览态。预览态按 `data` 分页，用 `<xh-print-preview>` 显示全部输出页。

## 语言包

界面文字缺省是英文。把 XiHan.UI 的中文语言包与打印的中文语言包合并后全局设置，设计器、它内部的零件与预览都换成中文，见[快速开始](../quickstart#中文界面)。

只改一个实例的几处文案时，给它的 `translations` 属性，压在全局语言包之上：

<<< @/examples/snippets/designer-translations.ts#example

全部文案键见[设计器参考](../reference/designer#printdesignertranslations)。属性面板里的属性名、选项名与单位也在里面，键是属性路径，如 `style.fontSize`。

## 自定义属性编辑器

`editors` 属性给属性面板换编辑器。查找顺序是对象种类加属性路径、属性路径、编辑方式，都没有时用设计器自带的编辑器：

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
