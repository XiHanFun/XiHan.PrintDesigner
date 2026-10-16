/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 开发预览页的示例模板与示例数据：送货单、商品标签、内部通知。

import type { CellStyle, LineElement, PageNumberElement, PrintDocument, PrintPage, TableFooterRow, TextElement, TextStyle } from '@xihan-print/core'
import { createDocument, createElementRegistry, createPage } from '@xihan-print/core'

/** 一份示例：模板、数据与打印标题。 */
export interface PrintSample {
  readonly id: string
  readonly title: string
  readonly schema: PrintDocument
  readonly data: unknown
}

const registry = createElementRegistry()

function textStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontSize: 10.5,
    bold: false,
    italic: false,
    underline: false,
    lineThrough: false,
    color: '#000000',
    align: 'left',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  }
}

function cellStyle(overrides: Partial<CellStyle> = {}): CellStyle {
  return {
    fontSize: 10,
    bold: false,
    italic: false,
    color: '#000000',
    verticalAlign: 'middle',
    padding: 1,
    lineHeight: 4.5,
    ...overrides,
  }
}

const money = { kind: 'number', decimals: 2, grouping: true } as const

function deliveryFooterRows(): TableFooterRow[] {
  return [
    {
      id: 'subtotal',
      placement: 'everyPage',
      height: 7,
      style: cellStyle({ bold: true }),
      cells: [
        { columnId: 'no', colSpan: 5, content: { kind: 'static', text: '本页小计' }, align: 'right' },
        { columnId: 'amount', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'page', format: money } },
      ],
    },
    {
      id: 'total',
      placement: 'lastPage',
      height: 7,
      style: cellStyle({ bold: true, background: '#f2f2f2' }),
      cells: [
        { columnId: 'no', colSpan: 3, content: { kind: 'static', text: '合计' }, align: 'right' },
        { columnId: 'qty', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'qty', scope: 'all', format: { kind: 'number', decimals: 0, grouping: true } } },
        { columnId: 'price', colSpan: 1, content: { kind: 'aggregate', fn: 'count', scope: 'all' }, align: 'center' },
        { columnId: 'amount', colSpan: 1, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all', format: money } },
      ],
    },
    {
      id: 'upper',
      placement: 'lastPage',
      height: 7,
      style: cellStyle(),
      cells: [
        { columnId: 'no', colSpan: 2, content: { kind: 'static', text: '金额大写（人民币）' }, align: 'right' },
        { columnId: 'unit', colSpan: 4, content: { kind: 'aggregate', fn: 'sum', field: 'amount', scope: 'all', format: { kind: 'rmb-upper' } }, align: 'left' },
      ],
    },
  ]
}

