# 运行时

`@xihan-print/runtime` 是业务页面用的部分：`<xh-print-preview>` 把模板按数据排成输出页逐页显示，`print()` 与 `printDocument` 调起浏览器的打印对话框。分页算法本身在 `@xihan-print/core`，不依赖 DOM。属性、方法与事件的完整列表见[预览与打印](../reference/runtime)。

## 预览元素

调用 `definePrintPreview()` 注册后，把模板与数据交给 `schema` 与 `data`。下面的设备巡检记录排成多页，状态行显示每次分页的结果：

<<< @/examples/demos/runtime.ts#events

<PrintDemo name="runtime" />

- `schema`、`data`、`extensions` 与各注入项（`expressionEngine`、`formatter`、`measurer`、`locale`、`timeZone`）任一变化都重新分页。`extensions` 与设计器给同一份，见[设计器的扩展](./designer#扩展)。
- 分页成功派发 `paginated`，带输出页数与诊断；失败派发 `pagination-error` 并清空预览，带错误码与校验问题。
- `result` 是最近一次的分页结果，`paginate()` 立即按当前属性重新分页并返回结果。
- 元素是带滚动的块，在页面上给它一个高度，输出页多时在里面滚动。纸张比预览区宽时从左边开始排，可以横向滚动。

`zoom` 是显示缩放倍数，缺省 1，只影响预览、不影响打印：

<<< @/examples/demos/runtime.ts#zoom

## 分页规则

### 页面模板与输出页

模板里的页面模板依次排，每张排出一张或多张输出页。每张输出页先选页眉与页脚的带区（首页、末页、奇偶页的选取见[模板结构](./template#首页、末页与奇偶页)），再按选中的带区高度算出这一页的正文区，所以首页页眉高一些时，首页的正文区就短一些。

### 正文元素的位置

正文元素按设计时的上边缘从上到下依次排：

1. 一个元素的设计位置整个在另一个元素下方时（不论左右是否重叠），它排在那个元素实际结束的位置之后，并保持设计时两者之间的间距；同时在几个元素下方时，取最靠后的那个。
2. 不在任何元素下方的元素，留在第一张输出页的设计位置。
3. 固定尺寸的元素被推到正文区底边之外时，整个移到下一页正文区的顶部，不拆开。
4. 长文本、富文本与表格从起点开始续排，排满一页接着排到下一页。

所以表格下面的落款、长文本下面的表格，都会随上面内容的长短上下移动。巡检记录里，表格排在说明文字下面，落款排在表格之后。

### 长文本

长文本按元素宽度换行，按整行切到后续输出页，每段都带上下内边距；只有一段时高度不小于设计高度。文字里的换行符照样换行。

### 富文本

富文本按块排版，行高随这一行的字号变化，跨页的切法与长文本相同，续排那一段的第一行不留段距。排版规则见[富文本](./rich-text#排版规则)。

### 表格

- 数据行不拆开跨页：一行放不下时整行移到下一页；在一页的正文区里也放不下时照样放上去，并给出警告 `table.rowOverflow`。
- 表头在第一段显示；`header.repeat` 为 `true` 时每一段都重复表头。
- `everyPage` 的表尾行在每一段末尾都出现，`lastPage` 的表尾行只在最后一段出现，并且与最后一行数据排在同一页：放不下时最后一行数据一起移到下一页。
- 行高方式为 `fixed` 时每行固定为行高；`minimum` 时以行高为下限，按单元格内容撑高。
- `maxRowsPerPage` 限制每段的数据行数；`fillEmptyRows` 用空行补齐到每页最大行数，没有设最大行数时补满可用高度。
- 只有一段时，表格高度不小于设计高度。

### 页码

页码元素在全部输出页排完后才填入。<code v-pre>{{$page}}</code> 是这张输出页的页码，<code v-pre>{{$pages}}</code> 是所在编号段的总页数；`numbering.continuous` 为 `true` 的页面模板与上一张同属一个编号段。

### 只在预览中显示

`previewOnly` 的元素在预览与设计器里显示，打印时不画，适合放套打用的底图或说明。

### 输出页上限

整份模板最多排出 1000 张输出页（`printDocument` 的 `maxSheets` 可以改）。超出时停止排版，给出错误级诊断 `layout.sheetLimit`，已排的输出页照常显示与打印。

## 诊断与错误

分页有两类结果：

- **诊断**：分页照常完成，问题随结果给出。错误级表示按模板该画的内容没有画出或输出页被截断（如表达式求值失败、条码内容编不了、超出页数上限），警告表示内容画出了但与设计有出入（如文字超出元素框、表格一行跨不下一页）。
- **错误**：分页无法进行。模板有错误级校验问题时抛出 `PrintLayoutError`，码为 `document.invalid`，`issues` 里是全部错误级问题；没有给模板、拿不到文字度量器时抛出 `PrintRuntimeError`。

预览元素把错误转成 `pagination-error` 事件；`print()` 与 `printDocument` 直接抛出，不打开打印对话框。问题码见[问题码与诊断](../reference/issues)。

## 浏览器打印

`print()`、`printDocument` 与 `printSheets` 都这样打印：

1. 在页面上挂一个看不见的 iframe，把输出页渲染进去，`previewOnly` 的元素不画。
2. 每种纸张尺寸写一条具名的 `@page`，边距为 0，背景色照样打印。
3. 把页面里的 `@font-face` 带进 iframe：读得到的规则把地址换成绝对地址抄过去，读不到的跨源样式表整张链接过去。
4. 等图片解码、字体就绪，最多等 10 秒，然后调起打印对话框。
5. 对话框关闭后移除 iframe；有的浏览器不派发 `afterprint`，最多等 60 秒。

`title` 选项是打印对话框与另存 PDF 时的缺省文件名，缺省沿用当前页面的标题。浏览器打印由用户在对话框里选打印机；要不弹对话框直接打到指定的打印机，或者纸张尺寸不同的输出页要分别按各自的纸张送去打印，用[打印客户端](./client)。

### 一次打多份

一份数据打一份单据；要一次打出多份，每份数据各用 `paginateDocument(schema, data, options?)` 排一次，`mergePaginationResults(results)` 按顺序接成一份，再交给 `printSheets`：

<<< @/examples/snippets/print-batch.ts#browser

- `paginateDocument` 只分页、不打印，缺省注入项与 `printDocument` 同一份：度量器用 `options.document`（缺省为当前页面）里的 Canvas 度量器，表达式引擎与格式化器同预览元素，`measurer`、`expressionEngine`、`formatter`、`locale`、`timeZone`、`maxSheets` 与 `extensions` 照样可以给。出错的情形也与 `printDocument` 相同。
- 每份的页码与总页数各自从第 1 页算起，合并后不变。合并结果的 `parts` 给出每份占的输出页（起点与张数）；诊断各带 `part`，是来自第几份（从 0 开始），`path` 与 `target` 相对那一份的文档。
- `printDocument` 只收一份数据，不收数组：模板的数据根本身就可能是数组（比如整份数据就是一张明细表），收数组会分不清是一份还是多份。
- 合并结果同样可以交给 `renderSheets` 显示，或交给[打印客户端](./client)的 `printSheets`：

<<< @/examples/snippets/print-batch.ts#client

## 字体与文字度量

分页时要量每段文字的宽度来换行，缺省用页面里的 Canvas 度量器，字体就是模板里写的字体族，没写时用 `sans-serif`。

- 预览元素在页面的字体加载完成后自动重新分页，网页字体晚到也能排对。
- `printDocument` 只排一次。模板用了网页字体时，先用 `document.fonts.load()` 把要用的字体加载好再调用，否则会按替代字体换行。
- 输出页里每个元素都按 mm 绝对定位、尺寸固定，只有元素框内部的折行受字形宽度影响。换一台字体不同的电脑，折行位置可能不同。
- 需要在没有 Canvas 的环境里分页时，用 `@xihan-print/core` 的 `paginate` 并传入自己的度量器（`measure(text, font)` 返回宽度与上下高度，单位 CSS 像素）。
