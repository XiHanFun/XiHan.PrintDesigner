# 模板类型

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

模板文档 `PrintDocument` 的全部类型，按 `@xihan-print/core` 的源码列出。当前 schema 版本 `PRINT_SCHEMA_VERSION` 为 `1`。

长度单位为 mm，字号与字间距单位为 pt，角度单位为度；颜色写作 `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。

## 文档与页面

### PrintSchemaVersion {#printschemaversion}

模板 schema 版本号类型。

类型：<code>typeof PRINT_SCHEMA_VERSION</code>

### PaperSpec {#paperspec}

纸张。宽高为纵向尺寸，单位 mm；横向时宽高互换。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `preset` | <code>PaperPresetName</code> | 可省 | 来源预设，自定义纸张不填。 |
| `width` | <code>number</code> | 是 |  |
| `height` | <code>number</code> | 是 |  |

### PageBand {#pageband}

页眉或页脚的一个带区。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `height` | <code>number</code> | 是 | 带区高度，单位 mm。 |
| `elements` | <code><a href="#printelement">PrintElement</a>[]</code> | 是 | 带区内的元素，坐标相对纸张左上角。 |

### PageBandSet {#pagebandset}

页眉或页脚：`default` 为常规带区，其余为按输出页命中的变体。命中顺序为首页、末页、奇偶页，都未命中时使用 `default`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `default` | <code><a href="#pageband">PageBand</a></code> | 是 |  |
| `first` | <code><a href="#pageband">PageBand</a></code> | 可省 |  |
| `last` | <code><a href="#pageband">PageBand</a></code> | 可省 |  |
| `odd` | <code><a href="#pageband">PageBand</a></code> | 可省 |  |
| `even` | <code><a href="#pageband">PageBand</a></code> | 可省 |  |
| `singleSheet` | <code><a href="#singlesheetpreference">SingleSheetPreference</a></code> | 是 | 输出页既是首页又是末页且两种变体都存在时采用哪一个。 |

### PageNumbering {#pagenumbering}

页码编号规则。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `continuous` | <code>boolean</code> | 是 | 是否接续上一页面模板的页码；为 false 或没有上一页面模板时从 `start` 开始。 |
| `start` | <code>number</code> | 是 | 起始页码。 |

### Watermark {#watermark}

平铺文字水印。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | <code>string</code> | 是 | 水印文字，支持 <code v-pre>{{path}}</code> 占位。 |
| `fontFamily` | <code>string</code> | 可省 |  |
| `fontSize` | <code>number</code> | 是 | 字号，单位 pt。 |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |
| `opacity` | <code>number</code> | 是 | 不透明度，0 到 1。 |
| `rotation` | <code>number</code> | 是 | 逆时针旋转角度。 |
| `gapX` | <code>number</code> | 是 | 相邻水印的水平间距，单位 mm。 |
| `gapY` | <code>number</code> | 是 | 相邻水印的垂直间距，单位 mm。 |

### PageGuides {#pageguides}

参考线：设计时对位用，不参与分页也不打印；坐标相对纸张左上角（按页面方向换算后的纸张），单位 mm。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `x` | <code>number[]</code> | 是 | 竖线的横坐标。 |
| `y` | <code>number[]</code> | 是 | 横线的纵坐标。 |

### PrintPage {#printpage}

页面模板：一份页面模板按数据量排出一张或多张输出页。页眉位于上边距之下，页脚位于下边距之上，两者之间为正文区。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | <code>string</code> | 是 | 页面标识，在整份文档内唯一。 |
| `name` | <code>string</code> | 可省 |  |
| `paper` | <code><a href="#paperspec">PaperSpec</a></code> | 是 |  |
| `orientation` | <code><a href="#pageorientation">PageOrientation</a></code> | 是 |  |
| `margins` | <code><a href="#edges">Edges</a></code> | 是 | 页边距，单位 mm。 |
| `header` | <code><a href="#pagebandset">PageBandSet</a></code> | 是 |  |
| `footer` | <code><a href="#pagebandset">PageBandSet</a></code> | 是 |  |
| `elements` | <code><a href="#printelement">PrintElement</a>[]</code> | 是 | 正文元素，坐标相对纸张左上角。 |
| `numbering` | <code><a href="#pagenumbering">PageNumbering</a></code> | 是 |  |
| `watermark` | <code><a href="#watermark">Watermark</a></code> | 可省 |  |
| `guides` | <code><a href="#pageguides">PageGuides</a></code> | 可省 |  |
| `meta` | <code>JsonObject</code> | 可省 |  |
| `extensions` | <code>JsonObject</code> | 可省 | 扩展自己的数据，键是扩展 id。 |

### PrintDocument {#printdocument}

打印模板文档。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | <code><a href="#printschemaversion">PrintSchemaVersion</a></code> | 是 |  |
| `name` | <code>string</code> | 可省 |  |
| `pages` | <code><a href="#printpage">PrintPage</a>[]</code> | 是 |  |
| `meta` | <code>JsonObject</code> | 可省 |  |
| `extensions` | <code>JsonObject</code> | 可省 | 扩展自己的数据，键是扩展 id。 |

## 元素

### ElementBase {#elementbase}

全部元素共有的字段。坐标相对纸张左上角，单位 mm。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | <code>string</code> | 是 | 元素标识，在整份文档内唯一。 |
| `type` | <code>TType</code> | 是 |  |
| `name` | <code>string</code> | 可省 | 设计器中显示的名称。 |
| `x` | <code>number</code> | 是 |  |
| `y` | <code>number</code> | 是 |  |
| `width` | <code>number</code> | 是 |  |
| `height` | <code>number</code> | 是 |  |
| `locked` | <code>boolean</code> | 可省 | 是否锁定，锁定的元素在设计器中不可拖动与缩放。 |
| `previewOnly` | <code>boolean</code> | 可省 | 是否只在设计与预览中显示、不参与打印。 |
| `meta` | <code>JsonObject</code> | 可省 | 宿主附加数据。 |
| `extensions` | <code>JsonObject</code> | 可省 | 扩展自己的数据，键是扩展 id；core 只检查它是对象，里面不看。 |

### TextElement {#textelement}

固定尺寸的文本。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'text'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | <code><a href="#textcontent">TextContent</a></code> | 是 |  |
| `style` | <code><a href="#textstyle">TextStyle</a></code> | 是 |  |
| `wrap` | <code>boolean</code> | 是 | 是否自动换行。 |
| `overflow` | <code><a href="#textoverflow">TextOverflow</a></code> | 是 |  |
| `rotation` | <code>number</code> | 是 | 绕中心顺时针旋转的角度。 |
| `box` | <code><a href="#boxstyle">BoxStyle</a></code> | 可省 |  |

### LongTextElement {#longtextelement}

随内容纵向延展并可跨页续排的长文本。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'longText'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | <code><a href="#textcontent">TextContent</a></code> | 是 |  |
| `style` | <code><a href="#textstyle">TextStyle</a></code> | 是 |  |
| `box` | <code><a href="#boxstyle">BoxStyle</a></code> | 可省 |  |

### RichTextContent {#richtextcontent}

富文本的内容来源：模板里写死的文档，或从数据字段读取。字段值是 HTML 串时（source 为 html）按白名单换成文档，字段值已是富文本文档对象时 source 为 document。文档是 @xihan-ui/core/rich-text 的 RichTextDocument，其中行内字段的 format 按值格式解释。

类型：<code>&#124; { kind: 'static', document: RichTextDocument } &#124; { kind: 'field', field: string, source: <a href="#richtextsource">RichTextSource</a> }</code>

### RichTextElement {#richtextelement}

随内容纵向延展并可跨页续排的富文本：段落、标题、列表、分隔线与带样式的文字。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'richText'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | <code><a href="#richtextcontent">RichTextContent</a></code> | 是 |  |
| `style` | <code><a href="#textstyle">TextStyle</a></code> | 是 | 基准样式：块与行内的样式在它之上覆写。 |
| `box` | <code><a href="#boxstyle">BoxStyle</a></code> | 可省 |  |

### TableElement {#tableelement}

绑定数组数据、随行数延展并可跨页续排的表格。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'table'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `dataField` | <code>string</code> | 是 | 数组数据的字段路径。 |
| `columns` | <code><a href="#tablecolumn">TableColumn</a>[]</code> | 是 |  |
| `header` | <code><a href="#tableheader">TableHeader</a></code> | 是 |  |
| `body` | <code><a href="#tablebody">TableBody</a></code> | 是 |  |
| `footerRows` | <code><a href="#tablefooterrow">TableFooterRow</a>[]</code> | 是 |  |
| `maxRowsPerPage` | <code>number</code> | 可省 | 每页最多显示的数据行数，缺省按可用高度排满。 |
| `fillEmptyRows` | <code>boolean</code> | 是 | 数据行不足时是否用空行补齐到每页最大行数或可用高度。 |
| `border` | <code><a href="#tableborder">TableBorder</a></code> | 是 |  |

### ImageElement {#imageelement}

图片。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'image'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | <code><a href="#imagesource">ImageSource</a></code> | 是 |  |
| `fit` | <code><a href="#imagefit">ImageFit</a></code> | 是 |  |
| `rotation` | <code>number</code> | 是 |  |
| `box` | <code><a href="#boxstyle">BoxStyle</a></code> | 可省 |  |

### LineElement {#lineelement}

直线，走向由元素框和方向共同决定。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'line'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `direction` | <code><a href="#linedirection">LineDirection</a></code> | 是 |  |
| `stroke` | <code><a href="#stroke">Stroke</a></code> | 是 |  |

### RectElement {#rectelement}

矩形。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'rect'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stroke` | <code><a href="#stroke">Stroke</a></code> | 可省 | 边线，缺省不画边。 |
| `fill` | <code><a href="#color">Color</a></code> | 可省 | 填充色，缺省不填充。 |
| `radius` | <code>number</code> | 是 | 圆角半径，单位 mm。 |
| `rotation` | <code>number</code> | 是 |  |

