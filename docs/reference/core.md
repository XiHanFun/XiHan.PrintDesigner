# 模型层 core

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

`@xihan-print/core` 是纯 TypeScript 的模型层：模板类型、校验、编辑操作、元素登记表与分页算法，不依赖 DOM，浏览器、Node.js 与其它 JavaScript 运行环境里都能用。模板类型的字段见[模板类型](./schema)，元素属性见[元素](./elements)。下表按源码模块列出全部导出。

## 全部导出

### extensions

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `createPrintModel` | 函数 | 合出打印模型：内置扩展 PRINT_CORE_EXTENSION 在前，extensions 按顺序在后。 |
| `PRINT_CORE_EXTENSION` | 常量 | 内置扩展：全部内置元素。 |
| `PRINT_CORE_EXTENSION_ID` | 常量 | 内置扩展的 id。 |
| `PRINT_EXTENSION_SPACES` | 常量 | 打印各层扩展共用的名字空间：元素类型。 |
| `PrintCoreExtension` | 接口 | 打印 core 层的扩展：元素原型、编辑方式与校验规则。 |
| `PrintModel` | 接口 | 一组扩展合出的打印模型：元素登记表与编辑方式。 |
| `PrintRuleContext` | 接口 | 规则拿到的上下文：合并后的元素登记表。 |

### factory

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `collectDocumentIds` | 函数 | 收集文档中已使用的页面与元素标识。 |
| `createDocument` | 函数 | 生成当前 schema 版本的文档。 |
| `CreateDocumentOptions` | 接口 | 文档创建选项。 |
| `createEdges` | 函数 | 生成四边相等或逐边指定的边距。 |
| `createPage` | 函数 | 生成页面模板：页眉单页时优先首页变体，页脚单页时优先末页变体，页码接续上一页面模板。 |
| `createPageBandSet` | 函数 | 生成只含空 default 带区的页眉或页脚。 |
| `CreatePageOptions` | 接口 | 页面模板创建选项。 |
| `createPaper` | 函数 | 按预设名生成纸张。 |

### geometry

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `getBandRect` | 函数 | 取页眉或页脚带区在纸张上的矩形。 |
| `getBodyRect` | 函数 | 取给定页眉、页脚带区之间的正文区。 |
| `getContentRect` | 函数 | 取页边距以内的内容区。 |
| `getElementRect` | 函数 | 取元素框。 |
| `getPageBand` | 函数 | 取页眉或页脚中指定键的带区。 |
| `getPaperSize` | 函数 | 取页面按方向换算后的纸张尺寸。 |
| `resolvePageBand` | 函数 | 按输出页位置选出页眉或页脚应使用的带区。 |
| `resolvePageBandKey` | 函数 | 按输出页位置选出页眉或页脚应使用的带区键。 |
| `SheetPosition` | 接口 | 输出页在所属页面模板中的位置。 |

### layout/boxes

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `MIN_SHRINK_FONT_SIZE` | 常量 | 缩小字号以容纳文字时的最小字号，单位 pt。 |
| `SHRINK_FONT_STEP` | 常量 | 缩小字号的步长，单位 pt。 |

### layout/design

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `DESIGN_FILLER_ROWS` | 常量 | 设置了补空行的表格在设计态示意的空行数。 |
| `DESIGN_SAMPLE_ROWS` | 常量 | 表格缺省示意的数据行数。 |
| `DesignLayout` | 接口 | 设计态排版结果：各区的布局盒按元素层级排列，坐标为设计坐标。 |
| `DesignLayoutOptions` | 接口 | 设计态排版的选项：度量器、表达式引擎、格式化器、区域与时区同分页。 |
| `layoutDesign` | 函数 | 按设计坐标排出页面模板的每个元素，页眉页脚取 options.bands 指定的变体。 |

### layout/paginate

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `DEFAULT_MAX_SHEETS` | 常量 | 输出页总数上限的缺省值。 |
| `paginate` | 函数 | 按数据排出模板文档的全部输出页，返回每页每个元素的布局盒。 |

