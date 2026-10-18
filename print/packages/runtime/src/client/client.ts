/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PaginationResult, PrintDocument } from '@xihan-print/core'
import type { PrintRenderOptions } from '../options'
import type { ClientDocumentOptions } from './document'
import type { ClientErrorPayload, ClientPrintOptions, ClientWelcome, JobState, JobStatus, PrinterInfo } from './protocol'
import { paginateDocument } from '../print'
import { toBase64 } from './base64'
import { buildClientDocument } from './document'
import { PrintClientError } from './errors'
import { DEFAULT_PORTS, PROTOCOL_MINOR, PROTOCOL_VERSION, SUB_PROTOCOL, UNVERSIONED_SUB_PROTOCOL } from './protocol'

/** SDK 的名称，写进握手。 */
const SDK_NAME = '@xihan-print/runtime'
/** 心跳间隔：客户端 45 秒收不到消息就断开。 */
const HEARTBEAT_MS = 15_000
/** 重连的退避上限。 */
const RECONNECT_MAX_MS = 10_000
/** 客户端为断线的会话保留任务的期限，过了就不再重连认领。 */
const RESUME_WINDOW_MS = 10 * 60_000
/** 没有未结束任务时最多重连几次。 */
const IDLE_RECONNECT_ATTEMPTS = 5

/** 连接状态。 */
export type PrintClientState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

/** 能当 WebSocket 用的构造函数，单测可注入假实现。 */
export type WebSocketConstructor = new (url: string, protocols: string[]) => WebSocket

/** 查浏览器权限的入口，形同 navigator.permissions。 */
export interface PermissionsLike {
  query: (descriptor: { readonly name: string }) => Promise<{ readonly state: string }>
}

/** createPrintClient 的选项。 */
export interface PrintClientOptions {
  /** 按顺序探测的端口，缺省 17620–17623。 */
  readonly ports?: readonly number[]
  /** 请求等响应的期限，缺省 10 秒。 */
  readonly timeoutMs?: number
  /** 每个端口建连的期限，缺省 3 秒。 */
  readonly connectTimeoutMs?: number
  /** 客户端弹出授权窗口后等用户决定的期限，缺省 75 秒。 */
  readonly consentTimeoutMs?: number
  /** 断线后是否自动重连，缺省 true。 */
  readonly reconnect?: boolean
  /** WebSocket 构造函数，缺省为全局 WebSocket。 */
  readonly WebSocket?: WebSocketConstructor
  /** 查本机网络权限的入口，缺省为 navigator.permissions；为 null 时不查。 */
  readonly permissions?: PermissionsLike | null
  /** 页面是否是安全上下文，缺省为全局 isSecureContext。 */
  readonly secureContext?: boolean
  /** 打包文档时取资源用的 fetch，缺省为全局 fetch。 */
  readonly fetch?: typeof fetch
}

/** 打印与导出的选项：客户端打印选项、分页注入项与打包文档的选项。 */
export interface PrintClientDocumentOptions extends ClientPrintOptions, PrintRenderOptions, Pick<ClientDocumentOptions, 'document'> {}

/** 写原始指令的选项。 */
export interface PrintRawOptions {
  /** 打印池里显示的文档名，缺省为任务标识。 */
  readonly docName?: string
}

/** 一个交给客户端的任务。 */
export interface PrintClientJob {
  /** 任务标识，由 SDK 生成。 */
  readonly id: string
  /** 最近一次的状态；还没交给客户端时为 undefined。 */
  readonly status: JobStatus | undefined
  /** completed 时兑现；failed 时以客户端给出的错误码拒绝，cancelled 时以 JOB_CANCELLED 拒绝，发送前出错时以对应错误拒绝。 */
  readonly done: Promise<JobStatus>
  /** 订阅状态变化，返回退订函数。 */
  onStatus: (listener: (status: JobStatus) => void) => () => void
  /** 取消任务：排队中的立即取消并返回 true；执行中的尽力取消并返回 false，结果以状态为准。 */
  cancel: () => Promise<boolean>
}

