/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 与本地打印客户端之间的协议：子协议 xihan-print.v1，JSON 文本帧，导出的 PDF 用二进制帧。

/** 带主版本的子协议。 */
export const SUB_PROTOCOL = 'xihan-print.v1'
/** 不带版本的子协议：客户端不认识带版本的那个时选它完成升级，再回 PROTOCOL_UNSUPPORTED。 */
export const UNVERSIONED_SUB_PROTOCOL = 'xihan-print'
/** 协议主版本。 */
export const PROTOCOL_VERSION = 1
/** 协议次版本：只加不减。 */
export const PROTOCOL_MINOR = 0
/** 客户端监听的端口，按顺序探测。 */
export const DEFAULT_PORTS: readonly number[] = [17620, 17621, 17622, 17623]
/** 任务文档在客户端里的地址，资源经 r/{id} 引用。 */
export const RESOURCE_ORIGIN = 'https://print.local/'
/** 单条消息上限。 */
export const MAX_MESSAGE_BYTES = 96 * 1024 * 1024
/** 单个任务的资源总量上限。 */
export const MAX_RESOURCE_BYTES = 64 * 1024 * 1024

/** 客户端给出的错误码。 */
export type ClientErrorCode
  = | 'BAD_REQUEST'
    | 'CONSENT_PENDING'
    | 'CONSENT_DENIED'
    | 'CONSENT_TIMEOUT'
    | 'SESSION_EXPIRED'
    | 'PROTOCOL_UNSUPPORTED'
    | 'NO_PRINTERS'
    | 'PRINTER_NOT_FOUND'
    | 'PRINTER_OFFLINE'
    | 'PAPER_UNSUPPORTED'
    | 'DOCUMENT_TOO_LARGE'
    | 'RESOURCE_BLOCKED'
    | 'RENDER_FAILED'
    | 'RENDER_TIMEOUT'
    | 'SPOOL_FAILED'
    | 'PDF_FAILED'
    | 'JOB_DUPLICATE'
    | 'JOB_NOT_FOUND'
    | 'QUEUE_FULL'
    | 'CAPABILITY_UNSUPPORTED'
    | 'INTERNAL'

/**
 * SDK 自己给出的错误码：
 * - CLIENT_UNAVAILABLE：所有端口都连不上（客户端没装或没运行）；
 * - LOCAL_NETWORK_DENIED：浏览器的「本机应用」权限被拒，或页面不是安全上下文，连接在浏览器里就被拦下；
 * - CONNECTION_LOST：等结果时断线，或断线后没能在期限内重连上；
 * - TOO_MANY_CONNECTIONS：同一来源的连接数超过客户端上限；
 * - TIMEOUT：请求没有在期限内得到响应；
 * - JOB_CANCELLED：任务被取消。
 */
export type SdkErrorCode = 'CLIENT_UNAVAILABLE' | 'LOCAL_NETWORK_DENIED' | 'CONNECTION_LOST' | 'TOO_MANY_CONNECTIONS' | 'TIMEOUT' | 'JOB_CANCELLED'

/** 打印客户端相关的全部错误码。 */
export type PrintClientErrorCode = ClientErrorCode | SdkErrorCode