function deliveryPage(): PrintPage {
  const page = createPage({ id: 'delivery', name: '送货单' })
  page.header.default = {
    height: 20,
    elements: [
      registry.createElement('text', {
        id: 'delivery-title',
        x: 10,
        y: 10,
        overrides: { width: 190, height: 10, content: { kind: 'static', text: '送 货 单' }, style: textStyle({ fontSize: 18, bold: true, align: 'center', letterSpacing: 2 }) },
      }),
      registry.createElement('text', {
        id: 'delivery-no',
        x: 10,
        y: 22,
        overrides: { width: 95, height: 6, content: { kind: 'template', template: '单号：{{order.no}}' }, style: textStyle({ fontSize: 10 }) },
      }),
      registry.createElement('text', {
        id: 'delivery-date',
        x: 105,
        y: 22,
        overrides: { width: 95, height: 6, content: { kind: 'field', field: 'order.date', format: { kind: 'date', pattern: '送货日期：yyyy 年 M 月 d 日' } }, style: textStyle({ fontSize: 10, align: 'right' }) },
      }),
    ],
  }
  const pageNumber = (id: string, y: number): PageNumberElement => registry.createElement('pageNumber', {
    id,
    x: 10,
    y,
    overrides: { width: 190, height: 6, format: '第 {{$page}} 页 / 共 {{$pages}} 页', numeral: 'cn-lower' },
  })
  page.footer.default = { height: 8, elements: [pageNumber('delivery-page', 280)] }
  page.footer.last = {
    height: 18,
    elements: [
      registry.createElement('text', {
        id: 'delivery-sender',
        x: 10,
        y: 270,
        overrides: { width: 90, height: 7, content: { kind: 'template', template: '送货人：{{order.sender}}' }, style: textStyle({ fontSize: 10 }) },
      }),
      registry.createElement('text', {
        id: 'delivery-receiver',
        x: 110,
        y: 270,
        overrides: { width: 90, height: 7, content: { kind: 'static', text: '收货人签字：' }, style: textStyle({ fontSize: 10 }) },
      }),
      registry.createElement('line', {
        id: 'delivery-receiver-line',
        x: 132,
        y: 276,
        overrides: { width: 60, height: 0 },
      }),
      pageNumber('delivery-page-last', 280),
    ],
  }
  page.elements = [
    registry.createElement('text', {
      id: 'delivery-customer',
      x: 10,
      y: 31,
      overrides: { width: 190, height: 6, content: { kind: 'template', template: '收货单位：{{customer.name}}　　联系人：{{customer.contact}}　　电话：{{customer.phone}}' }, style: textStyle({ fontSize: 10 }) },
    }),
    registry.createElement('text', {
      id: 'delivery-address',
      x: 10,
      y: 37,
      overrides: { width: 190, height: 6, content: { kind: 'field', field: 'customer.address' }, style: textStyle({ fontSize: 10 }) },
    }),
    registry.createElement('table', {
      id: 'delivery-items',
      x: 10,
      y: 45,
      overrides: {
        width: 190,
        height: 22,
        dataField: 'items',
        columns: [
          { id: 'no', title: '序号', width: 12, align: 'center', content: { kind: 'rowNumber' }, cellType: 'text' },
          { id: 'name', title: '品名及规格', width: 70, align: 'left', content: { kind: 'template', template: '{{name}}（{{spec}}）' }, cellType: 'text' },
          { id: 'unit', title: '单位', width: 16, align: 'center', content: { kind: 'field', field: 'unit' }, cellType: 'text' },
          { id: 'qty', title: '数量', width: 22, align: 'right', content: { kind: 'field', field: 'qty', format: { kind: 'number', decimals: 0, grouping: true } }, cellType: 'text' },
          { id: 'price', title: '单价', width: 30, align: 'right', content: { kind: 'field', field: 'price', format: money }, cellType: 'text' },
          { id: 'amount', title: '金额', width: 40, align: 'right', content: { kind: 'field', field: 'amount', format: money }, cellType: 'text' },
        ],
        header: { visible: true, repeat: true, height: 8, style: cellStyle({ bold: true, align: 'center', background: '#f2f2f2' }) },
        body: { rowHeight: 7, rowHeightMode: 'fixed', style: cellStyle() },
        footerRows: deliveryFooterRows(),
        maxRowsPerPage: 20,
        fillEmptyRows: true,
      },
    }),
    registry.createElement('longText', {
      id: 'delivery-remark',
      x: 10,
      y: 71,
      overrides: { width: 190, height: 10, content: { kind: 'template', template: '备注：{{order.remark}}' }, style: textStyle({ fontSize: 9.5, lineHeight: 1.5, verticalAlign: 'top', color: '#333333' }) },
    }),
  ]
  return page
}

