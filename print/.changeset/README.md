# Changesets · 发布流程

版本与发布由 [changesets](https://github.com/changesets/changesets) 驱动。三个公开包 `@xihan-print/core`、`@xihan-print/runtime`、`@xihan-print/designer` 经 `fixed` 组**锁步同版**，总是同一个版本号一起发；playground 是私有包，不发布、不计版。

## 写变更集

改了使用者能感知的东西的那一笔，附一份变更集：

```bash
pnpm changeset
```

- **要写**：公开 API、元素的属性 / 事件 / 方法 / 部件、模板结构、扩展点、样式外观、语言包文案、问题码的变化。
- **不写**：CI、门禁、测试、文档站、playground、构建与发版脚本、README。判据是消费这三个包的人能不能感知到。
- **头部**：列受影响的包与级别。锁步组里列一个包也会带着三个一起升，按实际影响列。级别：公开面被删除或改名、旧模板读不进来为 `major`；新增能力、模板结构升版本但带自动迁移为 `minor`；修复与不改公开面的修正为 `patch`。
- **正文**：中文，官方口径，写「改了什么、影响谁、要做什么」，开头标 **新增 / 修复 / 调整 / 移除**；破坏性变更写清旧写法与新写法。正文原样进各包的 CHANGELOG。

首发版的内容由 `first-release.md` 概括；之后每笔使用者能感知的改动都附一份变更集。预发布期间用过的变更集记进 `pre.json`、文件留着，转正式版时一并消费并删掉。

## 职责划分

| 动作 | 由谁做 |
| --- | --- |
| 写变更集；`VersionUpgrade` 定版本、生成各包 CHANGELOG | 人，在本地 |
| 文档站「更新日志」页（`docs/changelog.md`） | 人，与升版本同一笔 |
| 合并 main、打标签 | 人，手工 |
| 发到 npm、发布后冒烟、部署文档站；出打印客户端的安装包与草稿 Release | `.github/workflows/release.yml`（客户端那条调 `client-release.yml`） |
| 发布客户端的草稿 Release，把 `update.json` 提交到 main 再合回 dev | 人，手工 |

changesets 自己打标签的行为已用 `--no-git-tag` 关掉；一次发版对应一个自己打的 `v<版本>` 标签。打印客户端与三个包版本相同、每版同发：`VersionUpgrade` 把 `client/Directory.Build.props` 的 `Version` 写成同一个号，发版时 `check-release-tag.mjs` 核三方一致，兼容照旧靠子协议 `xihan-print.v1`。npm 包不另建 GitHub Release；每个 `v<版本>` 标签的 Release 放这一版客户端的安装包与 `update.json`。

## 发一个版本

在 `print/` 目录：

```bash
# 1) 定版本：按变更集推导或指定级别，选发布通道（正式 / rc 等），消费变更集、写各包 CHANGELOG
scripts/release/VersionUpgrade.bat          # Windows；其它平台用 pwsh scripts/release/VersionUpgrade.ps1

# 2) 在文档站 docs/changelog.md 补这一版的一节，跑门禁，提交
git commit -m "build: v1.0.0"
```

提交合进 `main` 后，在那个提交上打标签并推送：

```bash
git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0
```

标签推上去后 Release 工作流先把关两条：标签指向的提交在 `main` 的历史里；标签号等于三个包与打印客户端的版本，且与预发布模式对得上（`scripts/release/check-release-tag.mjs`）。缺一拒发。过了分两条线：一条构建、核对产物（`pnpm gate:publish`）、把 npm 上还没有的版本发出去，然后在空项目里装刚发的版本做冒烟（`scripts/release/smoke.mjs`），最后部署文档站；另一条编译、签名打印客户端，建这个标签的草稿 Release。哪条失败就用 `gh run rerun <run-id> --failed` 重跑那一条。

预发布：`VersionUpgrade` 选 rc 等通道时执行 `changeset pre enter <通道>`，版本号带 `-rc.N` 后缀，npm 上打 `rc` 等 dist-tag，不占 `latest`（从没发过正式版的包除外，首发会同时挂上 `latest`）；转正式版时选「正式版」，脚本执行 `changeset pre exit`。

`VersionUpgrade` 不提交、不打标签、不推送；`-DryRun` 只打印这一次会做什么，不改任何文件。