/** 响应与任务事件里的错误。 */
export interface ClientErrorPayload {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** 客户端在完成的任务里给出的提醒码。 */
export type ClientWarningCode = 'PAPER_UNCHECKED' | 'PAPER_FITTED'

/** 任务照常完成、但宿主应当知道的情况，code 取 ClientWarningCode。 */
export interface ClientWarningPayload {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** 客户端信息。 */
export interface ClientInfo {
  readonly version: string
  readonly os: string
  readonly arch: string
  /** 渲染引擎版本；没有渲染引擎时缺省。 */
  readonly renderer?: string
}

/** 客户端能力。 */
export interface ClientCapabilities {
  readonly html: boolean
  readonly raw: boolean
  readonly pdf: boolean
  readonly duplex: boolean
  readonly printerStatus: boolean
}

/** 握手成功后客户端的回复。 */
export interface ClientWelcome {
  readonly protocol: number
  readonly minor: number
  readonly client: ClientInfo
  readonly capabilities: ClientCapabilities
  /** 重连认回会话时仍未结束的任务。 */
  readonly resumed: readonly string[]
}

/** 打印机状态。 */
export type PrinterState = 'ready' | 'paused' | 'offline' | 'error' | 'paperOut' | 'paperJam' | 'busy' | 'unknown'

/** 打印机支持的一种纸张。 */
export interface PaperInfo {
  readonly id: number
  readonly name: string
  readonly widthMm: number
  readonly heightMm: number
}

/** 打印机能力，只在查单台打印机时给出。 */
export interface PrinterCapabilities {
  readonly color: boolean
  readonly duplex: boolean
  readonly maxCopies: number
  readonly papers: readonly PaperInfo[]
}

/** 一台打印机。 */
export interface PrinterInfo {
  readonly name: string
  readonly isDefault: boolean
  readonly status: PrinterState
  /** 系统给出的原始状态位。 */
  readonly statusFlags: number
  readonly location?: string
  readonly comment?: string
  readonly driver?: string
  readonly port?: string
  readonly isNetwork: boolean
  readonly capabilities?: PrinterCapabilities
}

/** 任务状态。completed 指已交给系统打印池，不等于纸已印出。 */
export type JobState = 'queued' | 'started' | 'completed' | 'failed' | 'cancelled'

/** 任务的当前状态。 */
export interface JobStatus {
  readonly jobId: string
  readonly state: JobState
  /** 排队时同一台打印机前面还有几个任务。 */
  readonly position?: number
  /** HTML 通道交给打印池的页数。 */
  readonly sheets?: number
  /** 原始通道写出的字节数，或导出的 PDF 大小。 */
  readonly bytes?: number
  readonly error?: ClientErrorPayload
  /** HTML 通道完成时的提醒，如没能核对纸张、按 fitToNearestPaper 换了纸；没有时缺省。 */
  readonly warnings?: readonly ClientWarningPayload[]
}

/** 交给客户端的打印选项。纸张不在选项里：每组输出页按模板里的纸张尺寸下发；原始指令的纸张由指令自己决定。 */
export interface ClientPrintOptions {
  /** 打印机名称，缺省为默认打印机。 */
  readonly printer?: string
  /** 份数，1–999。 */
  readonly copies?: number
  /** 多份时逐份打印，缺省 true。 */
  readonly collate?: boolean
  readonly duplex?: 'simplex' | 'long-edge' | 'short-edge'
  readonly color?: 'color' | 'grayscale'
  /** 页码范围，如 1-3,5。 */
  readonly pageRanges?: string
  /** 弹系统打印对话框，缺省静默打印。 */
  readonly dialog?: boolean
  /** 交给打印池的期限，毫秒。 */
  readonly timeoutMs?: number
  /** 打印机没有某组的纸张、驱动也不接受这个尺寸时，改用最接近的纸张，比纸大的内容等比缩小到放得下，比纸小的原大居中；缺省 false，这时整个任务以 PAPER_UNSUPPORTED 失败。 */
  readonly fitToNearestPaper?: boolean
}

/** 随任务带去的一份资源，data 为 base64。 */
export interface ClientResource {
  readonly id: string
  readonly type: string
  readonly data: string
}

/** 连续的若干张同尺寸输出页。 */
export interface ClientSheetGroup {
  readonly widthMm: number
  readonly heightMm: number
  readonly count: number
}

/** 交给客户端的文档：自包含的输出页、资源与按出现顺序的纸张分组。 */
export interface ClientDocument {
  readonly html: string
  readonly resources: readonly ClientResource[]
  readonly sheets: readonly ClientSheetGroup[]
}