### layout/rich-text

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `RICH_TEXT_BLOCK_GAP` | 常量 | 顶层块与块之间的段距，基准字号的倍数；列表项之间与列表项里的块之间不留段距。 |
| `RICH_TEXT_DIVIDER_WIDTH` | 常量 | 分隔线的线宽，单位 mm。 |
| `RICH_TEXT_HEADING_SCALES` | 常量 | 一到三级标题的字号，基准字号的倍数。 |
| `RICH_TEXT_LIST_INDENT` | 常量 | 每层列表的缩进，基准字号的倍数。 |
| `RICH_TEXT_MARKER_GAP` | 常量 | 项目符号或序号与文字之间的间距，基准字号的倍数。 |
| `RICH_TEXT_SCRIPT_SCALE` | 常量 | 上标与下标的字号，所在文字字号的倍数。 |

### layout/text-measure

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `DEFAULT_FONT_FAMILY` | 常量 | 文字样式没写字体时，量字与渲染共用的字体族。 |

### layout/types

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `BarCodeLayoutBox` | 接口 | 一维条码布局盒。 |
| `EllipseLayoutBox` | 接口 | 椭圆布局盒。 |
| `ExtensionLayoutBox` | 接口 | 扩展元素的布局盒：data 是原型的 layout 给出的数据，交给运行时层同一类型的渲染；类型没登记时为 null。 |
| `ImageLayoutBox` | 接口 | 图片布局盒。 |
| `LayoutBand` | 接口 | 输出页选中的页眉或页脚带区。 |
| `LayoutBox` | 类型 |  |
| `LayoutBoxBase` | 接口 | 布局盒共有的字段。 |
| `LayoutFragment` | 接口 | 跨页续排元素的分段位置。 |
| `LayoutSheet` | 接口 | 一张输出页。 |
| `LayoutWatermark` | 类型 | 已替换占位的水印。 |
| `LineLayoutBox` | 接口 | 直线布局盒。 |
| `MatrixCodeLayoutBox` | 接口 | 二维码布局盒。 |
| `PaginateOptions` | 接口 | 分页选项。 |
| `PAGINATION_DIAGNOSTIC_SEVERITIES` | 常量 | 全部分页诊断码及其固定的严重程度：error 为按模板该画的内容没有画出或输出页被截断，warning 为内容画出了但与设计有出入。 |
| `PaginationDiagnostic` | 类型 | 分页诊断：与校验问题同形的 @xihan-ui/designer-kit/schema 的 SchemaIssue，不含文案，严重程度与 target 总是给出。 |
| `PaginationDiagnosticCode` | 类型 | 分页诊断码。 |
| `PaginationDiagnosticTarget` | 接口 | 分页诊断所在的页面（kind 为 page）或元素（kind 为 element）。 |
| `PaginationResult` | 接口 | 分页结果。 |
| `PrintLayoutError` | 类 | 分页无法进行时抛出的错误。 |
| `PrintLayoutErrorCode` | 类型 | 分页无法进行的原因：文档有 error 级校验问题、选项不合法、测量器或格式化器返回了不合法的结果。 |
| `RectLayoutBox` | 接口 | 矩形布局盒。 |
| `RichTextLayoutBox` | 接口 | 富文本布局盒，跨页时每页一段。 |
| `RichTextLine` | 接口 | 富文本排出的一行，长度单位 mm。 |
| `RichTextMarker` | 接口 | 列表项的项目符号或序号。 |
| `RichTextSpan` | 接口 | 富文本一行里同一样式的一截文字：字号与字间距单位 pt。 |
| `TableCellLayout` | 接口 | 表格单元格布局，坐标相对纸张左上角。 |
| `TableLayoutBox` | 接口 | 表格布局盒，跨页时每页一段。 |
| `TableRowLayout` | 接口 | 表格行布局：表头、数据行、补空行或表尾行。 |
| `TextLayoutBox` | 接口 | 文本、长文本与页码的布局盒。 |
| `TextMeasurement` | 接口 | 按文本样式排出的文字，长度单位 mm。 |

