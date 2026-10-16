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

const PROPERTY_NAMES: Readonly<Record<string, string>> = {
  'x': 'X',
  'y': 'Y',
  'width': '宽',
  'height': '高',
  'rotation': '旋转',
  'content': '内容',
  'style.fontFamily': '字体',
  'style.fontSize': '字号',
  'style.bold': '粗体',
  'style.italic': '斜体',
  'style.underline': '下划线',
  'style.lineThrough': '删除线',
  'style.color': '文字颜色',
  'style.align': '水平对齐',
  'style.verticalAlign': '垂直对齐',
  'style.lineHeight': '行高',
  'style.letterSpacing': '字间距',
  'wrap': '自动换行',
  'overflow': '放不下时',
  'box.background': '背景',
  'box.border': '边框',
  'box.padding': '内边距',
  'name': '名称',
  'locked': '锁定',
  'previewOnly': '只在预览中显示',
  'format': '格式',
  'barCode:format': '码制',
  'matrixCode:format': '码制',
  'numeral': '数字写法',
  'source': '图片来源',
  'fit': '填充方式',
  'dataField': '数据字段',
  'columns': '列',
  'header.visible': '显示表头',
  'header.repeat': '每页重复表头',
  'header.height': '表头行高',
  'header.style': '表头样式',
  'body.rowHeight': '行高',
  'body.rowHeightMode': '行高方式',
  'body.style': '表体样式',
  'footerRows': '表尾行',
  'maxRowsPerPage': '每页最多行数',
  'fillEmptyRows': '用空行补齐',
  'border.stroke': '边框线',
  'border.outer': '外框',
  'border.horizontal': '横线',
  'border.vertical': '竖线',
  'direction': '方向',
  'stroke': '边线',
  'fill': '填充',
  'radius': '圆角',
  'showText': '显示文字',
  'textStyle.fontFamily': '文字字体',
  'textStyle.fontSize': '文字字号',
  'color': '颜色',
  'level': '纠错级别',
  'quietZone': '静区',
  'background': '背景',
  'paper': '纸张',
  'orientation': '方向',
  'margins': '页边距',
  'header.default.height': '页眉高度',
  'header.first.height': '首页页眉高度',
  'header.last.height': '末页页眉高度',
  'header.odd.height': '奇数页页眉高度',
  'header.even.height': '偶数页页眉高度',
  'header.singleSheet': '只有一页时的页眉',
  'footer.default.height': '页脚高度',
  'footer.first.height': '首页页脚高度',
  'footer.last.height': '末页页脚高度',
  'footer.odd.height': '奇数页页脚高度',
  'footer.even.height': '偶数页页脚高度',
  'footer.singleSheet': '只有一页时的页脚',
  'numbering.continuous': '接续上一页面模板的页码',
  'numbering.start': '起始页码',
  'watermark': '水印',
  'title': '标题',
  'cellType': '单元格类型',
  'barCodeFormat': '条码码制',
  'align': '对齐',
  'visible': '显示',
  'repeat': '每页重复',
  'style': '样式',
  'rowHeight': '行高',
  'rowHeightMode': '行高方式',
  'placement': '出现在',
  'colSpan': '跨列数',
  'table-column:width': '列宽',
  'table-header:height': '行高',
  'table-footer-row:height': '行高',
  'stroke/width': '线宽',
  'stroke/style': '线型',
  'stroke/color': '颜色',
  'edges/top': '上',
  'edges/right': '右',
  'edges/bottom': '下',
  'edges/left': '左',
  'borderSides/top': '上边框',
  'borderSides/right': '右边框',
  'borderSides/bottom': '下边框',
  'borderSides/left': '左边框',
  'cellStyle/fontFamily': '字体',
  'cellStyle/fontSize': '字号',
  'cellStyle/bold': '粗体',
  'cellStyle/italic': '斜体',
  'cellStyle/color': '文字颜色',
  'cellStyle/background': '背景',
  'cellStyle/align': '水平对齐',
  'cellStyle/verticalAlign': '垂直对齐',
  'cellStyle/padding': '左右内边距',
  'cellStyle/lineHeight': '行高',
  'paper/preset': '规格',
  'paper/width': '宽',
  'paper/height': '高',
  'watermark/text': '文字',
  'watermark/fontFamily': '字体',
  'watermark/fontSize': '字号',
  'watermark/color': '颜色',
  'watermark/opacity': '不透明度',
  'watermark/rotation': '旋转',
  'watermark/gapX': '横向间距',
  'watermark/gapY': '纵向间距',
  'content/text': '文字',
  'content/field': '字段',
  'content/emptyText': '空值时显示',
  'content/template': '模板',
  'content/expression': '表达式',
  'content/format': '格式（JSON）',
  'content/url': '地址',
  'content/fn': '汇总方式',
  'content/scope': '汇总范围',
}

const PROPERTY_OPTIONS: Readonly<Record<string, string>> = {
  'left': '左',
  'center': '居中',
  'right': '右',
  'justify': '两端对齐',
  'top': '上',
  'middle': '居中',
  'bottom': '下',
  'clip': '裁掉',
  'shrink': '缩小字号',
  'visible': '照常显示',
  'roman-upper': '罗马数字（I、II）',
  'roman-lower': '罗马数字（i、ii）',
  'cn-lower': '中文小写（一、二）',
  'cn-upper': '中文大写（壹、贰）',
  'contain': '完整显示',
  'cover': '铺满裁切',
  'fill': '拉伸铺满',
  'none': '原始大小',
  'fixed': '固定',
  'minimum': '至少',
  'horizontal': '水平',
  'vertical': '竖直',
  'diagonalDown': '左上到右下',
  'diagonalUp': '左下到右上',
  'portrait': '纵向',
  'landscape': '横向',
  'first': '首页',
  'last': '末页',
  'text': '文字',
  'image': '图片',
  'barCode': '条码',
  'matrixCode': '二维码',
  'everyPage': '每一页',
  'lastPage': '只在最后一页',
  'solid': '实线',
  'dashed': '虚线',
  'dotted': '点线',
  'double': '双线',
  'custom': '自定义',
  'static': '固定文字',
  'field': '字段',
  'template': '模板',
  'expression': '表达式',
  'rowNumber': '序号',
  'aggregate': '汇总',
  'sum': '求和',
  'avg': '平均',
  'count': '计数',
  'min': '最小',
  'max': '最大',
  'page': '本页',
  'cumulative': '累计到本页',
  'all': '全部',
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
  propertyGroups: {
    layout: '布局',
    content: '内容',
    data: '数据',
    text: '文字',
    table: '表格',
    code: '条码',
    appearance: '外观',
    behavior: '行为',
    page: '页面',
    paper: '纸张',
    bands: '页眉页脚',
    numbering: '页码',
    watermark: '水印',
  },
  propertyNames: PROPERTY_NAMES,
  propertyPart: (parent, part) => `${parent} · ${part}`,
  propertyOptions: PROPERTY_OPTIONS,
  units: { mm: 'mm', pt: 'pt', deg: '°', ratio: '倍', count: '' },
  pageSettings: '页面设置',
  selectedCount: count => `已选中 ${count} 个元素`,
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
