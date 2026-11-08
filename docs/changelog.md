# 更新日志

本页记录 `@xihan-print/core`、`@xihan-print/runtime`、`@xihan-print/designer` 各版本使用者能感知的变更，每条标注 **新增 / 修复 / 调整 / 移除**。这几个包总是同一个版本号一起发布；逐包的完整记录见仓库里各包的 `CHANGELOG.md`。打印客户端与它们同号，它的改动写在同一版里，条目开头标明「打印客户端」。

## v1.0.0（2026-11-08）

首个正式版，以原生 Web Components 交付，不绑定前端框架。模板是纯 JSON，按数据分页预览、在浏览器里打印，也可以经本地打印客户端静默打印。需要 XiHan.UI 5.4.0 及以上。

- **新增** `@xihan-print/core`：打印模板的结构、校验与问题码、编辑操作与撤销重做，按数据分页排版：表格跨页与重复表头、页小计与合计、页眉页脚变体、条码与二维码、水印。纯 TypeScript，不依赖 DOM。
- **新增** `@xihan-print/runtime`：`<xh-print-preview>` 分页预览并调起浏览器打印；`printDocument`、`paginateDocument` 不经界面直接排版与打印；界面语言包与 XiHan.UI 内建语言一一对应；打印客户端的 SDK，连不上客户端时退回浏览器打印。
- **新增** `@xihan-print/designer`：`<xh-print-designer>` 可视化设计器：物料与字段拖放，画布上的选择、对齐吸附与参考线，表格编辑，属性面板与问题列表，页面设置，撤销重做与本机草稿。元素种类、属性编辑器、命令、面板等都能经 `extensions` 扩展。
- **新增** 打印客户端：Windows 托盘程序，网页经本机连接静默打印到指定打印机，按来源授权，支持按纸张分组打印、原始指令打印与导出 PDF，自动检查新版。安装包在 GitHub Releases。