### EllipseElement {#ellipseelement}

椭圆，内切于元素框。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'ellipse'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stroke` | <code><a href="#stroke">Stroke</a></code> | 可省 |  |
| `fill` | <code><a href="#color">Color</a></code> | 可省 |  |
| `rotation` | <code>number</code> | 是 |  |

### BarCodeTextStyle {#barcodetextstyle}

条码下方文字的样式。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fontFamily` | <code>string</code> | 可省 |  |
| `fontSize` | <code>number</code> | 是 | 字号，单位 pt。 |

### BarCodeElement {#barcodeelement}

一维条码。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'barCode'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `format` | <code>BarCodeFormat</code> | 是 | 码制，取值见 @xihan-ui/headless 的 BAR_CODE_FORMATS。 |
| `content` | <code><a href="#textcontent">TextContent</a></code> | 是 |  |
| `showText` | <code>boolean</code> | 是 | 是否在条码下方显示编码文字。 |
| `textStyle` | <code><a href="#barcodetextstyle">BarCodeTextStyle</a></code> | 是 |  |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |
| `rotation` | <code>number</code> | 是 |  |

### MatrixCodeElement {#matrixcodeelement}

二维码：QR、Data Matrix、PDF417、Aztec。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'matrixCode'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `format` | <code>MatrixCodeFormat</code> | 是 |  |
| `content` | <code><a href="#textcontent">TextContent</a></code> | 是 |  |
| `level` | <code>MatrixCodeLevel</code> | 可省 | 纠错级别：qr 为 L / M / Q / H，pdf417 为 0–8，aztec 为纠错码字至少占的百分比 5–95，data-matrix 没有级别；缺省取码制的默认值。 |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |
| `background` | <code><a href="#color">Color</a></code> | 可省 |  |
| `quietZone` | <code>number</code> | 是 | 四周静区宽度，单位为模块数。 |
| `rotation` | <code>number</code> | 是 |  |

