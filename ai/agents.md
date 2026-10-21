来源：https://print.docs.xihanfun.com/ai/agents

# For Agents

给 Claude Code、Cursor、Codex、GitHub Copilot 这类 AI 编程工具的入口：在项目里用打印设计器时，怎样让 AI 写对接法；参与打印仓库开发时，AI 该读什么。

打印设计器没有单独的命令行或 MCP 服务端，AI 工具要的资料在两处：本站构建时产出的[机读文档](./llms)，以及仓库根的 `AGENTS.md`。打印用到的 XiHan.UI 另有自己的 [AI 辅助开发](https://ui.docs.xihanfun.com/ai/agents)资料。

## 复制这段提示词

把下面这段放进对话，或写进项目的 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules`：

```text
这个项目用曦寒打印设计器（@xihan-print/*）设计打印模板、按数据预览与打印。
写代码前先读 https://print.docs.xihanfun.com/llms.txt，按需读取其中列出的页面（站点地址后加 .md 取 Markdown）。
元素、属性、事件、模板结构与问题码以文档和项目里装的版本为准，不要凭记忆写，也不要套用别的打印组件的 API。
用到 XiHan.UI 的组件、设计令牌或语言包时，再读 https://ui.docs.xihanfun.com/llms.txt。
```

## 要装的包

| 用途 | 安装 | 注册 | 引入的样式 |
| --- | --- | --- | --- |
| 业务页面预览与打印 | `pnpm add @xihan-print/core @xihan-print/runtime @xihan-ui/styles` | `definePrintPreview()` | `@xihan-ui/styles/index.css`、`@xihan-print/runtime/style.css` |
| 设计模板 | `pnpm add @xihan-print/designer @xihan-print/runtime @xihan-ui/styles @xihan-ui/designer-shell` | `definePrintDesigner()` | 上面两份，再加 `@xihan-ui/designer-shell/style.css`、`@xihan-print/designer/style.css` |
| 界面语言 | 另装 `@xihan-ui/web-components` | 见下文「关键约定」 | — |

`@xihan-print/core` 用来在代码里写模板；模板直接写成 JSON 或从接口取回时，业务页面只要 `@xihan-print/runtime`。`@xihan-ui/*` 是打印各包的 peer 依赖，由项目装唯一的一份，与项目自己用的 XiHan.UI 同一个版本，页面上不会出现两份 UI。

## 关键约定

把这几条一并告诉 AI，常见的错写多出在这里：

- **先注册再用**：元素不在 import 时注册，应用启动时调用一次 `definePrintPreview()` 或 `definePrintDesigner()`，重复调用不报错。
- **对象走属性**：模板、数据、字段树这类对象交给元素的属性（如 `schema`、`data`、`fields`），不写成 attribute。Vue 里用 `.prop` 修饰，并把 `xh-` 开头的标签声明为自定义元素，见[在前端框架里使用](../guide/host#在前端框架里使用)。
- **模板是纯 JSON**：不含函数与脚本；坐标、宽高与边距的单位是 mm，原点在纸张左上角，字号用 pt。保存前用 `validateDocument` 或设计器的 `validate()` 校验，有错误级问题的模板不能分页，问题码见[问题码与诊断](../reference/issues)。
- **宿主管保存与取数**：组件不发网络请求。设计器每次修改派发 `schema-change`，保存命令派发 `save`，宿主存好后调用 `markSaved()`；数据、存储与权限都由宿主给，见[与宿主集成](../guide/host)。
- **扩展走 `extensions`**：元素种类、属性编辑器、校验规则、命令、面板与菜单都经 `extensions` 登记，不改包内源码，见[设计器的扩展](../guide/designer#扩展)。
- **语言包合并后全局设置**：界面文字缺省是英文。语言包的名字是 `print` 加 XiHan.UI 语言包的名字（`zhCN` 对 `printZhCN`），与 UI 同一语言的那份合并：`setXhConfig(mergeXhConfig(zhCN, printZhCN))`，见[快速开始](../quickstart)。

## 参与打印仓库开发

仓库根的 `AGENTS.md` 是写给 AI 的仓库规范：

| 内容 | 说明 |
| --- | --- |
| 仓库概览与目录结构 | `print/` 是三个包的工作区，`docs/` 是本站，`client/` 是打印客户端 |
| 常用命令 | 构建、类型检查、单测、Lint、产物契约与冒烟，以及文档站与客户端的命令 |
| 分层与依赖 | `designer → runtime → core`，core 不碰 DOM，运行时依赖只允许 `@xihan-print/*` 与 `@xihan-ui/*` |
| 硬性约定 | 模板即数据、无全局状态、数据由使用方提供、对外契约、语言包、样式、注释 |
| 文档站、打印客户端、发版、Git 与提交 | 各自的做法与禁止事项 |

`CLAUDE.md` 是指向 `AGENTS.md` 的链接，Claude Code 打开仓库即读到；Codex 直接读 `AGENTS.md`；Cursor、GitHub Copilot 等工具在各自的规则文件里写一句「先读仓库根的 AGENTS.md」即可。

## 相关

- [LLMs.txt](./llms) · [快速开始](../quickstart) · [与宿主集成](../guide/host)
- [XiHan.UI 的 AI 辅助开发](https://ui.docs.xihanfun.com/ai/agents)
