/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 「本地客户端」页的连接状态：状态标签（已连接、未连接、未安装）、「测试连接」钮，没连上时再给「下载客户端」链接。
// 读宿主给的 printClient，订阅它的 state 当场刷新；测试连接调它的 connect，设计器自己不建连接。

import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { PrintClient } from '@xihan-print/runtime/client'
import type { Tone } from '@xihan-ui/core'
import type { DesignerSettingEditor } from '@xihan-ui/designer-shell'
import type { PrintClientStatusControl } from './settings'
import { createAuthoredElement, setAttributes, setText } from '@xihan-ui/web-components/authoring'
import { PRINT_CLIENT_DOWNLOAD_URL } from './settings'

/** 连接状态的三种说法：连着；没连着；最近一次测试连接没找到客户端。 */
type PrintClientStatus = 'connected' | 'disconnected' | 'missing'

/** createPrintClientStatus 的选项：都按调用现取。下载地址取这一条的编辑方式。 */
interface PrintClientStatusOptions {
  readonly document: () => Document
  readonly client: () => PrintClient | undefined
  readonly translations: () => PrintDesignerTranslations
}

/** 连接状态的编辑器，与刷新、退订开着的那几份的入口。 */
interface PrintClientStatusHost {
  /** 交给设置对话框的编辑器：不写值，只显示状态与两个入口。 */
  readonly editor: DesignerSettingEditor
  /** 宿主换了 printClient、或设计器重新连上文档后调用：每一份按现在的客户端重新订阅、重画。 */
  readonly refresh: () => void
  /** 设计器断开时调用：每一份退订客户端的 state，下次 refresh 再订。 */
  readonly detach: () => void
}

/** 开着的一份：重画，或退订客户端。 */
interface Instance {
  readonly paint: () => void
  readonly detach: () => void
}

const TONES: Readonly<Record<PrintClientStatus, Tone>> = { connected: 'success', disconnected: 'neutral', missing: 'warning' }

export function createPrintClientStatus(options: PrintClientStatusOptions): PrintClientStatusHost {
  const live = new Set<Instance>()
  const editor: DesignerSettingEditor = (initial) => {
    let context = initial
    const doc = options.document()
    const label = createAuthoredElement(doc, 'span', { 'data-xh-part': 'label' })
    const tag = createAuthoredElement(doc, 'xh-tag', { variant: 'subtle', size: 'sm' }, [createAuthoredElement(doc, 'span', { 'data-xh-part': 'root' }, [label])])
    const state = createAuthoredElement(doc, 'span', { 'role': 'status', 'data-scope': 'print-designer', 'data-part': 'client-state' }, [tag])
    const testFace = createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button' })
    const test = createAuthoredElement(doc, 'xh-button', { 'variant': 'outline', 'size': 'sm', 'data-part': 'client-test' }, [testFace])
    const link = createAuthoredElement(doc, 'a', { 'data-xh-part': 'root', 'target': '_blank', 'rel': 'noopener noreferrer' })
    const download = createAuthoredElement(doc, 'xh-button', { 'as': 'a', 'variant': 'ghost', 'size': 'sm', 'data-part': 'client-download' }, [link])
    const element = createAuthoredElement(doc, 'div', { 'data-scope': 'print-designer', 'data-part': 'client-status' }, [state, test, download])
    let watched: { readonly client: PrintClient, readonly off: () => void } | undefined
    let missing = false
    let testing = false

    const paint = (): void => {
      const client = options.client()
      if (watched?.client !== client) {
        watched?.off()
        missing = false
        watched = client === undefined ? undefined : { client, off: client.on('state', paint) }
      }
      const t = options.translations()
      const now: PrintClientStatus = client?.state === 'open' ? 'connected' : missing ? 'missing' : 'disconnected'
      setText(label, t.settingsClientStates[now])
      setAttributes(tag, { tone: TONES[now] })
      setText(testFace, t.settingsClientTest)
      setAttributes(test, { loading: testing, disabled: client === undefined })
      setText(link, t.settingsClientDownload)
      setAttributes(link, { href: (context.descriptor.control as Partial<PrintClientStatusControl>).downloadUrl ?? PRINT_CLIENT_DOWNLOAD_URL })
      download.hidden = now === 'connected'
    }
    const instance: Instance = {
      paint,
      detach: () => {
        watched?.off()
        watched = undefined
      },
    }

    test.addEventListener('click', () => {
      const client = options.client()
      if (client === undefined || testing)
        return
      testing = true
      paint()
      client.connect().then(
        () => void (missing = false),
        (error: unknown) => void (missing = (error as { readonly code?: unknown } | null)?.code === 'CLIENT_UNAVAILABLE'),
      ).finally(() => {
        testing = false
        if (live.has(instance))
          paint()
      })
    })
    live.add(instance)
    paint()
    return {
      element,
      update: (next) => {
        context = next
        paint()
      },
      destroy: () => {
        live.delete(instance)
        instance.detach()
      },
    }
  }
  return {
    editor,
    refresh: () => {
      for (const instance of live)
        instance.paint()
    },
    detach: () => {
      for (const instance of live)
        instance.detach()
    },
  }
}
