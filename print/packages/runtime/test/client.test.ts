/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @vitest-environment jsdom

import type { PaginationResult, PrintElement } from '@xihan-print/core'
import type { JobState, PrintClientOptions } from '../src/client'
import type { Message } from './client-fakes'
import { paginate } from '@xihan-print/core'
import { createExpressionEngine, formatValue } from '@xihan-ui/expression'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildClientDocument, createPrintClient, PrintClientError, shouldFallBack } from '../src/client'
import { FakeApp, FakeSocket, FakeWebSocket, settle } from './client-fakes'
import { createFakeMeasurer, documentOf, pageOf, registry, textElement } from './fixtures'

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])

function layout(...pages: Parameters<typeof pageOf>[]): PaginationResult {
  return paginate(documentOf(...pages.map(args => pageOf(...args))), {}, { measurer: createFakeMeasurer(), expressionEngine: createExpressionEngine(), formatter: formatValue })
}

function client(options: PrintClientOptions = {}): ReturnType<typeof createPrintClient> {
  return createPrintClient({ ports: [17620, 17621], WebSocket: FakeWebSocket, permissions: null, secureContext: true, timeoutMs: 1_000, ...options })
}

function listen(port = 17620): FakeApp {
  const app = new FakeApp()
  FakeSocket.ports.set(port, app)
  return app
}

/** 受理任务并依次推送事件。 */
function accept(socket: FakeSocket, request: Message, events: Array<{ readonly state: JobState } & Record<string, unknown>>): void {
  socket.reply(request, { jobId: request.jobId, position: 0 })
  for (const { state, ...fields } of events)
    socket.push({ type: `job.${state}`, jobId: request.jobId, ...fields, at: '2026-10-16T12:00:00Z' })
}

