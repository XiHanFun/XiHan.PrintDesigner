/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印产品各元素的文案键：预览与设计器的文案类型集中在这里，并补进 UI 的 XhTranslationOverrides；预览的英文缺省也在这里。

import type { ElementCategory, ElementRegion, PageBandKey, PrintElementType, PropertyGroup, PropertyUnit } from '@xihan-print/core'
import type { SchemaIssue } from '@xihan-ui/designer-kit/schema'
import type { PrintClientState } from './client/client'

/** 预览元素的文案。 */
export interface PrintPreviewTranslations {
  /** 预览区域的可访问名。 */
  readonly label: string
  /** 一张输出页的可访问名；position 从 1 开始，count 为输出页总数。 */
  readonly sheetLabel: (position: number, count: number) => string
}

/** 预览元素的内建英文文案，与 printEnUS 里预览的那份相同。 */
export const DEFAULT_PRINT_PREVIEW_TRANSLATIONS: PrintPreviewTranslations = {
  label: 'Print preview',
  sheetLabel: (position, count) => `Page ${position} of ${count}`,
}

/** 表格编辑态里可以选中的部位。 */
export type PrintTablePartKind = 'column' | 'header' | 'body' | 'footerRow' | 'footerCell'

/** 新手引导里打印自己那几步的键。 */
export type PrintTourStepKey = 'bands' | 'pages' | 'fields' | 'print'

/** 新手引导一步的标题与说明。 */
export interface PrintTourStepTranslations {
  readonly title: string
  readonly description: string
}

/** 撤销历史里一步的说明：单个元素写「种类 名称」（见 elementLabel），几个元素写个数。 */
export interface PrintHistoryTranslations {
  readonly addElement: (label: string) => string
  readonly addElements: (count: number) => string
  readonly removeElement: (label: string) => string
  readonly removeElements: (count: number) => string
  readonly editElement: (label: string) => string
  readonly editElements: (count: number) => string
  readonly moveElement: (label: string) => string
  readonly moveElements: (count: number) => string
  readonly resizeElement: (label: string) => string
  readonly resizeElements: (count: number) => string
  readonly rotateElement: (label: string) => string
  readonly rotateElements: (count: number) => string
  /** 调整层级。 */
  readonly reorderElement: (label: string) => string
  readonly reorderElements: (count: number) => string
  /** 按住 Alt 拖动复制。 */
  readonly copyElement: (label: string) => string
  readonly copyElements: (count: number) => string
  /** 在属性面板或页面设置弹层里改了一项；name 是属性名。 */
  readonly editProperty: (name: string) => string
  readonly addPage: string
  readonly removePage: string
  readonly movePage: string
  /** 改了页面模板的纸张、边距等设置。 */
  readonly editPage: string
  readonly editGuides: string
  /** 新增、删除页眉页脚的一个变体；variant 写成「页眉 · 首页」这样。 */
  readonly addBand: (variant: string) => string
  readonly removeBand: (variant: string) => string
  /** 改了模板本身的设置（名称等）。 */
  readonly editDocument: string
}

