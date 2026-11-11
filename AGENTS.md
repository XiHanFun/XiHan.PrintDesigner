# AGENTS.md

本文件约束在 XiHan.PrintDesigner 仓库内工作的 AI Agent。回答和提交说明使用中文；代码标识、公开 API 与标准术语保持英文。

## 仓库概览

XiHan.PrintDesigner 是框架无关的打印设计器，以原生 Web Components 交付，任何前端项目都能使用。本仓库是开源版（MIT），必须能独立安装、构建和使用，不接收依赖私有包的代码。

本仓库还包含本地打印客户端（Windows、macOS、Linux 上带主窗口的桌面程序，Rust + Tauri 2，放在 `client/`），约定见「打印客户端」一节。

### 技术栈

| 技术 | 用途 |
| --- | --- |
| Node.js | 脚本、构建与测试 |
| pnpm | 工作区包管理 |
| TypeScript | 类型与源码 |
| tsdown | 库打包（ESM only） |
| Vitest | 单元测试 |
| Web Components（Light DOM） | 对外交付形态 |
| ESLint + oxlint（@antfu/eslint-config） | Lint |

Node.js 与 pnpm 的最低版本见 `print/package.json` 的 `engines`，其余依赖的版本见 `print/pnpm-workspace.yaml` 的 catalog。

## 开始前必须做

1. 按任务读取对应技能（`.agents/skills/<技能>/SKILL.md`，Claude Code 经 `.claude/skills` 读到同一份）：

   | 技能 | 什么时候读 |
   | --- | --- |
   | `designer-development` | 实现或重构 core、runtime、designer 三个包：模板结构、元素、扩展点、分页、设计器界面、语言包 |
   | `docs-site` | 改文档站：正文、示例、参考页生成、导航与侧栏、更新日志页、llms 资产 |
   | `client` | 改打印客户端：协议 `xihan-print.v1`、静默打印、更新检查、安装包 |
   | `version-release` | 定版本、进出 rc 预发布、打标签发 npm、核对发布结果 |
   | `changelog-collect` | 收集两版之间的变化，写文档站「更新日志」 |
   | `commit-msg` · `create-pr` · `issue-reply` · `test-review` | 写提交信息、准备 PR、回复 Issue、审查测试 |

2. 同时涉及几块时加载对应的几个技能，不一次读无关的资料。

## 目录结构

