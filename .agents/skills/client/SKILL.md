---
name: xihan-print-client
description: 开发、修复或测试 XiHan.PrintDesigner 的本地打印客户端（client/，.NET 10 + WebView2 的 Windows 托盘程序）时使用：协议 xihan-print.v1、来源授权、静默打印与原始指令、更新检查、安装包。适用于“打印客户端”“静默打印”“连不上客户端”“安装包”“协议”；浏览器侧的 SDK 改动同时读 designer-development。
---

# XiHan.PrintDesigner 打印客户端

命令都在 `client/` 下跑，SDK 版本以 `client/global.json` 为准。

| 任务 | 命令 |
| --- | --- |
| 构建 | `dotnet build XiHan.PrintClient.slnx -c Release` |
| 测试 | `dotnet test --solution XiHan.PrintClient.slnx -c Release --no-build` |
| 安装包 | `pwsh installer/build.ps1`（缺省 x64 与 arm64；`-Arch x64` 只打一种，`-PublishOnly` 只发布，`-SkipWebView2` 不打 WebView2 安装程序、只用于本机试装） |

## 结构

| 项目 | 放什么 |
| --- | --- |
| `src/XiHan.PrintClient.Core` | net10.0，平台无关：协议、会话、来源授权、任务队列、更新检查，以及各平台要实现的接口；不引用任何 Windows 专属 API |
| `src/XiHan.PrintClient.Windows` | net10.0-windows：WebView2 渲染、winspool 打印、注册表自启、单实例 |
| `src/XiHan.PrintClient` | WinForms 托盘程序，产物 `XiHanPrint.exe` |
| `tests/` | xUnit v3，走 Microsoft.Testing.Platform（解决方案用 `--solution` 传入） |
| `installer/` | Inno Setup 脚本 `XiHanPrint.iss`、简体中文消息 `zh-CN.isl`、打包脚本 `build.ps1` |

## 协议与安全边界

- 只监听 127.0.0.1 的 WebSocket，端口按 17620–17623 依次试；子协议 `xihan-print.v1`（`ClientDefaults`）。主版本对不上时以 4426 关闭，浏览器侧 SDK 报 `PROTOCOL_UNSUPPORTED`。
- 每个网站（来源）第一次连接时问用户一次，记进允许与拒绝名单。
- WebView2 只渲染打印文档：不跑页面脚本、不联网，图片与字体由 SDK 随任务带来。
- 浏览器侧的 SDK 在 `print/packages/runtime/src/client/`。协议、消息或错误码一改，两边同一笔改，并在 `docs/` 跑 `pnpm gen`（客户端错误码的说明取自 C# 注释，生成进 `docs/reference/client.md`）。SDK 与客户端靠子协议保持兼容；协议升主版本时两边的更新日志都写清楚。

## 约定

- 运行时 NuGet 依赖只有 `Microsoft.Web.WebView2`，版本集中在 `Directory.Packages.props`；加任何运行时依赖先问维护者，能用 .NET 自带库或 Windows API 自写的就自写。
- 代码风格照 XiHan.Framework：文件头两行 `//` 版权注释，文件级命名空间，公开成员写中文 XML 注释（`GenerateDocumentationFile` 与 `TreatWarningsAsErrors` 都开着），注释只写做什么。
- 原始通道的集成测试要一台端口指向文件的「Generic / Text Only」打印机，经 `XIHAN_PRINT_TEST_PRINTER`、`XIHAN_PRINT_TEST_OUTPUT` 告知；没配时跳过。CI 里由 `client.yml` 自动装，本机要跑时以管理员身份照那一步装。
- 安装包按当前用户装到 `%LocalAppData%\Programs\XiHanFun\PrintClient`，不要管理员权限。本机编译用按当前用户装的 Inno Setup 6（`build.ps1` 会在 `%LocalAppData%\Programs\Inno Setup 6` 与 PATH 里找 `ISCC.exe`）。给安装包加页面或提示时，`zh-CN.isl` 与 `[CustomMessages]` 的 `en.`、`zh.` 两份一起补。
- 版本是 `Directory.Build.props` 的 `Version`，与 `@xihan-print/*` 相同、每版同发：由 `print/scripts/release/VersionUpgrade` 一起写，不手改；发版时 `release.yml` 的「核对标签」核标签号、三个包与客户端一致。可以带预发布后缀：程序集与安装包的文件版本取数字部分（`1.0.0-rc.1` 得 `1.0.0.0`），安装包文件名、界面与更新比较用完整的号。
- 自动更新先查 Gitee、再查 GitHub 上的清单，只安装 `XiHanUpdatePublisher` 这个发布者签名的安装包，为空时只提示新版。
- 发布跟设计器同一个 `v<版本>` 标签：`release.yml` 核对标签后调 `client-release.yml`（与发 npm 并行），编译、测试、签名（有证书密钥时），建这个标签的草稿 Release，附件是两个架构的安装包、SHA-256 与 `update.json`；客户端这条失败时 `gh run rerun <run-id> --failed` 只重跑它，不会重发 npm，草稿已在时只覆盖附件。维护者发布草稿后把附件里的 `update.json` 提交到 main 的 `client/update.json`，再把 main 合回 dev。完整步骤见 version-release；推标签与发布只在用户明确要求时做。

## 门禁

改 `client/` 的提交前跑构建与测试，再在仓库根跑 `git diff --check`；动了安装脚本时本机用 `build.ps1 -Arch x64 -SkipWebView2` 编一次，核安装包的文件名与版本信息，编出来的文件不入库。
