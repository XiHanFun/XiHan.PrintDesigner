/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印产品各元素的文案键：预览与设计器的文案类型集中在这里，并补进 UI 的 XhTranslationOverrides。

import type { ElementCategory, ElementRegion, PageBandKey, PrintElementType, PropertyGroup, PropertyUnit } from '@xihan-print/core'
import type { SchemaIssue } from '@xihan-ui/designer-kit/schema'

/** 预览元素的文案。 */
export interface PrintPreviewTranslations {
  /** 预览区域的可访问名。 */
  readonly label: string
  /** 一张输出页的可访问名；position 从 1 开始，count 为输出页总数。 */
  readonly sheetLabel: (position: number, count: number) => string
}

/** 表格编辑态里可以选中的部位。 */
export type PrintTablePartKind = 'column' | 'header' | 'body' | 'footerRow' | 'footerCell'

/** 设计器的文案。 */
export interface PrintDesignerTranslations {
  /** 设计器的可访问名。 */
  readonly label: string
  /** 画布区域的可访问名。 */
  readonly canvas: string
  /** 工具栏的可访问名。 */
  readonly toolbar: string
  readonly undo: string
  readonly redo: string
  readonly cut: string
  readonly copy: string
  readonly paste: string
  readonly duplicate: string
  readonly delete: string
  readonly selectAll: string
  readonly alignLeft: string
  /** 各自的中心落到同一条竖直中线上。 */
  readonly alignCenter: string
  readonly alignRight: string
  readonly alignTop: string
  /** 各自的中心落到同一条水平中线上。 */
  readonly alignMiddle: string
  readonly alignBottom: string
  readonly distributeHorizontal: string
  readonly distributeVertical: string
  readonly bringToFront: string
  readonly bringForward: string
  readonly sendBackward: string
  readonly sendToBack: string
  readonly zoomIn: string
  readonly zoomOut: string
  readonly zoomToFit: string
  readonly zoomToActual: string
  /** 显示并吸附网格的开关。 */
  readonly grid: string
  /** 吸附其它元素与参考线的开关。 */
  readonly snap: string
  /** 切到设计态。 */
  readonly design: string
  /** 切到预览态。 */
  readonly preview: string
  readonly print: string
  /** 页面模板页签的可访问名。 */
  readonly pages: string
  readonly addPage: string
  readonly removePage: string
  readonly movePageLeft: string
  readonly movePageRight: string
  /** 没有名称的页面模板的标题，position 从 1 开始。 */
  readonly pageTitle: (position: number) => string
  /** 页眉、正文、页脚的名称。 */
  readonly regions: Readonly<Record<ElementRegion, string>>
  /** 页眉页脚变体的名称。 */
  readonly bandVariants: Readonly<Record<PageBandKey, string>>
  /** 选择当前编辑的页眉或页脚变体的控件的可访问名。 */
  readonly bandVariant: (region: 'header' | 'footer') => string
  readonly addBandVariant: string
  readonly removeBandVariant: string
  /** 拖动调整页眉或页脚高度的把手的可访问名。 */
  readonly resizeBand: (region: 'header' | 'footer') => string
  /** 元素种类的名称。 */
  readonly elements: Readonly<Record<PrintElementType, string>>
  /** 物料分组的名称。 */
  readonly categories: Readonly<Record<ElementCategory, string>>
  /** 画布上一个元素的可访问名：种类名加元素名称或标识。 */
  readonly elementLabel: (type: string, name: string) => string
  /** 表格部位的名称。 */
  readonly tableParts: Readonly<Record<PrintTablePartKind, string>>
  readonly editTable: string
  readonly exitTableEdit: string
  readonly insertColumnLeft: string
  readonly insertColumnRight: string
  readonly removeColumn: string
  readonly moveColumnLeft: string
  readonly moveColumnRight: string
  readonly insertFooterRowAbove: string
  readonly insertFooterRowBelow: string
  readonly removeFooterRow: string
  readonly mergeCellRight: string
  readonly splitCell: string
  /** 拖动调整列宽的把手的可访问名。 */
  readonly resizeColumn: (title: string) => string
  /** 新插入的列的标题，position 从 1 开始。 */
  readonly newColumnTitle: (position: number) => string
  /** 拖动元素时显示的尺寸，入参是格式化后的宽与高（mm）。 */
  readonly measure: (width: string, height: string) => string
  /** 物料面板的标题。 */
  readonly palette: string
  /** 属性面板的标题。 */
  readonly properties: string
  /** 问题列表的标题。 */
  readonly issues: string
  /** 校验问题与分页诊断的说明，按问题码与参数生成。 */
  readonly issue: (issue: SchemaIssue) => string
  /** 属性分组的名称。 */
  readonly propertyGroups: Readonly<Record<PropertyGroup, string>>
  /**
   * 属性名：键为 formatJsonPath(path)；「对象种类:路径」覆盖同一路径在该种类上的名字，对象种类是 page、元素种类或 table-column 等表格部位。
   * 复合属性拆开后的分项用「复合种类/分项」作键，如 stroke/width、edges/top。
   */
  readonly propertyNames: Readonly<Record<string, string>>
  /** 复合属性拆开后分项的名字，如「页边距 · 上」。 */
  readonly propertyPart: (parent: string, part: string) => string
  /** select 选项名：键为选项值；「路径=选项值」覆盖该属性上的名字。 */
  readonly propertyOptions: Readonly<Record<string, string>>
  /** 数值属性的单位。 */
  readonly units: Readonly<Record<PropertyUnit, string>>
  /** 属性面板在没有选中时编辑页面设置，标题下的一行。 */
  readonly pageSettings: string
  /** 属性面板在选中多个元素时标题下的一行。 */
  readonly selectedCount: (count: number) => string
}

declare module '@xihan-ui/web-components' {
  interface XhTranslationOverrides {
    'xh-print-preview'?: Partial<PrintPreviewTranslations>
    'xh-print-designer'?: Partial<PrintDesignerTranslations>
  }
}
