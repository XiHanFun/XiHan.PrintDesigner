---
name: xihan-print-version-release
description: 为 XiHan.PrintDesigner 定版本、消费变更集、进出 rc 预发布、打 v<版本> 标签、发 npm 包或核对发布结果时使用；打印客户端的版本号随设计器一起写。推送、打标签与发布只在用户明确要求时做。
---

# XiHan.PrintDesigner 版本发布

## 事实

- 三个公开包 `@xihan-print/core`、`runtime`、`designer` 是 changesets 的 `fixed` 组，锁步同版，`print/scripts/release/check-version-lock.mjs` 核对。版本真源是 `print/packages/core/package.json`。
- 有 `print/.changeset/pre.json` 就是预发布模式（如 `rc`），npm dist-tag 跟着它走，不在里面就是正式模式。
- 版本提交是 `build: v<版本>`；标签是 `v<版本>`，只认 main 历史里的提交，标签号必须等于包版本、且与预发布模式一致（`check-release-tag.mjs`）。
- 打印客户端（`client/Directory.Build.props` 的 `Version`）在设计器升版时由 VersionUpgrade 一起写成同一个号，不另加检查，兼容靠子协议 `xihan-print.v1`。

## 定版本（本地，不提交、不推送）

1. 工作区干净、在 `dev`、没有进行中的 merge/rebase。
2. 在 `print/` 跑 `scripts/release/VersionUpgrade.bat`（或 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/VersionUpgrade.ps1`）。参数：`-Channel keep|alpha|beta|rc|release`、`-Level derived|major|minor|patch`（强制级别要给 `-Reason`）、`-Yes`、`-DryRun`。不替用户预选通道与级别。
3. 预发布里再出一版：加变更集，`-Channel keep -Level derived`，序号自动加一（rc.1 → rc.2）。转正式版：`-Channel release`，执行 `changeset pre exit`，预发布期间用过的变更集此时才被消费、删掉。
4. 进预发布时序号缺省从 0 起。要从别的号起（首发定的是 `1.0.0-rc.1`）：先 `pnpm exec changeset pre enter rc`，再把三个包的 `version` 临时写成 `<目标正式号>-rc.<N-1>`，然后 `-Channel keep -Level derived`。changesets 的序号按包的当前版本推：没有预发布后缀时出 0，是 `-rc.k` 时出 k+1。跑完核对三个包的版本、`pre.json` 的 `initialVersions` 仍是原来的号，以及 `RELEASE_TAG=v<版本> node scripts/release/check-release-tag.mjs` 通过。先在 `git worktree add --detach` 的临时副本里试（副本里自己装依赖，不要把 node_modules junction 到主检出）。
5. 看一遍三个包的 `package.json` 与 `CHANGELOG.md`、`.changeset/`、`client/Directory.Build.props`；在 `docs/changelog.md` 补这一版的一节（见 changelog-collect）。
6. 门禁：`print/` 的 `pnpm lint`、`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm gate:publish`、`pnpm smoke --pack`；`docs/` 的 `pnpm gate:gen`、`pnpm check:examples`、`pnpm lint`、`pnpm typecheck`、`pnpm build`；`git diff --check`。退出码全 0 再提交 `build: v<版本>`。

## 发布（用户明确要求时）

1. 推 dev，等 dev 上 CI 两个 job（Lint、构建、类型与测试；文档站）全绿。
2. `git fetch . dev:main` 快进 main（不是快进就停下查），推 main，等 main 上 CI 全绿。
3. 在版本提交上打附注标签 `git tag -a v<版本> -m "v<版本>"`，只推这个标签。Release 依次：核对标签 → 发到 npm（`changeset publish`，凭组织级密钥 `NPM_TOKEN`）→ 发布后冒烟（空项目里装刚发的版本）→ 部署文档站（只部署已经发布的版本）。
4. 发完核对：`npm view @xihan-print/core dist-tags`（runtime、designer 同样），三个包都在、`rc` 或 `latest` 指向这一版。

## 出错时

- 不删标签、不移动标签、不重复发已有的版本；用 `gh run rerun <run-id> --failed` 重跑失败的 job（`changeset publish` 只发 npm 上还没有的版本）。只看工作流摘要与失败步骤的报错行。
- 发 npm 报 `ERR_PNPM_OTP_NON_INTERACTIVE`、401/403/404：是令牌或权限问题，停下把原文交给用户，不自己改工作流绕过。
- 冒烟报「npm 上找不到 …」：全新的包在 npm 上查得到比冒烟等的两分钟慢，过几分钟重跑失败的 job。
- 从没发过正式版的包，预发布首发也会被挂上 `latest`，这是 changesets 的行为，照实报告，不自己改 dist-tag；npm 给新包自动建的 `0.0.0-stage` 占位不是我们发的。

打印客户端走另一条线：推 `client-v<版本>` 标签时 `client-release.yml` 核对标签号等于 `Directory.Build.props` 的版本，编译、签名（有证书时）并建草稿 Release；维护者发布草稿后把附件里的 `update.json` 提交到 main 的 `client/update.json`，再把 main 合回 dev。每版都出客户端还是有改动才出，还没定，按用户当时的要求做。
