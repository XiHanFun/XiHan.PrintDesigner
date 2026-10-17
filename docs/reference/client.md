# 打印客户端 SDK

<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->

`@xihan-print/runtime/client` 连接本地打印客户端：静默打印、写原始指令、导出 PDF、查打印机。这个子入口单独打包，不用客户端的页面不会加载它。

## 创建连接

### createPrintClient() {#createprintclient}

```ts
declare function createPrintClient(options?: PrintClientOptions): PrintClient
```

创建本地打印客户端的连接；不会立即连接，第一次调用时才连。

### PrintClientOptions {#printclientoptions}

createPrintClient 的选项。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `ports?` | `readonly number[]` | 按顺序探测的端口，缺省 17620–17623。 |
| `timeoutMs?` | `number` | 请求等响应的期限，缺省 10 秒。 |
| `connectTimeoutMs?` | `number` | 每个端口建连的期限，缺省 3 秒。 |
| `consentTimeoutMs?` | `number` | 客户端弹出授权窗口后等用户决定的期限，缺省 75 秒。 |
| `reconnect?` | `boolean` | 断线后是否自动重连，缺省 true。 |
| `WebSocket?` | `WebSocketConstructor` | WebSocket 构造函数，缺省为全局 WebSocket。 |
| `permissions?` | `PermissionsLike \| null` | 查本机网络权限的入口，缺省为 navigator.permissions；为 null 时不查。 |
| `secureContext?` | `boolean` | 页面是否是安全上下文，缺省为全局 isSecureContext。 |
| `fetch?` | `typeof fetch` | 打包文档时取资源用的 fetch，缺省为全局 fetch。 |

### PrintClient {#printclient}

本地打印客户端的连接。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `state` | `PrintClientState` | 连接状态。 |
| `welcome` | `ClientWelcome \| undefined` | 最近一次握手的结果；还没连上过时为 undefined。 |

| 方法 | 说明 |
| --- | --- |
| `connect(): Promise<ClientWelcome>` | 连接并握手；已连着时直接返回握手结果。连不上抛 PrintClientError，码为 CLIENT_UNAVAILABLE、LOCAL_NETWORK_DENIED、PROTOCOL_UNSUPPORTED、CONSENT_DENIED、CONSENT_TIMEOUT 等。 |
| `close(): void` | 断开连接，不再重连；未结束的任务以 CONNECTION_LOST 拒绝，客户端里的任务照常执行完。 |
| `printers(): Promise<PrinterInfo[]>` | 列出打印机，不含能力明细。 |
| `printer(name: string): Promise<PrinterInfo>` | 查一台打印机，含能力明细。 |
| `printDocument(schema: PrintDocument, data: unknown, options?: PrintClientDocumentOptions): PrintClientJob` | 按数据排出模板并交给客户端打印。 |
| `printSheets(result: PaginationResult, options?: PrintClientDocumentOptions): PrintClientJob` | 把排好的输出页交给客户端打印。 |
| `printRaw(printer: string, data: Uint8Array \| ArrayBuffer \| string, options?: PrintRawOptions): PrintClientJob` | 把原始指令原样写给打印机；字符串按 UTF-8 编码，要别的编码时先转成字节。 |
| `exportPdf(schema: PrintDocument, data: unknown, options?: PrintClientDocumentOptions): Promise<Blob>` | 按数据排出模板并导出为 PDF。 |
| `exportSheetsPdf(result: PaginationResult, options?: PrintClientDocumentOptions): Promise<Blob>` | 把排好的输出页导出为 PDF。 |
| `job(jobId: string): Promise<JobStatus>` | 查任务状态。 |
| `on<K extends keyof PrintClientEventMap>(type: K, listener: (detail: PrintClientEventMap[K]) => void): () => void` | 订阅事件，返回退订函数。 |

### PrintClientJob {#printclientjob}

一个交给客户端的任务。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 任务标识，由 SDK 生成。 |
| `status` | `JobStatus \| undefined` | 最近一次的状态；还没交给客户端时为 undefined。 |
| `done` | `Promise<JobStatus>` | completed 时兑现；failed 时以客户端给出的错误码拒绝，cancelled 时以 JOB_CANCELLED 拒绝，发送前出错时以对应错误拒绝。 |

| 方法 | 说明 |
| --- | --- |
| `onStatus(listener: (status: JobStatus) => void): () => void` | 订阅状态变化，返回退订函数。 |
| `cancel(): Promise<boolean>` | 取消任务：排队中的立即取消并返回 true；执行中的尽力取消并返回 false，结果以状态为准。 |

### PrintClientEventMap {#printclienteventmap}

客户端派发的事件。

