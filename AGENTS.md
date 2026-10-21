# AGENTS.md

本文件约束在 XiHan.PrintDesigner 仓库内工作的 AI Agent。回答和提交说明使用中文；代码标识、公开 API 与标准术语保持英文。

## 仓库概览

XiHan.PrintDesigner 是框架无关的打印设计器，以原生 Web Components 交付，任何前端项目都能使用。本仓库是开源版（MIT），必须能独立安装、构建和使用，不接收依赖私有包的代码。

本仓库还包含本地打印客户端（Windows 托盘程序，.NET 10 + WebView2，放在 `client/`），约定见「打印客户端」一节。

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
├─ .github/ .gitee/ .gitcode/     # 三平台 Issue / PR 模板，GitHub 另有 CI 与发版工作流
├─ client/                         # 打印客户端（.NET 解决方案 XiHan.PrintClient.slnx）
│  ├─ src/XiHan.PrintClient.Core/      # net10.0，平台无关：协议、会话、来源授权、任务队列与各平台接口
│  ├─ src/XiHan.PrintClient.Windows/   # net10.0-windows：WebView2 渲染、winspool、注册表自启、单实例
│  ├─ src/XiHan.PrintClient/           # WinForms 托盘程序，产物 XiHanPrint.exe
│  ├─ tests/                           # xunit.v3，dotnet test 走 Microsoft.Testing.Platform
│  └─ installer/                       # Inno Setup 安装脚本与打包脚本 build.ps1
├─ docs/                            # 产品文档站（VitePress，独立的 pnpm 项目）
└─ print/                           # pnpm monorepo 根
   ├─ .changeset/                 # changesets 配置与待发布的变更集
   ├─ scripts/release/            # 发版脚本：VersionUpgrade、锁步与标签核对、产物契约、冒烟（smoke/ 是冒烟用的宿主项目模板）
   ├─ packages/
   │  ├─ core/                    # @xihan-print/core：模型层，纯 TS，不碰 DOM
   │  ├─ runtime/                 # @xihan-print/runtime：业务页面用的运行时元素
   │  └─ designer/                # @xihan-print/designer：设计器元素
   └─ playground/                 # @xihan-print/playground：开发预览页（private，不发布）
