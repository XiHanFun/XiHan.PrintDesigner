# 问题码与诊断

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

校验问题由 `validateDocument` 与设计器的问题列表给出，分页诊断随分页结果一起给出。问题都不带文案，只有问题码、严重程度、路径与参数；下表的说明来自中文语言包 `printZhCN`，其中的 {名} 是参数，实际文案只含问题给出的参数。

## 校验问题

有错误级问题的模板不能分页：`paginate` 抛出 `PrintLayoutError`（码为 `document.invalid`），预览元素派发 `pagination-error`。警告不影响分页。

| 问题码 | 严重程度 | 说明 | 参数 |
| --- | --- | --- | --- |
| `required` | 错误 | 缺少必填项 | — |
| `invalid-type` | 错误 | 类型不对 | — |
| `invalid-value` | 错误 | 取值无效 | — |
| `out-of-range` | 错误 | 应不小于 {min}、大于 {exclusiveMin}、不大于 {max} | `min`、`exclusiveMin`、`max` |
| `not-integer` | 错误 | 应为整数 | — |
| `invalid-option` | 错误 | 不是可选的值 | — |
| `invalid-color` | 错误 | 不是有效的颜色 | — |
| `empty` | 错误 | 不能为空 | — |
| `unknown-key` | 警告 | 未知的属性 {key} | `key` |
| `unknown-control` | 错误 | 未知的编辑方式 | — |
| `duplicate-key` | 错误 | 键 {key} 重复 | `key` |
| `duplicate-id` | 错误 | 标识 {id} 重复 | `id` |
| `duplicate-value` | 错误 | 选项的值重复 | — |
| `json.circular` | 错误 | 数据有循环引用 | — |
| `schema.unsupportedVersion` | 错误 | 不支持模板版本 {version}（应为 {supported}） | `version`、`supported` |
| `field.empty` | 警告 | 没有绑定字段 | — |
| `field.invalidPath` | 错误 | 字段路径 {field} 写法不对 | `field` |
| `template.unclosedPlaceholder` | 错误 | 模板里有没闭合的 &#123;&#123; | — |
| `template.emptyPlaceholder` | 错误 | 模板里有空的 &#123;&#123;}} | — |
| `template.invalidPath` | 错误 | 模板里的字段路径写法不对 | — |
| `expression.invalid` | 错误 | 表达式有误 | — |
| `format.duplicateMapValue` | 警告 | 值映射里 {value} 重复 | `value` |
| `format.invalidOption` | 错误 | 格式选项无效 | — |
| `format.conflict` | 错误 | 格式选项相互冲突 | — |
| `document.noPages` | 错误 | 模板里没有页面 | — |
| `page.presetMismatch` | 警告 | 纸张尺寸与 {preset} 不符 | `preset` |
| `page.noContentArea` | 错误 | 页边距占满了纸张 | — |
| `page.bandsOverflow` | 错误 | 页眉页脚比版心还高 | — |
| `watermark.emptyText` | 警告 | 水印文字为空 | — |
| `element.unknownType` | 错误 | 未知的元素种类 {type} | `type` |
| `element.tooSmall` | 错误 | 小于最小尺寸 … × … mm | `minWidth`、`minHeight` |
| `element.outsidePaper` | 警告 | 超出纸张 | — |
| `element.outsideBand` | 警告 | 超出{region}区 | `region` |
| `element.flowInBand` | 错误 | 跨页元素只能放在正文区 | — |
| `element.flowOutsideBody` | 警告 | 跨页元素超出正文区 | — |
| `line.zeroLength` | 错误 | 直线长度为 0 | — |
| `shape.invisible` | 警告 | 图形既没有边线也没有填充 | — |
| `image.emptySource` | 警告 | 图片地址为空 | — |
| `image.unsafeSource` | 错误 | 图片地址不允许使用 | — |
| `table.noColumns` | 警告 | 表格没有列 | — |
| `table.duplicateColumnId` | 错误 | 列标识 {id} 重复 | `id` |
| `table.duplicateRowId` | 错误 | 表尾行标识 {id} 重复 | `id` |
| `table.columnWidthMismatch` | 警告 | 列宽合计 … mm，与表格宽度 … mm 不一致 | `columnsWidth`、`width` |
| `table.unknownColumn` | 错误 | 表尾单元格指向不存在的列 {columnId} | `columnId` |
| `table.cellSpanOverflow` | 错误 | 跨 {colSpan} 列，右侧只剩 {available} 列 | `colSpan`、`available` |
| `table.cellOverlap` | 错误 | 表尾单元格与其它单元格重叠 | — |
| `table.aggregateFieldMissing` | 错误 | 汇总 {fn} 缺少字段 | `fn` |
| `table.rowExceedsBody` | 警告 | 表头加一行需要 … mm，正文区只有 … mm | `required`、`available` |
| `barCode.invalidValue` | 错误 | 内容无法按 {format} 编码 | `format` |
| `matrixCode.invalidValue` | 错误 | 内容无法按 {format} 编码 | `format` |
| `matrixCode.invalidLevel` | 错误 | 纠错级别 {level} 不适用于 {format} | `level`、`format` |
| `matrixCode.levelIgnored` | 警告 | {format} 没有纠错级别，设置的级别不起作用 | `format` |
| `matrixCode.notSquare` | 警告 | 二维码宽高不等 | — |
| `pageNumber.noToken` | 警告 | 页码格式里没有 &#123;&#123;$page}} 或 &#123;&#123;$pages}} | — |
| `pageNumber.unknownToken` | 警告 | 页码格式里有未知的变量 {token} | `token` |
| `richText.invalidDocument` | 错误 | 富文本写法不对 | `code` |
| `richText.empty` | 警告 | 富文本没有内容 | — |

