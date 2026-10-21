---
name: xihan-print-designer-development
description: 实现、重构、修复或测试 XiHan.PrintDesigner 的三个 npm 包时使用：@xihan-print/core（模板结构、校验、编辑、分页）、@xihan-print/runtime（预览、打印、语言包、客户端 SDK）、@xihan-print/designer（设计器元素）。适用于“加元素种类”“改模板结构”“加属性 / 事件 / 命令”“扩展点”“分页不对”“设计器面板”等；只改文档站用 docs-site，只改 .NET 客户端用 client。
---

# XiHan.PrintDesigner 包开发

开始前读仓库根 `AGENTS.md` 的「分层与依赖」「硬性约定」，再读文档站对应的一页：模板结构 `docs/guide/template.md`、数据绑定 `binding.md`、运行时 `runtime.md`、设计器 `designer.md`、与宿主集成 `host.md`。公开 API 的完整列表在 `docs/reference/`（由源码生成）。

## 分层

| 包 | 放什么 | 不放什么 |
| --- | --- | --- |
| core | 模板类型与构造（`createPage`、元素登记表的 `createElement`）、`validateDocument` 与问题码、编辑操作 `applyOperation(s)`（返回新文档与逆操作）、按数据分页、字段树 | DOM 与任何浏览器 API（tsconfig 不含 DOM 类型库） |
| runtime | `<xh-print-preview>`、`printDocument`、`paginateDocument`、渲染、语言包（`runtime/src/locale/`）、打印客户端 SDK（`@xihan-print/runtime/client`） | 设计器专用的代码（runtime 体积敏感） |
| designer | `<xh-print-designer>`：画布、属性编辑器、物料、页面结构、表格编辑、设置、引导、自动保存 | 新的通用界面零件（归 XiHan.UI） |

依赖方向 `designer → runtime → core`，不反向引用；源码不 import 任何前端框架。

## 模型约定

- 坐标、宽高、边距用 mm，原点在纸张左上角；字号、字间距用 pt。页眉页脚是缺省一份加首页、末页、奇数页、偶数页变体；表格的小计合计统一走 `footerRows`。
- 校验只给问题码、严重程度、路径与参数，文案由 runtime / designer 按语言生成；新问题码登记进 core 并补文案。
- 排版的注入项是 `measurer`、`expressionEngine`、`formatter`、`locale`、`timeZone`。缺省用 Canvas 度量器，拿不到时抛 `measurer.unavailable`，不退回估算。
- 扩展一律经 `extensions`：core 的 `createPrintModel`、runtime 的 `createPrintRuntimeModel`、designer 的 `createPrintDesignerModel`；设计器自带的编辑器与命令是每个实例一份的内置扩展，按同一条路登记，不开特殊通道。

## 复用 XiHan.UI

- UI 已有的组件、外壳零件（`@xihan-ui/designer-shell`）、设计器内核（`@xihan-ui/designer-kit`）、表达式与格式化（`@xihan-ui/expression`）、条码与二维码、文字度量一律直接用，不在这里另写一套。
- 常用、以后别处也会用的能力，即使眼下只有打印用到，也加进 XiHan.UI 再调用；只有打印专属的语义（分页、页眉页脚变体、打印输出）留在这里。
- UI 用 npm 正式包（peer `^5.0.0`），同级 UI 源码不会自动生效；缺 UI 能力时先报给维护者排进 UI 的版本，不在设计器里局部修补 UI 的缺陷。

## 元素与界面

- 复杂数据走 property 不走 attribute；事件用 `CustomEvent`；布尔 attribute 用 `@xihan-ui/web-components/authoring` 的 `BOOLEAN_CONVERTER`。
- 模板即数据：不用 `eval`、`new Function`，不把用户内容拼进 `innerHTML`。不往 `window` 挂东西、不读写固定键名的存储、不发网络请求。
- 样式是 Light DOM，只用 `@xihan-ui` 的设计令牌，不写颜色、间距、圆角的散值。
- 新文案键、属性名、选项名、问题码，十种语言一起补；`runtime/src/designer-locale.ts` 的英文表是键的唯一来源，少键、多键都是类型错误。

## 做法与门禁

1. 先写一条会红的断言（缺陷复现或新行为），再改实现。jsdom 用例挂设计器时写 `autoTour = false`。
2. 在 `print/` 跑 `pnpm lint`、`pnpm build`、`pnpm typecheck`、`pnpm test`；改了公开面或源码注释，在 `docs/` 跑 `pnpm gen`，参考页随改动一起提交，再跑 docs-site 的门禁；最后 `git diff --check`。各步退出码先存下来，全 0 再提交。
3. 使用者能感知的改动在 `print/` 跑 `pnpm changeset` 附一份变更集；破坏性改动写清旧写法与新写法。
4. 界面上看得见的改动，在文档站或开发预览页（`print/` 的 `pnpm dev`）里真实浏览器核一遍；jsdom 证明不了布局、光标与动画。
5. 一项完整功能一笔提交，注释只写代码做什么，设计理由写进提交说明。
