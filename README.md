<div align="center">

<h1>XiHan.PrintDesigner</h1>

<h3>A fast, lightweight, efficient and thoughtfully built framework-agnostic print designer</h3>

<p>
  <a href="https://github.com/XiHanFun/XiHan.PrintDesigner/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/XiHanFun/XiHan.PrintDesigner/ci.yml?branch=dev&style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@xihan-print/designer"><img alt="npm" src="https://img.shields.io/npm/v/@xihan-print/designer?style=flat-square&logo=npm&logoColor=white&color=cb3837" /></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/XiHanFun/XiHan.PrintDesigner?style=flat-square&color=green" /></a>
  <a href="https://github.com/XiHanFun/XiHan.PrintDesigner/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/XiHanFun/XiHan.PrintDesigner?style=flat-square&logo=github&label=Stars&color=1f6feb" /></a>
  <a href="https://gitee.com/XiHanFun/XiHan.PrintDesigner"><img alt="Gitee Stars" src="https://gitee.com/XiHanFun/XiHan.PrintDesigner/badge/star.svg" /></a>
  <a href="https://gitcode.com/XiHanFun/XiHan.PrintDesigner"><img alt="GitCode Stars" src="https://gitcode.com/XiHanFun/XiHan.PrintDesigner/star/badge.svg" /></a>
</p>

<p>
  <a href="https://print.docs.xihanfun.com"><b>Docs</b></a> ·
  <a href="#getting-started"><b>Getting Started</b></a> ·
  <a href="https://print.docs.xihanfun.com/changelog"><b>Changelog</b></a>
</p>

<p><b>English</b> | <a href="./README_cn.md">简体中文</a></p>

</div>

XiHan.PrintDesigner is a framework-agnostic print designer delivered as Web Components. It designs print templates visually, previews and prints in the browser, and prints silently with a local client. It is part of the XiHanFun open-source ecosystem.

## Features

| Feature | Description |
| --- | --- |
| Framework-agnostic | Native Web Components for Vue, React, Angular and pages without a framework |
| No third-party dependencies | Nothing third-party at runtime |
| Templates are data | Templates are JSON that neither contain nor execute code |
| Data stays with you | Components make no network requests; data, storage and permissions go through callbacks |
| [Print client](https://print.docs.xihanfun.com/guide/client) | Silent printing, printer selection, raw command printing and PDF export |

## Getting Started

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

Templates and data binding are covered in the [quickstart](https://print.docs.xihanfun.com/quickstart).

## Packages

| Package | Description |
| --- | --- |
| `@xihan-print/core` | Model layer: template schema, validation and editing commands, with no DOM dependency |
| `@xihan-print/runtime` | Runtime: template preview, browser printing and client connection |
| `@xihan-print/designer` | Designer: visual template design |

Dependencies run `designer → runtime → core`, and business pages only need `runtime`.

## Print Client

`client/` is a desktop application with its own main window for Windows, macOS and Linux (Rust + Tauri 2) that listens only on 127.0.0.1, asks the user to authorize each site on first connection, and renders print jobs in an isolated sandbox. See the [print client](https://print.docs.xihanfun.com/guide/client) guide.

## Local Development

Requires Node.js 24+ and pnpm 11+. The development preview runs at `http://localhost:5191`.

```bash
cd print
pnpm install
pnpm dev
```

## Ecosystem

| Project | Description |
| --- | --- |
| [XiHan.Framework](https://github.com/XiHanFun/XiHan.Framework) | .NET microkernel development framework |
| [XiHan.UI](https://github.com/XiHanFun/XiHan.UI) | Framework-agnostic headless UI component library |
| [XiHan.BasicApp](https://github.com/XiHanFun/XiHan.BasicApp) | A beautifully crafted general-purpose admin kernel built on XiHan.Framework and XiHan.UI |
| [XiHan.FlowDesigner](https://github.com/XiHanFun/XiHan.FlowDesigner) | Framework-agnostic flow designer |
| [XiHan.FormDesigner](https://github.com/XiHanFun/XiHan.FormDesigner) | Framework-agnostic form designer |
| [XiHan.ReportDesigner](https://github.com/XiHanFun/XiHan.ReportDesigner) | Framework-agnostic report designer |

## Documentation

The documentation site is written in Chinese.

[Runtime](https://print.docs.xihanfun.com/guide/runtime) · [Designer](https://print.docs.xihanfun.com/guide/designer) · [Print client](https://print.docs.xihanfun.com/guide/client) · [Changelog](https://print.docs.xihanfun.com/changelog)

## Contributing

[Issues](https://github.com/XiHanFun/XiHan.PrintDesigner/issues) and pull requests are welcome. Commits follow Conventional Commits, and changes must pass the CI gates. Community: QQ group [462371834](https://qm.qq.com/q/qYp1Urv3z2). Support the project: [sponsorship page](https://docs.xihanfun.com/cosmos/sponsor).

## License

[MIT](./LICENSE) © 2021-Present XiHanFun and contributors. The XiHan.PrintDesigner name, interface design and original visual expression belong to the author.
