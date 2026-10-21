---
name: xihan-print-create-pr
description: 为 XiHan.PrintDesigner 准备、审查或创建 Pull Request 时使用。适用于写 PR 标题与正文、比较当前分支和基线、填仓库的 PR 模板或执行 gh pr create；普通代码审查不使用。
---

# XiHan.PrintDesigner 创建 PR

## 前置检查

- 读 `git status --short --branch`；有 rebase、merge、未解决冲突或 detached HEAD 时不创建 PR。
- 分支按 `AGENTS.md`「分支与 worktree」分组：`feat/<名>`、`fix/<名>`、`issue/<编号>`、`pr/<编号>-review`。还是 `claude/<名>`、`codex/<名>` 这类工具前缀时，推送前先改名；分支是 `issue/<编号>` 时在「关联 Issue」填这个编号。
- base 通常是 `dev`；`main` 只接收发版，没有依据不改成 `main`。
- 用 `git log <base>..HEAD`、`git diff --stat <base>...HEAD` 和完整 diff 概括整条分支，不只看最后一笔。
- 核对改动与门禁、文档是否对得上：改了 `print/` 要有单测；改了公开面要在 `docs/` 跑过 `pnpm gen`、参考页随改动提交；使用者能感知的改动要有 `print/.changeset/` 变更集；新文案键十种语言都补了。

## PR 内容

照 `.github/PULL_REQUEST_TEMPLATE.md` 的结构写：关联 Issue、变更类型、变更说明、影响范围、自测清单、破坏性变更、补充说明 / 截图。Gitee 与 GitCode 镜像各有一份同结构的模板（`.gitee/`、`.gitcode/`）。

- 标题用 Conventional Commit 的写法，概括使用者能感知的影响。
- 影响范围写包（core / runtime / designer）、元素、客户端或文档站，不堆文件名。
- 只勾实际跑过的检查；没跑或失败的写明原因。
- 破坏性变更写清旧写法与新写法；模板结构的变化写明存量模板怎么办。

只要草稿时只输出标题与正文，不写远端。明确要求创建 PR 时，确认分支已推送再用 `gh pr create`；可以推送当前分支，但不强推、不合并、不改别的远端状态。创建后给出 PR 链接。
