# 与宿主集成

组件只管设计、排版与打印，不发网络请求，也不碰存储与权限。把它嵌进业务系统时，下面这些由宿主来做：

| 事情 | 宿主做什么 | 组件给什么 |
| --- | --- | --- |
| 模板的保存 | 存模板 JSON，管名称、分类、版本与审核 | `schema`、`schema-change`、`save`、`dirty`、`markSaved()` |
| 取数 | 调接口取业务数据，整理成模板要的结构 | `data`、`sampleData`、`fields` |
| 权限 | 决定谁能看、谁能改、谁能打印，服务端再复核 | `readonly`、`panels`、`editors` |
| 校验 | 保存前拦住有错误的模板，服务端复核 | `validate()`、`issues-change`、`validateDocument` |
| 打印记录 | 记下谁在什么时候打了什么 | `print()` 的结果、客户端任务的状态 |

## 模板的保存

模板是一份完整的 JSON，原样存、原样取，不要拆成字段存。`schemaVersion` 记录模板格式的版本；`meta`（文档、页面与元素上都有）放宿主自己的数据，组件不读、原样保留。

打开时把取回的模板赋给 `schema`，保存时取 `schema` 交给后端，成功后 `markSaved()`：

<<< @/examples/snippets/host.ts#save

设计器在内存里改模板，页面关掉修改就没了。有未保存的修改时提醒用户：

<<< @/examples/snippets/host.ts#leave

## 取数

- **打印时**：宿主调接口取业务数据，交给预览的 `data` 或 `printDocument`。字段路径对的是这份数据的结构，接口返回的结构与模板不一致时，在宿主这边转换好再交给组件。
- **设计时**：`fields` 告诉设计器有哪些字段可以绑定，`sampleData` 让画布显示实际的值。同一类单据的字段通常是固定的，也可以按一份示例数据生成字段树：

<<< @/examples/snippets/host.ts#fields

- 图片地址由宿主提供：放在宿主的文件服务里，模板里写地址或绑定数据里的地址字段。要经打印客户端打印的图片，文件服务要允许跨源读取（CORS）。

## 权限

- 只能看的用户把设计器设成 `readonly`：能选择、浏览、预览与打印，不能修改。
- 只让调整局部的场景，用 `panels` 去掉物料等区，用自定义属性编辑器限定可选的值。
- 这些都只在前端生效。模板保存、删除与打印的权限要在服务端判断；保存时服务端也应复核模板本身。

## 服务端复核

`@xihan-print/core` 不依赖 DOM，可以在 Node.js 后端直接校验收到的模板：

<<< @/examples/snippets/host.ts#server

后端不是 JavaScript 时，前端在提交前用 `validate()` 拦住有错误的模板；服务端把模板当作不透明的 JSON 存取，需要时另起一个 Node.js 服务做复核。

## 在前端框架里使用

预览与设计器是原生 Web Components，任何框架都能用：在应用启动时调用一次 `definePrintPreview()` 或 `definePrintDesigner()`，之后像普通元素一样放进模板。模板、数据这类对象要交给元素的属性，不要写成 attribute。

在 Vue 里，先告诉编译器 `xh-` 开头的标签是自定义元素，免得被当成组件去解析：

```ts
// vite.config.ts 里 @vitejs/plugin-vue 的选项
vue({
  template: {
    compilerOptions: {
      isCustomElement: tag => tag.startsWith('xh-'),
    },
  },
})
```

对象用 `.prop` 修饰交给属性，事件用 `@` 监听：

<<< @/examples/demos/vue-preview.vue

<PrintDemo name="vue-preview" />

React 19 起会把对象直接赋给自定义元素的同名属性；事件可以用 `ref` 拿到元素后 `addEventListener` 监听。

## 一个页面里放多个实例

组件不往 `window` 上挂对象，也不读写固定键名的本地存储，同一页面里的多个预览、多个设计器互不影响。只有语言包是全局的：`setXhConfig` 对页面上所有元素生效，单个实例的文案用它的 `translations` 属性覆写。
