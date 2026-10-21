---
name: xihan-print-changelog-collect
description: 收集 XiHan.PrintDesigner 两个版本或提交之间使用者能感知的变化、核对变更集，或补文档站「更新日志」页时使用。不升版本、不消费变更集、不发布 npm 包，这些归 version-release。
---

# XiHan.PrintDesigner 更新日志整理

## 事实源

- 用户给的起止标签或提交；没给终点用当前 HEAD，没给起点先提出最近的 `v<版本>` 标签请用户确认。
- `git log <起>..<止>`、实际 diff，以及 `print/.changeset/*.md`。版本提交里已消费的变更集用 `git show <版本提交>^:print/.changeset/<名>.md` 取回；预发布期间用过的变更集还留在目录里，记在 `.changeset/pre.json` 的 `changesets`。
- 三个包各自的 `print/packages/*/CHANGELOG.md`（changesets 生成，不手改）。
- `docs/changelog.md` 现有的写法：开头一段说明；每版一节 `## v<版本>（YYYY-MM-DD）`，一段这一版的主线，再按 **新增 / 修复 / 调整 / 移除** 列条目。

## 收录规则

- 只收三个包的使用者能感知的变化：元素的属性 / 事件 / 方法、模板结构、问题码、扩展点、样式外观、语言包文案、打印与分页结果。
- CI、门禁、测试、文档站、playground、发版脚本与 README 不收。
- 每条写使用者得到什么或要做什么，不写「加了判断」「改了文件」这类实现步骤；元素名、属性、事件、问题码用反引号。
- 同一件事跨 core、runtime、designer 的，合成一条。
- 有破坏性变更时加 `::: warning 升级须知`，只写破坏性变更与必做的动作（旧写法、新写法；存量模板怎么办），完整对照指向各包 CHANGELOG。
- 打印客户端的改动另起「打印客户端」一节，素材是 `client/` 的提交；客户端怎么发版还在定，这一节等第一次发客户端时再建。
- 口径平实，不写开发过程、口语比喻与「首个预览」一类的铺垫，不写组件数、元素数与依赖的版本号。

日期写计划发布的那天。这一节与升版本放在同一笔 `build: v<版本>` 里；只整理、不提交时，把草稿交给用户。
