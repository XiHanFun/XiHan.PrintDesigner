# 打印客户端

浏览器出于安全考虑，打印都要经过打印对话框，网页不能自己选打印机、也不能把原始指令发给小票机或标签机。本地打印客户端补上这一块：它是一个 Windows 托盘程序，业务页面经 `@xihan-print/runtime/client` 连上它，就能不弹对话框直接打到指定的打印机、写原始指令、导出 PDF。浏览器 SDK 的完整接口见[打印客户端 SDK](../reference/client)。

| 能力 | 说明 |
| --- | --- |
| 静默打印 | 打到指定的打印机，可设份数、逐份、单双面、彩色或灰度、页码范围；也可以弹出系统的打印对话框 |
| 原始指令 | 把 ESC/POS、ZPL、TSPL 等指令原样写给打印机 |
| 导出 PDF | 纸张尺寸不同的输出页导出成一份 PDF，每页保持自己的尺寸 |
| 打印机列表 | 名称、是否默认、状态（就绪、暂停、脱机、缺纸、卡纸等），单台打印机可查纸张、双面、彩色与最大份数 |

## 安全模型

- 只监听本机的 `127.0.0.1`，不接受其它电脑的连接。端口缺省为 17620，被占用时依次试 17621 到 17623。
- 按网站授权：每个网站（协议、主机与端口都相同才算同一个）第一次连接时，客户端询问用户一次。只接受 http 与 https 的网站。
- 打印任务在一个不跑页面脚本、不联网的 WebView2 里渲染。文档用到的图片与字体由浏览器取好后随任务带去，渲染时访问任何别的地址都会被拦下。
- 原始指令只能发给装在 Windows 里的打印机，不能直连局域网里的 IP 与端口。

## 安装

