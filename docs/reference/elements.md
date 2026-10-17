# 元素

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

内置元素按物料面板的分组列出。属性路径相对元素，嵌套属性用点连接；「名称」是属性面板里的中文名，「新建时」是在设计器里新建元素时的取值，过长的值以 … 代替，详见各元素的类型。

每个元素还有共有字段 `id`、`type`、`name`、`x`、`y`、`width`、`height`、`locked`、`previewOnly`、`meta`，见 [ElementBase](./schema#elementbase)。坐标相对纸张左上角，长度单位为 mm，字号与字间距单位为 pt。

## 文字

### 文本 `text` {#text}

固定尺寸，可放在页眉、正文与页脚 · 最小 1 × 1 mm · 新建时 60 × 8 mm · 类型 [TextElement](./schema#textelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `60` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `8` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `content` | 内容 | [文本内容](./schema#textcontent) | 是 | `{"kind":"static","text":""}` |
| `style.fontFamily` | 字体 | 文本 | 可省 | — |
| `style.fontSize` | 字号 | 数值（pt），> 0，≤ 500 | 是 | `10.5` |
| `style.bold` | 粗体 | 布尔 | 是 | `false` |
| `style.italic` | 斜体 | 布尔 | 是 | `false` |
| `style.underline` | 下划线 | 布尔 | 是 | `false` |
| `style.lineThrough` | 删除线 | 布尔 | 是 | `false` |
| `style.color` | 文字颜色 | [颜色](./schema#color) | 是 | `"#000000"` |
| `style.align` | 水平对齐 | `left` 左、`center` 居中、`right` 右、`justify` 两端对齐 | 是 | `"left"` |
| `style.verticalAlign` | 垂直对齐 | `top` 上、`middle` 居中、`bottom` 下 | 是 | `"middle"` |
| `style.lineHeight` | 行高 | 数值（倍），> 0，≤ 10 | 是 | `1.2` |
| `style.letterSpacing` | 字间距 | 数值（pt），≥ -10，≤ 100 | 是 | `0` |
| `wrap` | 自动换行 | 布尔 | 是 | `false` |
| `overflow` | 放不下时 | `clip` 裁掉、`shrink` 缩小字号、`visible` 照常显示 | 是 | `"clip"` |
| `box.background` | 背景 | [颜色](./schema#color) | 可省 | — |
| `box.border` | 边框 | [四边边框](./schema#bordersides) | 可省 | — |
| `box.padding` | 内边距 | [四边距离](./schema#edges) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

### 长文本 `longText` {#longtext}

随内容纵向延展、可跨页续排，只能放在正文区 · 最小 5 × 3 mm · 新建时 120 × 20 mm · 类型 [LongTextElement](./schema#longtextelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `120` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `20` |
| `content` | 内容 | [文本内容](./schema#textcontent) | 是 | `{"kind":"static","text":""}` |
| `style.fontFamily` | 字体 | 文本 | 可省 | — |
| `style.fontSize` | 字号 | 数值（pt），> 0，≤ 500 | 是 | `10.5` |
| `style.bold` | 粗体 | 布尔 | 是 | `false` |
| `style.italic` | 斜体 | 布尔 | 是 | `false` |
| `style.underline` | 下划线 | 布尔 | 是 | `false` |
| `style.lineThrough` | 删除线 | 布尔 | 是 | `false` |
| `style.color` | 文字颜色 | [颜色](./schema#color) | 是 | `"#000000"` |
| `style.align` | 水平对齐 | `left` 左、`center` 居中、`right` 右、`justify` 两端对齐 | 是 | `"left"` |
| `style.verticalAlign` | 垂直对齐 | `top` 上、`middle` 居中、`bottom` 下 | 是 | `"top"` |
| `style.lineHeight` | 行高 | 数值（倍），> 0，≤ 10 | 是 | `1.5` |
| `style.letterSpacing` | 字间距 | 数值（pt），≥ -10，≤ 100 | 是 | `0` |
| `box.background` | 背景 | [颜色](./schema#color) | 可省 | — |
| `box.border` | 边框 | [四边边框](./schema#bordersides) | 可省 | — |
| `box.padding` | 内边距 | [四边距离](./schema#edges) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

### 页码 `pageNumber` {#pagenumber}

固定尺寸，可放在页眉、正文与页脚 · 最小 1 × 1 mm · 新建时 30 × 6 mm · 类型 [PageNumberElement](./schema#pagenumberelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `30` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `6` |
| `format` | 格式 | 页码模板，可用 <code v-pre>{{$page}}</code> 与 <code v-pre>{{$pages}}</code> | 是 | <code v-pre>"{{$page}}/{{$pages}}"</code> |
| `numeral` | 数字写法 | `roman-upper` 罗马数字（I、II）、`roman-lower` 罗马数字（i、ii）、`cn-lower` 中文小写（一、二）、`cn-upper` 中文大写（壹、贰） | 可省 | — |
| `style.fontFamily` | 字体 | 文本 | 可省 | — |
| `style.fontSize` | 字号 | 数值（pt），> 0，≤ 500 | 是 | `9` |
| `style.bold` | 粗体 | 布尔 | 是 | `false` |
| `style.italic` | 斜体 | 布尔 | 是 | `false` |
| `style.underline` | 下划线 | 布尔 | 是 | `false` |
| `style.lineThrough` | 删除线 | 布尔 | 是 | `false` |
| `style.color` | 文字颜色 | [颜色](./schema#color) | 是 | `"#000000"` |
| `style.align` | 水平对齐 | `left` 左、`center` 居中、`right` 右、`justify` 两端对齐 | 是 | `"center"` |
| `style.verticalAlign` | 垂直对齐 | `top` 上、`middle` 居中、`bottom` 下 | 是 | `"middle"` |
| `style.lineHeight` | 行高 | 数值（倍），> 0，≤ 10 | 是 | `1.2` |
| `style.letterSpacing` | 字间距 | 数值（pt），≥ -10，≤ 100 | 是 | `0` |
| `box.background` | 背景 | [颜色](./schema#color) | 可省 | — |
| `box.border` | 边框 | [四边边框](./schema#bordersides) | 可省 | — |
| `box.padding` | 内边距 | [四边距离](./schema#edges) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

## 图片

### 图片 `image` {#image}

固定尺寸，可放在页眉、正文与页脚 · 最小 1 × 1 mm · 新建时 40 × 30 mm · 类型 [ImageElement](./schema#imageelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `40` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `30` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `source` | 图片来源 | [图片来源](./schema#imagesource) | 是 | `{"kind":"static","url":""}` |
| `fit` | 填充方式 | `contain` 完整显示、`cover` 铺满裁切、`fill` 拉伸铺满、`none` 原始大小 | 是 | `"contain"` |
| `box.background` | 背景 | [颜色](./schema#color) | 可省 | — |
| `box.border` | 边框 | [四边边框](./schema#bordersides) | 可省 | — |
| `box.padding` | 内边距 | [四边距离](./schema#edges) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

## 数据

### 表格 `table` {#table}

随内容纵向延展、可跨页续排，只能放在正文区 · 最小 10 × 5 mm · 新建时 180 × 22 mm · 类型 [TableElement](./schema#tableelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `180` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `22` |
| `dataField` | 数据字段 | 指向数组的字段路径 | 是 | `""` |
| `columns` | 列 | [列](#table-column)的数组 | 是 | … |
| `header.visible` | 显示表头 | 布尔 | 是 | `true` |
| `header.repeat` | 每页重复表头 | 布尔；「显示表头」打开时显示 | 是 | `true` |
| `header.height` | 表头行高 | 数值（mm），> 0；「显示表头」打开时显示 | 是 | `8` |
| `header.style` | 表头样式 | [单元格样式](./schema#cellstyle)；「显示表头」打开时显示 | 是 | … |
| `body.rowHeight` | 行高 | 数值（mm），> 0 | 是 | `7` |
| `body.rowHeightMode` | 行高方式 | `fixed` 固定、`minimum` 至少 | 是 | `"fixed"` |
| `body.style` | 表体样式 | [单元格样式](./schema#cellstyle) | 是 | … |
| `footerRows` | 表尾行 | [表尾行](#table-footer-row)的数组 | 是 | `[]` |
| `maxRowsPerPage` | 每页最多行数 | 整数（个），≥ 1 | 可省 | — |
| `fillEmptyRows` | 用空行补齐 | 布尔 | 是 | `false` |
| `border.stroke` | 边框线 | [描边](./schema#stroke) | 是 | `{"width":0.2,"style":"solid","color":"#000000"}` |
| `border.outer` | 外框 | 布尔 | 是 | `true` |
| `border.horizontal` | 横线 | 布尔 | 是 | `true` |
| `border.vertical` | 竖线 | 布尔 | 是 | `true` |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

## 图形

### 直线 `line` {#line}

固定尺寸，可放在页眉、正文与页脚 · 最小 0 × 0 mm · 新建时 80 × 0 mm · 类型 [LineElement](./schema#lineelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `80` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `0` |
| `direction` | 方向 | `horizontal` 水平、`vertical` 竖直、`diagonalDown` 左上到右下、`diagonalUp` 左下到右上 | 是 | `"horizontal"` |
| `stroke` | 边线 | [描边](./schema#stroke) | 是 | `{"width":0.3,"style":"solid","color":"#000000"}` |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

### 矩形 `rect` {#rect}

固定尺寸，可放在页眉、正文与页脚 · 最小 1 × 1 mm · 新建时 40 × 20 mm · 类型 [RectElement](./schema#rectelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `40` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `20` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `stroke` | 边线 | [描边](./schema#stroke) | 可省 | `{"width":0.3,"style":"solid","color":"#000000"}` |
| `fill` | 填充 | [颜色](./schema#color) | 可省 | — |
| `radius` | 圆角 | 数值（mm），≥ 0 | 是 | `0` |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

### 椭圆 `ellipse` {#ellipse}

固定尺寸，可放在页眉、正文与页脚 · 最小 1 × 1 mm · 新建时 30 × 20 mm · 类型 [EllipseElement](./schema#ellipseelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `30` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `20` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `stroke` | 边线 | [描边](./schema#stroke) | 可省 | `{"width":0.3,"style":"solid","color":"#000000"}` |
| `fill` | 填充 | [颜色](./schema#color) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

## 条码

### 条码 `barCode` {#barcode}

固定尺寸，可放在页眉、正文与页脚 · 最小 5 × 3 mm · 新建时 50 × 15 mm · 类型 [BarCodeElement](./schema#barcodeelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `50` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `15` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `format` | 码制 | `code128`、`ean13`、`ean8`、`upca`、`upce`、`itf14`、`code39` | 是 | `"code128"` |
| `content` | 内容 | [文本内容](./schema#textcontent) | 是 | `{"kind":"static","text":"1234567890"}` |
| `showText` | 显示文字 | 布尔 | 是 | `true` |
| `textStyle.fontFamily` | 文字字体 | 文本；「显示文字」打开时显示 | 可省 | — |
| `textStyle.fontSize` | 文字字号 | 数值（pt），> 0，≤ 100；「显示文字」打开时显示 | 是 | `9` |
| `color` | 颜色 | [颜色](./schema#color) | 是 | `"#000000"` |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

### 二维码 `matrixCode` {#matrixcode}

固定尺寸，可放在页眉、正文与页脚 · 最小 5 × 5 mm · 新建时 25 × 25 mm · 类型 [MatrixCodeElement](./schema#matrixcodeelement)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `x` | X | 数值（mm） | 是 | — |
| `y` | Y | 数值（mm） | 是 | — |
| `width` | 宽 | 数值（mm），≥ 0 | 是 | `25` |
| `height` | 高 | 数值（mm），≥ 0 | 是 | `25` |
| `rotation` | 旋转 | 数值（度），≥ -360，≤ 360 | 是 | `0` |
| `content` | 内容 | [文本内容](./schema#textcontent) | 是 | `{"kind":"static","text":"1234567890"}` |
| `format` | 码制 | `qr`、`data-matrix`、`pdf417`、`aztec` | 是 | `"qr"` |
| `level` | 纠错级别 | 纠错级别，见 [MatrixCodeElement](./schema#matrixcodeelement) | 可省 | `"M"` |
| `quietZone` | 静区 | 整数（个），≥ 0，≤ 20 | 是 | `1` |
| `color` | 颜色 | [颜色](./schema#color) | 是 | `"#000000"` |
| `background` | 背景 | [颜色](./schema#color) | 可省 | — |
| `name` | 名称 | 文本 | 可省 | — |
| `locked` | 锁定 | 布尔 | 可省 | — |
| `previewOnly` | 只在预览中显示 | 布尔 | 可省 | — |

## 页面设置 {#page}

没有选中元素时，属性面板编辑当前页面模板。属性路径相对页面模板，见 [PrintPage](./schema#printpage)。

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `name` | 名称 | 文本 | 可省 | — |
| `paper` | 纸张 | [纸张](./schema#paperspec) | 是 | — |
| `orientation` | 方向 | `portrait` 纵向、`landscape` 横向 | 是 | — |
| `margins` | 页边距 | [四边距离](./schema#edges) | 是 | — |
| `header.default.height` | 页眉高度 | 数值（mm），≥ 0 | 是 | — |
| `header.first.height` | 首页页眉高度 | 数值（mm），≥ 0；设置了 `header.first` 时显示 | 可省 | — |
| `header.last.height` | 末页页眉高度 | 数值（mm），≥ 0；设置了 `header.last` 时显示 | 可省 | — |
| `header.odd.height` | 奇数页页眉高度 | 数值（mm），≥ 0；设置了 `header.odd` 时显示 | 可省 | — |
| `header.even.height` | 偶数页页眉高度 | 数值（mm），≥ 0；设置了 `header.even` 时显示 | 可省 | — |
| `header.singleSheet` | 只有一页时的页眉 | `first` 首页、`last` 末页 | 是 | — |
| `footer.default.height` | 页脚高度 | 数值（mm），≥ 0 | 是 | — |
| `footer.first.height` | 首页页脚高度 | 数值（mm），≥ 0；设置了 `footer.first` 时显示 | 可省 | — |
| `footer.last.height` | 末页页脚高度 | 数值（mm），≥ 0；设置了 `footer.last` 时显示 | 可省 | — |
| `footer.odd.height` | 奇数页页脚高度 | 数值（mm），≥ 0；设置了 `footer.odd` 时显示 | 可省 | — |
| `footer.even.height` | 偶数页页脚高度 | 数值（mm），≥ 0；设置了 `footer.even` 时显示 | 可省 | — |
| `footer.singleSheet` | 只有一页时的页脚 | `first` 首页、`last` 末页 | 是 | — |
| `numbering.continuous` | 接续上一页面模板的页码 | 布尔 | 是 | — |
| `numbering.start` | 起始页码 | 整数（个），≥ 0 | 是 | — |
| `watermark` | 水印 | [水印](./schema#watermark) | 可省 | — |

纸张预设：

| 预设名 | 宽 × 高（mm，纵向） |
| --- | --- |
| `A3` | 297 × 420 |
| `A4` | 210 × 297 |
| `A5` | 148 × 210 |
| `A6` | 105 × 148 |
| `B4` | 250 × 353 |
| `B5` | 176 × 250 |
| `Letter` | 215.9 × 279.4 |
| `Legal` | 215.9 × 355.6 |

## 表格部位 {#table-parts}

双击表格进入表格编辑态后，可以分别选中列、表头、表体、表尾行与表尾单元格编辑。属性路径相对该部位。

### 列 {#table-column}

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `title` | 标题 | 文本 | 是 | `""` |
| `content` | 内容 | [单元格内容](./schema#tablecellcontent) | 是 | `{"kind":"field","field":""}` |
| `cellType` | 单元格类型 | `text` 文字、`image` 图片、`barCode` 条码、`matrixCode` 二维码 | 是 | `"text"` |
| `barCodeFormat` | 条码码制 | `code128`、`ean13`、`ean8`、`upca`、`upce`、`itf14`、`code39`；「单元格类型」为 `barCode` 时显示 | 可省 | — |
| `width` | 列宽 | 数值（mm），> 0 | 是 | `60` |
| `align` | 对齐 | `left` 左、`center` 居中、`right` 右 | 是 | `"left"` |

### 表头 {#table-header}

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `visible` | 显示 | 布尔 | 是 | `true` |
| `repeat` | 每页重复 | 布尔；「显示」打开时显示 | 是 | `true` |
| `height` | 行高 | 数值（mm），> 0；「显示」打开时显示 | 是 | `8` |
| `style` | 样式 | [单元格样式](./schema#cellstyle)；「显示」打开时显示 | 是 | … |

### 表体 {#table-body}

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `rowHeight` | 行高 | 数值（mm），> 0 | 是 | `7` |
| `rowHeightMode` | 行高方式 | `fixed` 固定、`minimum` 至少 | 是 | `"fixed"` |
| `style` | 样式 | [单元格样式](./schema#cellstyle) | 是 | … |

### 表尾行 {#table-footer-row}

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `placement` | 出现在 | `everyPage` 每一页、`lastPage` 只在最后一页 | 是 | — |
| `height` | 行高 | 数值（mm），> 0 | 是 | — |
| `style` | 样式 | [单元格样式](./schema#cellstyle) | 是 | — |

### 表尾单元格 {#table-footer-cell}

| 属性 | 名称 | 取值 | 必有 | 新建时 |
| --- | --- | --- | --- | --- |
| `content` | 内容 | [表尾单元格内容](./schema#tablefootercellcontent) | 是 | — |
| `colSpan` | 跨列数 | 整数（个），≥ 1 | 是 | — |
| `align` | 对齐 | `left` 左、`center` 居中、`right` 右 | 可省 | — |