### PageNumberElement {#pagenumberelement}

页码。

继承 <code><a href="#elementbase">ElementBase</a>&lt;'pageNumber'&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `format` | <code>string</code> | 是 | 页码格式：<code v-pre>{{path}}</code> 文本模板，可用的宿主变量为 `$page`（当前页码）与 `$pages`（所在编号段的总页数），如 <code v-pre>第 {{$page}} 页 / 共 {{$pages}} 页</code>。 |
| `numeral` | <code>NumeralStyle</code> | 可省 | 页码的数字字形，即 @xihan-ui/expression 的 numeral 格式（罗马数字、中文数字）；缺省为阿拉伯数字。 |
| `style` | <code><a href="#textstyle">TextStyle</a></code> | 是 |  |
| `box` | <code><a href="#boxstyle">BoxStyle</a></code> | 可省 |  |

### ExtensionElement {#extensionelement}

扩展登记的元素：通用字段之外的属性由扩展的原型定义，取值都是 JSON。

继承 <code><a href="#elementbase">ElementBase</a>&lt;string&gt;</code> 的字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `` | <code>JsonValue &#124; undefined</code> | 是 |  |

### PrintElement {#printelement}

内置元素。

取其一：<code><a href="#textelement">TextElement</a></code>、<code><a href="#longtextelement">LongTextElement</a></code>、<code><a href="#richtextelement">RichTextElement</a></code>、<code><a href="#tableelement">TableElement</a></code>、<code><a href="#imageelement">ImageElement</a></code>、<code><a href="#lineelement">LineElement</a></code>、<code><a href="#rectelement">RectElement</a></code>、<code><a href="#ellipseelement">EllipseElement</a></code>、<code><a href="#barcodeelement">BarCodeElement</a></code>、<code><a href="#matrixcodeelement">MatrixCodeElement</a></code>、<code><a href="#pagenumberelement">PageNumberElement</a></code>。