### operations/apply

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `applyOperation` | 函数 | 以纯函数方式执行编辑操作：不修改传入的文档，返回新文档与逆操作数组。 |
| `ApplyOperationOptions` | 接口 | 操作选项。 |
| `applyOperations` | 函数 | 按顺序执行一组编辑操作，整体成功或整体失败（@xihan-ui/designer-kit 的 applyInSequence）。 |

### operations/errors

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PrintOperationError` | 类 | 操作无法执行时抛出的错误，`code` 与 `params` 供调用方判断与生成文案。 |
| `PrintOperationErrorCode` | 类型 | 操作无法执行的原因。 |

### operations/table-plans

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `MIN_TABLE_COLUMN_WIDTH` | 常量 | 调整列宽时每列的最小宽度，单位 mm。 |
| `planInsertFooterRow` | 函数 | 在第 index 个表尾行之前插入一行（index 等于行数时追加）。 |
| `planInsertTableColumn` | 函数 | 在第 index 列之前插入一列（index 等于列数时追加在末尾）；跨过插入位置的表尾单元格多跨一列，其余表尾行在新列处留空。 |
| `planMergeFooterCells` | 函数 | 合并表尾行里 columnIds 覆盖的列范围：与范围相交的单元格（含留空的列）合成一个，合并后的范围扩到它们的并集；保留最左边那个单元格的内容，最左边是留空的列时新建空白单元格。 |
| `planMoveTableColumn` | 函数 | 把一列移到第 index 位（按移动后的顺序数）。 |
| `planRemoveFooterRow` | 函数 | 删除一个表尾行。 |
| `planRemoveTableColumn` | 函数 | 删除一列：只占这一列的表尾单元格删除，跨过它的缩短一列，从它起跨的改由下一列起跨。 |
| `planResizeTableColumn` | 函数 | 把一列调到 width 宽，不小于 MIN_TABLE_COLUMN_WIDTH。 |
| `planSplitFooterCell` | 函数 | 把表尾行里从 columnId 起跨的单元格拆成只占一列，空出来的列留空。 |
| `TableColumnFit` | 类型 | 列宽怎样跟着变：keep 保持表格宽度、各列按比例缩放；resize 改变表格宽度、其余列不动。 |
| `TablePlanRefusal` | 类型 | 计划不能执行的原因：只剩一列、移动会拆开跨列的表尾单元格、所选范围只有一个单元格、单元格本来就不跨列。 |
| `TablePlanResult` | 类型 | 计划结果：成功时给出 updateElement 的属性修改。 |

### operations/types

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `AddBandOperation` | 接口 | 为页眉或页脚添加变体带区。 |
| `AddElementOperation` | 接口 | 向容器添加元素，`index` 缺省时放在最上层。 |
| `AddPageOperation` | 接口 | 添加页面模板，`index` 缺省时放在末尾。 |
| `MoveElementsOperation` | 接口 | 平移一组元素，单位 mm。 |
| `MovePageOperation` | 接口 | 移动页面模板到目标下标。 |
| `OperationResult` | 类型 | 操作结果，即 @xihan-ui/designer-kit 的 OperationResult：新文档，以及按顺序作用于新文档即可还原出传入文档的逆操作。 |
| `PrintOperation` | 类型 | 编辑操作。 |
| `PrintOperationType` | 类型 | 编辑操作的种类。 |
| `PropertyChange` | 接口 | 一处属性修改。 |
| `RemoveBandOperation` | 接口 | 删除页眉或页脚的变体带区及其中的元素。 |
| `RemoveElementOperation` | 接口 | 删除元素。 |
| `RemovePageOperation` | 接口 | 删除页面模板。 |
| `ReorderElementOperation` | 接口 | 调整元素在容器内的层级。 |
| `ReorderTarget` | 类型 | 层级调整目标：最上层、最下层、上移一层、下移一层，或容器内的目标下标。 |
| `ResizeElementOperation` | 接口 | 把元素缩放到新的元素框，元素原型可附带专属缩放行为。 |
| `UpdateDocumentOperation` | 接口 | 修改文档属性；不能修改 `schemaVersion` 与 `pages`。 |
| `UpdateElementOperation` | 接口 | 修改元素属性；不能修改 `id` 与 `type`。 |
| `UpdatePageOperation` | 接口 | 修改页面设置：名称、纸张、方向、边距、页码规则、水印、参考线、宿主附加数据，以及页眉页脚的 `singleSheet` 和已有带区的 `height`。 |

### registry/builtins

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `createBuiltinElementPrototypes` | 函数 | 生成全部内置元素原型，每次调用返回互不共享的新对象。 |
| `scaleTableColumns` | 函数 | 按新的总宽度等比缩放列宽，末列吸收舍入误差；原列宽合计不为正时均分。 |

### registry/part-properties

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `pageProperties` | 函数 | 页面设置的属性描述，路径相对页面模板；页眉页脚各变体的高度只在该变体存在时显示。 |
| `tableBodyProperties` | 函数 | 表体的属性描述，路径相对表体。 |
| `tableColumnProperties` | 函数 | 表格列的属性描述，路径相对列；条码码制只在单元格类型为条码时显示。 |
| `tableFooterCellProperties` | 函数 | 表尾单元格的属性描述，路径相对单元格。 |
| `tableFooterRowProperties` | 函数 | 表尾行的属性描述，路径相对表尾行；单元格另按表尾格编辑。 |
| `tableHeaderProperties` | 函数 | 表头的属性描述，路径相对表头；表头隐藏时只显示「是否显示」。 |

### registry/properties

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `behaviorProperties` | 函数 | 名称、锁定与只预览不打印。 |
| `boxProperties` | 函数 | `box` 下的背景、边框与内边距。 |
| `choices` | 函数 | 一组取值写成 select 编辑方式的选项。 |
| `layoutProperties` | 函数 | 坐标、宽高与可选的旋转角度。 |
| `property` | 函数 | 生成一条属性描述，缺省为元素上必须有的属性。 |
| `PropertyOptions` | 接口 | 属性描述的可选项。 |
| `textStyleProperties` | 函数 | `style` 下的文本样式。 |

### registry/registry

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `CreateElementInit` | 接口 | 创建元素的参数。 |
| `createElementRegistry` | 函数 | 创建元素类型登记表，默认登记全部内置元素；类型重复时抛出错误。 |
| `ElementCategoryGroup` | 接口 | 物料面板中的一个分组。 |
| `ElementRegistry` | 接口 | 元素类型登记表。 |

### registry/types

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `AnyElementPrototype` | 类型 | 任一元素的原型：内置元素的，或扩展元素的。 |
| `ELEMENT_CATEGORIES` | 常量 | 内置的物料分组，按面板中的显示顺序；扩展自定的分组排在它们之后。 |
| `ElementCategory` | 类型 | 内置的物料分组：文字、图片、数据、图形、条码。 |
| `ElementDefaults` | 类型 | 元素默认值：不含标识与坐标。 |
| `ElementLayoutContext` | 接口 | 扩展元素排版时拿到的上下文。 |
| `ElementPrototype` | 接口 | 元素原型：一种元素的默认值、尺寸约束、可编辑属性与专属行为。 |
| `ElementValidationContext` | 接口 | 元素专属规则的校验上下文。 |
| `ExtensionElementPrototype` | 接口 | 扩展元素的原型：不跨页，必须给出 layout。 |
| `NumberControl` | 类型 | 数值属性：designer-kit 的 number 编辑方式，单位取打印的单位。 |
| `PAGE_PROPERTY_GROUPS` | 常量 | 页面设置的属性分组取值，按面板中的显示顺序。 |
| `PROPERTY_GROUPS` | 常量 | 元素与表格部位的属性分组取值，按面板中的显示顺序。 |
| `PropertyControl` | 类型 | 属性编辑方式：@xihan-ui/designer-kit/properties 的内建编辑方式（数值的单位取打印的单位），加上打印专属的复合类型；复合类型由设计器提供对应的专用编辑器。 |
| `PropertyControlKind` | 类型 | 属性编辑方式的种类。 |
| `PropertyDescriptor` | 接口 | 可编辑属性描述：@xihan-ui/designer-kit/properties 的 PropertyDescriptor，path 相对元素；分组总是给出，显示条件写在 visibleWhen；required（显示时必须填写）不用，空值由打印自己的规则报告。 |
| `PropertyGroup` | 类型 | 属性面板分组：元素与表格部位用布局、内容、数据、文字、表格、条码、外观、行为，页面设置用页面、纸张、页眉页脚、页码、水印。 |
| `PropertyUnit` | 类型 | 数值属性的单位：mm、pt、角度、倍数或个数。 |
| `SidesControl` | 类型 | 四边距离：designer-kit 的 sides 编辑方式，单位取打印的单位。 |

### schema/common

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `BorderSides` | 接口 | 四边边框，缺省的一边不画线。 |
| `BoxStyle` | 接口 | 元素外框样式。 |
| `Color` | 类型 | 颜色：`#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。 |
| `Edges` | 接口 | 四边距离，单位 mm。 |
| `ExpressionFormat` | 接口 | 表达式格式：以受限表达式把值转成显示文本，表达式中以 `value` 引用待格式化的值。 |
| `ExpressionTextContent` | 接口 | 以受限表达式计算的文本，表达式中的变量为数据对象的顶层字段。 |
| `FieldImageSource` | 接口 | 从数据字段读取图片地址。 |
| `FieldTextContent` | 接口 | 绑定单个数据字段。 |
| `ImageSource` | 类型 | 图片来源。 |
| `MapFormat` | 接口 | 值映射格式：按数据值查表显示文本。 |
| `StaticImageSource` | 接口 | 固定地址的图片。 |
| `StaticTextContent` | 接口 | 固定文本。 |
| `Stroke` | 接口 | 描边。 |
| `TemplateTextContent` | 接口 | 含 <code v-pre>{{path}}</code> 占位的文本模板，占位按数据字段替换。 |
| `TextContent` | 类型 | 文本内容来源。 |
| `TextStyle` | 接口 | 文本样式。 |
| `ValueFormat` | 类型 | 值格式：数字、百分比、日期与人民币大写即 @xihan-ui/expression 的 FormatSpec，交给注入的格式化器；值映射在本包内完成，表达式格式经表达式接入点。 |
| `ValueMapEntry` | 接口 | 值映射的一项：数据值（按字符串比较）与显示文本。 |