/** jsdom 的 Blob 没有 text()，经 FileReader 读。 */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function rejection(promise: Promise<unknown>): Promise<PrintClientError> {
  const error = await promise.then(() => undefined, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(PrintClientError)
  return error as PrintClientError
}

beforeEach(() => {
  FakeSocket.reset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('连接', () => {
  it('按顺序探测端口，连上第一个应答的并握手，已连着时不再重连', async () => {
    listen(17621)
    const target = client()
    const states: string[] = []
    target.on('state', state => states.push(state))

    const welcome = await target.connect()

    expect(welcome.client.renderer).toBe('155.0.4283.45')
    expect(welcome).not.toHaveProperty('sessionToken')
    expect(FakeSocket.created.map(socket => socket.url)).toEqual(['ws://127.0.0.1:17620/', 'ws://127.0.0.1:17621/'])
    expect(FakeSocket.created[1]!.protocols).toEqual(['xihan-print.v1', 'xihan-print'])
    expect(FakeSocket.created[1]!.sent[0]).toMatchObject({ type: 'hello', protocol: 1, minor: 0, sdk: { name: '@xihan-print/runtime' } })
    expect(FakeSocket.created[1]!.sent[0]).not.toHaveProperty('resume')
    expect(states).toEqual(['connecting', 'open'])
    expect(await target.connect()).toBe(welcome)
    expect(FakeSocket.created).toHaveLength(2)
  })

  it('客户端只认不带版本的子协议时报 PROTOCOL_UNSUPPORTED，可以退回浏览器打印', async () => {
    listen().protocol = 'xihan-print'

    const error = await rejection(client({ ports: [17620] }).connect())

    expect(error.code).toBe('PROTOCOL_UNSUPPORTED')
    expect(error.details).toEqual({ supported: [1] })
    expect(shouldFallBack(error)).toBe(true)
  })

  it('分清浏览器拦下了本机连接与客户端没在运行', async () => {
    const denied = { query: async () => ({ state: 'denied' }) }
    const granted = { query: async () => ({ state: 'granted' }) }
    const unknown = { query: async () => Promise.reject(new TypeError('unknown permission')) }

    expect((await rejection(client({ permissions: denied }).connect())).code).toBe('LOCAL_NETWORK_DENIED')
    expect((await rejection(client({ permissions: granted }).connect())).code).toBe('CLIENT_UNAVAILABLE')
    expect((await rejection(client({ permissions: unknown }).connect())).code).toBe('CLIENT_UNAVAILABLE')
    const insecure = await rejection(client({ secureContext: false }).connect())
    expect([insecure.code, insecure.details.reason]).toEqual(['LOCAL_NETWORK_DENIED', 'insecure-context'])
    expect(shouldFallBack(insecure)).toBe(false)
  })

  it('客户端弹授权窗口时派发 consentpending，并按授权期限等用户决定', async () => {
    const app = listen()
    let answer: (() => void) | undefined
    app.hello = (socket, hello) => {
      socket.push({ type: 'consent.pending', origin: 'https://erp.example.com' })
      answer = () => socket.reply(hello, app.welcome())
    }
    const target = client({ timeoutMs: 50, consentTimeoutMs: 5_000 })
    const pending: string[] = []
    target.on('consentpending', ({ origin }) => pending.push(origin))

    const connecting = target.connect()
    await settle()
    await new Promise(resolve => setTimeout(resolve, 100))
    answer!()

    expect((await connecting).capabilities.pdf).toBe(true)
    expect(pending).toEqual(['https://erp.example.com'])
  })

  it('来源被拒时报 CONSENT_DENIED，不退回浏览器打印', async () => {
    listen().hello = (socket, hello) => {
      socket.fail(hello, 'CONSENT_DENIED')
      socket.drop(4401)
    }

    const error = await rejection(client().connect())

    expect(error.code).toBe('CONSENT_DENIED')
    expect(shouldFallBack(error)).toBe(false)
  })

  it('同一来源连接数超限时报 TOO_MANY_CONNECTIONS', async () => {
    listen().hello = socket => socket.drop(4409)

    expect((await rejection(client({ ports: [17620] }).connect())).code).toBe('TOO_MANY_CONNECTIONS')
  })
})

describe('请求', () => {
  it('列出打印机，查不到时带上客户端的错误码与详情', async () => {
    const app = listen()
    app.handlers['printers.list'] = (socket, request) => socket.reply(request, [{ name: 'Office', isDefault: true, status: 'ready', statusFlags: 0, isNetwork: false }])
    app.handlers['printers.get'] = (socket, request) => socket.fail(request, 'PRINTER_NOT_FOUND', { printer: request.name })
    const target = client()

    expect((await target.printers()).map(printer => printer.name)).toEqual(['Office'])
    const error = await rejection(target.printer('Missing'))
    expect([error.code, error.details.printer]).toEqual(['PRINTER_NOT_FOUND', 'Missing'])
  })

  it('期限内没有应答的请求报 TIMEOUT', async () => {
    listen()
    const target = client({ timeoutMs: 30 })

    expect((await rejection(target.printers())).code).toBe('TIMEOUT')
  })

  it('断线时等结果的请求报 CONNECTION_LOST', async () => {
    const app = listen()
    app.handlers['printers.list'] = socket => socket.drop(1006)
    const target = client({ reconnect: false })

    expect((await rejection(target.printers())).code).toBe('CONNECTION_LOST')
    expect(target.state).toBe('idle')
  })
})

describe('任务', () => {
  it('写原始指令并跟着事件走到 completed，重复的状态不重复通知', async () => {
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => accept(socket, request, [{ state: 'queued', position: 0 }, { state: 'started' }, { state: 'completed', bytes: 3 }])
    const job = client().printRaw('Label', 'ABC', { docName: '发货标签' })
    const states: string[] = []
    job.onStatus(status => states.push(status.state))

    const status = await job.done

    expect(status).toEqual({ jobId: job.id, state: 'completed', bytes: 3 })
    expect(states).toEqual(['queued', 'started', 'completed'])
    expect(job.id).toMatch(/^[0-9a-f]{32}$/)
    expect(app.request('print.raw')).toMatchObject({ jobId: job.id, printer: 'Label', data: 'QUJD', docName: '发货标签' })
  })

  it('failed 以客户端的错误拒绝，cancelled 以 JOB_CANCELLED 拒绝', async () => {
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => request.printer === 'Office'
      ? accept(socket, request, [{ state: 'started' }, { state: 'failed', error: { code: 'SPOOL_FAILED', message: '交给打印池失败', details: { win32Error: 5 } } }])
      : accept(socket, request, [{ state: 'cancelled' }])
    const target = client()

    const failed = await rejection(target.printRaw('Office', new Uint8Array([1])).done)
    expect([failed.code, failed.message, failed.details.win32Error]).toEqual(['SPOOL_FAILED', '交给打印池失败', 5])
    expect((await rejection(target.printRaw('Label', new Uint8Array([1]).buffer).done)).code).toBe('JOB_CANCELLED')
  })

  it('经客户端取消排队中的任务', async () => {
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => accept(socket, request, [{ state: 'queued', position: 1 }])
    app.handlers['job.cancel'] = (socket, request) => {
      socket.push({ type: 'job.cancelled', jobId: request.jobId })
      socket.reply(request, { cancelled: true })
    }
    const job = client().printRaw('Label', 'X')
    await vi.waitFor(() => expect(job.status?.state).toBe('queued'))

    expect(await job.cancel()).toBe(true)
    expect((await rejection(job.done)).code).toBe('JOB_CANCELLED')
    expect(await job.cancel()).toBe(false)
  })

  it('连不上客户端时任务在发送前就失败', async () => {
    const job = client().printRaw('Label', 'X')

    const error = await rejection(job.done)

    expect(error.code).toBe('CLIENT_UNAVAILABLE')
    expect(job.status).toBeUndefined()
  })

  it('输出页与打印选项一起交给客户端，纸张分组按出现顺序', async () => {
    const app = listen()
    const warning = { code: 'PAPER_FITTED', message: '改用了最接近的纸张', details: { group: 1, scale: 1 } }
    app.handlers['print.html'] = (socket, request) => accept(socket, request, [{ state: 'completed', sheets: 2, warnings: [warning] }])
    const result = layout(['a', [textElement('t', '一')]], ['b', [textElement('u', '二')], { id: 'b', paper: 'A5' }])

    const status = await client().printSheets(result, { printer: 'Office', copies: 2, duplex: 'long-edge', pageRanges: '1-2', fitToNearestPaper: true }).done

    expect(status.sheets).toBe(2)
    expect(status.warnings).toEqual([warning])
    const request = app.request('print.html')!
    expect(request).toMatchObject({ printer: 'Office', options: { copies: 2, duplex: 'long-edge', pageRanges: '1-2', fitToNearestPaper: true } })
    expect(request.document.sheets).toEqual([{ widthMm: 210, heightMm: 297, count: 1 }, { widthMm: 148, heightMm: 210, count: 1 }])
    expect(request.document.html.match(/<div data-part="sheet"/g)).toHaveLength(2)
  })

  it('导出 PDF：job.output 之后的二进制消息即 PDF，不带打印机', async () => {
    const app = listen()
    app.handlers['export.pdf'] = (socket, request) => {
      socket.reply(request, { jobId: request.jobId, position: 0 })
      socket.push({ type: 'job.started', jobId: request.jobId })
      socket.push({ type: 'job.output', jobId: request.jobId, mime: 'application/pdf', bytes: 8 })
      socket.pushBinary(new Blob(['%PDF-1.7']))
      socket.push({ type: 'job.completed', jobId: request.jobId, bytes: 8 })
    }

    const pdf = await client().exportSheetsPdf(layout(['a', [textElement('t', '一')]]), { printer: 'Ignored', color: 'grayscale' })

    expect(pdf.type).toBe('application/pdf')
    expect(await readText(pdf)).toBe('%PDF-1.7')
    const request = app.request('export.pdf')!
    expect(request).not.toHaveProperty('printer')
    expect(request.options).toEqual({ color: 'grayscale' })
  })
})

describe('心跳与重连', () => {
  it('每 15 秒发一次心跳，客户端不应答时断开', async () => {
    vi.useFakeTimers()
    const app = listen()
    const target = client({ reconnect: false })
    const connecting = target.connect()
    await vi.advanceTimersByTimeAsync(10)
    await connecting

    await vi.advanceTimersByTimeAsync(15_000)
    expect(app.last.sent.filter(message => message.type === 'ping')).toHaveLength(1)
    app.receive = () => undefined
    await vi.advanceTimersByTimeAsync(15_000 + 1_000 + 10)

    expect(target.state).toBe('idle')
  })

  it('断线后带 resume 令牌重连，认回的任务继续跟，没被认领的补查状态', async () => {
    vi.useFakeTimers()
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => accept(socket, request, [{ state: 'started' }])
    const target = client()
    const first = target.printRaw('Label', 'A')
    const second = target.printRaw('Label', 'B')
    await vi.advanceTimersByTimeAsync(50)
    expect([first.status?.state, second.status?.state]).toEqual(['started', 'started'])

    app.token = 'token-2'
    app.hello = (socket, hello) => {
      socket.reply(hello, app.welcome([first.id]))
      socket.push({ type: 'job.started', jobId: first.id })
      socket.push({ type: 'job.completed', jobId: first.id, bytes: 1 })
    }
    app.handlers['job.get'] = (socket, request) => socket.reply(request, { jobId: request.jobId, state: 'completed', bytes: 1 })
    app.last.drop(1006)
    await vi.advanceTimersByTimeAsync(5)
    expect(target.state).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(target.state).toBe('open')
    expect(app.last.sent[0]).toMatchObject({ type: 'hello', resume: 'token-1' })
    expect((await first.done).bytes).toBe(1)
    expect((await second.done).state).toBe('completed')
    expect(app.request('job.get')).toMatchObject({ jobId: second.id })
  })

  it('重连后客户端查不到的任务以 CONNECTION_LOST 结束', async () => {
    vi.useFakeTimers()
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => accept(socket, request, [{ state: 'queued' }])
    const job = client().printRaw('Label', 'A')
    await vi.advanceTimersByTimeAsync(50)

    app.handlers['job.get'] = (socket, request) => socket.fail(request, 'JOB_NOT_FOUND')
    app.last.drop(1006)
    await vi.advanceTimersByTimeAsync(1_000)

    expect((await rejection(job.done)).code).toBe('CONNECTION_LOST')
  })

  it('没有未结束的任务时重连几次就停', async () => {
    vi.useFakeTimers()
    const app = listen()
    const target = client()
    const connecting = target.connect()
    await vi.advanceTimersByTimeAsync(10)
    await connecting

    FakeSocket.ports.clear()
    app.last.drop(1006)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(target.state).toBe('idle')
    expect(FakeSocket.created).toHaveLength(1 + 5 * 2)
  })

  it('close() 后不再重连，未结束的任务以 CONNECTION_LOST 结束', async () => {
    vi.useFakeTimers()
    const app = listen()
    app.handlers['print.raw'] = (socket, request) => accept(socket, request, [{ state: 'started' }])
    const target = client()
    const connecting = target.connect()
    await vi.advanceTimersByTimeAsync(10)
    await connecting
    const job = target.printRaw('Label', 'A')
    await vi.advanceTimersByTimeAsync(10)

    target.close()

    expect(target.state).toBe('closed')
    expect((await rejection(job.done)).code).toBe('CONNECTION_LOST')
    FakeSocket.ports.clear()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.created).toHaveLength(1)
  })
})

describe('buildClientDocument', () => {
  function fetcher(responses: Record<string, { readonly bytes: Uint8Array<ArrayBuffer>, readonly type: string } | number>): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const response = responses[url]
      if (response === undefined)
        throw new TypeError('Failed to fetch')
      return typeof response === 'number' ? new Response(null, { status: response }) : new Response(response.bytes, { headers: { 'content-type': response.type } })
    }) as unknown as typeof fetch
  }

  function imageElement(id: string, url: string): PrintElement {
    return registry.createElement('image', { id, x: 0, y: 0, overrides: { source: { kind: 'static', url } } })
  }

  it('图片同一地址只取一次，改写成任务资源地址，data: 地址原样保留', async () => {
    const fetch = fetcher({ 'https://cdn.example.com/logo.png': { bytes: PNG, type: 'image/png' } })
    const result = layout(['a', [imageElement('i', 'https://cdn.example.com/logo.png'), imageElement('j', 'https://cdn.example.com/logo.png'), imageElement('k', 'data:image/png;base64,iVBO')]])

    const document = await buildClientDocument(result, { fetch })

    expect(document.resources).toEqual([{ id: '0', type: 'image/png', data: 'iVBORw==' }])
    expect(document.html.match(/src="https:\/\/print\.local\/r\/0"/g)).toHaveLength(2)
    expect(document.html).toContain('src="data:image/png;base64,iVBO"')
    expect(document.html).not.toContain('cdn.example.com')
    expect(document.html).toMatch(/^<!doctype html>/)
    expect(document.html).toContain('@page xh-print-210x297 { size: 210mm 297mm; margin: 0; }')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('取不到的资源报 RESOURCE_BLOCKED，不静默丢掉', async () => {
    const missing = await rejection(buildClientDocument(layout(['a', [imageElement('i', 'https://cdn.example.com/a.png')]]), { fetch: fetcher({}) }))
    const forbidden = await rejection(buildClientDocument(layout(['a', [imageElement('i', 'https://cdn.example.com/a.png')]]), { fetch: fetcher({ 'https://cdn.example.com/a.png': 403 }) }))

    expect([missing.code, missing.details.url]).toEqual(['RESOURCE_BLOCKED', 'https://cdn.example.com/a.png'])
    expect([forbidden.code, forbidden.details.status]).toEqual(['RESOURCE_BLOCKED', 403])
  })

  it('只带模板用到的网络字体，每条只取第一个 url()', async () => {
    // jsdom 的 CSS 解析会丢掉 @font-face 的 src，这里换成浏览器给出的样式表形状
    const face = (descriptors: Record<string, string>): CSSRule => ({
      cssText: `@font-face { font-family: ${descriptors['font-family']}; }`,
      style: { getPropertyValue: (name: string) => descriptors[name] ?? '' },
    }) as unknown as CSSRule
    const sheet = {
      href: 'https://fonts.example.com/css/app.css',
      cssRules: [
        face({ 'font-family': '"XiHan Test"', 'src': 'url("../fonts/test.woff2") format("woff2"), url("../fonts/test.woff") format("woff")', 'font-weight': '700' }),
        face({ 'font-family': 'Unused', 'src': 'url("../fonts/unused.woff2")' }),
      ],
    }
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([sheet] as unknown as StyleSheetList)
    const text = textElement('t', '一')
    ;(text as PrintElement & { style: { fontFamily?: string } }).style.fontFamily = '"XiHan Test", sans-serif'
    const fetch = fetcher({ 'https://fonts.example.com/fonts/test.woff2': { bytes: new Uint8Array([1, 2]), type: 'font/woff2' } })

    const built = await buildClientDocument(layout(['a', [text]]), { fetch })

    expect(built.resources).toEqual([{ id: '0', type: 'font/woff2', data: 'AQI=' }])
    expect(built.html).toContain('@font-face { font-family: "XiHan Test"; src: url("https://print.local/r/0"); font-weight: 700; }')
    expect(built.html).not.toContain('Unused')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('资源总量超过 64 MiB 时报 DOCUMENT_TOO_LARGE', async () => {
    const big = { bytes: new Uint8Array(64 * 1024 * 1024 + 1), type: 'image/png' }
    const error = await rejection(buildClientDocument(layout(['a', [imageElement('i', 'https://cdn.example.com/big.png')]]), { fetch: fetcher({ 'https://cdn.example.com/big.png': big }) }))

    expect(error.code).toBe('DOCUMENT_TOO_LARGE')
  })
})
