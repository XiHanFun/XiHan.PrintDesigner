---
name: xihan-print-commit-msg
description: 根据 XiHan.PrintDesigner 当前暂存区写一行提交信息时使用。适用于“提交信息”“commit msg”“msg”或提交前概括 staged changes；只写消息，不负责暂存、跑门禁或执行提交。
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

## 写短

- 只写一行标题，不写正文。
- 说明一句话讲这次改动的结果，不超过 40 个字：汉字、字母、数字、标点各算一个，末尾的 `（ADR-NNNN）` 不计。
- 说明里不再出现「：」「；」，除末尾的 ADR 注外不用括号或破折号补充；不罗列文件、成员、取值与改前改后，不写向量与测试的数量、门禁结果，这些写进 变更集、更新日志或 PR 描述。
- 40 个字写不下时，多半是暂存区混了几件事（先建议拆成几笔），或细节写多了（删到只剩结果），不要加长标题。

示例：

- `fix(client): 主窗口的页签只显示当前一页`
- `fix(client): 修复打开「诊断」页时主窗口卡死`

不加任何署名或工具生成的尾注。只输出那一行标题，不附解释、代码块或候选列表。
