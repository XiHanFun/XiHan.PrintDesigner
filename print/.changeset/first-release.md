---
'@xihan-print/core': major
'@xihan-print/runtime': major
'@xihan-print/designer': major
---

**新增** 首次发布，以原生 Web Components 交付，不绑定前端框架。

- `@xihan-print/core`：打印模板的结构（文档、页面模板、页眉页脚及其变体、元素、表格）、单位换算与页面几何、元素类型登记表、模板校验与问题码、编辑操作与撤销重做、按数据分页排版。纯 TypeScript，不依赖 DOM。
- `@xihan-print/runtime`：`<xh-print-preview>` 按模板与数据分页预览，调起浏览器打印；`printDocument`、`paginateDocument` 不经预览直接排版、打印；与 XiHan.UI 内建语言一一对应的界面语言包（`@xihan-print/runtime/locale`）；本地打印客户端的 SDK（`@xihan-print/runtime/client`），连不上客户端时退回浏览器打印。
- `@xihan-print/designer`：`<xh-print-designer>` 可视化设计器，包括菜单栏、物料与按 `fields` 列出的字段物料，画布上的选择、移动、缩放、对齐吸附与参考线，表格编辑，属性面板，问题列表，页面设置，以及设置对话框。元素种类、编辑方式、校验规则、属性编辑器、命令、面板、设置分区、导入器、物料来源与菜单栏的菜单都能经 `extensions` 登记。