### schema/document

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `PageBand` | 接口 | 页眉或页脚的一个带区。 |
| `PageBandSet` | 接口 | 页眉或页脚：`default` 为常规带区，其余为按输出页命中的变体。 |
| `PageGuides` | 接口 | 参考线：设计时对位用，不参与分页也不打印；坐标相对纸张左上角（按页面方向换算后的纸张），单位 mm。 |
| `PageNumbering` | 接口 | 页码编号规则。 |
| `PaperSpec` | 接口 | 纸张。 |
| `PRINT_SCHEMA_VERSION` | 常量 | 当前模板 schema 版本。 |
| `PrintDocument` | 接口 | 打印模板文档。 |
| `PrintPage` | 接口 | 页面模板：一份页面模板按数据量排出一张或多张输出页。 |
| `PrintSchemaVersion` | 类型 | 模板 schema 版本号类型。 |
| `Watermark` | 接口 | 平铺文字水印。 |

### schema/elements

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `BarCodeElement` | 接口 | 一维条码。 |
| `BarCodeTextStyle` | 接口 | 条码下方文字的样式。 |
| `ElementBase` | 接口 | 全部元素共有的字段。 |
| `EllipseElement` | 接口 | 椭圆，内切于元素框。 |
| `ExtensionElement` | 接口 | 扩展登记的元素：通用字段之外的属性由扩展的原型定义，取值都是 JSON。 |
| `ImageElement` | 接口 | 图片。 |
| `LineElement` | 接口 | 直线，走向由元素框和方向共同决定。 |
| `LongTextElement` | 接口 | 随内容纵向延展并可跨页续排的长文本。 |
| `MatrixCodeElement` | 接口 | 二维码：QR、Data Matrix、PDF417、Aztec。 |
| `PageNumberElement` | 接口 | 页码。 |
| `PRINT_ELEMENT_TYPES` | 常量 | 内置元素类型列表。 |
| `PrintElement` | 类型 | 内置元素。 |
| `PrintElementOf` | 类型 | 按类型取元素接口。 |
| `PrintElementType` | 类型 | 内置元素类型。 |
| `RectElement` | 接口 | 矩形。 |
| `RichTextContent` | 类型 | 富文本的内容来源：模板里写死的文档，或从数据字段读取。 |
| `RichTextElement` | 接口 | 随内容纵向延展并可跨页续排的富文本：段落、标题、列表、分隔线与带样式的文字。 |
| `TableElement` | 接口 | 绑定数组数据、随行数延展并可跨页续排的表格。 |
| `TextElement` | 接口 | 固定尺寸的文本。 |

