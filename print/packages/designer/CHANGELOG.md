# @xihan-print/designer

## 1.0.0-rc.2

### Minor Changes

- ee0c6a0: **新增** `<xh-print-designer>` 的 `closable`（同名 attribute）：开着时菜单栏最右端多一颗关闭钮，按下派发 `close`，设计器自己不做别的，由宿主关掉编辑器或回到列表。缺省不显示。

### Patch Changes

- 6ad25c3: **修复** 拖动元素松手后，画布上不再在元素原来的位置留下一个悬停框；悬停框跟着元素的当前位置画，方向键挪动、撤销后也一样。
- f7d21c8: **修复** 选中工具条上的钮（字号、文字样式、对齐与分布、层级、副本、复制、删除）用指针按下时不再清掉选中，命令照常执行。
- 6408be4: **调整** 拖动、拉伸、旋转元素与平移画布更流畅：手势途中只重画纸面与覆盖层，属性面板、问题列表、工具栏与菜单栏在松手后更新一次。
- 6ae013b: **调整** `@xihan-ui/*` 的 peer 依赖范围升到 `^5.1.0`，宿主要把 XiHan.UI 一起升到 5.1.0 及以上。
- Updated dependencies [6ae013b]
  - @xihan-print/core@1.0.0-rc.2
  - @xihan-print/runtime@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 5217ad8: **新增** 首次发布，以原生 Web Components 交付，不绑定前端框架。

  - `@xihan-print/core`：打印模板的结构（文档、页面模板、页眉页脚及其变体、元素、表格）、单位换算与页面几何、元素类型登记表、模板校验与问题码、编辑操作与撤销重做、按数据分页排版。纯 TypeScript，不依赖 DOM。
  - `@xihan-print/runtime`：`<xh-print-preview>` 按模板与数据分页预览，调起浏览器打印；`printDocument`、`paginateDocument` 不经预览直接排版、打印，分页的每一步与打印的各个环节可经 `trace` 回调报告；与 XiHan.UI 内建语言一一对应的界面语言包（`@xihan-print/runtime/locale`）；本地打印客户端的 SDK（`@xihan-print/runtime/client`），连不上客户端时退回浏览器打印。
  - `@xihan-print/designer`：`<xh-print-designer>` 可视化设计器，包括菜单栏、物料与按 `fields` 列出的字段物料，画布上的选择、移动、缩放、对齐吸附与参考线，表格编辑，属性面板，问题列表，页面设置，设置对话框，新手引导，以及按 `draftKey` 在本机自动保存的草稿。元素种类、编辑方式、校验规则、属性编辑器、命令、面板、设置分区、导入器、物料来源与菜单栏的菜单都能经 `extensions` 登记。

### Patch Changes

- Updated dependencies [5217ad8]
  - @xihan-print/core@1.0.0-rc.1
  - @xihan-print/runtime@1.0.0-rc.1