用 `client.on(type, listener)` 订阅。连接状态 `PrintClientState` 取 `idle`、`connecting`、`open`、`reconnecting`、`closed`。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `state` | `PrintClientState` | 连接状态变化。 |
| `consentpending` | `{ readonly origin: string }` | 来源还没授权，客户端已弹出授权窗口。 |

## 退回浏览器打印

### printWithFallback() {#printwithfallback}

```ts
declare function printWithFallback(client: PrintClient, schema: PrintDocument, data: unknown, options?: PrintWithFallbackOptions): Promise<PrintWithFallbackOutcome>
```

先交给本地打印客户端打印，等到交给打印池；只在连不上客户端（CLIENT_UNAVAILABLE、PROTOCOL_UNSUPPORTED）时退回浏览器的打印对话框。打印机报错、拒绝授权等其它错误照常抛出，免得用户以为已经静默打出来了。

### PrintWithFallbackOptions {#printwithfallbackoptions}

printWithFallback 的选项：客户端打印选项、分页注入项，退回浏览器打印时另用 title。

继承 `PrintClientDocumentOptions`、`Pick<PrintOptions, 'title'>`。

### PrintWithFallbackOutcome {#printwithfallbackoutcome}

printWithFallback 的结果：走了哪条路，与送去打印的页数。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `via` | `'client' \| 'browser'` |  |
| `sheets` | `number` |  |

### shouldFallBack() {#shouldfallback}

```ts
declare function shouldFallBack(error: unknown): boolean
```

这个错误是否表示连不上客户端、应该退回浏览器打印；打印机报错、拒绝授权等一律不退回。

## 错误码

出错时抛出或以 `PrintClientError` 拒绝，`code` 为下表之一，`details` 带补充信息。「SDK」一栏的码在浏览器里产生，其余由客户端给出。

| 错误码 | 出自 | 说明 | 退回浏览器打印 |
| --- | --- | --- | --- |
| `CLIENT_UNAVAILABLE` | SDK | 所有端口都连不上（客户端没装或没运行） | 是 |
| `LOCAL_NETWORK_DENIED` | SDK | 浏览器的「本机应用」权限被拒，或页面不是安全上下文，连接在浏览器里就被拦下 | 否 |
| `CONNECTION_LOST` | SDK | 等结果时断线，或断线后没能在期限内重连上 | 否 |
| `TOO_MANY_CONNECTIONS` | SDK | 同一来源的连接数超过客户端上限 | 否 |
| `TIMEOUT` | SDK | 请求没有在期限内得到响应 | 否 |
| `JOB_CANCELLED` | SDK | 任务被取消 | 否 |
| `BAD_REQUEST` | 客户端 | 消息格式或字段不合法 | 否 |
| `CONSENT_PENDING` | 客户端 | 授权窗口还开着时又发了业务请求 | 否 |
| `CONSENT_DENIED` | 客户端 | 用户拒绝，或来源在拒绝名单 | 否 |
| `CONSENT_TIMEOUT` | 客户端 | 授权窗口在期限内没人处理 | 否 |
| `SESSION_EXPIRED` | 客户端 | 重连令牌过期或不属于这个来源，已当作新会话 | 否 |
| `PROTOCOL_UNSUPPORTED` | 客户端 | 协议主版本不匹配 | 是 |
| `NO_PRINTERS` | 客户端 | 本机没有任何打印机 | 否 |
| `PRINTER_NOT_FOUND` | 客户端 | 指定的打印机不存在 | 否 |
| `PRINTER_OFFLINE` | 客户端 | 打印机脱机、暂停或出错 | 否 |
| `PAPER_UNSUPPORTED` | 客户端 | 打印机没有任务需要的纸张，且驱动不接受自定义尺寸 | 否 |
| `DOCUMENT_TOO_LARGE` | 客户端 | 超过消息上限或资源总量上限 | 否 |
| `RESOURCE_BLOCKED` | 客户端 | 文档里引用了随任务带来的资源之外的地址 | 否 |
| `RENDER_FAILED` | 客户端 | 渲染引擎载入或等待就绪失败 | 否 |
| `RENDER_TIMEOUT` | 客户端 | 渲染超时 | 否 |
| `SPOOL_FAILED` | 客户端 | 交给打印池失败 | 否 |
| `PDF_FAILED` | 客户端 | 导出 PDF 失败 | 否 |
| `JOB_DUPLICATE` | 客户端 | 任务标识重复 | 否 |
| `JOB_NOT_FOUND` | 客户端 | 查无此任务 | 否 |
| `QUEUE_FULL` | 客户端 | 同一会话排队的任务超过上限 | 否 |
| `CAPABILITY_UNSUPPORTED` | 客户端 | 请求了客户端没有的能力 | 否 |
| `INTERNAL` | 客户端 | 未预期的异常 | 否 |

## 打印选项与结果

### ClientPrintOptions {#clientprintoptions}

