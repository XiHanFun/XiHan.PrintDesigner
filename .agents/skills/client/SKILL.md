---
name: xihan-print-client
description: 开发、修复或测试 XiHan.PrintDesigner 的本地打印客户端（client/，Rust + Tauri 2 的三平台托盘程序）时使用：协议 xihan-print.v1、来源授权、静默打印与原始指令、WebView2 / WebKit 渲染、winspool / CUPS 下发、更新检查、安装包、收费版扩展点。适用于“打印客户端”“静默打印”“连不上客户端”“安装包”“协议”“Tauri”；浏览器侧的 SDK 改动同时读 designer-development。
---

# XiHan.PrintDesigner 打印客户端

命令都在 `client/` 下跑。

| 任务 | 命令 |
| --- | --- |
| 窗口界面 | `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm build` |
| 检查 | `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --locked -- -D warnings` |
| 测试 | `cargo test --workspace --locked`（Linux 上套 `xvfb-run -a dbus-run-session --`） |
| 开发运行 | `pnpm tauri dev` |
| Windows 安装包 | `pwsh installer/build.ps1`（缺省 x64 与 arm64；`-Arch x64` 只打一种，`-PublishOnly` 只编译程序，`-SkipWebView2` 不打 WebView2 安装程序、只用于本机试装；`-WebView2FixedRuntime @{ x64 = '<cab 或目录>'; arm64 = '…' }` 另出打进固定版运行时的离线安装包，只能在 PowerShell 里传） |
| macOS / Linux 安装包 | `pnpm tauri build --target <三元组> --bundles app,dmg`（Linux 为 `deb,rpm,appimage`），再 `node scripts/collect-bundles.mjs --target <三元组> --out bundles` |

## 结构

| 位置 | 放什么 |
| --- | --- |
| `core/`（xihan-print-client-core） | 平台无关：协议读写（`protocol/`，错误码与提醒码在 `codes.rs`）、回环 WebSocket 服务与会话（`server/`，帧与握手自写）、来源授权（`consent/`）、任务队列与纸张核对（`printing/`）、更新清单与检查（`updates/`）、诊断、日志、设置；不引用任何平台 API |
| `platform/`（xihan-print-client-platform） | `windows/`：WebView2 渲染线程、winspool、PrintDlgEx、固定版运行时的查找、Authenticode、注册表自启；`unix/`：CUPS（dlopen）与「渲染成 PDF 再下发」的流水线；`macos/`：WKWebView 渲染与 PDFKit 合并；`linux/`：WebKitGTK 渲染与 PDF 合并 |
| `app/`（xihan-print-client） | Tauri 2 托盘程序：组装（`host.rs`）、托盘、主窗口与授权窗口、命令、更新；同时是库，`Extensions` 是收费版的扩展点 |
| `ui/` | 主窗口、授权窗口、新版提示的界面：Vite + TypeScript + `@xihan-ui` 正式包 |
| `scripts/` | `collect-bundles.mjs` 改名收集 macOS / Linux 安装包；`update-manifest.mjs` 生成 `update.json` |
| `installer/` | Windows 的 Inno Setup 脚本 `XiHanPrint.iss`（在线与离线两种包）、简体中文消息 `zh-CN.isl`、打包脚本 `build.ps1`、钉住的 WebView2 固定版运行时 `webview2-fixed.json` |

## 协议与安全边界

- 只监听 127.0.0.1 的 WebSocket，端口按 17620–17623 依次试（Windows 上独占绑定）；子协议 `xihan-print.v1`（`core/src/defaults.rs`）。主版本对不上时以 4426 关闭，浏览器侧 SDK 报 `PROTOCOL_UNSUPPORTED`。
- 每个网站（来源）第一次连接时问用户一次，记进允许与拒绝名单。
- 渲染页只渲染打印文档：不跑页面脚本、不联网，图片与字体由 SDK 随任务带来。WebView2 直接拦截 `https://print.local/`；WebKit 不能拦 https，渲染前把文档里的 `https://print.local/` 换成自定义协议 `xihan-print://print.local/`。
- 浏览器侧的 SDK 在 `print/packages/runtime/src/client/`。协议、消息或错误码一改，两边同一笔改，并在 `docs/` 跑 `pnpm gen`（客户端错误码的说明取自 `core/src/protocol/codes.rs` 的文档注释，生成进 `docs/reference/client.md`）。SDK 与客户端靠子协议保持兼容；协议升主版本时两边的更新日志都写清楚。

