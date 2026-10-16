/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导出 @xihan-print/runtime/client：连接本地打印客户端，静默打印、写原始指令与导出 PDF。

export { createPrintClient } from './client'
export type { PermissionsLike, PrintClient, PrintClientDocumentOptions, PrintClientEventMap, PrintClientJob, PrintClientOptions, PrintClientState, PrintRawOptions, WebSocketConstructor } from './client'
export { buildClientDocument } from './document'
export type { ClientDocumentOptions } from './document'
export { FALLBACK_CODES, PrintClientError, shouldFallBack } from './errors'
export { printWithFallback } from './fallback'
export type { PrintWithFallbackOptions, PrintWithFallbackOutcome } from './fallback'
export { DEFAULT_PORTS, PROTOCOL_MINOR, PROTOCOL_VERSION, SUB_PROTOCOL } from './protocol'
export type { ClientCapabilities, ClientDocument, ClientErrorCode, ClientErrorPayload, ClientInfo, ClientPrintOptions, ClientResource, ClientSheetGroup, ClientWelcome, JobState, JobStatus, PaperInfo, PrintClientErrorCode, PrinterCapabilities, PrinterInfo, PrinterState, SdkErrorCode } from './protocol'