### PrintElementType {#printelementtype}

内置元素类型。

类型：<code><a href="#printelement">PrintElement</a>['type']</code>

### PrintElementOf {#printelementof}

按类型取元素接口。

类型：<code>Extract&lt;<a href="#printelement">PrintElement</a>, { type: TType }&gt;</code>

## 表格

### CellStyle {#cellstyle}

单元格样式。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fontFamily` | <code>string</code> | 可省 |  |
| `fontSize` | <code>number</code> | 是 | 字号，单位 pt。 |
| `bold` | <code>boolean</code> | 是 |  |
| `italic` | <code>boolean</code> | 是 |  |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |
| `background` | <code><a href="#color">Color</a></code> | 可省 |  |
| `align` | <code><a href="#horizontalalign">HorizontalAlign</a></code> | 可省 | 水平对齐，缺省跟随列的对齐方式。 |
| `verticalAlign` | <code><a href="#verticalalign">VerticalAlign</a></code> | 是 |  |
| `padding` | <code>number</code> | 是 | 左右内边距，单位 mm。 |
| `lineHeight` | <code>number</code> | 是 | 单元格文字每一行的高度，单位 mm。 |

### TableFieldCellContent {#tablefieldcellcontent}

表体单元格显示行内字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'field'</code> | 是 |  |
| `field` | <code>string</code> | 是 | 行对象内的字段路径。 |
| `format` | <code><a href="#valueformat">ValueFormat</a></code> | 可省 |  |
| `emptyText` | <code>string</code> | 可省 |  |

### TableTemplateCellContent {#tabletemplatecellcontent}

表体单元格按行对象替换 <code v-pre>{{path}}</code> 占位。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'template'</code> | 是 |  |
| `template` | <code>string</code> | 是 |  |

### TableRowNumberCellContent {#tablerownumbercellcontent}

表体单元格显示从 1 开始、跨页连续的行序号。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'rowNumber'</code> | 是 |  |

### TableExpressionCellContent {#tableexpressioncellcontent}

表体单元格以受限表达式计算，表达式中的变量为行对象的顶层字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'expression'</code> | 是 |  |
| `expression` | <code>string</code> | 是 | 受限表达式源码。 |
| `format` | <code><a href="#valueformat">ValueFormat</a></code> | 可省 | 计算结果的格式。 |

### TableCellContent {#tablecellcontent}

表体单元格内容来源。

取其一：<code><a href="#tablefieldcellcontent">TableFieldCellContent</a></code>、<code><a href="#tabletemplatecellcontent">TableTemplateCellContent</a></code>、<code><a href="#tablerownumbercellcontent">TableRowNumberCellContent</a></code>、<code><a href="#tableexpressioncellcontent">TableExpressionCellContent</a></code>。

### TableColumn {#tablecolumn}

表格列。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | <code>string</code> | 是 | 列标识，在所属表格内唯一。 |
| `title` | <code>string</code> | 是 | 表头文本。 |
| `width` | <code>number</code> | 是 | 列宽，单位 mm。 |
| `align` | <code><a href="#horizontalalign">HorizontalAlign</a></code> | 是 |  |
| `content` | <code><a href="#tablecellcontent">TableCellContent</a></code> | 是 |  |
| `cellType` | <code><a href="#tablecelltype">TableCellType</a></code> | 是 |  |
| `barCodeFormat` | <code>BarCodeFormat</code> | 可省 | 条码码制，`cellType` 为 barCode 时必填；matrixCode 单元格按 QR 编码。 |

### TableHeader {#tableheader}

表头。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `visible` | <code>boolean</code> | 是 |  |
| `repeat` | <code>boolean</code> | 是 | 表格跨页时是否在每一页重复表头。 |
| `height` | <code>number</code> | 是 | 表头行高，单位 mm。 |
| `style` | <code><a href="#cellstyle">CellStyle</a></code> | 是 |  |

### TableBody {#tablebody}

表体。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `rowHeight` | <code>number</code> | 是 | 行高，单位 mm；`rowHeightMode` 为 minimum 时作为最小行高。 |
| `rowHeightMode` | <code><a href="#tablerowheightmode">TableRowHeightMode</a></code> | 是 |  |
| `style` | <code><a href="#cellstyle">CellStyle</a></code> | 是 |  |

### AggregateCellContent {#aggregatecellcontent}

表尾单元格的汇总内容。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'aggregate'</code> | 是 |  |
| `fn` | <code><a href="#aggregatefunction">AggregateFunction</a></code> | 是 |  |
| `field` | <code>string</code> | 可省 | 参与汇总的行内字段路径；`fn` 为 count 时可省略，表示统计行数。 |
| `scope` | <code><a href="#aggregatescope">AggregateScope</a></code> | 是 |  |
| `format` | <code><a href="#valueformat">ValueFormat</a></code> | 可省 |  |

### TableFooterCellContent {#tablefootercellcontent}

表尾单元格内容：固定文本、根数据字段、根数据模板或汇总值。

取其一：<code><a href="#textcontent">TextContent</a></code>、<code><a href="#aggregatecellcontent">AggregateCellContent</a></code>。

### TableFooterCell {#tablefootercell}

表尾单元格。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `columnId` | <code>string</code> | 是 | 起始列的标识。 |
| `colSpan` | <code>number</code> | 是 | 向右跨越的列数，至少为 1。 |
| `content` | <code><a href="#tablefootercellcontent">TableFooterCellContent</a></code> | 是 |  |
| `align` | <code><a href="#horizontalalign">HorizontalAlign</a></code> | 可省 | 水平对齐，缺省跟随行样式再跟随起始列。 |

### TableFooterRow {#tablefooterrow}

表尾行，可承载固定文字、根数据字段与汇总值。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | <code>string</code> | 是 | 行标识，在所属表格内唯一。 |
| `placement` | <code><a href="#tablefooterplacement">TableFooterPlacement</a></code> | 是 |  |
| `height` | <code>number</code> | 是 | 行高，单位 mm。 |
| `style` | <code><a href="#cellstyle">CellStyle</a></code> | 是 |  |
| `cells` | <code><a href="#tablefootercell">TableFooterCell</a>[]</code> | 是 |  |

### TableBorder {#tableborder}

表格网格线。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stroke` | <code><a href="#stroke">Stroke</a></code> | 是 |  |
| `outer` | <code>boolean</code> | 是 | 是否画外框。 |
| `horizontal` | <code>boolean</code> | 是 | 是否画行之间的横线。 |
| `vertical` | <code>boolean</code> | 是 | 是否画列之间的竖线。 |

