<div align="center">
<h1>XiHan.PrintDesigner</h1>

<p><b>A fast, lightweight, efficient and thoughtfully built framework-agnostic print designer</b></p>

<p>Delivered as Web Components: design print templates visually, preview and print in the browser, and print silently through a local print client</p>

<p><b>English</b> | <a href="./README_cn.md">简体中文</a></p>

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
> This project is in early development. No npm packages have been published yet, and the public API may change at any time.

## Introduction

XiHan.PrintDesigner is a framework-agnostic print designer delivered as native Web Components, so it works in Vue, React, Angular or framework-free pages alike. It is part of the XiHanFun open-source ecosystem.

## Principles

- **Framework-agnostic** - delivered as native Web Components, bound to no frontend framework
- **No third-party runtime dependencies** - nothing third-party ships at runtime
- **Templates are data** - a template is plain JSON that neither contains nor runs code, so importing one cannot inject scripts
- **The host owns the data** - components make no network requests; data, storage and permissions are handed to the host through callbacks
- **Companion print client** - a local print client for silent printing, printer selection and raw command printing, maintained in this repository (planned)

## Packages

| Package | Description |
| --- | --- |
| `@xihan-print/core` | Model layer: template schema, validation and edit commands; pure TypeScript, no DOM |
| `@xihan-print/runtime` | Runtime: template preview, browser printing and the print client connection for business pages |
| `@xihan-print/designer` | Designer: visual print template designer |

Dependencies point `designer → runtime → core`. Business pages only need the runtime; the designer is loaded only where templates are edited.

## Development

Requires Node.js 24+ and pnpm 11+.

```bash
cd print
pnpm install
pnpm build
```

Other commands: `pnpm typecheck`, `pnpm test`, `pnpm lint`.

## Related projects

- [XiHan.Framework](https://github.com/XiHanFun/XiHan.Framework) - .NET modular development framework
- [XiHan.UI](https://github.com/XiHanFun/XiHan.UI) - Framework-agnostic headless UI component library
- [XiHan.BasicApp](https://github.com/XiHanFun/XiHan.BasicApp) - A polished general-purpose admin core built on XiHan.Framework and XiHan.UI
- [XiHan.FlowDesigner](https://github.com/XiHanFun/XiHan.FlowDesigner) - Framework-agnostic flow designer
- [XiHan.FormDesigner](https://github.com/XiHanFun/XiHan.FormDesigner) - Framework-agnostic form designer
- [XiHan.ReportDesigner](https://github.com/XiHanFun/XiHan.ReportDesigner) - Framework-agnostic report designer

## Contributing

Issues and pull requests are welcome. Commits follow the conventional commits format, and changes must pass CI lint, type checking, build and tests.

## Sponsorship

If this project helps your work, you are welcome to buy the author a coffee.

Sponsorship page: https://docs.xihanfun.com/cosmos/sponsor

## Copyright & License

Copyright (c) 2021-Present XiHanFun and contributors.

Licensed under the MIT License; see [License](./LICENSE).

The XiHan.PrintDesigner name, interface visual design and original visual expression belong to the author. Third-party services follow their own licenses and terms.

This project is provided for learning and reference only; the author assumes no risk arising from its use.
