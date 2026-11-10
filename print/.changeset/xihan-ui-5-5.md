---
'@xihan-print/core': patch
'@xihan-print/runtime': patch
'@xihan-print/designer': patch
---

**调整** `@xihan-ui/*` 的 peer 依赖范围升到 `^5.5.0`，宿主要把 XiHan.UI 一起升到 5.5.0 及以上。设计器里用到的 UI 部件随 5.5.0 补上了过渡：树的展开收起按高度补间，列表增删与换序有进退场，提示、空态与清空钮出没时淡入淡出，换色改为淡变；选中的文字回到系统高亮色。
