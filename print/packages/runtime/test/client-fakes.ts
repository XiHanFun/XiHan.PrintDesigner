/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { WebSocketConstructor } from '../src/client'

/** 收到的一条请求。 */
export type Message = Record<string, any>

/** 假的本地打印客户端：一个端口上的服务端，按请求类型应答。 */
export class FakeApp {
  /** 与浏览器谈定的子协议。 */
  protocol = 'xihan-print.v1'
  token = 'token-1'
  readonly sockets: FakeSocket[] = []
  /** 收到的请求，按到达顺序。 */
  readonly received: Message[] = []
  /** 握手的应答，缺省直接回 welcome。 */
  hello: (socket: FakeSocket, hello: Message) => void = (socket, hello) => socket.reply(hello, this.welcome())
  /** 其它请求的应答，按 type 查。 */
  readonly handlers: Record<string, (socket: FakeSocket, message: Message) => void> = {}

  get last(): FakeSocket {
    return this.sockets.at(-1)!
  }

  welcome(resumed: string[] = []): Message {
    return {
      protocol: 1,
      minor: 0,
      client: { version: '0.1.0', os: 'windows', arch: 'x64', renderer: '155.0.4283.45' },
      sessionToken: this.token,
      capabilities: { html: true, raw: true, pdf: true, duplex: true, printerStatus: true },
      resumed,
    }
  }

  opened(socket: FakeSocket): void {
    this.sockets.push(socket)
    if (this.protocol === 'xihan-print') {
      socket.push({ type: 'result', ok: false, error: { code: 'PROTOCOL_UNSUPPORTED', message: '协议主版本不匹配', details: { supported: [1] } } })
      socket.drop(4426)
    }
  }

  receive(socket: FakeSocket, message: Message): void {
    this.received.push(message)
    if (message.type === 'hello')
      this.hello(socket, message)
    else if (message.type === 'ping')
      socket.push({ type: 'pong', id: message.id })
    else
      this.handlers[message.type]?.(socket, message)
  }

  /** 最近收到的某类请求。 */
  request(type: string): Message | undefined {
    return [...this.received].reverse().find(message => message.type === type)
  }
}

/** 假 WebSocket：按端口找到 FakeApp，打开、消息与关闭都在下一轮宏任务里送达。 */
export class FakeSocket {
  static readonly created: FakeSocket[] = []
  static readonly ports = new Map<number, FakeApp>()
  /** 接了连接却不应答握手的端口：不打开也不关闭，等浏览器侧超时。 */
  static readonly silent = new Set<number>()

  readonly url: string
  readonly protocols: string[]
  readyState = 0
  protocol = ''
  binaryType = 'blob'
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: { readonly code: number }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  readonly sent: Message[] = []
  app: FakeApp | undefined

  constructor(url: string, protocols: string[]) {
    this.url = url
    this.protocols = protocols
    FakeSocket.created.push(this)
    const port = Number(new URL(url).port)
    if (FakeSocket.silent.has(port))
      return
    const app = FakeSocket.ports.get(port)
    setTimeout(() => {
      if (app === undefined) {
        this.readyState = 3
        this.onerror?.(new Event('error'))
        this.onclose?.({ code: 1006 })
        return
      }
      this.app = app
      this.protocol = app.protocol
      this.readyState = 1
      this.onopen?.(new Event('open'))
      app.opened(this)
    }, 0)
  }

  static reset(): void {
    FakeSocket.created.length = 0
    FakeSocket.ports.clear()
    FakeSocket.silent.clear()
  }

  send(text: string): void {
    const message = JSON.parse(text) as Message
    this.sent.push(message)
    setTimeout(() => this.app?.receive(this, message), 0)
  }

  close(code = 1000): void {
    if (this.readyState === 3)
      return
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code }), 0)
  }

  /** 服务端推一条文本消息。 */
  push(message: Message): void {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), 0)
  }

  /** 服务端推一条二进制消息。 */
  pushBinary(blob: Blob): void {
    setTimeout(() => this.onmessage?.({ data: blob }), 0)
  }

  /** 服务端回一条成功的响应。 */
  reply(request: Message, data: unknown): void {
    this.push({ type: 'result', id: request.id, ok: true, data })
  }

  /** 服务端回一条失败的响应。 */
  fail(request: Message, code: string, details: Record<string, unknown> = {}): void {
    this.push({ type: 'result', id: request.id, ok: false, error: { code, message: code, details } })
  }

  /** 服务端以关闭码断开。 */
  drop(code: number): void {
    if (this.readyState === 3)
      return
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code }), 0)
  }
}

export const FakeWebSocket = FakeSocket as unknown as WebSocketConstructor

/** 等所有已排队的宏任务跑完若干轮。 */
export async function settle(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index++)
    await new Promise(resolve => setTimeout(resolve, 0))
}
