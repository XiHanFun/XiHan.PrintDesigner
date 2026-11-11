/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印客户端：连接、访问密钥与端口、退回浏览器打印与错误处理、任务状态、原始指令、PDF 打印、导出 PDF、接到预览元素上。

// #region connect
import type { XhPrintPreview } from '@xihan-print/runtime'
import type { PrintClientJob, PrinterInfo } from '@xihan-print/runtime/client'
import { createPrintClient, PrintClientError, printWithFallback } from '@xihan-print/runtime/client'
import { data, schema } from '../templates/delivery'

// 整个页面共用一个连接；创建时不连，第一次用到时才连
export const client = createPrintClient()

export function watchConsent(notify: (message: string) => void): () => void {
  // 网站第一次连接时，客户端在桌面上弹出授权窗口
  return client.on('consentpending', ({ origin }) => notify(`请在打印客户端弹出的窗口里允许 ${origin}`))
}
// #endregion connect

// #region access
// 客户端改了端口、设了访问密钥时，连接写上同一个端口、带上同样的密钥；密钥不对时连接以 ACCESS_DENIED 失败
export const lockedClient = createPrintClient({ ports: [18000], accessKey: 'k3y-for-erp-2026' })
// #endregion access

// #region fallback
export async function printDelivery(notify: (message: string) => void): Promise<void> {
  try {
    const outcome = await printWithFallback(client, schema, data, { printer: '仓库打印机', copies: 2, title: '送货单' })
    notify(outcome.via === 'client' ? `已交给打印机，共 ${outcome.sheets} 页` : '没有连上打印客户端，已改用浏览器打印')
  }
  catch (error) {
    if (!(error instanceof PrintClientError))
      throw error
    switch (error.code) {
      case 'LOCAL_NETWORK_DENIED':
        notify('浏览器拦下了到本机打印客户端的连接，请在网站设置里允许访问本机应用')
        break
      case 'CONSENT_DENIED':
      case 'CONSENT_TIMEOUT':
        notify('打印客户端没有允许这个网站打印')
        break
      case 'PRINTER_NOT_FOUND':
        notify(`找不到打印机 ${String(error.details.printer)}`)
        break
      default:
        notify(`打印失败：${error.code}`)
    }
  }
}
// #endregion fallback

// #region job
export async function printToDefault(onStatus: (text: string) => void): Promise<PrinterInfo | undefined> {
  const printers = await client.printers()
  const target = printers.find(item => item.isDefault)
  const job: PrintClientJob = client.printDocument(schema, data, { printer: target?.name, duplex: 'long-edge', pageRanges: '1' })
  job.onStatus((status) => {
    onStatus(status.position === undefined ? status.state : `${status.state}，前面还有 ${status.position} 个任务`)
  })
  // completed 时兑现，表示已交给系统的打印队列；failed 与 cancelled 时以错误拒绝
  await job.done
  return target
}
// #endregion job

// #region raw
export function printReceipt(): PrintClientJob {
  const bytes = new Uint8Array([
    0x1B,
    0x40, // ESC @ 初始化
    ...new TextEncoder().encode('ORDER 20261017-001\n\n\n'),
    0x1D,
    0x56,
    0x00, // GS V 0 切纸
  ])
  return client.printRaw('小票打印机', bytes, { docName: '小票' })
}
// #endregion raw

// #region print-pdf
export async function printInvoice(file: Blob): Promise<void> {
  // 浏览器拿到的 PDF 直接交给客户端，每页按自己的尺寸匹配打印机的纸张；从 2 号纸盒进纸，内容放大或缩小到正好放满纸张
  const job = client.printPdf(file, { printer: '财务打印机', docName: '电子发票', tray: '纸盒 2', scale: 'fit' })
  await job.done
}
// #endregion print-pdf

// #region options
export function printOddPagesOntoA4(): PrintClientJob {
  // 只打奇数页，每组都打到 A4 上并横放，比 A4 大的内容等比缩小
  return client.printDocument(schema, data, { pageSet: 'odd', paper: 'A4', orientation: 'landscape' })
}
// #endregion options

// #region pdf
export async function downloadPdf(): Promise<void> {
  const pdf = await client.exportPdf(schema, data)
  const url = URL.createObjectURL(pdf)
  const link = document.createElement('a')
  link.href = url
  link.download = '送货单.pdf'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
// #endregion pdf

// #region preview
export function usePrintClient(preview: XhPrintPreview): void {
  // preview.print() 先交给客户端，连不上时才调起浏览器的打印对话框
  preview.printClient = client
}
// #endregion preview
