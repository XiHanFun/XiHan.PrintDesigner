# 数据绑定与格式化

模板只描述「哪里显示什么数据、显示成什么样」，数据在打印时才交给预览或打印函数。数据是任意 JSON，通常就是业务接口返回的对象。

## 字段路径

字段路径按点与下标读数据：

| 写法 | 读到 |
| --- | --- |
| `customer.name` | `data.customer.name` |
| `items[0].qty` | 数组第一项的 `qty` |
| `["unit price"]` | 不是标识符的键，用方括号加引号 |

- 只读普通对象的自有属性与数组下标，读不到时得到空值，不报错。
- 字符串原样显示，数字、布尔转成文字，`null` 与 `undefined` 为空；对象与数组不能直接显示，显示为空并给出诊断 `data.notScalar`。
- 路径写法不对时校验报错 `field.invalidPath`。

## 文本内容

文本、长文本、条码与二维码的内容都是一个「文本内容」，有四种来源：

| 来源 | 写法 | 说明 |
| --- | --- | --- |
| 固定文字 | `{ kind: 'static', text }` | 原样显示 |
| 字段 | `{ kind: 'field', field, format?, emptyText? }` | 读一个字段，可按格式显示；结果为空时显示 `emptyText` |
| 占位模板 | `{ kind: 'template', template }` | 文字里用 <code v-pre>{{path}}</code> 嵌入字段，占位里只能写路径 |
| 表达式 | `{ kind: 'expression', expression, format? }` | 受限表达式，变量是数据对象的顶层字段 |

占位模板适合「文字里嵌几个数据」，如 <code v-pre>客户：{{customer.name}}</code>；需要计算时用表达式，如 `qty * price`。表达式的结果是单个值，可以再按格式显示。