## 分页诊断

分页诊断不打断分页：错误表示按模板该画的内容没有画出或输出页被截断，警告表示内容画出了但与设计有出入。同一位置的同一问题只报告一次。

| 问题码 | 严重程度 | 说明 | 参数 |
| --- | --- | --- | --- |
| `data.notArray` | 警告 | 字段 {field} 不是数组 | `field` |
| `data.notScalar` | 警告 | 字段 {field} 不是单个值 | `field` |
| `format.unavailable` | 警告 | 没有提供格式化器 | — |
| `format.failed` | 警告 | 格式化失败 | — |
| `expression.unavailable` | 警告 | 没有提供表达式引擎 | — |
| `expression.failed` | 错误 | 表达式求值失败 | — |
| `image.unsafeSource` | 错误 | 图片地址不允许使用 | — |
| `barCode.invalidValue` | 错误 | 内容无法按 {format} 编码 | `format` |
| `matrixCode.invalidValue` | 错误 | 内容无法按 {format} 编码 | `format` |
| `text.overflow` | 警告 | 文字缩到 {fontSize} pt 仍超出元素框 | `fontSize` |
| `richText.droppedContent` | 警告 | 字段 {field} 的 HTML 里去掉了 {names} | `field`、`names` |
| `richText.invalidData` | 错误 | 字段 {field} 不是合规的富文本文档 | `field` |
| `table.rowOverflow` | 警告 | 第 … 行在一页里放不下 | `dataIndex` |
| `element.overflow` | 警告 | 内容超出元素框 | — |
| `layout.sheetLimit` | 错误 | 输出页数超过上限 {limit} | `limit` |

## 分页与打印失败

分页无法进行的原因：文档有 error 级校验问题、选项不合法、测量器或格式化器返回了不合法的结果。

`PrintLayoutError` 的码：`document.invalid`、`option.invalid`、`measurer.invalidResult`、`formatter.invalidResult`。

运行时无法完成分页或打印的原因：拿不到文字度量器、没有给模板。

`PrintRuntimeError` 的码：`measurer.unavailable`、`schema.missing`。