/** 客户端派发的事件。 */
export interface PrintClientEventMap {
  /** 连接状态变化。 */
  state: PrintClientState
  /** 来源还没授权，客户端已弹出授权窗口。 */
  consentpending: { readonly origin: string }
}

/** 本地打印客户端的连接。 */
export interface PrintClient {
  /** 连接状态。 */
  readonly state: PrintClientState
  /** 最近一次握手的结果；还没连上过时为 undefined。 */
  readonly welcome: ClientWelcome | undefined
  /** 连接并握手；已连着时直接返回握手结果。连不上抛 PrintClientError，码为 CLIENT_UNAVAILABLE、LOCAL_NETWORK_DENIED、PROTOCOL_UNSUPPORTED、CONSENT_DENIED、CONSENT_TIMEOUT 等。 */
  connect: () => Promise<ClientWelcome>
  /** 断开连接，不再重连；未结束的任务以 CONNECTION_LOST 拒绝，客户端里的任务照常执行完。 */
  close: () => void
  /** 列出打印机，不含能力明细。 */
  printers: () => Promise<PrinterInfo[]>
  /** 查一台打印机，含能力明细。 */
  printer: (name: string) => Promise<PrinterInfo>
  /** 按数据排出模板并交给客户端打印。 */
  printDocument: (schema: PrintDocument, data: unknown, options?: PrintClientDocumentOptions) => PrintClientJob
  /** 把排好的输出页交给客户端打印。 */
  printSheets: (result: PaginationResult, options?: PrintClientDocumentOptions) => PrintClientJob
  /** 把原始指令原样写给打印机；字符串按 UTF-8 编码，要别的编码时先转成字节。 */
  printRaw: (printer: string, data: Uint8Array | ArrayBuffer | string, options?: PrintRawOptions) => PrintClientJob
  /** 按数据排出模板并导出为 PDF。 */
  exportPdf: (schema: PrintDocument, data: unknown, options?: PrintClientDocumentOptions) => Promise<Blob>
  /** 把排好的输出页导出为 PDF。 */
  exportSheetsPdf: (result: PaginationResult, options?: PrintClientDocumentOptions) => Promise<Blob>
  /** 查任务状态。 */
  job: (jobId: string) => Promise<JobStatus>
  /** 订阅事件，返回退订函数。 */
  on: <K extends keyof PrintClientEventMap>(type: K, listener: (detail: PrintClientEventMap[K]) => void) => () => void
}

interface Pending {
  readonly resolve: (data: unknown) => void
  readonly reject: (error: PrintClientError) => void
  timer: ReturnType<typeof setTimeout>
}

interface Envelope {
  readonly type?: unknown
  readonly id?: unknown
  readonly ok?: unknown
  readonly data?: unknown
  readonly error?: ClientErrorPayload
  readonly jobId?: unknown
  readonly origin?: unknown
  readonly mime?: unknown
  readonly [key: string]: unknown
}

const FINAL: ReadonlySet<JobState> = new Set(['completed', 'failed', 'cancelled'])

function errorFrom(payload: ClientErrorPayload | undefined): PrintClientError {
  return new PrintClientError((payload?.code ?? 'INTERNAL') as PrintClientError['code'], payload?.message ?? '客户端没有说明原因', payload?.details ?? {})
}

/** 32 位十六进制的随机标识，不依赖安全上下文。 */
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

class ClientJob implements PrintClientJob {
  readonly id: string
  status: JobStatus | undefined
  output: Blob | undefined
  readonly done: Promise<JobStatus>
  readonly #listeners = new Set<(status: JobStatus) => void>()
  readonly #cancel: (job: ClientJob) => Promise<boolean>
  #resolve!: (status: JobStatus) => void
  #reject!: (error: PrintClientError) => void
  #finished = false