const GOODS = [
  { name: '不锈钢六角螺栓', spec: 'M8×40', unit: '盒', price: 36.5 },
  { name: '平垫圈', spec: 'Φ8 镀锌', unit: '袋', price: 12.8 },
  { name: '尼龙扎带', spec: '4×200mm 白色', unit: '包', price: 9.9 },
  { name: '电缆桥架', spec: '200×100 热镀锌', unit: '米', price: 128 },
  { name: '阻燃电缆', spec: 'ZR-YJV 3×4', unit: '米', price: 21.6 },
  { name: '断路器', spec: '2P 32A', unit: '只', price: 88 },
  { name: '配电箱', spec: '明装 12 回路', unit: '台', price: 460 },
  { name: 'PVC 线管', spec: 'Φ20 中型', unit: '根', price: 6.4 },
  { name: '膨胀螺丝', spec: 'M10×80', unit: '盒', price: 42 },
  { name: '绝缘胶带', spec: '18mm×20m 黑色', unit: '卷', price: 3.5 },
  { name: '接线端子', spec: 'UK-2.5', unit: '包', price: 27 },
  { name: 'LED 面板灯', spec: '600×600 40W', unit: '套', price: 156 },
] as const

function deliveryData(): unknown {
  const items = Array.from({ length: 32 }, (_, index) => {
    const goods = GOODS[index % GOODS.length]!
    const qty = 5 + (index * 7) % 46
    return { ...goods, qty, amount: Math.round(qty * goods.price * 100) / 100 }
  })
  return {
    order: { no: 'SH-20261016-0007', date: '2026-10-16', sender: '王小川', remark: '货物请当面清点，如有破损或数量不符请在签收时注明。本单一式三联：存根、客户、财务。' },
    customer: { name: '曦寒示例建设工程有限公司', contact: '李工', phone: '0571-8888 6666', address: '送货地址：浙江省杭州市西湖区示例路 88 号 3 号楼' },
    items,
  }
}

function labelPage(): PrintPage {
  const page = createPage({ id: 'label', name: '商品标签', paper: { width: 100, height: 70 }, margins: 4 })
  page.elements = [
    registry.createElement('rect', {
      id: 'label-frame',
      x: 4,
      y: 4,
      overrides: { width: 92, height: 62, radius: 2, stroke: { width: 0.3, style: 'solid', color: '#000000' } },
    }),
    registry.createElement('text', {
      id: 'label-name',
      x: 8,
      y: 7,
      overrides: { width: 84, height: 8, content: { kind: 'field', field: 'name' }, style: textStyle({ fontSize: 14, bold: true }) },
    }),
    registry.createElement('text', {
      id: 'label-spec',
      x: 8,
      y: 16,
      overrides: { width: 84, height: 5, content: { kind: 'template', template: '规格：{{spec}}　　产地：{{origin}}' }, style: textStyle({ fontSize: 9, color: '#333333' }) },
    }),
    registry.createElement('text', {
      id: 'label-price-caption',
      x: 8,
      y: 23,
      overrides: { width: 14, height: 9, content: { kind: 'static', text: '零售价' }, style: textStyle({ fontSize: 9, verticalAlign: 'bottom' }) },
    }),
    registry.createElement('text', {
      id: 'label-price',
      x: 22,
      y: 22,
      overrides: { width: 44, height: 10, content: { kind: 'field', field: 'price', format: { kind: 'number', decimals: 2 } }, style: textStyle({ fontSize: 22, bold: true, verticalAlign: 'bottom' }) },
    }),
    registry.createElement('text', {
      id: 'label-batch',
      x: 66,
      y: 23,
      overrides: { width: 26, height: 9, content: { kind: 'template', template: '批号 {{batch}}' }, style: textStyle({ fontSize: 8, align: 'right', verticalAlign: 'bottom' }) },
    }),
    registry.createElement('line', {
      id: 'label-divider',
      x: 8,
      y: 34,
      overrides: { width: 84, height: 0, stroke: { width: 0.2, style: 'dashed', color: '#000000' } },
    }),
    registry.createElement('barCode', {
      id: 'label-ean',
      x: 8,
      y: 37,
      overrides: { width: 54, height: 22, format: 'ean13', content: { kind: 'field', field: 'sku' }, showText: true, textStyle: { fontSize: 9 } },
    }),
    registry.createElement('matrixCode', {
      id: 'label-qr',
      x: 69,
      y: 36,
      overrides: { width: 22, height: 22, format: 'qr', level: 'M', content: { kind: 'field', field: 'url' }, quietZone: 1 },
    }),
    registry.createElement('text', {
      id: 'label-qr-caption',
      x: 66,
      y: 59,
      overrides: { width: 28, height: 4, content: { kind: 'static', text: '扫码查看批次信息' }, style: textStyle({ fontSize: 6, align: 'center', color: '#333333' }) },
    }),
  ]
  return page
}