### schema/options

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `AGGREGATE_FUNCTIONS` | 常量 | 表格汇总函数取值。 |
| `AGGREGATE_SCOPES` | 常量 | 表格汇总范围取值。 |
| `AggregateFunction` | 类型 | 表格汇总函数。 |
| `AggregateScope` | 类型 | 表格汇总范围：page 本页数据，cumulative 截至本页的累计数据，all 全部数据。 |
| `BarCodeFormat` | 类型 | 转导出自 @xihan-ui/headless |
| `HORIZONTAL_ALIGNS` | 常量 | 单元格水平对齐取值。 |
| `HorizontalAlign` | 类型 | 单元格水平对齐。 |
| `IMAGE_FITS` | 常量 | 图片适配方式取值。 |
| `ImageFit` | 类型 | 图片在元素框内的适配方式。 |
| `LINE_DIRECTIONS` | 常量 | 直线方向取值。 |
| `LineDirection` | 类型 | 直线在元素框内的走向：horizontal 沿垂直中线，vertical 沿水平中线，diagonalDown 左上到右下，diagonalUp 左下到右上。 |
| `MatrixCodeFormat` | 类型 | 转导出自 @xihan-ui/headless |
| `MatrixCodeLevel` | 类型 | 转导出自 @xihan-ui/headless |
| `PAGE_BAND_VARIANTS` | 常量 | 页眉页脚的页面变体键。 |
| `PAGE_ORIENTATIONS` | 常量 | 页面方向取值。 |
| `PageBandKey` | 类型 | 页眉页脚的全部带区键，`default` 为未命中任何变体时使用的带区。 |
| `PageBandVariant` | 类型 | 页眉页脚变体：first 首页、last 末页、odd 奇数页、even 偶数页（按页码奇偶）。 |
| `PageOrientation` | 类型 | 页面方向：portrait 纵向，landscape 横向（宽高互换）。 |
| `RICH_TEXT_SOURCES` | 常量 | 富文本字段的内容格式取值。 |
| `RichTextSource` | 类型 | 富文本字段的内容格式：html 为 HTML 串，按白名单换成文档；document 为富文本文档对象。 |
| `SINGLE_SHEET_PREFERENCES` | 常量 | 同一输出页既是首页又是末页时优先采用的变体取值。 |
| `SingleSheetPreference` | 类型 | 同一输出页既是首页又是末页时优先采用的变体。 |
| `STROKE_STYLES` | 常量 | 线型取值。 |
| `StrokeStyle` | 类型 | 线型。 |
| `TABLE_CELL_TYPES` | 常量 | 表格列单元格的呈现类型取值。 |
| `TABLE_FOOTER_PLACEMENTS` | 常量 | 表尾行出现位置取值。 |
| `TABLE_ROW_HEIGHT_MODES` | 常量 | 表体行高模式取值。 |
| `TableCellType` | 类型 | 表格列单元格的呈现类型。 |
| `TableFooterPlacement` | 类型 | 表尾行出现位置：everyPage 表格所跨的每一页，lastPage 仅表格结束的那一页。 |
| `TableRowHeightMode` | 类型 | 表体行高模式：fixed 每行固定为设定的行高，minimum 以设定的行高为下限、按单元格内容撑高。 |
| `TEXT_ALIGNS` | 常量 | 文本水平对齐取值。 |
| `TEXT_OVERFLOWS` | 常量 | 固定尺寸文本的溢出处理取值。 |
| `TextAlign` | 类型 | 文本水平对齐。 |
| `TextOverflow` | 类型 | 固定尺寸文本的溢出处理：clip 裁切，shrink 缩小字号以容纳，visible 允许溢出显示。 |
| `VERTICAL_ALIGNS` | 常量 | 垂直对齐取值。 |
| `VerticalAlign` | 类型 | 垂直对齐。 |