交给客户端的打印选项。纸张不在选项里：每组输出页按模板里的纸张尺寸下发；原始指令的纸张由指令自己决定。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `printer?` | `string` | 打印机名称，缺省为默认打印机。 |
| `copies?` | `number` | 份数，1–999。 |
| `collate?` | `boolean` | 多份时逐份打印，缺省 true。 |
| `duplex?` | `'simplex' \| 'long-edge' \| 'short-edge'` |  |
| `color?` | `'color' \| 'grayscale'` |  |
| `pageRanges?` | `string` | 页码范围，如 1-3,5。 |
| `dialog?` | `boolean` | 弹系统打印对话框，缺省静默打印。 |
| `timeoutMs?` | `number` | 交给打印池的期限，毫秒。 |

### PrintClientDocumentOptions {#printclientdocumentoptions}

打印与导出的选项：客户端打印选项、分页注入项与打包文档的选项。

继承 `ClientPrintOptions`、`PrintRenderOptions`、`Pick<ClientDocumentOptions, 'document'>`。

### PrintRawOptions {#printrawoptions}

写原始指令的选项。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `docName?` | `string` | 打印池里显示的文档名，缺省为任务标识。 |

### JobStatus {#jobstatus}

任务的当前状态。

任务状态 `JobState` 取 `queued`、`started`、`completed`、`failed`、`cancelled`。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `jobId` | `string` |  |
| `state` | `JobState` |  |
| `position?` | `number` | 排队时同一台打印机前面还有几个任务。 |
| `sheets?` | `number` | HTML 通道交给打印池的页数。 |
| `bytes?` | `number` | 原始通道写出的字节数，或导出的 PDF 大小。 |
| `error?` | `ClientErrorPayload` |  |

## 打印机与客户端信息

### PrinterInfo {#printerinfo}

一台打印机。

打印机状态 `PrinterState` 取 `ready`、`paused`、`offline`、`error`、`paperOut`、`paperJam`、`busy`、`unknown`。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` |  |
| `isDefault` | `boolean` |  |
| `status` | `PrinterState` |  |
| `statusFlags` | `number` | 系统给出的原始状态位。 |
| `location?` | `string` |  |
| `comment?` | `string` |  |
| `driver?` | `string` |  |
| `port?` | `string` |  |
| `isNetwork` | `boolean` |  |
| `capabilities?` | `PrinterCapabilities` |  |

### PrinterCapabilities {#printercapabilities}

打印机能力，只在查单台打印机时给出。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `color` | `boolean` |  |
| `duplex` | `boolean` |  |
| `maxCopies` | `number` |  |
| `papers` | `readonly PaperInfo[]` |  |

### PaperInfo {#paperinfo}

打印机支持的一种纸张。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `number` |  |
| `name` | `string` |  |
| `widthMm` | `number` |  |
| `heightMm` | `number` |  |

### ClientWelcome {#clientwelcome}

握手成功后客户端的回复。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `protocol` | `number` |  |
| `minor` | `number` |  |
| `client` | `ClientInfo` |  |
| `capabilities` | `ClientCapabilities` |  |
| `resumed` | `readonly string[]` | 重连认回会话时仍未结束的任务。 |

### ClientInfo {#clientinfo}

客户端信息。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `string` |  |
| `os` | `string` |  |
| `arch` | `string` |  |
| `renderer?` | `string` | 渲染引擎版本；没有渲染引擎时缺省。 |

### ClientCapabilities {#clientcapabilities}

客户端能力。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `html` | `boolean` |  |
| `raw` | `boolean` |  |
| `pdf` | `boolean` |  |
| `duplex` | `boolean` |  |
| `printerStatus` | `boolean` |  |

## 交给客户端的文档

### buildClientDocument() {#buildclientdocument}

```ts
declare function buildClientDocument(result: PaginationResult, options?: ClientDocumentOptions): Promise<ClientDocument>
```

把分页结果打包成交给客户端的文档：输出页渲染进一份独立的 HTML（只在预览中显示的元素不画），图片、背景图与模板用到的字体取来随任务带去，地址改写成客户端里的资源地址。

### ClientDocumentOptions {#clientdocumentoptions}

打包文档的选项。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `document?` | `Document` | 发起打印的文档：从它的样式表里找模板用到的字体，相对地址也按它解析；缺省为全局 document。 |
| `fetch?` | `typeof fetch` | 取资源用的 fetch，缺省为全局 fetch。 |

### ClientDocument {#clientdocument}

交给客户端的文档：自包含的输出页、资源与按出现顺序的纸张分组。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `html` | `string` |  |
| `resources` | `readonly ClientResource[]` |  |
| `sheets` | `readonly ClientSheetGroup[]` |  |

### ClientResource {#clientresource}

随任务带去的一份资源，data 为 base64。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` |  |
| `type` | `string` |  |
| `data` | `string` |  |