```

仓库根没有 package.json，库命令在 `print/` 执行，文档站命令在 `docs/` 执行；客户端命令在 `client/` 执行。

## 常用命令（`print/`）

| 任务 | 命令 |
| --- | --- |
| 安装 | `pnpm install --frozen-lockfile` |
| 开发预览 | `pnpm dev`（http://localhost:5191） |
| 构建 | `pnpm build` |
| 类型检查 | `pnpm typecheck` |
| 单测 | `pnpm test` |
| Lint | `pnpm lint` |
| 产物契约（publint + attw，先 build） | `pnpm gate:publish` |
| 冒烟（在临时空项目里装包、类型检查与打包） | `pnpm smoke --pack`（要连同级 XiHan.UI 还没发版的改动一起试时加 `--ui ../../XiHan.UI/ui`） |
| 写变更集 | `pnpm changeset` |

`pnpm build` 按依赖拓扑依次构建 core、runtime、designer。runtime 与 designer 经包的 `exports` 读取上游 dist，改了上游先重建再验证下游。

开发预览页在 `print/playground`，用 Vite 起在 5191 端口（strictPort），分「分页预览」「设计器」两个页签。分页预览用 `<xh-print-preview>` 显示三份示例模板的分页结果——送货单（表格跨页、重复表头、本页小计与合计、补空行、人民币大写、中文页码）、商品标签（EAN-13 条码与二维码）、内部通知（奇偶页眉、罗马数字页码、平铺水印、长文本跨页、字段里的 HTML 排成富文本跨页），可切换模板、缩放、调起浏览器打印、切换中文语言包 `printZhCN`；度量器用缺省的 Canvas 度量器。设计器页签用 `<xh-print-designer>` 打开同一份示例模板，可切换画布按示例数据显示，下方滚动显示设计器派发的事件。
它直接引用 core、runtime 与 designer 的源码，改了源码即时生效，不必先 `pnpm build`；`@xihan-ui/*` 用 npm 上的正式包（版本见 `print/pnpm-workspace.yaml` 的 catalog）：

```bash
# XiHan.PrintDesigner/print
pnpm dev
```

这是开发预览，不是产品：页面只用 UI 的令牌、皮肤与元素，不另写一套样式，也不进任何发布物。

## 文档站（`docs/`）

产品文档站用 VitePress 加组织统一主题 `@xihanfun/vitepress-theme`，做法与 Framework、UI、BasicApp 三站一致。

| 任务 | 命令（在 `docs/`） |
| --- | --- |
| 安装 | `pnpm install --frozen-lockfile` |
| 开发 | `pnpm dev` |
| 构建 | `pnpm build`（站内死链会让构建失败） |
| 重新生成参考页 | `pnpm gen`；`pnpm gate:gen` 只比对、不写文件 |
| 示例类型检查 | `pnpm typecheck` |
| 示例模板校验并试排 | `pnpm check:examples` |
| Lint | `pnpm lint` |

- 打印三个包经 `link:` 读 `print/packages/*` 的产物，先在 `print/` 构建。`@xihan-ui/*` 用 npm 上的正式包：打印三个包要的那几个由 `docs/package.json` 一并装上，并在 `.vitepress/config.ts` 里 `resolve.dedupe` 成同一份；不去重时文档站与设计器各用一份 UI，全站设的界面语言到不了设计器。
- `docs/reference/` 由 `scripts/gen-reference.mjs` 从源码生成（元素原型、`printZhCN`、TypeScript 源码注释、客户端错误码的 C# 注释），不手改。改了元素、属性、问题码、公开 API 或这些注释，在 `docs/` 跑 `pnpm gen` 并随改动一起提交；参考页的说明不对，就改源码注释。
- 正文里的 TypeScript 与 Vue 示例都放在 `examples/`，用 `<<< @/examples/…#片段` 引入，不在 Markdown 里另写一份：`templates/` 下导出 `schema` 与 `data` 的模板由 `check:examples` 校验并试排，`demos/` 下的 `.ts` 导出 `mount(host)`、`.vue` 是一个组件，页面上写 `<PrintDemo name="…" />` 真实运行，`snippets/` 只做类型检查。
- 正文里含 `{{` 的行内代码写成 `<code v-pre>…</code>`，否则会被 Vue 当成插值吃掉，构建也不报错。
- 站点自己的导航、侧栏与示例组件放在 `docs/.vitepress/`，不复制或改写主题已提供的样式。
- 文档只写已经做完的能力；不写组件数、元素数与依赖的具体版本号，不写预发布阶段的铺垫。
- 站点地址是 https://print.docs.xihanfun.com：`docs/public/CNAME`、`docs/public/.nojekyll` 与 `.github/workflows/deploy-docs.yml`（main 上 `docs/` 或 `print/` 有变更时先装好并构建 `print/`，再构建文档站，部署到 gh-pages）属于站点契约，不因清理构建配置而删除；主题配置的 `llms.site` 与 `docs/package.json` 的 `homepage` 写同一个地址。

## 分层与依赖

- 依赖方向固定为 `designer → runtime → core`，不得反向引用。
- core 只做模型：schema 类型、校验、编辑命令与算法。tsconfig 不含 DOM 类型库，不得触碰 DOM。
- runtime 是业务页面使用的元素，体积敏感；设计器专用的代码不进 runtime。
- 所有包源码不得 import 任何前端框架（ESLint 已拦截）。
- 运行时依赖只允许 `@xihan-print/*` 与 `@xihan-ui/*`；引入任何其他依赖之前先征得维护者同意。`@xihan-ui/*` 写成 peerDependencies `^5.0.0`（由宿主装唯一的一份），开发时另写 devDependencies（`catalog:`），升级 UI 时两处一起改。

## 硬性约定

- **模板即数据**：模板是纯 JSON，禁止 `eval`、`new Function`、动态插入脚本和把用户内容拼进 `innerHTML`。需要计算的地方用受限的表达式解析，不执行字符串代码。
- **无全局状态**：不往 `window` 上挂对象，不读写固定键名的 localStorage，不在模块顶层产生副作用；同一页面放多个实例互不影响。
- **数据由使用方提供**：组件不发网络请求，数据、存储与权限都经回调或属性交给使用方。
- **对外契约**：复杂数据走 property 不走 attribute；事件用 `CustomEvent`；公开方法、事件和属性都要有类型声明。布尔 attribute 一律用 `@xihan-ui/web-components/authoring` 的 `BOOLEAN_CONVERTER`（不写为 undefined、`"false"` 为假、其余为真），不用 `type: Boolean`；元素内部按 `=== true` 读。
- **语言包**：内建文案按语言出包，语言与 UI 的内建语言包一一对应，导出名是 `print` 加 UI 语言包的名字（`printZhCN`、`printJaJP`……），每份并入 designer-shell 同一语言的那份；宿主用 `mergeXhConfig` 与 UI 同一语言的语言包合并。语言包在 `runtime/src/locale/`，一种语言一个文件，按 `PrintLocale` 声明；`runtime/src/designer-locale.ts` 的英文表是属性名与选项名的键的唯一来源，问题说明按内建问题码各写一条，少键、多键都是类型错误。新增文案键、属性名、选项名或问题码时十种语言一起补。
- **样式**：Light DOM，样式只消费 `@xihan-ui` 设计令牌，不写颜色、间距、圆角等散值。
- **注释**：只写代码做什么，不写为什么这样设计、也不写任何参考项目名称；设计理由写进提交说明。
- **源码文件头**：

```ts
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */
```

## 打印客户端（`client/`）

设计依据是总会话共享笔记里的 `print-client-draft.md`（用户已批准）：只监听 127.0.0.1 的 WebSocket，子协议 `xihan-print.v1`，端口 17620–17623；按来源授权；WebView2 只渲染、不跑页面脚本、不联网。

| 任务 | 命令（在 `client/`） |
| --- | --- |
| 构建 | `dotnet build XiHan.PrintClient.slnx -c Release` |
| 测试 | `dotnet test --solution XiHan.PrintClient.slnx -c Release --no-build` |
| 安装包 | `pwsh installer/build.ps1`（自包含发布 x64 与 arm64，再用 Inno Setup 6 编译；`-PublishOnly` 只发布，`-SkipWebView2` 不打 WebView2 安装程序、只用于本机试装） |

- SDK 版本以 `client/global.json` 为准，与 XiHan.Framework 一致；包版本集中在 `Directory.Packages.props`。
- 运行时 NuGet 依赖只有 `Microsoft.Web.WebView2`；新增任何运行时依赖前先征得维护者同意，能用 .NET 自带库或 Windows API 自写的就自写。
- Core 不引用任何 Windows 专属 API，平台相关的实现放在平台项目里，经 Core 的接口接入。
- 代码风格照 XiHan.Framework：文件头两行版权注释，文件级命名空间，公开成员写中文 XML 注释，注释只写做什么。
- 原始通道的集成测试要一台端口指向文件的「Generic / Text Only」打印机，经环境变量 `XIHAN_PRINT_TEST_PRINTER`、`XIHAN_PRINT_TEST_OUTPUT` 告知；没配置时跳过。CI 里由 `client.yml` 自动装，本机要跑时以管理员身份照那一步装。
- 本机编译安装包用按当前用户装的 Inno Setup 6.7.3（官方安装包，装在 `%LocalAppData%\Programs\Inno Setup 6`），`build.ps1` 会在那里和 PATH 里找 `ISCC.exe`；它只用于编译与试装，不进运行时依赖，也不进仓库。CI 自己装 Inno Setup，不依赖哪台机器。安装包按系统界面语言选简体中文或英文，不弹语言选择框；简体中文是自己写的 `installer/zh-CN.isl`，叠在 `compiler:Default.isl` 之上，只覆写这个安装包在安装、升级、卸载与出错时会出现的消息，其余沿用英文。给安装包加页面或提示时，在 `zh-CN.isl` 与 `[CustomMessages]` 的 `en.`、`zh.` 两份里一起补。
- 安装包按当前用户装到 `%LocalAppData%\Programs\XiHanFun\PrintClient`，不要管理员权限；打进 WebView2 Evergreen 引导程序（内网可用 `-WebView2Installer` 换成离线安装包）。分支 CI 出未签名的安装包；推 `client-v<版本>` 标签时 `client-release.yml` 签名（仓库密钥 `CLIENT_SIGNING_CERT`、`CLIENT_SIGNING_PASSWORD`，没有就不签）并建草稿 Release，发布草稿后把附件里的 `update.json` 提交到 main 的 `client/update.json`，客户端的自动更新才看得到新版。
- 自动更新只安装 `Directory.Build.props` 里 `XiHanUpdatePublisher` 这个发布者签名的安装包，为空时只提示新版、不自动安装。
- 提交前跑构建、测试与 `git diff --check`。

## 发版

做法照 XiHan.UI：changesets 记变更，main 上的 `v<版本>` 标签触发 `.github/workflows/release.yml` 发 npm。说明见 `print/.changeset/README.md`。

- 三个公开包经 changesets 的 `fixed` 组锁步同版；`scripts/release/check-version-lock.mjs` 核对。
- 使用者能感知的改动附一份变更集（`pnpm changeset`），中文、官方口径；CI、测试、文档站、脚本、README 不写。首发之前的改动由 `.changeset/first-release.md` 一并概括。
- 定版本用 `print/scripts/release/VersionUpgrade.bat`（或 `pwsh scripts/release/VersionUpgrade.ps1`）：消费变更集、写各包 CHANGELOG，可进出预发布通道；不提交、不打标签、不推送，`-DryRun` 只打印计划。同一笔补文档站「更新日志」页（`docs/changelog.md`）这一版的一节；这一页在首发那一笔新建并加进导航，首发之前不建，也不写发布前的铺垫。
- release.yml 先核对标签（在 main 的历史里；标签号等于包版本且与 `.changeset/pre.json` 一致，`check-release-tag.mjs`），再构建、`gate:publish`、`changeset publish`（带 provenance），然后 `scripts/release/smoke.mjs --version` 冒烟，最后调 `deploy-docs.yml` 部署文档站。deploy-docs 只部署已经发布的版本：当前版本有标签、main 上的包与标签一致、这个版本已在 npm 上。
- npm 包的版本不建 GitHub Release；Release 页只放打印客户端的安装包（`client-v<版本>`，`client-release.yml` 同样只放行 main 上的标签）。
- main 只接收发版；两次发版之间挑进 main 的纯文档修正与客户端的 `client/update.json`，进了 main 以后立刻把 main 合回 dev。
- 合并 main、打标签、发布都只在用户明确要求时执行。

## 分支与 worktree

- 主检出上的日常改动直接提交到 `dev`；`main` 只接收发版。
- 开 worktree 时分支按用途分组：`feat/<名>`、`fix/<名>`、`issue/<编号>`、`pr/<编号>-review`；工具生成的 `claude/<名>` 等分支在首次提交前改名。
- worktree 分支的合并、推送、PR 以及删除，只在用户明确要求时执行。

## Git 与提交

- 保留用户已有和无关改动；不要 reset、checkout 或清理它们。
- 使用 Conventional Commits：`<type>(<scope>): <中文说明>`，scope 取 `core`、`runtime`、`designer`、`client`、`docs`、`repo`。
- 一项完整功能一个提交；改 `print/` 的提交前跑 `pnpm lint`、`pnpm build`、`pnpm typecheck`、`pnpm test`，改 `client/` 的跑构建与测试，改 `docs/` 的在 `docs/` 跑 `pnpm gate:gen`、`pnpm check:examples`、`pnpm lint`、`pnpm typecheck`、`pnpm build`，都要过 `git diff --check`。
- 不推送、不发布、不创建远程 PR，除非用户明确要求。

## 禁止事项

- 不凭记忆猜 `@xihan-ui` 的 API、部件、事件或令牌，先查 XiHan.UI 源码或文档。
- 不复制其他项目的源码；参考他人设计只学思路。
- 不添加静默兜底和推测性兼容。
- 不通过放宽 Lint 或类型检查掩盖实现问题。