## 通用类型

### Color {#color}

颜色：`#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。

类型：<code>string</code>

### Edges {#edges}

四边距离，单位 mm。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `top` | <code>number</code> | 是 |  |
| `right` | <code>number</code> | 是 |  |
| `bottom` | <code>number</code> | 是 |  |
| `left` | <code>number</code> | 是 |  |

### Stroke {#stroke}

描边。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `width` | <code>number</code> | 是 | 线宽，单位 mm。 |
| `style` | <code><a href="#strokestyle">StrokeStyle</a></code> | 是 |  |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |

### BorderSides {#bordersides}

四边边框，缺省的一边不画线。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `top` | <code><a href="#stroke">Stroke</a></code> | 可省 |  |
| `right` | <code><a href="#stroke">Stroke</a></code> | 可省 |  |
| `bottom` | <code><a href="#stroke">Stroke</a></code> | 可省 |  |
| `left` | <code><a href="#stroke">Stroke</a></code> | 可省 |  |

### BoxStyle {#boxstyle}

元素外框样式。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `background` | <code><a href="#color">Color</a></code> | 可省 | 背景色，缺省为透明。 |
| `border` | <code><a href="#bordersides">BorderSides</a></code> | 可省 |  |
| `padding` | <code><a href="#edges">Edges</a></code> | 可省 | 内边距，单位 mm。 |

### TextStyle {#textstyle}

文本样式。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fontFamily` | <code>string</code> | 可省 | 字体族，缺省使用运行时默认字体。 |
| `fontSize` | <code>number</code> | 是 | 字号，单位 pt。 |
| `bold` | <code>boolean</code> | 是 |  |
| `italic` | <code>boolean</code> | 是 |  |
| `underline` | <code>boolean</code> | 是 |  |
| `lineThrough` | <code>boolean</code> | 是 |  |
| `color` | <code><a href="#color">Color</a></code> | 是 |  |
| `align` | <code><a href="#textalign">TextAlign</a></code> | 是 |  |
| `verticalAlign` | <code><a href="#verticalalign">VerticalAlign</a></code> | 是 |  |
| `lineHeight` | <code>number</code> | 是 | 行高，字号的倍数。 |
| `letterSpacing` | <code>number</code> | 是 | 字间距，单位 pt。 |