```text
/
├─ AGENTS.md
├─ CLAUDE.md -> AGENTS.md         # Claude Code 仓库指令入口
├─ .agents/skills/                # 按任务划分的仓库技能
├─ .claude/skills -> ../.agents/skills   # Claude Code 技能入口
├─ .github/ .gitee/ .gitcode/     # 三平台 Issue / PR 模板，GitHub 另有 CI 与发版工作流
├─ client/                         # 打印客户端（Rust + Tauri 2 的 Cargo 工作区，另有窗口界面的 pnpm 项目）
│  ├─ core/                        # xihan-print-client-core：平台无关的协议、服务、来源授权、任务队列、纸张核对、更新与诊断
│  ├─ platform/                    # xihan-print-client-platform：Windows 是 WebView2 + winspool，macOS 是 WKWebView，Linux 是 WebKitGTK，后两者经 CUPS 下发
│  ├─ app/                         # xihan-print-client：Tauri 2 桌面程序（库 + 程序 XiHanPrint），tauri.conf.json、权限与图标
│  ├─ ui/                          # 主窗口、授权窗口、新版提示的界面（Vite + TypeScript + @xihan-ui 正式包）
│  ├─ scripts/                     # 改名收集 macOS / Linux 安装包、生成 update.json
│  └─ installer/                   # Windows 的 Inno Setup 安装脚本与打包脚本 build.ps1
├─ docs/                            # 产品文档站（VitePress，独立的 pnpm 项目）
└─ print/                           # pnpm monorepo 根
   ├─ .changeset/                 # changesets 配置与待发布的变更集
   ├─ scripts/release/            # 发版脚本：VersionUpgrade、锁步与标签核对、产物契约、预发布版跟上 latest、冒烟（smoke/ 是冒烟用的宿主项目模板）
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
- `docs/reference/` 由 `scripts/gen-reference.mjs` 从源码生成（元素原型、`printZhCN`、TypeScript 源码注释、客户端错误码在 `client/core/src/protocol/codes.rs` 里的文档注释），不手改。改了元素、属性、问题码、公开 API 或这些注释，在 `docs/` 跑 `pnpm gen` 并随改动一起提交；参考页的说明不对，就改源码注释。
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
- 运行时依赖只允许 `@xihan-print/*` 与 `@xihan-ui/*`；引入任何其他依赖之前先征得维护者同意。`@xihan-ui/*` 写成 peerDependencies（范围与 `print/pnpm-workspace.yaml` 的 catalog 相同，由宿主装唯一的一份），开发时另写 devDependencies（`catalog:`），升级 UI 时两处一起改。

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

设计依据是总会话共享笔记里的 `print-client-draft.md`（用户已批准）：只监听 127.0.0.1 的 WebSocket，子协议 `xihan-print.v1`，端口 17620–17623；按来源授权；渲染页只渲染、不跑页面脚本、不联网。客户端用 Rust + Tauri 2 写，Windows、macOS、Linux 三个平台：Windows 用 WebView2 渲染、winspool 下发；macOS 用 WKWebView、Linux 用 WebKitGTK 把输出页渲染成 PDF，再经 CUPS 下发。

| 任务 | 命令（在 `client/`） |
| --- | --- |
| 窗口界面 | `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm build`（产物 `ui/dist` 由 Tauri 打进程序） |
| 构建 | `cargo build --workspace --locked` |
| 检查 | `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --locked -- -D warnings` |
| 测试 | `cargo test --workspace --locked`（Linux 上套 `xvfb-run -a dbus-run-session --`） |
| 开发运行 | `pnpm tauri dev` |
| Windows 安装包 | `pwsh installer/build.ps1`（构建界面、按 x64 与 arm64 编译 `XiHanPrint.exe`，再用 Inno Setup 编译；`-PublishOnly` 只编译程序，`-SkipWebView2` 不打 WebView2 安装程序、只用于本机试装；在 PowerShell 里给 `-WebView2FixedRuntime @{ x64 = '<cab 或目录>'; arm64 = '…' }` 时另出离线安装包） |
| macOS / Linux 安装包 | `pnpm tauri build --target <三元组> --bundles app,dmg`（Linux 为 `deb,rpm,appimage`），再 `node scripts/collect-bundles.mjs --target <三元组> --out bundles` 按发布的写法改名 |

- Rust 工具链用 stable，最低版本是 `client/Cargo.toml` 的 `rust-version`；依赖版本集中在工作区的 `[workspace.dependencies]`。Windows 上编译要装 Visual Studio 的「使用 C++ 的桌面开发」（MSVC 与 Windows SDK）；Linux 上要装 WebKitGTK 4.1、GTK 3 与 libcups 的开发包（见 `client.yml`）。
- 运行时依赖只取 Tauri 2 已带进来的（tokio、serde、windows、webview2-com、objc2、gtk、webkit2gtk 等）与 `[workspace.dependencies]` 里列出的几项；新增任何运行时依赖前先征得维护者同意，能自写的就自写。CUPS 运行时经 dlopen 加载，不在链接期依赖 libcups。
- 分层：`core` 不引用任何平台 API，各平台的渲染、打印、目录、开机自启与签名校验放在 `platform`，经 `core` 的接口接入；`app` 只做组装、窗口、托盘图标与命令。`app` 同时是库：开源版程序 `XiHanPrint` 调 `run(Extensions::default())`，收费版在私有仓库依赖这几个库，在 `Extensions` 登记扩展（额外的监听与握手放行、自定义消息类型、任务观察者、打印完成跟踪、主窗口扩展页、Tauri 插件、启动钩子、诊断段）后调同一个 `run`。扩展点本身开源，改它的形状要同步告知收费版。
- 代码风格：每个 `.rs` 文件头两行 `//` 版权注释；公开与 `pub(crate)` 的项写中文 `///` 文档注释（工作区 lints 里 `missing_docs` 开着）；注释只写代码做什么；`unsafe` 块写 `SAFETY` 注释。`cargo fmt` 用 `client/rustfmt.toml`。
- 窗口界面只用 `@xihan-ui` 的正式包（元素按需注册、样式只用设计令牌），不另写一套组件；界面文案用中文。
- 原始通道与打印的集成测试要一台写文件的测试打印机，经环境变量 `XIHAN_PRINT_TEST_PRINTER`、`XIHAN_PRINT_TEST_OUTPUT` 告知；没配置时跳过。Windows 是端口指向文件的「Generic / Text Only」打印机，HTML 通道与原始指令共用；Linux 的 HTML 通道是 CUPS 里 `file:` 设备的通用 PostScript 打印机，原始指令另用一台指向本机端口的原始打印机，经 `XIHAN_PRINT_TEST_RAW_PRINTER`、`XIHAN_PRINT_TEST_RAW_LISTEN` 告知，由测试自己在端口上收。CI 里由 `client.yml` 自动装，本机要跑时照那一步装。
- 本机编译 Windows 安装包用按当前用户装的 Inno Setup（官方安装包），`build.ps1` 会在 Inno Setup 的常见安装目录和 PATH 里找 `ISCC.exe`；它只用于编译与试装，不进运行时依赖，也不进仓库。CI 自己装 Inno Setup，不依赖哪台机器。安装包按系统界面语言选简体中文或英文，不弹语言选择框；简体中文是自己写的 `installer/zh-CN.isl`，叠在 `compiler:Default.isl` 之上，只覆写这个安装包在安装、升级、卸载与出错时会出现的消息，其余沿用英文。给安装包加页面或提示时，在 `zh-CN.isl` 与 `[CustomMessages]` 的 `en.`、`zh.` 两份里一起补。Windows 安装包的 AppId 与 1.0（.NET 版）相同，装新版即原地升级，并删掉旧版留下的运行库。
- Windows 安装包按当前用户装到 `%LocalAppData%\Programs\XiHanFun\PrintClient`，不要管理员权限；打进 WebView2 Evergreen 引导程序（内网可用 `-WebView2Installer` 换成 Evergreen 独立安装程序）；离线安装包 `XiHanPrint-<版本>-<arch>-offline-setup.exe` 另把 WebView2 固定版运行时装进 `{app}\WebView2\`，不联网，运行时的版本与下载地址钉在 `installer/webview2-fixed.json`，客户端启动时发现它就设 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`。macOS 出 `.dmg`，Linux 出 `.deb`、`.rpm` 与 `.AppImage`，由 Tauri 打包。分支 CI 出未签名的安装包；推 `v<版本>` 标签时 `release.yml` 调 `client-release.yml` 编译三个平台的安装包（Windows 有仓库密钥 `CLIENT_SIGNING_CERT`、`CLIENT_SIGNING_PASSWORD` 时签名）并建这个标签的草稿 Release，`update.json` 由 `scripts/update-manifest.mjs` 生成（Windows 的在线安装包排在最前，1.0 及以前的客户端只按架构取第一项；离线安装包的条目带 `"variant": "offline"`、排在所有在线条目之后，离线安装的客户端只取它们）。发布草稿后把附件里的 `update.json` 提交到 main 的 `client/update.json`，客户端的自动更新才看得到新版。
- 自动更新只在 Windows 上自动安装，且只安装 `app/src/updates.rs` 里 `UPDATE_PUBLISHER` 这个发布者签名的安装包，为空时只提示新版、不自动安装；macOS 与 Linux 发现新版只提示，用浏览器打开安装包地址。
- 客户端与 `@xihan-print/*` 版本相同、每版同发：`client/Cargo.toml` 里 `[workspace.package]` 的 `version`（连同 `Cargo.lock` 里三个 crate 的版本）由 VersionUpgrade 写成三个包的版本，不手改；日常门禁不核对，发版时 `release.yml` 的「核对标签」核标签号、三个包与客户端三方一致（`check-release-tag.mjs`）。SDK 与客户端的兼容照旧靠子协议 `xihan-print.v1`，客户端不支持时 SDK 报 `PROTOCOL_UNSUPPORTED`。程序与安装包的文件版本取它去掉预发布后缀的数字部分（如 `1.0.0-rc.1` 得 `1.0.0.0`），安装包文件名与界面上显示完整的版本号。
- 改 `client/` 的提交前跑界面的 `pnpm typecheck`、`pnpm build`，Rust 的 fmt、clippy、构建与测试，再在仓库根跑 `git diff --check`。

## 发版

做法照 XiHan.UI：changesets 记变更，发布分支上的 `v<版本>` 标签触发 `.github/workflows/release.yml` 发 npm，同时出这一版打印客户端的安装包。说明见 `print/.changeset/README.md`。

- 发布分支：预览版（带 `-rc.N` 这类预发布后缀的版本）从 `preview` 发，正式版从 `main` 发，都由 `dev` 快进，只接收发版。预览版沿用已发过的 `rc` 通道：按 semver `preview` 排在 `rc` 之前，换名字版本号会倒退。
- `deploy-docs.yml` 只认 main 上的版本：预览版发布时跳过部署文档站，不算失败。
- 三个公开包经 changesets 的 `fixed` 组锁步同版，`scripts/release/check-version-lock.mjs` 核对；打印客户端与它们同号，每版同发。
- 使用者能感知的改动附一份变更集（`pnpm changeset`），中文、官方口径；CI、测试、文档站、脚本、README 不写。
- 定版本用 `print/scripts/release/VersionUpgrade.bat`（或 `pwsh scripts/release/VersionUpgrade.ps1`）：消费变更集、写各包 CHANGELOG，把打印客户端的版本写成同一个号，可进出预发布通道；不提交、不打标签、不推送，`-DryRun` 只打印计划。同一笔在文档站「更新日志」页（`docs/changelog.md`）补这一版的一节（客户端的改动并进同一节），导航上的版本号取 core 的版本，不用改。
- 发一个版本的步骤：
  1. 在 `print/` 跑 VersionUpgrade，选发布通道与升级级别；看一遍三个包的 `package.json`、`CHANGELOG.md`、`.changeset/` 与 `client/Cargo.toml`、`client/Cargo.lock` 的改动。
  2. 在 `docs/changelog.md` 补这一版的一节，日期写计划发布的那天；发布推迟了另起一笔改日期。
  3. `print/` 跑 `pnpm lint`、`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm gate:publish`、`pnpm smoke --pack`，`docs/` 跑文档站门禁，再跑 `git diff --check`；全过再提交 `build: v<版本>`。
  4. 推 dev，等 dev 上的 CI 全绿。
  5. 发布分支从 dev 快进（预览版 `git fetch . dev:preview`，正式版 `git fetch . dev:main`，不是快进就停下查），推发布分支，等上面的 CI 全绿。
  6. 在版本提交上打 `v<版本>` 标签并推送，Release 发包、冒烟、部署文档站，同时出打印客户端的草稿 Release；发完用 `npm view @xihan-print/designer dist-tags` 核对（正式版发出前 `rc` 与 `latest` 都指这一版）。
  7. 发布这个标签的草稿 Release。正式版再把附件里的 `update.json` 提交到 main 的 `client/update.json`，然后把 main 合回 dev；预览版不动这份清单，已装的客户端不会自动升到预览版。
- release.yml 先核对标签（带预发布后缀的在 preview 的历史里，不带的在 main 的历史里；标签号等于三个包与客户端的版本、且与 `.changeset/pre.json` 一致，`check-release-tag.mjs`），之后分两条线：一条构建、`gate:publish`、`changeset publish`（带 provenance），接着 `scripts/release/promote-latest.mjs`：预发布模式、且 npm 上这个包还没有任何正式版时，等 npm 取得到这一版再把 `latest` 也指过来（正式版发出前每个候选版都让 `latest` 跟着走，有了正式版后自动不做，本地可 `--dry-run`），然后 `scripts/release/smoke.mjs --version` 冒烟，最后调 `deploy-docs.yml` 部署文档站；另一条调 `client-release.yml` 编译三个平台的客户端（Windows 签名）并建草稿 Release，只依赖核对标签。一条失败时用「重跑失败的 job」（`gh run rerun <run-id> --failed`）单独重跑那一条，客户端那条重跑不会重发 npm，草稿已在就只覆盖附件。deploy-docs 只部署已经发布的版本：当前版本有标签、main 上的包与标签一致、这个版本已在 npm 上。
- 每个 `v<版本>` 标签有一个同名的 GitHub Release：由 client-release.yml 建成草稿，说明取 `docs/changelog.md` 这一版的一节（`scripts/release/release-notes.mjs`），附件是这一版打印客户端三个平台的安装包、SHA-256 与 `update.json`，预发布版标成 Pre-release。这一节缺了，「核对标签」就拦下，不会发包。
- main 只接收发版；两次发版之间挑进 main 的纯文档修正与客户端的 `client/update.json`，进了 main 以后立刻把 main 合回 dev。
- 合并 main 或 preview、打标签、发布都只在用户明确要求时执行。

## 分支与 worktree

- 主检出上的日常改动直接提交到 `dev`；`main` 与 `preview` 只接收发版。
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