安装包在仓库的 [Release 页面](https://github.com/XiHanFun/XiHan.PrintDesigner/releases)发布，x64 与 arm64 各一个，文件名形如 `XiHanPrint-<版本>-x64-setup.exe`。

- 按当前用户安装到 `%LocalAppData%\Programs\XiHanFun\PrintClient`，不需要管理员权限。
- 需要系统的 WebView2 运行时：Windows 11 自带；没有时安装包调起微软的 WebView2 安装程序（要能联网）。
- 安装向导按系统界面语言显示简体中文或英文。附加任务里可以选开机时自动启动；装好后在开始菜单里有「曦寒打印客户端」。
- 装新版本时直接运行新的安装包：旧进程先退出，开机自启的设置与授权过的网站都保留。
- 在 Windows 的「应用」里卸载。卸载时询问是否一起删除设置、来源名单与日志；管理员下发的策略文件不删。

客户端运行后在托盘显示图标，右键菜单里有：

| 菜单 | 作用 |
| --- | --- |
| 首行 | 版本与监听的端口 |
| 设置… | 开机自启、检查新版本、日志级别，允许与拒绝的网站名单（可删除） |
| 诊断信息… | 版本、WebView2 版本、端口、策略、来源名单与最近的任务 |
| 打开日志目录 | 日志在 `%LocalAppData%\XiHanFun\PrintClient\logs`，按天滚动，保留 14 天；只记任务的来源、打印机、页数、耗时与错误，不记文档内容与原始指令 |
| 导出诊断包… | 把诊断信息、日志、设置与策略文件打成 zip，形如令牌的值会打码 |
| 测试打印 | 给选中的打印机打一页自检页 |
| 检查更新… | 立即检查新版本；策略关闭检查更新时不显示 |
| 开机自启 | 开关 |
| 退出 | 退出客户端 |

## 首次授权

网站第一次连接时，客户端在桌面上弹出授权窗口，写明是哪个网站、它将能不弹对话框直接打印：

- **允许**：记进允许名单，以后不再询问。
- **仅这次**：只放行这一次连接。
- **拒绝**：这次不放行；勾上「拒绝时不再询问这个网站」则记进拒绝名单。
- 60 秒内没人处理，当作这次不允许。

页面这边会收到 `consentpending` 事件，可以提示用户去点「允许」；被拒绝或超时时，连接以 `CONSENT_DENIED` 或 `CONSENT_TIMEOUT` 失败。名单在托盘的「设置」里查看和删除。

## 在页面里连接

整个页面创建一个连接即可，创建时不连，第一次用到时才连：

<<< @/examples/snippets/client.ts#connect

最常用的写法是 `printWithFallback`：交给客户端静默打印，等它交给系统的打印队列；只有连不上客户端（没装、没运行，或协议版本不对）时退回浏览器的打印对话框。打印机出错、网站没被允许这类错误照常抛出，不退回，免得用户以为已经静默打出来了：

<<< @/examples/snippets/client.ts#fallback

打印选项：

| 选项 | 说明 |
| --- | --- |
| `printer` | 打印机名称，缺省为默认打印机 |
| `copies`、`collate` | 份数（1 到 999）与是否逐份打印 |
| `duplex` | `simplex` 单面、`long-edge` 长边翻页、`short-edge` 短边翻页 |
| `color` | `color` 彩色、`grayscale` 灰度 |
| `pageRanges` | 页码范围，如 `1-3,5` |
| `dialog` | 为 `true` 时弹出系统的打印对话框，用户选定后再打 |
| `timeoutMs` | 交给打印队列的期限 |

要看任务进度或取消任务时，直接用 `printDocument`，它立即返回一个任务：

<<< @/examples/snippets/client.ts#job

任务状态依次是 `queued`、`started`，最后是 `completed`、`failed` 或 `cancelled`。`completed` 表示已经交给系统的打印队列，不等于纸已经打出来。断线后 SDK 自动重连并认回自己的任务，客户端里的任务不受影响。

预览元素与设计器有一个 `printClient` 属性，给了以后它们的打印也先交给客户端：

<<< @/examples/snippets/client.ts#preview

## 原始指令

`printRaw` 把字节原样写给打印机，适合小票机、标签机这类有自己指令集的打印机。指令由业务方自己拼，客户端不做任何解释：

<<< @/examples/snippets/client.ts#raw

- 打印机要装在 Windows 里，用「Generic / Text Only」或厂商驱动都可以，端口可以是 USB、并口或网络端口。
- 传字符串时按 UTF-8 编码；打印机要 GBK 等编码时，先自己转成字节。

## 导出 PDF

`exportPdf` 在客户端里把模板排成一份 PDF，纸张尺寸不同的输出页各自保持尺寸，结果是一个 Blob：

<<< @/examples/snippets/client.ts#pdf

## 打印是怎么完成的

1. 浏览器里照常分页，把输出页渲染成一份独立的 HTML。
2. 取来输出页用到的图片、背景图与模板字体族的 `@font-face`，地址改写成任务里的资源，随任务一起交给客户端。跨源的图片与字体文件要服务器允许 CORS，取不到时任务以 `RESOURCE_BLOCKED` 失败，不会悄悄少画。资源合计不超过 64 MiB。
3. 客户端在不跑页面脚本、不联网的 WebView2 里载入这份文档，等字体与图片就绪。
4. 按纸张尺寸分组，每组一个打印作业，依次交给系统的打印队列；页码范围按全文页码换算到各组。

几点限制：

- 纸张尺寸不同的模板打多份时，是第一组打完全部份数再打第二组。
- 页面里读不到内容的跨源样式表会按 CORS 再取一次，仍取不到就跳过，里面声明的字体不会随任务带去。
- 浏览器与 WebView2 同为 Chromium，同一台电脑上排出来的折行一致；在 Firefox 里分页、交给客户端打印时，个别元素框里的折行可能不同。

## 企业部署

### 网站要用 HTTPS

Chrome 与 Edge 从 147 版起，公网或局域网里的网页连接本机的 `127.0.0.1` 之前，要先过浏览器自己的「本机应用」权限（`loopback-network`），每个网站询问一次。这个权限只有安全上下文能请求，所以：

- 业务系统要用 HTTPS 提供，`http://localhost` 除外。用 http 提供的局域网系统连不上本机客户端，浏览器也不会弹出询问。
- 连接被浏览器拦下时，SDK 报 `LOCAL_NETWORK_DENIED`，与「没装客户端」的 `CLIENT_UNAVAILABLE` 分开，宿主可以据此提示用户去网站设置里允许，而不是去安装客户端。
- 企业环境可以用 Chrome 的策略 `LocalNetworkAccessAllowedForUrls` 预先放行业务系统的地址，免得每台电脑第一次使用时各弹一次。

页面嵌在 iframe 里时，每一层 iframe 的 `allow` 都要写上 `loopback-network`：

```html
<iframe src="https://erp.example.com/print" allow="loopback-network"></iframe>
```

### 客户端策略

管理员可以在 `%ProgramData%\XiHanFun\PrintClient\policy.json` 放一份策略，优先于用户的设置。文件允许注释与末尾逗号：

```jsonc
{
  // 预先放行的网站，不弹授权窗口
  "allowedOrigins": ["https://erp.example.com"],
  // 为 false 时不认识的网站一律不放行，只认上面的名单与用户允许过的网站
  "promptForUnknownOrigins": false,
  // 固定监听的端口；SDK 的 ports 选项要与它一致
  "ports": [17620],
  "updates": {
    // 是否检查新版本
    "check": true,
    // 自建的更新清单地址，只认 https，按顺序尝试
    "manifestUrls": ["https://intranet.example.com/print-client/update.json"]
  }
}
```

- 不合法的来源、端口与地址记一条警告日志后跳过；整个文件读不出时按没有策略处理，并记错误日志。
- 策略里的网站在设置窗口里标「（策略）」，用户不能删除。托盘的「诊断信息」显示当前生效的策略。

### 批量安装

安装包支持 Inno Setup 的命令行参数，按当前用户静默安装与卸载：

```cmd
XiHanPrint-<版本>-x64-setup.exe /VERYSILENT
"%LocalAppData%\Programs\XiHanFun\PrintClient\unins000.exe" /VERYSILENT
```

`/LANG=en` 强制用英文向导。安装不需要管理员权限，所以要在每个使用打印的 Windows 用户下各装一次。

### 新版本

客户端启动 2 分钟后检查一次新版本，之后每天一次，先查 Gitee、再查 GitHub 上的更新清单；发现新版本时弹出提示，写明版本与发布说明。用户可以在设置里关掉检查，管理员可以用策略关掉，或换成内网的清单地址。
