# 介绍

曦寒打印设计器（XiHan.PrintDesigner）是一款框架无关的打印设计器：以原生 Web Components 交付，可视化设计打印模板，在浏览器里按数据分页、预览与打印；配合本地打印客户端，还能不弹对话框直接打到指定的打印机。属于曦寒懿（XiHanFun）开源生态，采用 MIT 授权。

## 能做什么

| 场景 | 用什么 |
| --- | --- |
| 设计与修改模板 | `<xh-print-designer>`：物料面板、标尺与参考线、吸附对齐、属性面板、问题列表、表格编辑、撤销重做，可切到预览态 |
| 在业务页面里预览、打印 | `<xh-print-preview>`：按数据排出全部输出页逐页显示，调起浏览器的打印对话框 |
| 不显示预览直接打印 | `printDocument(schema, data)`：在隐藏的 iframe 里排版并调起打印对话框 |
| 静默打印、原始指令、导出 PDF | 本地打印客户端，经 `@xihan-print/runtime/client` 连接 |

## 设计原则

- **框架无关**：以原生 Web Components 交付，不绑定任何前端框架。元素用 Light DOM，样式只消费 [XiHan.UI](https://ui.docs.xihanfun.com) 的设计令牌。
- **零第三方依赖**：运行时只依赖 `@xihan-print/*` 与 `@xihan-ui/*`，条码、二维码、受限表达式与格式化都来自 XiHan.UI。
- **模板即数据**：模板是纯 JSON，不含也不执行任何代码。需要计算的地方用受限表达式，导入模板不会带来脚本注入。
- **数据由使用方掌控**：组件不发网络请求。模板存在哪里、数据从哪里取、谁能改模板，都由使用方决定，经属性与事件交给组件。
- **没有全局状态**：不往 `window` 上挂对象，不读写固定键名的本地存储，同一页面放多个实例互不影响。

## 包与入口

| 入口 | 内容 |
| --- | --- |
| `@xihan-print/core` | 模板的类型定义、校验、编辑操作与分页算法。纯 TypeScript，不依赖 DOM，浏览器与 Node.js 里都能用 |
| `@xihan-print/runtime` | 业务页面用的 `<xh-print-preview>`、`printDocument` 与浏览器打印，样式在 `@xihan-print/runtime/style.css` |
| `@xihan-print/runtime/client` | 连接本地打印客户端：静默打印、原始指令、导出 PDF；不用客户端的页面不会加载这部分代码 |
| `@xihan-print/runtime/locale` | 中文语言包 `printZhCN`，预览与设计器共用 |
| `@xihan-print/designer` | `<xh-print-designer>`，样式在 `@xihan-print/designer/style.css` |

依赖方向固定为 `designer → runtime → core`。业务页面只需要 runtime，设计器只在需要编辑模板的地方加载。

## 工作流程

```text
设计器 <xh-print-designer>
  │  schema-change / save 事件
  ▼
宿主保存模板 JSON（数据库、文件，由宿主决定）
  │
  ▼
业务页面取模板与数据
  ├─ <xh-print-preview> 或 printDocument ──▶ 浏览器打印对话框
  └─ @xihan-print/runtime/client ──▶ 本地打印客户端 ──▶ 打印机 / PDF
```

1. 设计：在设计器里编辑模板，设计器派发 `schema-change` 与 `save`，宿主把模板 JSON 存起来。
2. 打印：业务页面取出模板与数据，交给 `<xh-print-preview>` 预览与打印，或者直接调用 `printDocument`。
3. 静默打印：装了本地打印客户端时，交给客户端打到指定的打印机；连不上客户端时退回浏览器的打印对话框。

## 运行环境

- `@xihan-print/core` 不依赖 DOM，可以在浏览器、Node.js 或其它 JavaScript 运行环境里校验模板、排出输出页。
- `@xihan-print/runtime` 与 `@xihan-print/designer` 要在支持 Custom Elements 的浏览器里运行，文字度量缺省用 Canvas 2D。
- 本地打印客户端是 Windows 托盘程序，有 x64 与 arm64 两种安装包，渲染用系统的 WebView2 运行时。

## 下一步

- [快速开始](./quickstart)：在任意前端项目里装包、渲染一张模板并打印。
- [模板结构](./guide/template)：页面、页眉页脚、元素与表格。