### ValueMapEntry {#valuemapentry}

值映射的一项：数据值（按字符串比较）与显示文本，与选择类组件的选项同一形状（不带 disabled）。没有 label 时命中这一项显示为空。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | <code>string</code> | 是 |  |
| `label` | <code>string</code> | 可省 |  |

### MapFormat {#mapformat}

值映射格式：按数据值查表显示文本。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'map'</code> | 是 |  |
| `entries` | <code><a href="#valuemapentry">ValueMapEntry</a>[]</code> | 是 |  |
| `fallback` | <code>string</code> | 可省 | 未命中任何映射时显示的文本，缺省显示原值。 |

### ExpressionFormat {#expressionformat}

表达式格式：以受限表达式把值转成显示文本，表达式中以 `value` 引用待格式化的值。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'expression'</code> | 是 |  |
| `expression` | <code>string</code> | 是 | 受限表达式源码。 |

### ValueFormat {#valueformat}

值格式：数字、百分比、日期与人民币大写即 @xihan-ui/expression 的 FormatSpec，交给注入的格式化器；值映射在本包内完成，表达式格式经表达式接入点。

取其一：<code>FormatSpec</code>、<code><a href="#mapformat">MapFormat</a></code>、<code><a href="#expressionformat">ExpressionFormat</a></code>。

### StaticTextContent {#statictextcontent}

