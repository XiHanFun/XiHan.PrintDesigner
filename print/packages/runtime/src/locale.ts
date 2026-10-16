/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印产品的中文文案，预览与设计器共用，含设计器零件的中文：与 UI 的语言包一起交给 mergeXhConfig，再经 setXhConfig 或 <xh-config> 生效。

import type { SchemaIssue } from '@xihan-ui/designer-kit/schema'
import type { XhConfig } from '@xihan-ui/web-components'
import type { PrintDesignerTranslations } from './translations'
import { designerShellZhCN } from '@xihan-ui/designer-shell/locale'

const REGION_NAMES = { header: '页眉', body: '正文', footer: '页脚' } as const

function text(value: unknown): string {
  return Array.isArray(value) ? value.join('、') : String(value ?? '')
}

function mm(value: unknown): string {
  return String(Math.round(Number(value) * 10) / 10)
}

function range(params: Readonly<Record<string, unknown>>): string {
  const parts: string[] = []
  if (params.min !== undefined)
    parts.push(`不小于 ${text(params.min)}`)
  if (params.exclusiveMin !== undefined)
    parts.push(`大于 ${text(params.exclusiveMin)}`)
  if (params.max !== undefined)
    parts.push(`不大于 ${text(params.max)}`)
  return parts.length === 0 ? '超出范围' : `应${parts.join('、')}`
}

/** 校验问题与分页诊断的中文说明；不认识的问题码原样返回。 */
function issueText(issue: SchemaIssue): string {
  const params = issue.params ?? {}
  switch (issue.code) {
    case 'required':
      return '缺少必填项'
    case 'invalid-type':
      return '类型不对'
    case 'invalid-value':
      return '取值无效'
    case 'out-of-range':
      return range(params)
    case 'not-integer':
      return '应为整数'
    case 'invalid-option':
      return '不是可选的值'
    case 'invalid-color':
      return '不是有效的颜色'
    case 'empty':
      return '不能为空'
    case 'unknown-key':
      return `未知的属性 ${text(params.key)}`
    case 'duplicate-key':
      return `键 ${text(params.key)} 重复`
    case 'duplicate-id':
      return `标识 ${text(params.id)} 重复`
    case 'json.circular':
      return '数据有循环引用'
    case 'schema.unsupportedVersion':
      return `不支持模板版本 ${text(params.version)}（应为 ${text(params.supported)}）`
    case 'field.empty':
      return '没有绑定字段'
    case 'field.invalidPath':
      return `字段路径 ${text(params.field)} 写法不对`
    case 'template.unclosedPlaceholder':
      return '模板里有没闭合的 {{'
    case 'template.emptyPlaceholder':
      return '模板里有空的 {{}}'
    case 'template.invalidPath':
      return '模板里的字段路径写法不对'
    case 'expression.invalid':
      return '表达式有误'
    case 'format.duplicateMapValue':
      return `值映射里 ${text(params.value)} 重复`
    case 'format.invalidOption':
      return '格式选项无效'
    case 'format.conflict':
      return '格式选项相互冲突'
    case 'document.noPages':
      return '模板里没有页面'
    case 'page.presetMismatch':
      return `纸张尺寸与 ${text(params.preset)} 不符`
    case 'page.noContentArea':
      return '页边距占满了纸张'
    case 'page.bandsOverflow':
      return '页眉页脚比版心还高'
    case 'watermark.emptyText':
      return '水印文字为空'
    case 'element.unknownType':
      return `未知的元素种类 ${text(params.type)}`
    case 'element.tooSmall':
      return `小于最小尺寸 ${mm(params.minWidth)} × ${mm(params.minHeight)} mm`
    case 'element.outsidePaper':
      return '超出纸张'
    case 'element.outsideBand':
      return `超出${REGION_NAMES[text(params.region) as keyof typeof REGION_NAMES] ?? text(params.region)}区`
    case 'element.flowInBand':
      return '跨页元素只能放在正文区'
    case 'element.flowOutsideBody':
      return '跨页元素超出正文区'
    case 'line.zeroLength':
      return '直线长度为 0'
    case 'shape.invisible':
      return '图形既没有边线也没有填充'
    case 'image.emptySource':
      return '图片地址为空'
    case 'image.unsafeSource':
      return '图片地址不允许使用'
    case 'table.noColumns':
      return '表格没有列'
    case 'table.duplicateColumnId':
      return `列标识 ${text(params.id)} 重复`
    case 'table.duplicateRowId':
      return `表尾行标识 ${text(params.id)} 重复`
    case 'table.columnWidthMismatch':
      return `列宽合计 ${mm(params.columnsWidth)} mm，与表格宽度 ${mm(params.width)} mm 不一致`
    case 'table.unknownColumn':
      return `表尾单元格指向不存在的列 ${text(params.columnId)}`
    case 'table.cellSpanOverflow':
      return `跨 ${text(params.colSpan)} 列，右侧只剩 ${text(params.available)} 列`
    case 'table.cellOverlap':
      return '表尾单元格与其它单元格重叠'
    case 'table.aggregateFieldMissing':
      return `汇总 ${text(params.fn)} 缺少字段`
    case 'table.rowExceedsBody':
      return `表头加一行需要 ${mm(params.required)} mm，正文区只有 ${mm(params.available)} mm`
    case 'barCode.invalidValue':
    case 'matrixCode.invalidValue':
      return `内容无法按 ${text(params.format)} 编码`
    case 'matrixCode.invalidLevel':
      return `纠错级别 ${text(params.level)} 不适用于 ${text(params.format)}`
    case 'matrixCode.levelIgnored':
      return `${text(params.format)} 没有纠错级别，设置的级别不起作用`
    case 'matrixCode.notSquare':
      return '二维码宽高不等'
    case 'pageNumber.noToken':
      return '页码格式里没有 {{$page}} 或 {{$pages}}'
    case 'pageNumber.unknownToken':
      return `页码格式里有未知的变量 ${text(params.token)}`
    case 'data.notArray':
      return `字段 ${text(params.field)} 不是数组`
    case 'data.notScalar':
      return params.field === undefined ? '取到的不是单个值' : `字段 ${text(params.field)} 不是单个值`
    case 'format.unavailable':
      return '没有提供格式化器'
    case 'format.failed':
      return '格式化失败'
    case 'expression.unavailable':
      return '没有提供表达式引擎'
    case 'expression.failed':
      return '表达式求值失败'
    case 'text.overflow':
      return params.fontSize === undefined ? '文字超出元素框' : `文字缩到 ${text(params.fontSize)} pt 仍超出元素框`
    case 'table.rowOverflow':
      return `第 ${Number(params.dataIndex) + 1} 行在一页里放不下`
    case 'element.overflow':
      return '内容超出元素框'
    case 'layout.sheetLimit':
      return `输出页数超过上限 ${text(params.limit)}`
    default:
      return issue.code
  }
}

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
  issue: issueText,
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
