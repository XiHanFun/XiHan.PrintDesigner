---
'@xihan-print/core': patch
'@xihan-print/runtime': patch
'@xihan-print/designer': patch
---

**调整** `@xihan-ui/*` 的 peer 依赖范围升到 `^5.2.0`，宿主要把 XiHan.UI 一起升到 5.2.0 及以上。设计器的外观随 UI 5.2.0 变化：缺省品牌色换成偏紫的靛蓝，圆角、聚焦环与面板分组的箭头位置都有调整；要保留原来的蓝色，在主题根上写 `data-brand="indigo"`。