固定文本。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'static'</code> | 是 |  |
| `text` | <code>string</code> | 是 |  |

### FieldTextContent {#fieldtextcontent}

绑定单个数据字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'field'</code> | 是 |  |
| `field` | <code>string</code> | 是 | 字段路径，写法同 @xihan-ui/core/json 的 formatJsonPath，如 `customer.name`、`items[0].qty`。 |
| `format` | <code><a href="#valueformat">ValueFormat</a></code> | 可省 |  |
| `emptyText` | <code>string</code> | 可省 | 字段值为空时显示的文本。 |

### TemplateTextContent {#templatetextcontent}

含 <code v-pre>{{path}}</code> 占位的文本模板，占位按数据字段替换。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'template'</code> | 是 |  |
| `template` | <code>string</code> | 是 |  |

### ExpressionTextContent {#expressiontextcontent}

以受限表达式计算的文本，表达式中的变量为数据对象的顶层字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'expression'</code> | 是 |  |
| `expression` | <code>string</code> | 是 | 受限表达式源码。 |
| `format` | <code><a href="#valueformat">ValueFormat</a></code> | 可省 | 计算结果的格式。 |

### TextContent {#textcontent}

文本内容来源。

取其一：<code><a href="#statictextcontent">StaticTextContent</a></code>、<code><a href="#fieldtextcontent">FieldTextContent</a></code>、<code><a href="#templatetextcontent">TemplateTextContent</a></code>、<code><a href="#expressiontextcontent">ExpressionTextContent</a></code>。

### StaticImageSource {#staticimagesource}

固定地址的图片。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'static'</code> | 是 |  |
| `url` | <code>string</code> | 是 | 图片地址：http(s)、data:image、blob 或相对地址。 |

### FieldImageSource {#fieldimagesource}

从数据字段读取图片地址。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | <code>'field'</code> | 是 |  |
| `field` | <code>string</code> | 是 |  |

### ImageSource {#imagesource}

图片来源。

取其一：<code><a href="#staticimagesource">StaticImageSource</a></code>、<code><a href="#fieldimagesource">FieldImageSource</a></code>。

## 取值

### PageOrientation {#pageorientation}

页面方向：portrait 纵向，landscape 横向（宽高互换）。

取值见常量 `PAGE_ORIENTATIONS`：

| 取值 | 中文名 |
| --- | --- |
| `portrait` | 纵向 |
| `landscape` | 横向 |

### PageBandVariant {#pagebandvariant}

页眉页脚变体：first 首页、last 末页、odd 奇数页、even 偶数页（按页码奇偶）。

取值见常量 `PAGE_BAND_VARIANTS`：

| 取值 | 中文名 |
| --- | --- |
| `first` | 首页 |
| `last` | 末页 |
| `odd` | 奇数页 |
| `even` | 偶数页 |

### PageBandKey {#pagebandkey}

页眉页脚的全部带区键，`default` 为未命中任何变体时使用的带区。

类型：<code>'default' &#124; <a href="#pagebandvariant">PageBandVariant</a></code>

### TextAlign {#textalign}

文本水平对齐。

取值见常量 `TEXT_ALIGNS`：

| 取值 | 中文名 |
| --- | --- |
| `left` | 左 |
| `center` | 居中 |
| `right` | 右 |
| `justify` | 两端对齐 |

### HorizontalAlign {#horizontalalign}

单元格水平对齐。

取值见常量 `HORIZONTAL_ALIGNS`：

| 取值 | 中文名 |
| --- | --- |
| `left` | 左 |
| `center` | 居中 |
| `right` | 右 |

### VerticalAlign {#verticalalign}

垂直对齐。

取值见常量 `VERTICAL_ALIGNS`：

| 取值 | 中文名 |
| --- | --- |
| `top` | 上 |
| `middle` | 居中 |
| `bottom` | 下 |

### StrokeStyle {#strokestyle}

线型。

取值见常量 `STROKE_STYLES`：

| 取值 | 中文名 |
| --- | --- |
| `solid` | 实线 |
| `dashed` | 虚线 |
| `dotted` | 点线 |
| `double` | 双线 |

