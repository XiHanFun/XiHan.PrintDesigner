<div align="center">

<h1>XiHan.PrintDesigner</h1>

<h3>快速、轻量、高效、用心的框架无关打印设计器</h3>

<p>
  <a href="https://github.com/XiHanFun/XiHan.PrintDesigner/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/XiHanFun/XiHan.PrintDesigner/ci.yml?branch=dev&style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@xihan-print/designer"><img alt="npm" src="https://img.shields.io/npm/v/@xihan-print/designer?style=flat-square&logo=npm&logoColor=white&color=cb3837" /></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/XiHanFun/XiHan.PrintDesigner?style=flat-square&color=green" /></a>
  <a href="https://github.com/XiHanFun/XiHan.PrintDesigner/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/XiHanFun/XiHan.PrintDesigner?style=flat-square&logo=github&label=Stars&color=1f6feb" /></a>
  <a href="https://gitee.com/XiHanFun/XiHan.PrintDesigner"><img alt="Gitee Stars" src="https://gitee.com/XiHanFun/XiHan.PrintDesigner/badge/star.svg" /></a>
  <a href="https://gitcode.com/XiHanFun/XiHan.PrintDesigner"><img alt="GitCode Stars" src="https://gitcode.com/XiHanFun/XiHan.PrintDesigner/star/badge.svg" /></a>
</p>

<p>
  <a href="https://print.docs.xihanfun.com"><b>文档</b></a> ·
  <a href="#快速开始"><b>快速开始</b></a> ·
  <a href="https://print.docs.xihanfun.com/changelog"><b>更新日志</b></a>
</p>

<p><a href="./README.md">English</a> | <b>简体中文</b></p>

</div>

XiHan.PrintDesigner 是框架无关的打印设计器，以 Web Components 交付，可视化设计打印模板，支持浏览器预览与打印，配合本地客户端可静默直打，属曦寒懿（XiHanFun）开源生态。

## 特性

| 特性 | 说明 |
| --- | --- |
| 框架无关 | 原生 Web Components，适用于 Vue、React、Angular 与无框架页面 |
| 零第三方依赖 | 运行时不引入第三方包 |
| 模板即数据 | 模板为 JSON，不含也不执行代码 |
| 数据自主 | 组件不发网络请求，数据、存储与权限经回调交由使用方 |
| [打印客户端](https://print.docs.xihanfun.com/guide/client) | 静默打印、指定打印机、原始指令打印与导出 PDF |

## 快速开始

```bash
pnpm add @xihan-print/core @xihan-print/runtime @xihan-ui/styles
```

```ts
import { definePrintPreview } from '@xihan-print/runtime'
import '@xihan-ui/styles/index.css'
import '@xihan-print/runtime/style.css'

definePrintPreview()

const preview = document.createElement('xh-print-preview')
preview.schema = schema
preview.data = data
document.body.append(preview)
```

模板与数据绑定的写法见[快速开始](https://print.docs.xihanfun.com/quickstart)。

## 包结构

| 包 | 说明 |
| --- | --- |
| `@xihan-print/core` | 模型层：模板 schema、校验与编辑命令，不依赖 DOM |
| `@xihan-print/runtime` | 运行时：模板预览、浏览器打印与客户端连接 |
| `@xihan-print/designer` | 设计器：可视化模板设计 |

依赖方向为 `designer → runtime → core`，业务页面仅需 `runtime`。

## 打印客户端

`client/` 为 Windows、macOS 与 Linux 上的托盘程序（Rust + Tauri 2），仅监听 127.0.0.1，各站点首次连接时须经用户授权，打印任务在隔离沙箱中渲染。接入方式见[打印客户端](https://print.docs.xihanfun.com/guide/client)。

## 本地开发

需 Node.js 24+ 与 pnpm 11+，开发预览页位于 `http://localhost:5191`。

```bash
cd print
pnpm install
pnpm dev
```

## 生态

| 项目 | 说明 |
| --- | --- |
| [XiHan.Framework](https://github.com/XiHanFun/XiHan.Framework) | .NET 微内核开发框架 |
| [XiHan.UI](https://github.com/XiHanFun/XiHan.UI) | 框架无关 Headless UI 组件库 |
| [XiHan.BasicApp](https://github.com/XiHanFun/XiHan.BasicApp) | 基于 XiHan.Framework 和 XiHan.UI 的超高颜值通用中后台内核 |
| [XiHan.FlowDesigner](https://github.com/XiHanFun/XiHan.FlowDesigner) | 框架无关流程设计器 |
| [XiHan.FormDesigner](https://github.com/XiHanFun/XiHan.FormDesigner) | 框架无关表单设计器 |
| [XiHan.ReportDesigner](https://github.com/XiHanFun/XiHan.ReportDesigner) | 框架无关报表设计器 |

## 文档

[运行时](https://print.docs.xihanfun.com/guide/runtime) · [设计器](https://print.docs.xihanfun.com/guide/designer) · [打印客户端](https://print.docs.xihanfun.com/guide/client) · [更新日志](https://print.docs.xihanfun.com/changelog)

## 参与

欢迎提交 [Issue](https://github.com/XiHanFun/XiHan.PrintDesigner/issues) 与 Pull Request，提交遵循 Conventional Commits，改动须通过 CI 门禁。交流：QQ 群 [462371834](https://qm.qq.com/q/qYp1Urv3z2)。支持项目：[赞助页](https://docs.xihanfun.com/cosmos/sponsor)。

## 许可证

[MIT](./LICENSE) © 2021-Present XiHanFun and contributors。XiHan.PrintDesigner 的名称、界面视觉设计与原创视觉表达归作者所有。