function labelData(): unknown {
  return {
    name: '有机高山绿茶 · 明前特级',
    spec: '250g / 罐',
    origin: '浙江 · 安吉',
    price: 168,
    batch: '20261016A',
    sku: '690123456789',
    url: 'https://www.xihanfun.com/?sku=6901234567892&batch=20261016A',
  }
}

const NOTICE_SECTIONS = [
  '一、自查范围。各部门在用的业务系统、办公终端、移动设备、共享文件夹与对外发布的网站，以及由部门自行采购或托管在外部的云服务，均纳入本次自查。',
  '二、账号与口令。逐一核对系统账号与在岗人员名单，离职、调岗人员的账号应在当日停用；共用账号须登记使用人；口令长度不少于十二位，不得与个人信息或历史口令相同。',
  '三、权限分配。按照最小授权原则复核各系统的角色与数据范围，临时授予的权限须写明到期时间；涉及客户信息、财务数据的查询与导出权限，由部门负责人逐项确认。',
  '四、终端与介质。办公电脑须开启自动锁屏与磁盘加密，及时安装系统补丁；外部存储介质实行登记管理，禁止在未经批准的设备上处理内部资料。',
  '五、数据备份。核对重要数据的备份周期、保存地点与保存期限，每季度至少完成一次恢复演练，并记录恢复所用时间与发现的问题。',
  '六、外包与合作方。梳理与外部单位的数据交换方式，确认合同中的保密条款与数据返还、销毁条款；合作结束后及时收回对方的访问权限。',
  '七、日志与留痕。关键系统的登录、授权变更与数据导出操作须保留日志，日志保存时间不少于六个月，并安排专人定期抽查。',
  '八、问题整改。自查发现的问题须填写整改清单，写明责任人与完成时限；不能按期完成的，须说明原因并提出临时控制措施。',
  '九、时间安排。各部门于本月二十五日前完成自查并提交自查报告与整改清单，信息中心将于下月上旬组织抽查，抽查结果纳入年度考核。',
  '十、联系方式。自查过程中如有疑问，请联系信息中心安全组，内线电话 6021，或在内部服务台提交工单。',
]