### schema/table

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `AggregateCellContent` | 接口 | 表尾单元格的汇总内容。 |
| `CellStyle` | 接口 | 单元格样式。 |
| `TableBody` | 接口 | 表体。 |
| `TableBorder` | 接口 | 表格网格线。 |
| `TableCellContent` | 类型 | 表体单元格内容来源。 |
| `TableColumn` | 接口 | 表格列。 |
| `TableExpressionCellContent` | 接口 | 表体单元格以受限表达式计算，表达式中的变量为行对象的顶层字段。 |
| `TableFieldCellContent` | 接口 | 表体单元格显示行内字段。 |
| `TableFooterCell` | 接口 | 表尾单元格。 |
| `TableFooterCellContent` | 类型 | 表尾单元格内容：固定文本、根数据字段、根数据模板或汇总值。 |
| `TableFooterRow` | 接口 | 表尾行，可承载固定文字、根数据字段与汇总值。 |
| `TableHeader` | 接口 | 表头。 |
| `TableRowNumberCellContent` | 接口 | 表体单元格显示从 1 开始、跨页连续的行序号。 |
| `TableTemplateCellContent` | 接口 | 表体单元格按行对象替换 <code v-pre>{{path}}</code> 占位。 |

### traverse

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `ElementContainerRef` | 类型 | 元素容器：页面正文，或页眉、页脚中的某个带区。 |
| `ElementLocation` | 接口 | 元素在文档中的位置。 |
| `ElementRegion` | 类型 | 元素所在区域：正文、页眉或页脚。 |
| `findElement` | 函数 | 按标识查找元素。 |
| `findPage` | 函数 | 按标识查找页面及其下标。 |
| `forEachElement` | 函数 | 按页面、正文、页眉、页脚的顺序遍历全部元素。 |
| `getContainerElements` | 函数 | 取容器的元素数组；页面或带区不存在时返回 undefined。 |
| `getContainerPath` | 函数 | 取容器元素数组相对页面的 JSON 路径。 |
| `listContainers` | 函数 | 列出页面上的全部容器，按正文、页眉、页脚的顺序。 |
| `listPageBandKeys` | 函数 | 列出页眉或页脚中已存在的带区键。 |
| `PAGE_BAND_KEYS` | 常量 | 页眉页脚带区键，按 default、first、last、odd、even 的顺序。 |

### validation/checks

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `isValidColor` | 函数 | 判断颜色是否为 `transparent` 或以 `#` 开头的 3、4、6、8 位十六进制色，判据即 designer-kit 的 color 编辑方式。 |

### validation/issues

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `ExtensionIssueCode` | 类型 | 扩展自己的问题码：扩展 id 的末段加点开头，如 seal.noImage；没有登记严重程度，缺省按 error。 |
| `IssueParams` | 类型 | 问题参数，供各语言文案插值。 |
| `VALIDATION_ISSUE_SEVERITIES` | 常量 | 全部问题码及其固定的严重程度：不带前缀的是 @xihan-ui/designer-kit/schema 的通用问题码，带前缀的是打印专属的问题码。 |
| `ValidationIssue` | 类型 | 校验问题：@xihan-ui/designer-kit/schema 的 SchemaIssue，严重程度总是给出。 |
| `ValidationIssueCode` | 类型 | 问题码。 |
| `ValidationReport` | 接口 | 校验报告。 |

### validation/validate

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `validateDocument` | 函数 | 校验模板文档：先检查 JSON 纯度，再按 schema、属性描述与元素专属规则逐层校验。 |
| `ValidateDocumentOptions` | 接口 | 校验选项。 |
