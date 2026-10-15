/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PaginationResult, PrintDocument, PrintElement } from '@xihan-print/core'
import { paginate } from '@xihan-print/core'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderSheets, sheetPageName } from '../src'
import { boxIn, createFakeMeasurer, documentOf, pageOf, registry, textElement } from './fixtures'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
})

function layout(schema: PrintDocument, data: unknown = {}): PaginationResult {
  return paginate(schema, data, { measurer: createFakeMeasurer(), expressionEngine: createExpressionEngine(), formatter: formatValue })
}

function render(elements: PrintElement[], data: unknown = {}): HTMLDivElement[] {
  return renderSheets(layout(documentOf(pageOf('p', elements)), data), container)
}

describe('renderSheets', () => {
  it('清空容器后按顺序放入输出页，输出页按纸张尺寸定宽高并带具名页面', () => {
    container.append(document.createElement('span'))
    const sheets = renderSheets(layout(documentOf(pageOf('a', []), pageOf('b', [], { id: 'b', paper: 'A5', orientation: 'landscape' }))), container)
    expect(Array.from(container.children)).toEqual(sheets)
    expect(sheets.map(sheet => [sheet.dataset.pageId, sheet.style.width, sheet.style.height])).toEqual([
      ['a', '210mm', '297mm'],
      ['b', '210mm', '148mm'],
    ])
    expect(sheets[0]!.style.getPropertyValue('page')).toBe(sheetPageName({ width: 210, height: 297 }))
    expect(sheetPageName({ width: 215.9, height: 279.4 })).toBe('xh-print-215_9x279_4')
  })

  it('元素按毫米绝对定位，带元素标识与种类；旋转绕中心顺时针', () => {
    const rect = registry.createElement('rect', { id: 'r', x: 12.5, y: 30, overrides: { width: 40, height: 20, rotation: 15 } })
    render([rect])
    const box = boxIn(container, 'r')
    expect(box.dataset.kind).toBe('rect')
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['12.5mm', '30mm', '40mm', '20mm'])
    expect(box.style.transform).toBe('rotate(15deg)')
  })

  it('只在预览中显示的元素在送去打印时不画', () => {
    const hint = { ...textElement('hint', '仅预览'), previewOnly: true }
    const result = layout(documentOf(pageOf('p', [hint, textElement('t', '正文', 10, 60)])))
    renderSheets(result, container)
    expect(boxIn(container, 'hint').hasAttribute('data-preview-only')).toBe(true)
    renderSheets(result, container, { previewOnly: false })
    expect(container.querySelector('[data-element-id="hint"]')).toBeNull()
    expect(boxIn(container, 't')).toBeDefined()
  })
})

describe('水印', () => {
  it('按模板铺满整张输出页：颜色与透明度写进图样，旋转方向取反，间距按毫米换成像素', () => {
    const page = pageOf('p', [])
    page.watermark = { text: '机密 {{no}}', fontSize: 12, color: '#999999', opacity: 0.2, rotation: 30, gapX: 25.4, gapY: 0 }
    const [sheet] = renderSheets(layout(documentOf(page), { no: 'A-1' }), container)
    const layer = sheet!.querySelector<HTMLElement>('[data-part="watermark"]')!
    expect(layer.style.backgroundRepeat).toBe('repeat')
    const image = layer.style.backgroundImage
    const svg = decodeURIComponent(image.slice(image.indexOf(',') + 1, image.lastIndexOf('"')))
    expect(svg).toContain('rotate(-30 ')
    expect(svg).toContain('fill="#999999" fill-opacity="0.2"')
    expect(svg).toContain('机密 A-1')
    expect(layer.style.backgroundSize).toMatch(/^\d+px \d+px$/)
  })

  it('没有水印或文字为空时不铺', () => {
    const page = pageOf('p', [])
    page.watermark = { text: '  ', fontSize: 12, color: '#999999', opacity: 0.2, rotation: 0, gapX: 10, gapY: 10 }
    const [sheet] = renderSheets(layout(documentOf(page, pageOf('q', []))), container)
    expect(sheet!.querySelector('[data-part="watermark"]')).toBeNull()
    expect(container.querySelectorAll('[data-part="watermark"]')).toHaveLength(0)
  })
})

describe('文本', () => {
  it('按 core 排好的行逐行输出，字号、行高、字间距与颜色来自文字样式', () => {
    const text = registry.createElement('text', {
      id: 't',
      x: 0,
      y: 0,
      overrides: { width: 10, height: 30, wrap: true, content: { kind: 'static', text: '字'.repeat(7) } },
    })
    text.style = { ...text.style, fontSize: 10, lineHeight: 1.5, letterSpacing: 0, color: '#123456', bold: true, underline: true, align: 'right', verticalAlign: 'bottom' }
    render([text])
    const box = boxIn(container, 't')
    const content = box.querySelector<HTMLElement>('[data-part="text"]')!
    expect(Array.from(content.children, line => line.textContent)).toEqual(['字'.repeat(5), '字'.repeat(2)])
    expect(content.style.fontSize).toBe('10pt')
    expect(content.style.lineHeight).toBe('15pt')
    expect(content.style.fontWeight).toBe('700')
    expect(content.style.textAlign).toBe('right')
    expect(content.style.justifyContent).toBe('flex-end')
    expect(content.style.getPropertyValue('text-decoration-line')).toBe('underline')
    expect(content.style.color).toBe('rgb(18, 52, 86)')
    expect((content.children[0] as HTMLElement).style.height).toBe('15pt')
  })

  it('裁切的文本框隐藏溢出，盒样式写背景、描边与内边距', () => {
    const text = registry.createElement('text', {
      id: 't',
      x: 0,
      y: 0,
      overrides: {
        overflow: 'clip',
        content: { kind: 'static', text: 'x' },
        box: { background: '#eeeeee', border: { top: { width: 0.3, style: 'dashed', color: '#000000' } }, padding: { top: 1, right: 2, bottom: 1, left: 2 } },
      },
    })
    render([text])
    const box = boxIn(container, 't')
    expect(box.style.overflow).toBe('hidden')
    expect(box.style.backgroundColor).toBe('rgb(238, 238, 238)')
    expect(box.style.borderTop).toBe('0.3mm dashed rgb(0, 0, 0)')
    expect(box.style.padding).toBe('1mm 2mm')
  })
})

