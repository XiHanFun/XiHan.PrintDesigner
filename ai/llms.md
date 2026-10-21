来源：https://print.docs.xihanfun.com/ai/llms

# LLMs.txt

文档站在构建时产出一组给大语言模型读的机读资产，内容与站点正文同源。AI 工具读取它们即可了解打印设计器的模板结构、元素、API 与用法。

## 可用资源

| 文件 | 说明 |
| --- | --- |
| [llms.txt](https://print.docs.xihanfun.com/llms.txt) | 索引：全部页面的标题、一句话摘要与地址，以及下列资产的入口 |
| [llms-full.txt](https://print.docs.xihanfun.com/llms-full.txt) | 全站正文，正文引用的示例代码已内联 |
| [llms-guide.txt](https://print.docs.xihanfun.com/llms-guide.txt) | 指南：模板结构、数据绑定与格式化、富文本、运行时、设计器、打印客户端、与宿主集成 |
| [llms-reference.txt](https://print.docs.xihanfun.com/llms-reference.txt) | 参考：元素、模板类型、问题码与诊断，以及预览与打印、设计器、打印客户端 SDK、模型层 core 的 API |

**单页 Markdown**：任何一页的站点地址后加 `.md` 即可取到这一页的 Markdown，如 [guide/template.md](https://print.docs.xihanfun.com/guide/template.md)、[reference/elements.md](https://print.docs.xihanfun.com/reference/elements.md)。每页正文上方的「取本页 Markdown」也指向它。

`llms-full.txt` 体积较大，多数场景读 `llms.txt` 索引后按需取单页，或只取 `llms-guide.txt`、`llms-reference.txt` 之一。

站点在发版时部署，这些资产对应 npm 上最新发布的版本。打印用到 XiHan.UI 的样式、设计器零件与语言包，UI 的机读资产见 [ui.docs.xihanfun.com/llms.txt](https://ui.docs.xihanfun.com/llms.txt)。

## 在 AI 工具中使用

所有工具都可以用同一段提示词：

```text
阅读 https://print.docs.xihanfun.com/llms.txt 了解曦寒打印设计器，写打印相关的代码时按需读取其中列出的页面（站点地址后加 .md 取 Markdown），以文档为准，不要凭记忆写元素、属性与模板结构；用到 XiHan.UI 时再读 https://ui.docs.xihanfun.com/llms.txt。
```

| 工具 | 做法 |
| --- | --- |
| Claude Code | 写进项目的 `CLAUDE.md`，或用 `/memory` 记下 |
| Cursor | 在对话中用 `@Docs` 添加 `https://print.docs.xihanfun.com/llms.txt`，或写进 `.cursor/rules` |
| Codex | 写进项目的 `AGENTS.md` |
| GitHub Copilot | 写进 `.github/copilot-instructions.md` |
| Windsurf | 写进 `.windsurf/rules` |

## 相关

- [For Agents](./agents)