  constructor(id: string, cancel: (job: ClientJob) => Promise<boolean>) {
    this.id = id
    this.#cancel = cancel
    this.done = new Promise<JobStatus>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    this.done.catch(() => undefined)
  }

  get finished(): boolean {
    return this.#finished
  }

  onStatus(listener: (status: JobStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  cancel(): Promise<boolean> {
    return this.#cancel(this)
  }

  update(status: JobStatus): void {
    if (this.#finished)
      return
    const previous = this.status
    this.status = status
    if (previous?.state === status.state && previous.position === status.position)
      return
    for (const listener of this.#listeners)
      listener(status)
    if (status.state === 'completed')
      this.#settle(() => this.#resolve(status))
    else if (status.state === 'failed')
      this.#settle(() => this.#reject(errorFrom(status.error)))
    else if (status.state === 'cancelled')
      this.#settle(() => this.#reject(new PrintClientError('JOB_CANCELLED', '任务已取消', { jobId: this.id })))
  }

  fail(error: PrintClientError): void {
    this.#settle(() => this.#reject(error))
  }

  #settle(action: () => void): void {
    if (this.#finished)
      return
    this.#finished = true
    action()
  }
}

class Client implements PrintClient {
  readonly #ports: readonly number[]
  readonly #timeout: number
  readonly #connectTimeout: number
  readonly #consentTimeout: number
  readonly #reconnect: boolean
  readonly #WebSocket: WebSocketConstructor | undefined
  readonly #permissions: PermissionsLike | null | undefined
  readonly #secureContext: boolean | undefined
  readonly #fetch: typeof fetch | undefined
  readonly #pending = new Map<string, Pending>()
  readonly #jobs = new Map<string, ClientJob>()
  readonly #listeners = new Map<keyof PrintClientEventMap, Set<(detail: never) => void>>()
  #state: PrintClientState = 'idle'
  #welcome: ClientWelcome | undefined
  #token: string | undefined
  #socket: WebSocket | undefined
  #connecting: Promise<ClientWelcome> | undefined
  #heartbeat: ReturnType<typeof setInterval> | undefined
  #retry: ReturnType<typeof setTimeout> | undefined
  #lostAt = 0
  #closed = false
  #requests = 0
  #output: ClientJob | undefined

  constructor(options: PrintClientOptions) {
    this.#ports = options.ports ?? DEFAULT_PORTS
    this.#timeout = options.timeoutMs ?? 10_000
    this.#connectTimeout = options.connectTimeoutMs ?? 3_000
    this.#consentTimeout = options.consentTimeoutMs ?? 75_000
    this.#reconnect = options.reconnect ?? true
    this.#WebSocket = options.WebSocket ?? (globalThis.WebSocket as WebSocketConstructor | undefined)
    this.#permissions = options.permissions === undefined ? (globalThis.navigator?.permissions as PermissionsLike | undefined) : options.permissions
    this.#secureContext = options.secureContext ?? (globalThis.isSecureContext as boolean | undefined)
    this.#fetch = options.fetch
  }

  get state(): PrintClientState {
    return this.#state
  }

  get welcome(): ClientWelcome | undefined {
    return this.#welcome
  }

  connect(): Promise<ClientWelcome> {
    this.#closed = false
    if (this.#socket !== undefined && this.#welcome !== undefined)
      return Promise.resolve(this.#welcome)
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = undefined
    })
    return this.#connecting
  }

  close(): void {
    this.#closed = true
    clearTimeout(this.#retry)
    this.#stopHeartbeat()
    const socket = this.#socket
    this.#socket = undefined
    socket?.close(1000)
    this.#rejectPending(new PrintClientError('CONNECTION_LOST', '连接已关闭'))
    for (const job of this.#jobs.values())
      job.fail(new PrintClientError('CONNECTION_LOST', '连接已关闭，任务在客户端里照常执行', { jobId: job.id }))
    this.#jobs.clear()
    this.#setState('closed')
  }

  async printers(): Promise<PrinterInfo[]> {
    await this.connect()
    return await this.#request({ type: 'printers.list' }) as PrinterInfo[]
  }

  async printer(name: string): Promise<PrinterInfo> {
    await this.connect()
    return await this.#request({ type: 'printers.get', name }) as PrinterInfo
  }

  printDocument(schema: PrintDocument, data: unknown, options: PrintClientDocumentOptions = {}): PrintClientJob {
    return this.#submit(async () => ({ type: 'print.html', ...await this.#document(this.#paginate(schema, data, options), options) }))
  }

  printSheets(result: PaginationResult, options: PrintClientDocumentOptions = {}): PrintClientJob {
    return this.#submit(async () => ({ type: 'print.html', ...await this.#document(result, options) }))
  }

  printRaw(printer: string, data: Uint8Array | ArrayBuffer | string, options: PrintRawOptions = {}): PrintClientJob {
    return this.#submit(async () => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
      return { type: 'print.raw', printer, data: toBase64(bytes), ...(options.docName === undefined ? {} : { docName: options.docName }) }
    })
  }

  exportPdf(schema: PrintDocument, data: unknown, options: PrintClientDocumentOptions = {}): Promise<Blob> {
    return this.#pdf(this.#submit(async () => {
      const { document, options: printOptions } = await this.#document(this.#paginate(schema, data, options), options)
      return { type: 'export.pdf', document, options: printOptions }
    }))
  }

  exportSheetsPdf(result: PaginationResult, options: PrintClientDocumentOptions = {}): Promise<Blob> {
    return this.#pdf(this.#submit(async () => {
      const { document, options: printOptions } = await this.#document(result, options)
      return { type: 'export.pdf', document, options: printOptions }
    }))
  }

  async job(jobId: string): Promise<JobStatus> {
    await this.connect()
    return await this.#request({ type: 'job.get', jobId }) as JobStatus
  }

  on<K extends keyof PrintClientEventMap>(type: K, listener: (detail: PrintClientEventMap[K]) => void): () => void {
    let listeners = this.#listeners.get(type)
    if (listeners === undefined) {
      listeners = new Set()
      this.#listeners.set(type, listeners)
    }
    listeners.add(listener as (detail: never) => void)
    return () => listeners.delete(listener as (detail: never) => void)
  }

  // —— 内部：任务 ——

  #paginate(schema: PrintDocument, data: unknown, options: PrintClientDocumentOptions): PaginationResult {
    return paginateDocument(schema, data, options)
  }

  async #document(result: PaginationResult, options: PrintClientDocumentOptions): Promise<{ document: unknown, options: Record<string, unknown>, printer?: string }> {
    const documentOptions: ClientDocumentOptions = {
      ...(options.document === undefined ? {} : { document: options.document }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    }
    const document = await buildClientDocument(result, documentOptions)
    const printOptions: Record<string, unknown> = {}
    for (const key of ['copies', 'collate', 'duplex', 'color', 'pageRanges', 'dialog', 'timeoutMs'] as const) {
      if (options[key] !== undefined)
        printOptions[key] = options[key]
    }
    return { document, options: printOptions, ...(options.printer === undefined ? {} : { printer: options.printer }) }
  }

  #submit(build: () => Promise<Record<string, unknown>>): ClientJob {
    const job = new ClientJob(randomId(), target => this.#cancelJob(target))
    this.#jobs.set(job.id, job)
    void (async () => {
      try {
        const payload = await build()
        await this.connect()
        const accepted = await this.#request({ ...payload, jobId: job.id }) as { readonly position?: number }
        if (job.status === undefined)
          job.update({ jobId: job.id, state: 'queued', ...(accepted.position === undefined ? {} : { position: accepted.position }) })
      }
      catch (error) {
        job.fail(error instanceof PrintClientError ? error : new PrintClientError('INTERNAL', String(error)))
        this.#jobs.delete(job.id)
      }
    })()
    return job
  }

  async #pdf(job: ClientJob): Promise<Blob> {
    await job.done
    this.#jobs.delete(job.id)
    if (job.output === undefined)
      throw new PrintClientError('PDF_FAILED', '客户端没有送回导出的 PDF', { jobId: job.id })
    return job.output
  }

  async #cancelJob(job: ClientJob): Promise<boolean> {
    if (job.finished)
      return false
    await this.connect()
    const result = await this.#request({ type: 'job.cancel', jobId: job.id }) as { readonly cancelled: boolean }
    return result.cancelled
  }

  // —— 内部：连接 ——

  async #open(): Promise<ClientWelcome> {
    this.#setState(this.#state === 'reconnecting' ? 'reconnecting' : 'connecting')
    if (this.#WebSocket === undefined)
      throw this.#fail(new PrintClientError('CLIENT_UNAVAILABLE', '这个环境没有 WebSocket'))
    let unsupported: PrintClientError | undefined
    for (const port of this.#ports) {
      const socket = await this.#tryPort(this.#WebSocket, port)
      if (socket === undefined)
        continue
      try {
        return await this.#handshake(socket)
      }
      catch (error) {
        if (error instanceof PrintClientError && error.code === 'PROTOCOL_UNSUPPORTED') {
          unsupported = error
          continue
        }
        throw this.#fail(error instanceof PrintClientError ? error : new PrintClientError('INTERNAL', String(error)))
      }
    }
    throw this.#fail(unsupported ?? await this.#unavailable())
  }

  #fail(error: PrintClientError): PrintClientError {
    if (this.#state !== 'reconnecting')
      this.#setState('idle')
    return error
  }

  #tryPort(Constructor: WebSocketConstructor, port: number): Promise<WebSocket | undefined> {
    return new Promise((resolve) => {
      let socket: WebSocket
      try {
        socket = new Constructor(`ws://127.0.0.1:${port}/`, [SUB_PROTOCOL, UNVERSIONED_SUB_PROTOCOL])
      }
      catch {
        resolve(undefined)
        return
      }
      socket.binaryType = 'blob'
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (value: WebSocket | undefined): void => {
        clearTimeout(timer)
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        resolve(value)
      }
      timer = setTimeout(() => {
        finish(undefined)
        socket.close()
      }, this.#connectTimeout)
      socket.onopen = () => finish(socket)
      socket.onclose = () => finish(undefined)
      socket.onerror = () => undefined
    })
  }

  /** 所有端口都连不上时，分清是浏览器拦下了本机连接，还是客户端没在运行。 */
  async #unavailable(): Promise<PrintClientError> {
    if (this.#secureContext === false)
      return new PrintClientError('LOCAL_NETWORK_DENIED', '页面不是安全上下文，浏览器不允许连接本机打印客户端', { reason: 'insecure-context' })
    try {
      const permission = await this.#permissions?.query({ name: 'loopback-network' })
      if (permission?.state === 'denied')
        return new PrintClientError('LOCAL_NETWORK_DENIED', '浏览器拒绝了这个网站访问本机应用', { reason: 'permission-denied' })
    }
    catch {
      // 浏览器不认识这项权限时按客户端没在运行处理
    }
    return new PrintClientError('CLIENT_UNAVAILABLE', '连不上本机打印客户端', { ports: [...this.#ports] })
  }

  #handshake(socket: WebSocket): Promise<ClientWelcome> {
    return new Promise<ClientWelcome>((resolve, reject) => {
      let connectionError: PrintClientError | undefined
      const id = `h${++this.#requests}`
      let pending: Pending
      const fail = (error: PrintClientError): void => {
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        socket.onmessage = null
        socket.onclose = null
        socket.close()
        reject(error)
      }
      pending = {
        resolve: (data) => {
          clearTimeout(pending.timer)
          this.#pending.delete(id)
          this.#adopt(socket, data as ClientWelcome & { readonly sessionToken: string }).then(resolve, reject)
        },
        reject: fail,
        timer: setTimeout(() => fail(new PrintClientError('TIMEOUT', '握手超时')), this.#timeout),
      }
      this.#pending.set(id, pending)
      socket.onmessage = (event) => {
        const message = this.#parse(event)
        if (message === undefined)
          return
        if (message.type === 'consent.pending') {
          clearTimeout(pending.timer)
          pending.timer = setTimeout(() => fail(new PrintClientError('CONSENT_TIMEOUT', '等授权超时')), this.#consentTimeout)
          this.#emit('consentpending', { origin: String(message.origin ?? '') })
          return
        }
        if (message.type === 'result' && message.id === undefined && message.ok === false) {
          connectionError = errorFrom(message.error)
          return
        }
        this.#dispatch(message)
      }
      socket.onclose = (event) => {
        if (event.code === 4426 || connectionError?.code === 'PROTOCOL_UNSUPPORTED')
          fail(connectionError ?? new PrintClientError('PROTOCOL_UNSUPPORTED', '协议主版本不匹配'))
        else if (event.code === 4401)
          fail(new PrintClientError('CONSENT_DENIED', '来源未获授权'))
        else if (event.code === 4409)
          fail(new PrintClientError('TOO_MANY_CONNECTIONS', '同一来源的连接数超过客户端上限'))
        else
          fail(connectionError ?? new PrintClientError('CONNECTION_LOST', '握手时连接断开', { closeCode: event.code }))
      }
      if (socket.protocol === UNVERSIONED_SUB_PROTOCOL)
        return
      socket.send(JSON.stringify({
        type: 'hello',
        id,
        protocol: PROTOCOL_VERSION,
        minor: PROTOCOL_MINOR,
        sdk: { name: SDK_NAME },
        ...(this.#token === undefined ? {} : { resume: this.#token }),
      }))
    })
  }

  /** 握手成功：接管连接，开始心跳；认回会话时补查没被认领的任务。 */
  async #adopt(socket: WebSocket, data: ClientWelcome & { readonly sessionToken: string }): Promise<ClientWelcome> {
    const { sessionToken, ...welcome } = data
    this.#token = sessionToken
    this.#welcome = welcome
    this.#socket = socket
    socket.onmessage = event => this.#receive(event)
    socket.onclose = () => this.#lost(socket)
    socket.onerror = () => undefined
    this.#startHeartbeat()
    this.#setState('open')
    const resumed = new Set(welcome.resumed)
    for (const job of this.#jobs.values()) {
      if (job.finished || job.status === undefined || resumed.has(job.id))
        continue
      void this.#request({ type: 'job.get', jobId: job.id }).then(
        status => job.update(status as JobStatus),
        () => {
          job.fail(new PrintClientError('CONNECTION_LOST', '断线期间客户端没有保留这个任务，结果不明', { jobId: job.id }))
          this.#jobs.delete(job.id)
        },
      )
    }
    return welcome
  }

  #lost(socket: WebSocket): void {
    if (socket !== this.#socket)
      return
    this.#socket = undefined
    this.#stopHeartbeat()
    this.#output = undefined
    this.#rejectPending(new PrintClientError('CONNECTION_LOST', '连接断开'))
    if (this.#closed)
      return
    this.#lostAt = Date.now()
    if (!this.#reconnect) {
      this.#abandonJobs()
      this.#setState('idle')
      return
    }
    this.#setState('reconnecting')
    this.#scheduleReconnect(0)
  }

  #scheduleReconnect(attempt: number): void {
    const waiting = [...this.#jobs.values()].some(job => !job.finished)
    if ((!waiting && attempt >= IDLE_RECONNECT_ATTEMPTS) || Date.now() - this.#lostAt > RESUME_WINDOW_MS) {
      this.#abandonJobs()
      this.#setState('idle')
      return
    }
    const delay = Math.min(RECONNECT_MAX_MS, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4)
    this.#retry = setTimeout(() => {
      this.connect().catch((error: unknown) => {
        if (this.#closed)
          return
        if (error instanceof PrintClientError && error.code !== 'CLIENT_UNAVAILABLE' && error.code !== 'TIMEOUT') {
          this.#abandonJobs()
          this.#setState('idle')
          return
        }
        this.#scheduleReconnect(attempt + 1)
      })
    }, delay)
  }

  #abandonJobs(): void {
    for (const job of this.#jobs.values())
      job.fail(new PrintClientError('CONNECTION_LOST', '没能重连上客户端，任务在客户端里照常执行', { jobId: job.id }))
    this.#jobs.clear()
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat()
    this.#heartbeat = setInterval(() => {
      this.#request({ type: 'ping' }).catch(() => {
        this.#socket?.close()
      })
    }, HEARTBEAT_MS)
  }

  #stopHeartbeat(): void {
    clearInterval(this.#heartbeat)
    this.#heartbeat = undefined
  }

  // —— 内部：消息 ——

  #request(message: Record<string, unknown>): Promise<unknown> {
    const socket = this.#socket
    if (socket === undefined)
      return Promise.reject(new PrintClientError('CONNECTION_LOST', '没有连着客户端'))
    const id = `r${++this.#requests}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new PrintClientError('TIMEOUT', `请求 ${String(message.type)} 超时`))
      }, this.#timeout)
      this.#pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ ...message, id }))
    })
  }

  #rejectPending(error: PrintClientError): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      this.#pending.delete(id)
      pending.reject(error)
    }
  }

  #parse(event: MessageEvent): Envelope | undefined {
    if (typeof event.data !== 'string')
      return undefined
    try {
      const message = JSON.parse(event.data) as unknown
      return typeof message === 'object' && message !== null ? message as Envelope : undefined
    }
    catch {
      return undefined
    }
  }

  #receive(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      const job = this.#output
      this.#output = undefined
      if (job !== undefined && event.data instanceof Blob)
        job.output = new Blob([event.data], { type: 'application/pdf' })
      return
    }
    const message = this.#parse(event)
    if (message !== undefined)
      this.#dispatch(message)
  }

  #dispatch(message: Envelope): void {
    const type = typeof message.type === 'string' ? message.type : ''
    if (type === 'result' || type === 'pong') {
      const pending = typeof message.id === 'string' ? this.#pending.get(message.id) : undefined
      if (pending === undefined)
        return
      clearTimeout(pending.timer)
      this.#pending.delete(message.id as string)
      if (type === 'pong' || message.ok === true)
        pending.resolve(message.data)
      else
        pending.reject(errorFrom(message.error))
      return
    }
    if (type === 'consent.pending') {
      this.#emit('consentpending', { origin: String(message.origin ?? '') })
      return
    }
    if (!type.startsWith('job.') || typeof message.jobId !== 'string')
      return
    const job = this.#jobs.get(message.jobId)
    if (job === undefined)
      return
    if (type === 'job.output') {
      this.#output = job
      return
    }
    const state = type.slice('job.'.length) as JobState
    const status: { -readonly [K in keyof JobStatus]: JobStatus[K] } = { jobId: job.id, state }
    if (typeof message.position === 'number')
      status.position = message.position
    if (typeof message.sheets === 'number')
      status.sheets = message.sheets
    if (typeof message.bytes === 'number')
      status.bytes = message.bytes
    if (message.error !== undefined)
      status.error = message.error
    job.update(status)
    if (FINAL.has(state))
      this.#jobs.delete(job.id)
  }

  #setState(state: PrintClientState): void {
    if (this.#state === state)
      return
    this.#state = state
    this.#emit('state', state)
  }

  #emit<K extends keyof PrintClientEventMap>(type: K, detail: PrintClientEventMap[K]): void {
    for (const listener of this.#listeners.get(type) ?? [])
      (listener as (value: PrintClientEventMap[K]) => void)(detail)
  }
}

/** 创建本地打印客户端的连接；不会立即连接，第一次调用时才连。 */
export function createPrintClient(options: PrintClientOptions = {}): PrintClient {
  return new Client(options)
}