### ClientSheetGroup {#clientsheetgroup}

连续的若干张同尺寸输出页。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `widthMm` | `number` |  |
| `heightMm` | `number` |  |
| `count` | `number` |  |

## 常量

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `DEFAULT_PORTS` | `[17620, 17621, 17622, 17623]` | 客户端监听的端口，按顺序探测。 |
| `SUB_PROTOCOL` | `'xihan-print.v1'` | 带主版本的子协议。 |
| `PROTOCOL_VERSION` | `1` | 协议主版本。 |
| `PROTOCOL_MINOR` | `0` | 协议次版本：只加不减。 |

## 全部导出

### client/client

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `createPrintClient` | 函数 | 创建本地打印客户端的连接；不会立即连接，第一次调用时才连。 |
| `PermissionsLike` | 接口 | 查浏览器权限的入口，形同 navigator.permissions。 |
| `PrintClient` | 接口 | 本地打印客户端的连接。 |
| `PrintClientDocumentOptions` | 接口 | 打印与导出的选项：客户端打印选项、分页注入项与打包文档的选项。 |
| `PrintClientEventMap` | 接口 | 客户端派发的事件。 |
| `PrintClientJob` | 接口 | 一个交给客户端的任务。 |
| `PrintClientOptions` | 接口 | createPrintClient 的选项。 |
| `PrintClientState` | 类型 | 连接状态。 |
| `PrintRawOptions` | 接口 | 写原始指令的选项。 |
| `WebSocketConstructor` | 类型 | 能当 WebSocket 用的构造函数，单测可注入假实现。 |

### client/document

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `buildClientDocument` | 函数 | 把分页结果打包成交给客户端的文档：输出页渲染进一份独立的 HTML（只在预览中显示的元素不画），图片、背景图与模板用到的字体取来随任务带去，地址改写成客户端里的资源地址。 |
| `ClientDocumentOptions` | 接口 | 打包文档的选项。 |

### client/errors

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `FALLBACK_CODES` | 常量 | 连不上客户端、可以退回浏览器打印的错误码：客户端没装或没运行，或协议主版本不对。 |
| `PrintClientError` | 类 | 打印客户端相关的错误，`code` 与 `details` 供调用方判断与生成文案。 |
| `shouldFallBack` | 函数 | 这个错误是否表示连不上客户端、应该退回浏览器打印；打印机报错、拒绝授权等一律不退回。 |

### client/fallback

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `printWithFallback` | 函数 | 先交给本地打印客户端打印，等到交给打印池；只在连不上客户端（CLIENT_UNAVAILABLE、PROTOCOL_UNSUPPORTED）时退回浏览器的打印对话框。 |
| `PrintWithFallbackOptions` | 接口 | printWithFallback 的选项：客户端打印选项、分页注入项，退回浏览器打印时另用 title。 |
| `PrintWithFallbackOutcome` | 接口 | printWithFallback 的结果：走了哪条路，与送去打印的页数。 |

### client/protocol

| 名称 | 种类 | 说明 |
| --- | --- | --- |
| `ClientCapabilities` | 接口 | 客户端能力。 |
| `ClientDocument` | 接口 | 交给客户端的文档：自包含的输出页、资源与按出现顺序的纸张分组。 |
| `ClientErrorCode` | 类型 | 客户端给出的错误码。 |
| `ClientErrorPayload` | 接口 | 响应与任务事件里的错误。 |
| `ClientInfo` | 接口 | 客户端信息。 |
| `ClientPrintOptions` | 接口 | 交给客户端的打印选项。 |
| `ClientResource` | 接口 | 随任务带去的一份资源，data 为 base64。 |
| `ClientSheetGroup` | 接口 | 连续的若干张同尺寸输出页。 |
| `ClientWelcome` | 接口 | 握手成功后客户端的回复。 |
| `DEFAULT_PORTS` | 常量 | 客户端监听的端口，按顺序探测。 |
| `JobState` | 类型 | 任务状态。 |
| `JobStatus` | 接口 | 任务的当前状态。 |
| `PaperInfo` | 接口 | 打印机支持的一种纸张。 |
| `PrintClientErrorCode` | 类型 | 打印客户端相关的全部错误码。 |
| `PrinterCapabilities` | 接口 | 打印机能力，只在查单台打印机时给出。 |
| `PrinterInfo` | 接口 | 一台打印机。 |
| `PrinterState` | 类型 | 打印机状态。 |
| `PROTOCOL_MINOR` | 常量 | 协议次版本：只加不减。 |
| `PROTOCOL_VERSION` | 常量 | 协议主版本。 |
| `SdkErrorCode` | 类型 | SDK 自己给出的错误码： |
| `SUB_PROTOCOL` | 常量 | 带主版本的子协议。 |
