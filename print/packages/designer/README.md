# @xihan-print/designer

曦寒打印设计器：`<xh-print-designer>` 可视化编辑打印模板，包括物料与字段物料、画布上的选择移动缩放与对齐吸附、表格编辑、属性面板、问题列表、页面设置与设置对话框。以原生 Web Components 交付，任何前端项目都能用。设计器只吃模板与数据、吐模板与事件，模板的保存与权限由宿主负责。

设计器用到 XiHan.UI 的设计器零件，样式要四份一起引入（见下面的用法）。元素种类、编辑方式、校验规则、属性编辑器、命令、面板、设置分区与导入器都能经 `extensions` 登记。

## 用法

```ts
import { definePrintDesigner } from '@xihan-print/designer'
import '@xihan-ui/styles/index.css'
import '@xihan-ui/designer-shell/style.css'
import '@xihan-print/runtime/style.css'
import '@xihan-print/designer/style.css'

definePrintDesigner()

const designer = document.createElement('xh-print-designer')
designer.schema = schema
designer.addEventListener('schema-change', () => save(designer.schema))
document.body.append(designer)
```

## 装

```bash
pnpm add @xihan-print/designer @xihan-print/runtime @xihan-ui/styles @xihan-ui/designer-shell
```

完整文档见 [https://print.docs.xihanfun.com](https://print.docs.xihanfun.com)。

许可：MIT
