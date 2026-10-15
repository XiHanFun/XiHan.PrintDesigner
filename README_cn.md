<div align="center">
<h1>XiHan.PrintDesigner</h1>

<p><b>快速、轻量、高效、用心的框架无关打印设计器</b></p>

<p>以 Web Components 交付，可视化设计打印模板，在浏览器里预览与打印；配合本地打印客户端可静默直打</p>

<p><a href="./README.md">English</a> | <b>简体中文</b></p>

<p>
  <a href="https://github.com/XiHanFun/XiHan.PrintDesigner/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/XiHanFun/XiHan.PrintDesigner?style=flat-square&logo=github&label=Stars&color=1f6feb" /></a>
  <a href="https://gitee.com/XiHanFun/XiHan.PrintDesigner"><img alt="Gitee Stars" src="https://gitee.com/XiHanFun/XiHan.PrintDesigner/badge/star.svg" /></a>
  <a href="https://gitcode.com/XiHanFun/XiHan.PrintDesigner"><img alt="GitCode Stars" src="https://gitcode.com/XiHanFun/XiHan.PrintDesigner/star/badge.svg" /></a>
</p>

<p>
  <img alt="Web Components" src="https://img.shields.io/badge/Web_Components-29ABE2?style=flat-square&logo=webcomponentsdotorg&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/XiHanFun/XiHan.PrintDesigner?style=flat-square&color=green" /></a>
</p>

<p>
  <a href="https://docs.xihanfun.com"><img alt="Docs" src="https://img.shields.io/badge/Docs-docs.xihanfun.com-2496ED?style=flat-square&logo=readthedocs&logoColor=white" /></a>
  <a href="https://qm.qq.com/q/qYp1Urv3z2"><img alt="QQ Group" src="https://img.shields.io/badge/QQ_Group-462371834-EB1923?style=flat-square&logo=tencentqq&logoColor=white" /></a>
</p>

</div>

> [!WARNING]
> 项目处于早期开发阶段，尚未发布 npm 包，公开 API 随时可能调整。

## 简介

XiHan.PrintDesigner 是一款框架无关的打印设计器，以原生 Web Components 交付，Vue、React、Angular 或不使用框架的页面都能直接使用。属于曦寒懿（XiHanFun）开源生态。

## 设计原则

- **框架无关** - 以原生 Web Components 交付，不绑定任何前端框架
- **零第三方依赖** - 运行时不引入任何第三方包
- **模板即数据** - 模板只是 JSON，不含也不执行任何代码，导入模板不会带来脚本注入
- **数据由使用方掌控** - 组件不发网络请求，数据、存储与权限都经回调交给使用方
- **配套打印客户端** - 本地打印客户端负责静默打印、指定打印机与原始指令打印，与设计器在同一仓库维护（规划中）

## 包结构

| 包 | 说明 |
| --- | --- |
| `@xihan-print/core` | 模型层：模板 schema、校验与编辑命令，纯 TypeScript，不依赖 DOM |
| `@xihan-print/runtime` | 运行时：业务页面使用的模板预览、浏览器打印与打印客户端连接 |
| `@xihan-print/designer` | 设计器：可视化打印模板设计器 |

依赖方向为 `designer → runtime → core`。业务页面只需要 runtime，设计器只在需要编辑模板的地方加载。

## 本地开发

需要 Node.js 24+ 与 pnpm 11+。

```bash
cd print
pnpm install
pnpm build
```

其余命令：`pnpm typecheck`、`pnpm test`、`pnpm lint`。

## 相关项目

- [XiHan.Framework](https://github.com/XiHanFun/XiHan.Framework) - .NET 模块化开发框架
- [XiHan.UI](https://github.com/XiHanFun/XiHan.UI) - 框架无关 Headless UI 组件库
- [XiHan.BasicApp](https://github.com/XiHanFun/XiHan.BasicApp) - 基于 XiHan.Framework 和 XiHan.UI 的超高颜值通用中后台内核
- [XiHan.FlowDesigner](https://github.com/XiHanFun/XiHan.FlowDesigner) - 框架无关流程设计器
- [XiHan.FormDesigner](https://github.com/XiHanFun/XiHan.FormDesigner) - 框架无关表单设计器
- [XiHan.ReportDesigner](https://github.com/XiHanFun/XiHan.ReportDesigner) - 框架无关报表设计器

## 贡献

欢迎提交 Issue 和 Pull Request。提交遵循 conventional commits 规范，改动需通过 CI 的 lint、类型检查、构建与测试。

## 支持&赞助

如果此项目对你的开发有助益，也欢迎请作者一杯咖啡。

官方赞助页 https://docs.xihanfun.com/cosmos/sponsor

## 版权&授权

Copyright (c) 2021-Present XiHanFun and contributors.

本项目采用 MIT 授权，详见 [License](./LICENSE)

XiHan.PrintDesigner 名称、界面视觉设计与原创视觉表达归作者所有，第三方服务分别遵循其各自授权与服务条款。

项目仅供学习参考，作者不承担任何软件的使用风险。
