---
name: xihan-print-commit-msg
description: 根据 XiHan.PrintDesigner 当前暂存区写提交信息时使用。适用于“提交信息”“commit msg”“msg”或提交前概括 staged changes；只写消息，不负责暂存、跑门禁或执行提交。
---

# XiHan.PrintDesigner 提交信息

## 工作流

1. 运行 `git status --short --branch`；有未解决冲突或进行中的 merge/rebase 时停下说明，不写假定已完成的消息。
2. 只读 `git diff --cached --stat`、`git diff --cached` 和最近 20 条提交；未暂存的改动不算，除非用户明确要求。
3. 暂存区为空时直接说明，不根据工作区或聊天内容猜。
4. 暂存区里混着几件不相干的事时，先指出来，建议拆成几笔（一项完整功能一个提交）。

## 格式

标题一行：`<type>(<scope>): <中文说明>`。

- type：`feat`、`fix`、`refactor`、`perf`、`docs`、`style`、`test`、`build`、`ci`、`chore`、`revert`。
- scope 取 `core`、`runtime`、`designer`、`client`、`docs`、`repo`，跨几层时并列写，如 `feat(designer,runtime,docs)`；只改文档站的写 `docs(docs)`；版本提交固定写 `build: v<版本>`。
- 删除或改名公开 API、元素的属性 / 事件 / 方法、模板结构、问题码、语言包键，或改变默认行为时，在冒号前加 `!`。

用户要完整提交说明时，标题下空一行写正文：改了什么、为什么这样改（代码注释只写做什么，设计理由写在这里）、怎么核对过的（跑了哪些门禁、反向验证）。不加任何署名或工具生成的尾注。

只要标题时，只输出那一行，不附解释、代码块或候选列表。