/** 设计器的文案。 */
export interface PrintDesignerTranslations {
  /** 设计器的可访问名。 */
  readonly label: string
  /** 画布区域的可访问名。 */
  readonly canvas: string
  /** 显示网格的开关。 */
  readonly grid: string
  /** 吸附其它元素与参考线的开关。 */
  readonly snap: string
  readonly print: string
  /** 画布右侧翻页条的可访问名。 */
  readonly pages: string
  readonly previousPage: string
  readonly nextPage: string
  readonly addPage: string
  readonly duplicatePage: string
  readonly removePage: string
  readonly movePageUp: string
  readonly movePageDown: string
  /**
   * 翻页条上页码按钮的名字：含按钮上写的「第几个 / 共几个」，再加页面名称（没有名称时是 pageTitle），position 从 1 开始。
   * 按钮上看得见的字要包含在名字里。
   */
  readonly pagePosition: (position: number, count: number, name: string) => string
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
  /** 撤销历史里一步的说明。 */
  readonly history: PrintHistoryTranslations
  /** 新插入的列的标题，position 从 1 开始。 */
  readonly newColumnTitle: (position: number) => string
  /** 物料面板的标题。 */
  readonly palette: string
  /** 物料面板里按 fields 列出的字段那一组的名称。 */
  readonly fieldGroup: string
  /** 属性面板的标题。 */
  readonly properties: string
  /** 问题列表的标题。 */
  readonly issues: string
  /** 物料面板头里的帮助。 */
  readonly paletteHelp: string
  /** 属性面板头里的帮助。 */
  readonly propertiesHelp: string
  /** 问题列表面板头里的帮助。 */
  readonly issuesHelp: string
  /** 设置对话框里设计器自己那一页（打印方式与画布偏好）的名称。 */
  readonly settingsPrint: string
  readonly settingsShowGrid: string
  readonly settingsShowGridHint: string
  readonly settingsGridSize: string
  readonly settingsGridSizeHint: string
  readonly settingsSnap: string
  readonly settingsSnapHint: string
  readonly settingsShowMargins: string
  readonly settingsShowMarginsHint: string
  /** 设置「打印」分区：标尺开关。 */
  readonly settingsRulers: string
  readonly settingsRulersHint: string
  /** 新手引导里打印自己的几步：页眉页脚、页面模板、字段物料与打印。 */
  readonly tourSteps: Readonly<Record<PrintTourStepKey, PrintTourStepTranslations>>
  /** 设置对话框「帮助」页的几段操作说明。 */
  readonly helpNotes: readonly string[]
  /** 快捷键表里 Ctrl / ⌘ + S 那一行：派发 save，请宿主保存。 */
  readonly shortcutSave: string
  /** 「打印」页里打印方式一项：经本地打印客户端，还是浏览器的打印对话框。 */
  readonly settingsVia: string
  readonly settingsViaHint: string
  readonly settingsViaOptions: Readonly<Record<'client' | 'browser', string>>
  /** 设置对话框里「本地客户端」那一页的名称。 */
  readonly settingsClient: string
  /** 「本地客户端」页里连接状态一项。 */
  readonly settingsClientStatus: string
  readonly settingsClientStatusHint: string
  /** 连接状态的三种说法：已连接；未连接；最近一次测试连接没找到客户端时是未安装。 */
  readonly settingsClientStates: Readonly<Record<'connected' | 'disconnected' | 'missing', string>>
  readonly settingsClientTest: string
  readonly settingsClientDownload: string
  /** 状态栏左段没有选中时的值：当前页面模板上可见的元素个数。 */
  readonly statusElements: (count: number) => string
  /** 状态栏左段选中一个元素时的值：入参是格式化后的位置与尺寸（mm）。 */
  readonly statusGeometry: (x: string, y: string, width: string, height: string) => string
  /** 状态栏右段缩放一项的标签。 */
  readonly statusZoom: string
  /** 状态栏右段打印客户端一项的标签。 */
  readonly statusClient: string
  /** 打印客户端连接状态的说法。 */
  readonly statusClientStates: Readonly<Record<PrintClientState, string>>
  /** 顶栏插入钮那一条工具栏的名字。 */
  readonly insertToolbar: string
  /** 顶栏插入钮的名字，label 是元素种类的名称。 */
  readonly insertElement: (label: string) => string
  /** 选中元素后浮在选中框上方的选中工具条的名字。 */
  readonly selectionToolbar: string
  readonly alignTextLeft: string
  readonly alignTextCenter: string
  readonly alignTextRight: string
  /** 格式工具条上字号菜单的名字：含按钮上写的字号，选中的几处字号不一时是 —。 */
  readonly fontSizeMenu: (size: string) => string
  /** 工具栏上「对齐与分布」菜单的名字。 */
  readonly alignMenu: string
  /** 工具栏上「层级」菜单的名字。 */
  readonly layerMenu: string
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
  /** 页码格式编辑器里插入变量的菜单按钮。 */
  readonly pageNumberInsert: string
  /** 页码格式里能插入的两个变量：当前页码与总页数。 */
  readonly pageNumberTokens: Readonly<{ page: string, pages: string }>
  /** 页码格式的示例，入参是按第 1 页、共 3 页填好的文字。 */
  readonly pageNumberSample: (text: string) => string
  /** 值格式编辑器里种类下拉的名字。 */
  readonly valueFormatKind: string
  /** 值格式的种类：不设格式、常用格式（数字、百分比、日期、人民币大写、数字字形）、值映射、表达式。 */
  readonly valueFormatKinds: Readonly<{ none: string, format: string, map: string, expression: string }>
  /** 值映射表的两列：数据值与显示文本。 */
  readonly valueMapColumns: Readonly<{ value: string, label: string }>
  /** 值映射表里一格的名字，index 从 1 起，column 是列名。 */
  readonly valueMapCell: (index: number, column: string) => string
  /** 值映射里没有命中任何一项时显示的文本。 */
  readonly valueMapFallback: string
}

declare module '@xihan-ui/web-components' {
  interface XhTranslationOverrides {
    'xh-print-preview'?: Partial<PrintPreviewTranslations>
    'xh-print-designer'?: Partial<PrintDesignerTranslations>
  }
}