### TextOverflow {#textoverflow}

固定尺寸文本的溢出处理：clip 裁切，shrink 缩小字号以容纳，visible 允许溢出显示。

取值见常量 `TEXT_OVERFLOWS`：

| 取值 | 中文名 |
| --- | --- |
| `clip` | 裁掉 |
| `shrink` | 缩小字号 |
| `visible` | 照常显示 |

### RichTextSource {#richtextsource}

富文本字段的内容格式：html 为 HTML 串，按白名单换成文档；document 为富文本文档对象。

取值见常量 `RICH_TEXT_SOURCES`：

| 取值 | 中文名 |
| --- | --- |
| `html` | HTML |
| `document` | 富文本文档 |

### ImageFit {#imagefit}

图片在元素框内的适配方式。

取值见常量 `IMAGE_FITS`：

| 取值 | 中文名 |
| --- | --- |
| `contain` | 完整显示 |
| `cover` | 铺满裁切 |
| `fill` | 拉伸铺满 |
| `none` | 原始大小 |

### LineDirection {#linedirection}

直线在元素框内的走向：horizontal 沿垂直中线，vertical 沿水平中线，diagonalDown 左上到右下，diagonalUp 左下到右上。

取值见常量 `LINE_DIRECTIONS`：

| 取值 | 中文名 |
| --- | --- |
| `horizontal` | 水平 |
| `vertical` | 竖直 |
| `diagonalDown` | 左上到右下 |
| `diagonalUp` | 左下到右上 |

### BarCodeFormat {#barcodeformat}

转导出自 `@xihan-ui/headless`。取值：`code128`、`ean13`、`ean8`、`upca`、`upce`、`itf14`、`code39`。

### MatrixCodeFormat {#matrixcodeformat}

转导出自 `@xihan-ui/headless`。取值：`qr`、`data-matrix`、`pdf417`、`aztec`。

### MatrixCodeLevel {#matrixcodelevel}

转导出自 `@xihan-ui/headless`，取值随元素说明。

### AggregateFunction {#aggregatefunction}

表格汇总函数。

取值见常量 `AGGREGATE_FUNCTIONS`：

| 取值 | 中文名 |
| --- | --- |
| `sum` | 求和 |
| `avg` | 平均 |
| `count` | 计数 |
| `min` | 最小 |
| `max` | 最大 |

### AggregateScope {#aggregatescope}

表格汇总范围：page 本页数据，cumulative 截至本页的累计数据，all 全部数据。

取值见常量 `AGGREGATE_SCOPES`：

| 取值 | 中文名 |
| --- | --- |
| `page` | 本页 |
| `cumulative` | 累计到本页 |
| `all` | 全部 |

### TableFooterPlacement {#tablefooterplacement}

表尾行出现位置：everyPage 表格所跨的每一页，lastPage 仅表格结束的那一页。

取值见常量 `TABLE_FOOTER_PLACEMENTS`：

| 取值 | 中文名 |
| --- | --- |
| `everyPage` | 每一页 |
| `lastPage` | 只在最后一页 |

### TableRowHeightMode {#tablerowheightmode}

表体行高模式：fixed 每行固定为设定的行高，minimum 以设定的行高为下限、按单元格内容撑高。

取值见常量 `TABLE_ROW_HEIGHT_MODES`：

| 取值 | 中文名 |
| --- | --- |
| `fixed` | 固定 |
| `minimum` | 至少 |

### TableCellType {#tablecelltype}

表格列单元格的呈现类型。

取值见常量 `TABLE_CELL_TYPES`：

| 取值 | 中文名 |
| --- | --- |
| `text` | 文字 |
| `image` | 图片 |
| `barCode` | 条码 |
| `matrixCode` | 二维码 |

### SingleSheetPreference {#singlesheetpreference}

同一输出页既是首页又是末页时优先采用的变体。

取值见常量 `SINGLE_SHEET_PREFERENCES`：

| 取值 | 中文名 |
| --- | --- |
| `first` | 首页 |
| `last` | 末页 |