describe('图形与图片', () => {
  it('矩形与椭圆用描边与圆角，直线用 SVG，双线画成两条', () => {
    const rect = registry.createElement('rect', { id: 'r', x: 0, y: 0, overrides: { radius: 2, fill: '#ff0000', stroke: { width: 0.5, style: 'solid', color: '#000000' } } })
    const ellipse = registry.createElement('ellipse', { id: 'e', x: 0, y: 40 })
    const line = registry.createElement('line', { id: 'l', x: 0, y: 80, overrides: { direction: 'diagonalDown', stroke: { width: 0.3, style: 'double', color: '#000000' } } })
    render([rect, ellipse, line])
    expect(boxIn(container, 'r').style.borderRadius).toBe('2mm')
    expect(boxIn(container, 'r').style.border).toBe('0.5mm solid rgb(0, 0, 0)')
    expect(boxIn(container, 'e').style.borderRadius).toBe('50%')
    expect(boxIn(container, 'l').querySelectorAll('line')).toHaveLength(2)
  })

  it('图片按地址加载并按 fit 铺放，地址为空时不放图片', () => {
    const image = registry.createElement('image', { id: 'i', x: 0, y: 0, overrides: { source: { kind: 'field', field: 'photo' }, fit: 'cover' } })
    render([image], { photo: 'https://example.com/a.png' })
    const img = boxIn(container, 'i').querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://example.com/a.png')
    expect(img.style.objectFit).toBe('cover')
    render([image], { photo: 'javascript:alert(1)' })
    expect(boxIn(container, 'i').querySelector('img')).toBeNull()
  })
})

describe('条码与二维码', () => {
  it('条码按 headless 的几何画条，人读文字按模板字号排在条下', () => {
    const bar = registry.createElement('barCode', {
      id: 'b',
      x: 0,
      y: 0,
      overrides: { format: 'ean13', width: 40, height: 20, showText: true, content: { kind: 'static', text: '400638133393' } },
    })
    render([bar])
    const svg = boxIn(container, 'b').querySelector('svg')!
    expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M/)
    const texts = Array.from(svg.querySelectorAll('text'), node => node.textContent)
    expect(texts.join('')).toBe('4006381333931')
  })

  it('不能编码的条码内容不画', () => {
    const bar = registry.createElement('barCode', { id: 'b', x: 0, y: 0, overrides: { format: 'ean13', content: { kind: 'field', field: 'sku' } } })
    render([bar], { sku: '12' })
    expect(boxIn(container, 'b').querySelector('svg')).toBeNull()
  })

  it('二维码等比放进元素框，背景铺满视图', () => {
    const qr = registry.createElement('matrixCode', {
      id: 'q',
      x: 0,
      y: 0,
      overrides: { content: { kind: 'static', text: 'https://ui.xihanfun.com' }, background: '#ffffff', quietZone: 2 },
    })
    render([qr])
    const svg = boxIn(container, 'q').querySelector('svg')!
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff')
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2)
  })
})

describe('表格', () => {
  it('行与单元格换算到表格框内，文字按单元格行输出，网格线画在最上层', () => {
    const table = registry.createElement('table', {
      id: 't',
      x: 10,
      y: 20,
      overrides: {
        width: 60,
        dataField: 'items',
        columns: [
          { id: 'name', title: '品名', width: 40, align: 'left', content: { kind: 'field', field: 'name' }, cellType: 'text' },
          { id: 'qty', title: '数量', width: 20, align: 'right', content: { kind: 'field', field: 'qty' }, cellType: 'text' },
        ],
      },
    })
    render([table], { items: [{ name: '甲', qty: 1 }, { name: '乙', qty: 2 }] })
    const box = boxIn(container, 't')
    const rows = Array.from(box.querySelectorAll<HTMLElement>('[data-part="row"]'))
    expect(rows.map(row => row.dataset.role)).toEqual(['header', 'body', 'body'])
    expect(rows[0]!.style.top).toBe('0mm')
    const cells = Array.from(rows[1]!.querySelectorAll<HTMLElement>('[data-part="cell"]'))
    expect(cells.map(cell => [cell.dataset.columnId, cell.style.left, cell.style.width, cell.textContent])).toEqual([
      ['name', '0mm', '40mm', '甲'],
      ['qty', '40mm', '20mm', '1'],
    ])
    expect(box.lastElementChild!.tagName.toLowerCase()).toBe('svg')
    expect(box.lastElementChild!.querySelectorAll('line').length).toBeGreaterThan(0)
  })
})