## 约定

- 运行时依赖只取 Tauri 2 已带进来的与 `[workspace.dependencies]` 列出的几项；加任何运行时依赖先问维护者，能自写的就自写。
- 每个 `.rs` 文件头两行 `//` 版权注释；公开与 `pub(crate)` 的项写中文 `///` 文档注释；注释只写做什么；`unsafe` 块写 `SAFETY` 注释。
- 本机 Windows 编译要 Visual Studio 的「使用 C++ 的桌面开发」；没装时只能在 Linux 容器（WebKitGTK 4.1、GTK 3、libcups、xvfb、cups）里编译与测试 core、platform 的 Linux 部分与 app。
- 集成测试要一台写文件的测试打印机，经 `XIHAN_PRINT_TEST_PRINTER`、`XIHAN_PRINT_TEST_OUTPUT` 告知；没配时跳过。CI 里由 `client.yml` 装：Windows 是 Generic / Text Only；Linux 的 HTML 通道是 CUPS `file:` 设备的通用 PostScript 打印机，原始指令另用一台 `socket://127.0.0.1:9101` 的原始打印机（`XIHAN_PRINT_TEST_RAW_PRINTER`、`XIHAN_PRINT_TEST_RAW_LISTEN`，测试自己在端口上收；CUPS 把原始文档发给 `file:` 设备时不写内容）。
- Windows 安装包按当前用户装到 `%LocalAppData%\Programs\XiHanFun\PrintClient`，不要管理员权限，AppId 与 1.0（.NET 版）相同。本机编译用按当前用户装的 Inno Setup。给安装包加页面或提示时，`zh-CN.isl` 与 `[CustomMessages]` 的 `en.`、`zh.` 两份一起补。
- 版本是 `client/Cargo.toml` 里 `[workspace.package]` 的 `version`，与 `@xihan-print/*` 相同、每版同发：由 `print/scripts/release/VersionUpgrade` 一起写（连同 `Cargo.lock`），不手改；发版时 `release.yml` 的「核对标签」核标签号、三个包与客户端一致。
- 自动更新先查 Gitee、再查 GitHub 上的清单；清单的每项带 `os`（缺省 windows）与 `arch`。只在 Windows 上自动安装，且只装 `app/src/updates.rs` 里 `UPDATE_PUBLISHER` 这个发布者签名的安装包，为空时只提示新版；macOS 与 Linux 只提示并打开下载地址。
- 发布跟设计器同一个 `v<版本>` 标签：`release.yml` 核对标签后调 `client-release.yml`（与发 npm 并行），编译三个平台、签名 Windows（有证书密钥时），建这个标签的草稿 Release（说明取 `docs/changelog.md` 这一版的一节），附件是安装包、SHA-256 与 `update.json`；客户端这条失败时 `gh run rerun <run-id> --failed` 只重跑它，不会重发 npm，草稿已在时只覆盖附件、换上最新的说明。维护者发布草稿后，正式版再把附件里的 `update.json` 提交到 main 的 `client/update.json`，然后把 main 合回 dev；预览版不动这份清单。推标签与发布只在用户明确要求时做。
- 收费能力（局域网与 wss、真实回执、标签机原生指令、打印记录与重打）不进本仓库：私有仓库依赖 `core`、`platform`、`app` 三个库，在 `Extensions` 上登记。扩展点的形状一改，要在提交说明里写清楚。

## 门禁

改 `client/` 的提交前跑界面的 `pnpm typecheck`、`pnpm build`，Rust 的 fmt、clippy、构建与测试，再在仓库根跑 `git diff --check`；动了安装脚本时本机用 `build.ps1 -Arch x64 -SkipWebView2` 编一次，核安装包的文件名与版本信息，编出来的文件不入库。
