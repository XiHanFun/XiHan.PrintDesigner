# 更新日志

本页记录 `@xihan-print/core`、`@xihan-print/runtime`、`@xihan-print/designer` 各版本使用者能感知的变更，每条标注 **新增 / 修复 / 调整 / 移除**。这几个包总是同一个版本号一起发布；逐包的完整记录见仓库里各包的 `CHANGELOG.md`。

## v1.0.0-rc.1（2026-10-21）

首次发布，以原生 Web Components 交付，不绑定前端框架。模板是纯 JSON，按数据分页预览、在浏览器里打印，也可以经本地打印客户端静默打印。

- **新增** `@xihan-print/core`：打印模板的结构（文档、页面模板、页眉页脚及其变体、元素、表格）、单位换算与页面几何、元素类型登记表、模板校验与问题码、编辑操作与撤销重做、按数据分页排版。纯 TypeScript，不依赖 DOM。
- **新增** `@xihan-print/runtime`：`<xh-print-preview>` 按模板与数据分页预览，调起浏览器打印；`printDocument`、`paginateDocument` 不经预览直接排版、打印，分页的每一步与打印的各个环节可经 `trace` 回调报告；与 XiHan.UI 内建语言一一对应的界面语言包（`@xihan-print/runtime/locale`）；本地打印客户端的 SDK（`@xihan-print/runtime/client`），连不上客户端时退回浏览器打印。
- **新增** `@xihan-print/designer`：`<xh-print-designer>` 可视化设计器，包括菜单栏、物料与按 `fields` 列出的字段物料，画布上的选择、移动、缩放、对齐吸附与参考线，表格编辑，属性面板，问题列表，页面设置，设置对话框，新手引导，以及按 `draftKey` 在本机自动保存的草稿。元素种类、编辑方式、校验规则、属性编辑器、命令、面板、设置分区、导入器、物料来源与菜单栏的菜单都能经 `extensions` 登记。
