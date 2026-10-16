/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印产品的中文文案，预览与设计器共用，含设计器零件的中文：与 UI 的语言包一起交给 mergeXhConfig，再经 setXhConfig 或 <xh-config> 生效。

import type { XhConfig } from '@xihan-ui/web-components'
import type { PrintDesignerTranslations } from './translations'
import { designerShellZhCN } from '@xihan-ui/designer-shell/locale'

const REGION_NAMES = { header: '页眉', body: '正文', footer: '页脚' } as const

const designer: PrintDesignerTranslations = {
  label: '打印设计器',
  canvas: '画布',
  toolbar: '设计器操作',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  duplicate: '再制',
  delete: '删除',
  selectAll: '全选',
  alignLeft: '左对齐',
  alignCenter: '水平居中',
  alignRight: '右对齐',
  alignTop: '顶端对齐',
  alignMiddle: '垂直居中',
  alignBottom: '底端对齐',
  distributeHorizontal: '水平等距分布',
  distributeVertical: '垂直等距分布',
  bringToFront: '置于顶层',
  bringForward: '上移一层',
  sendBackward: '下移一层',
  sendToBack: '置于底层',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomToFit: '适合窗口',
  zoomToActual: '实际大小',
  grid: '网格',
  snap: '吸附',
  design: '设计',
  preview: '预览',
  print: '打印',
  pages: '页面模板',
  addPage: '新增页面',
  removePage: '删除页面',
  movePageLeft: '左移页面',
  movePageRight: '右移页面',
  pageTitle: position => `第 ${position} 页`,
  regions: REGION_NAMES,
  bandVariants: { default: '默认', first: '首页', last: '末页', odd: '奇数页', even: '偶数页' },
  bandVariant: region => `${REGION_NAMES[region]}变体`,
  addBandVariant: '新增变体',
  removeBandVariant: '删除变体',
  resizeBand: region => `调整${REGION_NAMES[region]}高度`,
  categories: { text: '文字', media: '图片', data: '数据', shape: '图形', code: '条码' },
  elements: {
    text: '文本',
    longText: '长文本',
    table: '表格',
    image: '图片',
    line: '直线',
    rect: '矩形',
    ellipse: '椭圆',
    barCode: '条码',
    matrixCode: '二维码',
    pageNumber: '页码',
  },
  elementLabel: (type, name) => `${type} ${name}`,
  tableParts: { column: '列', header: '表头', body: '表体', footerRow: '表尾行', footerCell: '表尾单元格' },
  editTable: '编辑表格',
  exitTableEdit: '退出表格编辑',
  insertColumnLeft: '在左侧插入列',
  insertColumnRight: '在右侧插入列',
  removeColumn: '删除列',
  moveColumnLeft: '左移列',
  moveColumnRight: '右移列',
  insertFooterRowAbove: '在上方插入表尾行',
  insertFooterRowBelow: '在下方插入表尾行',
  removeFooterRow: '删除表尾行',
  mergeCellRight: '与右侧单元格合并',
  splitCell: '拆分单元格',
  resizeColumn: title => `调整「${title}」列宽`,
  newColumnTitle: position => `列 ${position}`,
  measure: (width, height) => `${width} × ${height} mm`,
  palette: '物料',
  properties: '属性',
  issues: '问题',
}

/** 打印预览与设计器的中文文案。 */
export const printZhCN: XhConfig = {
  translations: {
    ...designerShellZhCN.translations,
    'xh-print-preview': {
      label: '打印预览',
      sheetLabel: (position: number, count: number) => `第 ${position} 页，共 ${count} 页`,
    },
    'xh-print-designer': designer,
  },
}
