---
name: xihan-print-docs-site
description: 修改 XiHan.PrintDesigner 文档站（docs/，print.docs.xihanfun.com）时使用：写或改指南页、示例、参考页，调导航与侧栏、更新日志页、llms.txt 机读资产，或文档站构建失败。适用于“改文档”“加示例”“参考页不对”“文档站构建”“llms”。
---

# XiHan.PrintDesigner 文档站

文档站是独立的 pnpm 项目，VitePress 加组织统一主题 `@xihanfun/vitepress-theme`。命令都在 `docs/` 下跑。

## 依赖与预览

- `pnpm bootstrap`（即 `pnpm install --frozen-lockfile`）。打印三个包经 `link:` 读 `print/packages/*` 的产物，先在 `print/` 跑 `pnpm build`。
- `@xihan-ui/*` 用 npm 正式包：打印三个包要的那几个由 `docs/package.json` 一并装上，并在 `.vitepress/config.ts` 的 `vite.resolve.dedupe` 里列全。少列一个时文档站与设计器各用一份 UI，全站设的界面语言到不了设计器（设计器变回英文），构建却照样通过。
- `pnpm dev` 起开发服务；改了依赖后第一次打开会报一批 504 Outdated Optimize Dep，是 Vite 在重新预构建，刷新即可。

## 内容从哪来

- **参考页** `docs/reference/` 由 `scripts/gen-reference.mjs` 从源码生成：元素原型、`printZhCN` 语言包、TypeScript 源码注释、客户端错误码的 C# 注释。不手改；说明不对就改源码注释，再跑 `pnpm gen`，参考页随源码改动同一笔提交。`pnpm gate:gen` 只比对、不写文件。
- **示例**都放在 `examples/`，正文用 `<<< @/examples/<路径>#<片段>` 引入（源码里用 `// #region <名>` 与 `// #endregion <名>` 圈出），不在 Markdown 里另写一份：
  - `templates/`：导出 `schema` 与 `data` 的模板，`pnpm check:examples` 校验并试排；
  - `demos/`：`.ts` 导出 `mount(host)`，`.vue` 是一个组件，正文写 `<PrintDemo name="<文件名>" />` 真实运行；
  - `snippets/`：只做类型检查。
- 正文里含 `{{` 的行内代码写成 `<code v-pre>…</code>`，否则被 Vue 当成插值吃掉，构建也不报错。
- **更新日志** `docs/changelog.md` 每版一节，与升版本同一笔；导航右上角的版本号取 `print/packages/core/package.json`，不用手改。

## 站点配置

- 导航、侧栏、`PrintDemo` 等站点自己的东西在 `docs/.vitepress/`；主题已提供的样式不复制、不改写。
- 机读资产由主题的 `llms` 配置生成：`llms.txt`、`llms-full.txt`，以及 `bundles` 里的 `llms-guide.txt`、`llms-reference.txt`；每页另有同路径的 `.md`。新增顶层目录时把它加进 `llms.sections`；`transform` 把 `<<<` 片段内联、去掉 `<PrintDemo>`。
- 站点地址 `https://print.docs.xihanfun.com`：`docs/public/CNAME`、`docs/public/.nojekyll` 与 `.github/workflows/deploy-docs.yml` 是站点契约，不因清理而删；主题配置的 `llms.site` 与 `docs/package.json` 的 `homepage` 写同一个地址。部署只在发版后进行（当前版本有标签、main 上的包与标签一致、这个版本已在 npm 上），平时改文档不会立刻上线。
- 跨站链接写完整地址（如 `https://ui.docs.xihanfun.com`）；站内死链会让构建失败。

## 写法

- 只写已经做完的能力；不写组件数、元素数与依赖的具体版本号，不写「现在能用吗」「首发前」一类的预发布铺垫。
- 函数名、属性、事件、问题码对照源码或参考页核过再写，不凭记忆。

## 门禁

`pnpm gate:gen`、`pnpm check:examples`、`pnpm lint`、`pnpm typecheck`、`pnpm build`，再在仓库根跑 `git diff --check`；只改文档时不跑 `print/` 的全量门禁。看得见的改动在开发服务上用浏览器核一遍；只提交文档站的笔写 `docs(docs): …`。
