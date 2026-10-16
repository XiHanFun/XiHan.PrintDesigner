# AGENTS.md

本文件约束在 XiHan.PrintDesigner 仓库内工作的 AI Agent。回答和提交说明使用中文；代码标识、公开 API 与标准术语保持英文。

## 仓库概览

XiHan.PrintDesigner 是框架无关的打印设计器，以原生 Web Components 交付，任何前端项目都能使用。本仓库是开源版（MIT），必须能独立安装、构建和使用，不接收依赖私有包的代码。

本仓库还将包含本地打印客户端（.NET 桌面程序，放在 `client/`），落地时在本文件补充它的技术栈、命令与约定。

### 技术栈

| 技术 | 要求 | 用途 |
| --- | --- | --- |
| Node.js | 24+ | 脚本、构建与测试 |
| pnpm | 11+ | 工作区包管理 |
| TypeScript | 6.x | 类型与源码 |
| tsdown | 0.22 | 库打包（ESM only） |
| Vitest | 4.x | 单元测试 |
| Web Components | Light DOM | 对外交付形态 |
| ESLint + oxlint | @antfu/eslint-config | Lint |

## 目录结构

```text
/
├─ AGENTS.md
├─ CLAUDE.md -> AGENTS.md         # Claude Code 仓库指令入口
├─ .github/ .gitee/ .gitcode/     # 三平台 Issue / PR 模板，GitHub 另有 CI
└─ print/                           # pnpm monorepo 根
   ├─ packages/
   │  ├─ core/                    # @xihan-print/core：模型层，纯 TS，不碰 DOM
   │  ├─ runtime/                 # @xihan-print/runtime：业务页面用的运行时元素
   │  └─ designer/                # @xihan-print/designer：设计器元素
   └─ playground/                 # @xihan-print/playground：开发预览页（private，不发布）
```

仓库根没有 package.json，库命令在 `print/` 执行。

## 常用命令（`print/`）

| 任务 | 命令 |
| --- | --- |
| 安装 | `pnpm install --frozen-lockfile` |
| 开发预览 | `pnpm dev`（http://localhost:5191） |
| 构建 | `pnpm build` |
| 类型检查 | `pnpm typecheck` |
| 单测 | `pnpm test` |
| Lint | `pnpm lint` |

`pnpm build` 按依赖拓扑依次构建 core、runtime、designer。runtime 与 designer 经包的 `exports` 读取上游 dist，改了上游先重建再验证下游。

开发预览页在 `print/playground`，用 Vite 起在 5191 端口（strictPort）：用 `<xh-print-preview>` 显示三份示例模板的分页结果——送货单（表格跨页、重复表头、本页小计与合计、补空行、人民币大写、中文页码）、商品标签（EAN-13 条码与二维码）、内部通知（奇偶页眉、罗马数字页码、平铺水印、长文本跨页），可切换模板、缩放、调起浏览器打印、切换中文语言包 `printZhCN`；度量器用缺省的 Canvas 度量器。
它直接引用 core 与 runtime 的源码，改了源码即时生效，不必先 `pnpm build`；`@xihan-ui/*` 经 overrides 读同级 XiHan.UI 的产物，启动前先在 `XiHan.UI/ui` 构建依赖的包：

```bash
# XiHan.UI/ui
pnpm --filter "@xihan-ui/web-components..." --filter "@xihan-ui/designer-kit..." --filter "@xihan-ui/expression..." --filter "@xihan-ui/styles..." build
# XiHan.PrintDesigner/print
pnpm dev
```

这是开发预览，不是产品：页面只用 UI 的令牌、皮肤与元素，不另写一套样式，也不进任何发布物。

## 分层与依赖

- 依赖方向固定为 `designer → runtime → core`，不得反向引用。
- core 只做模型：schema 类型、校验、编辑命令与算法。tsconfig 不含 DOM 类型库，不得触碰 DOM。
- runtime 是业务页面使用的元素，体积敏感；设计器专用的代码不进 runtime。
- 所有包源码不得 import 任何前端框架（ESLint 已拦截）。
- 运行时依赖只允许 `@xihan-print/*` 与 `@xihan-ui/*`；引入任何其他依赖之前先征得维护者同意。

## 硬性约定

- **模板即数据**：模板是纯 JSON，禁止 `eval`、`new Function`、动态插入脚本和把用户内容拼进 `innerHTML`。需要计算的地方用受限的表达式解析，不执行字符串代码。
- **无全局状态**：不往 `window` 上挂对象，不读写固定键名的 localStorage，不在模块顶层产生副作用；同一页面放多个实例互不影响。
- **数据由使用方提供**：组件不发网络请求，数据、存储与权限都经回调或属性交给使用方。
- **对外契约**：复杂数据走 property 不走 attribute；事件用 `CustomEvent`；公开方法、事件和属性都要有类型声明。
- **样式**：Light DOM，样式只消费 `@xihan-ui` 设计令牌，不写颜色、间距、圆角等散值。
- **注释**：只写代码做什么，不写为什么这样设计、也不写任何参考项目名称；设计理由写进提交说明。
- **源码文件头**：

```ts
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */
```

## 分支与 worktree

- 主检出上的日常改动直接提交到 `dev`；`main` 只接收发版。
- 开 worktree 时分支按用途分组：`feat/<名>`、`fix/<名>`、`issue/<编号>`、`pr/<编号>-review`；工具生成的 `claude/<名>` 等分支在首次提交前改名。
- worktree 分支的合并、推送、PR 以及删除，只在用户明确要求时执行。

## Git 与提交

- 保留用户已有和无关改动；不要 reset、checkout 或清理它们。
- 使用 Conventional Commits：`<type>(<scope>): <中文说明>`，scope 取 `core`、`runtime`、`designer`、`client`、`repo`。
- 一项完整功能一个提交；提交前跑 `pnpm lint`、`pnpm build`、`pnpm typecheck`、`pnpm test` 与 `git diff --check`。
- 不推送、不发布、不创建远程 PR，除非用户明确要求。

## 禁止事项

- 不凭记忆猜 `@xihan-ui` 的 API、部件、事件或令牌，先查 XiHan.UI 源码或文档。
- 不复制其他项目的源码；参考他人设计只学思路。
- 不添加静默兜底和推测性兼容。
- 不通过放宽 Lint 或类型检查掩盖实现问题。