富文本的内容不是文本内容，另有三种来源，见[富文本](./rich-text#内容来源)。

下面这张模板的每一行，右边都是同一份数据按不同来源与格式显示的结果：

<<< @/examples/templates/formats.ts#rows

<<< @/examples/templates/formats.ts#data

<PrintDemo name="binding" />

## 值格式

字段与表达式的结果可以带 `format`：

| 格式 | 写法 | 说明 |
| --- | --- | --- |
| 数字 | `{ kind: 'number', decimals?, minDecimals?, maxDecimals?, grouping?, rounding? }` | `decimals` 固定小数位；或舍入到 `maxDecimals` 位再去掉末尾的 0、至少留 `minDecimals` 位；`grouping` 加千分位 |
| 百分比 | `{ kind: 'percent', … }` | 乘 100 后按数字格式输出并接 `%` |
| 日期 | `{ kind: 'date', pattern }` | 占位符 `yyyy yy MM M dd d HH H mm m ss s SSS`，单引号里的内容原样输出 |
| 人民币大写 | `{ kind: 'rmb-upper', rounding? }` | 舍入到分，整数金额以「整」结尾 |
| 数字字形 | `{ kind: 'numeral', style }` | 整数写成罗马数字（`roman-upper`、`roman-lower`）或中文数字（`cn-lower`、`cn-upper`） |
| 值映射 | `{ kind: 'map', entries, fallback? }` | `entries` 每项是 `{ value, label? }`，与选择类组件的选项同一形状、不带 `disabled`。按数据值查表显示 `label`，对上的一项没写 `label` 时显示为空；没对上时显示 `fallback`，没有 `fallback` 时显示原值 |
| 表达式格式 | `{ kind: 'expression', expression }` | 用受限表达式把值转成文字，表达式里用 `value` 引用这个值 |

- 数字类格式按十进制精确舍入，`1.005` 保留两位得 `1.01`。舍入方式 `rounding` 取 `half-up`（缺省）、`half-even`、`floor`、`ceil`、`down`。
- 值映射按显示文字比较，数字 `1` 与字符串 `'1'` 都能对上 `value: '1'`。同一个数据值写了几项时用第一项，校验报 `format.duplicateMapValue` 提醒。设计器里值映射是一张选项表，两列是数据值与显示文本，可以新增、删除与上移下移。
- 空值不经格式化，直接显示为空（再按 `emptyText` 补上）；表达式格式例外，空值也交给表达式。
- 数字、百分比、日期、人民币大写与数字字形由 XiHan.UI 的 `formatValue` 完成，完整规则见 [XiHan.UI 的格式化](https://ui.docs.xihanfun.com/runtime/expression#格式化)。值格式不合法时校验报错，数据不合格式时显示原值并给出诊断 `format.failed`。

### 区域与时区

预览元素与设计器的 `locale`、`time-zone` 两个 attribute（`printDocument` 的同名选项）交给格式化器：

- `locale` 只决定小数点与千分位符号，数字始终是 ASCII 数字，缺省用 `.` 与 `,`。
- `timeZone` 取 `UTC`、`±HH:mm` 或 IANA 名称（如 `Asia/Shanghai`）。不带偏移的日期文本按原样的墙钟时间显示；带偏移的文本、毫秒时间戳在给了时区时换算到该时区。

## 受限表达式

表达式由 XiHan.UI 的 `@xihan-ui/expression` 求值：只有运算符与白名单函数，不能访问全局对象，也不执行任何字符串代码，模板里存的只是源码文本。

- 文本与表达式格式里，变量是数据对象的顶层字段；表格单元格里，变量是这一行的顶层字段；表达式格式里只有 `value`。
- 常用函数：`IF`、`COALESCE`、`ROUND`、`SUM`、`AVG`、`CONCAT`、`LEFT`、`FORMAT_NUMBER`、`FORMAT_DATE`、`DATE_DIFF` 等，函数名不分大小写。文法与全部函数见 [XiHan.UI 的受限表达式](https://ui.docs.xihanfun.com/runtime/expression)。
- 表达式写错时校验报错 `expression.invalid`；求值失败（类型不对、除以零等）时显示为空，并给出错误级诊断 `expression.failed`。

### 换一个表达式引擎

预览、设计器与 `printDocument` 缺省用 `createExpressionEngine()`，不提供当前时间，`TODAY()`、`NOW()` 会求值失败。要用当前时间或登记自己的函数，创建一个引擎交给 `expressionEngine` 属性：

<<< @/examples/snippets/engine.ts#example

宿主函数必须是纯函数，只依赖实参与当前时间。表格表尾的求和、平均、最小、最大也经表达式引擎计算，只启用部分内置函数时要留下 `SUM`、`AVG`、`MIN`、`MAX`。

## 表格的数据

表格的 `dataField` 指向一个数组，每个元素一行。表体单元格的字段、占位与表达式都以行对象为根：

- `field: 'qty'` 读这一行的 `qty`；
- <code v-pre>{{name}}（{{spec}}）</code> 按行对象替换；
- `qty * price` 的变量是这一行的顶层字段；
- `rowNumber` 是从 1 开始、跨页连续的行序号。

表尾单元格的固定文字、字段与占位以整份数据为根，汇总则按 `scope` 取本页、截至本页或全部数据行，见[模板结构](./template#表尾行)。`dataField` 读到的不是数组时，表格按没有数据处理，并给出诊断 `data.notArray`。

## 图片、条码与页码

- **图片**：来源是固定地址 `{ kind: 'static', url }` 或字段 `{ kind: 'field', field }`。地址只认 http、https、`blob:`、以 `data:image/` 开头的内联图片与相对地址，`javascript:` 等其它地址不显示，并给出 `image.unsafeSource`。
- **条码与二维码**：内容是文本内容，可以绑定字段。内容不能按所选码制编码时（如 EAN-13 位数不对）不画，并给出 `barCode.invalidValue` 或 `matrixCode.invalidValue`。
- **页码**：格式是占位模板，只能用 <code v-pre>{{$page}}</code> 与 <code v-pre>{{$pages}}</code>；`numeral` 把两者都写成罗马数字或中文数字。
- **水印**：文字里可以用 <code v-pre>{{path}}</code> 取数据。

## 诊断

取值与格式化出问题时，分页照常进行，问题以诊断的形式随分页结果给出：没提供格式化器或表达式引擎、格式化失败、表达式求值失败、取到的不是单个值等。预览元素在 `paginated` 事件里带上诊断，全部问题码见[问题码与诊断](../reference/issues)。