function noticePage(): PrintPage {
  const page = createPage({ id: 'notice', name: '内部通知' })
  page.watermark = { text: '内部资料 · {{dept}}', fontSize: 18, color: '#999999', opacity: 0.15, rotation: 30, gapX: 30, gapY: 30 }
  const headerText = (id: string, text: string, align: 'left' | 'right'): TextElement => registry.createElement('text', {
    id,
    x: 10,
    y: 10,
    overrides: { width: 190, height: 7, content: { kind: 'template', template: text }, style: textStyle({ fontSize: 9, align, color: '#555555' }) },
  })
  const headerLine = (id: string): LineElement => registry.createElement('line', {
    id,
    x: 10,
    y: 18,
    overrides: { width: 190, height: 0, stroke: { width: 0.3, style: 'solid', color: '#555555' } },
  })
  page.header.default = { height: 10, elements: [headerText('notice-header', '{{org}}', 'left'), headerLine('notice-header-line')] }
  page.header.odd = { height: 10, elements: [headerText('notice-header-odd', '{{title}}', 'right'), headerLine('notice-header-odd-line')] }
  page.header.even = { height: 10, elements: [headerText('notice-header-even', '{{org}} · 内部通知', 'left'), headerLine('notice-header-even-line')] }
  page.footer.default = {
    height: 8,
    elements: [
      registry.createElement('pageNumber', {
        id: 'notice-page',
        x: 10,
        y: 280,
        overrides: { width: 190, height: 6, format: '— {{$page}} —', numeral: 'roman-upper' },
      }),
    ],
  }
  page.elements = [
    registry.createElement('text', {
      id: 'notice-title',
      x: 10,
      y: 26,
      overrides: { width: 190, height: 12, content: { kind: 'field', field: 'title' }, style: textStyle({ fontSize: 16, bold: true, align: 'center' }) },
    }),
    registry.createElement('text', {
      id: 'notice-meta',
      x: 10,
      y: 39,
      overrides: { width: 190, height: 6, content: { kind: 'template', template: '发文部门：{{dept}}　　编号：{{no}}　　日期：{{date}}' }, style: textStyle({ fontSize: 9, align: 'center', color: '#555555' }) },
    }),
    registry.createElement('longText', {
      id: 'notice-body',
      x: 10,
      y: 50,
      overrides: { width: 190, height: 20, content: { kind: 'field', field: 'body' }, style: textStyle({ fontSize: 12, lineHeight: 2, verticalAlign: 'top' }) },
    }),
    registry.createElement('text', {
      id: 'notice-sign',
      x: 110,
      y: 74,
      overrides: { width: 90, height: 14, content: { kind: 'template', template: '{{dept}}\n{{date}}' }, wrap: true, style: textStyle({ fontSize: 12, align: 'right', verticalAlign: 'top', lineHeight: 1.6 }) },
    }),
    registry.createElement('longText', {
      id: 'notice-appendix',
      x: 10,
      y: 92,
      overrides: { width: 190, height: 20, content: { kind: 'field', field: 'appendix' }, style: textStyle({ fontSize: 11, lineHeight: 2, verticalAlign: 'top' }) },
    }),
  ]
  return page
}

const NOTICE_CHECKLIST = [
  '离职、调岗人员账号已停用',
  '共用账号已登记使用人',
  '管理员口令已按要求更换',
  '临时权限已写明到期时间',
  '客户信息导出权限已逐项确认',
  '办公电脑已开启自动锁屏',
  '办公电脑已开启磁盘加密',
  '系统补丁已更新到最新',
  '外部存储介质已登记',
  '重要数据备份周期已核对',
  '本季度恢复演练已完成',
  '合作方保密条款已确认',
  '合作结束方的访问权限已收回',
  '关键操作日志保存不少于六个月',
  '整改清单已写明责任人与时限',
  '自查报告已提交信息中心',
]

function noticeData(): unknown {
  const checklist = NOTICE_CHECKLIST.map((item, index) => `□ ${index + 1}. ${item}`)
  return {
    org: '曦寒示例科技有限公司',
    title: '关于开展年度信息安全自查工作的通知',
    dept: '信息中心',
    no: '信发〔2026〕17 号',
    date: '2026 年 10 月 16 日',
    body: ['各部门：', '为落实年度信息安全工作安排，及时发现并消除安全隐患，现就开展自查工作通知如下。', ...NOTICE_SECTIONS, '特此通知。'].join('\n'),
    appendix: ['附件：自查清单', ...checklist].join('\n'),
  }
}

/** 全部示例，按工具栏顺序排列。 */
export function createSamples(): PrintSample[] {
  return [
    { id: 'delivery', title: '送货单', schema: createDocument({ name: '送货单', pages: [deliveryPage()] }), data: deliveryData() },
    { id: 'label', title: '商品标签', schema: createDocument({ name: '商品标签', pages: [labelPage()] }), data: labelData() },
    { id: 'notice', title: '内部通知', schema: createDocument({ name: '内部通知', pages: [noticePage()] }), data: noticeData() },
  ]
}
