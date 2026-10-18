/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器自己的设置分区。「打印」页：打印方式（给了 printClient 才有）与画布偏好（显示网格、网格间距、吸附对齐、显示边距线）；
// 「本地客户端」页：连接状态（给了 printClient 才有这一页）。值的键是 <分区 id>.<条目 id>，设计器与扩展从上下文的 settings 读。

import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { DesignerSettingItem, DesignerSettingsSection } from '@xihan-ui/designer-shell'

/** 设计器「打印」分区的 id，扩展不能再用。宿主给缺省或读设置时用它与 PRINT_SETTING_KEYS，不手写字符串。 */
export const PRINT_SETTINGS_SECTION = 'print'

/** 设计器「本地客户端」分区的 id，扩展同样不能再用；只在宿主给了 printClient 时出现。 */
export const PRINT_CLIENT_SETTINGS_SECTION = 'printClient'

/** 打印方式：经本地打印客户端，或浏览器的打印对话框。 */
export type PrintVia = 'client' | 'browser'

/** 「打印」分区各条目的键，即 settings 里的键（分区 id.条目 id）。 */
export const PRINT_SETTING_KEYS = {
  via: 'print.via',
  showGrid: 'print.showGrid',
  gridSize: 'print.gridSize',
  snap: 'print.snap',
  showMargins: 'print.showMargins',
} as const

/** 「本地客户端」分区里连接状态那一条的编辑方式种类：设计器自己铺状态、「测试连接」钮与下载链接，这一条不存值。 */
export const PRINT_CLIENT_STATUS_CONTROL = 'print-client-status'

/** 「下载客户端」链接的缺省地址：打印文档站的客户端一页。宿主用设计器的 clientDownloadUrl 换成自己的地址。 */
export const PRINT_CLIENT_DOWNLOAD_URL = 'https://print.docs.xihanfun.com/guide/client'

/** 连接状态那一条的编辑方式：带着「下载客户端」链接的地址。 */
export interface PrintClientStatusControl {
  readonly kind: typeof PRINT_CLIENT_STATUS_CONTROL
  readonly downloadUrl: string
}

/** printClientSettingsSection 的选项。 */
export interface PrintClientSettingsSectionOptions {
  /** 「下载客户端」链接的地址，缺省 PRINT_CLIENT_DOWNLOAD_URL。 */
  readonly downloadUrl?: string
}

/** printSettingsSection 的选项。 */
export interface PrintSettingsSectionOptions {
  /** 宿主给了 printClient：只有这时才有打印方式一项，缺省经本地客户端。 */
  readonly client?: boolean
}

const VIAS: readonly PrintVia[] = ['client', 'browser']

/** 「打印」分区：打印方式缺省经本地客户端；网格间距缺省 1 mm，吸附对齐与边距线缺省打开，网格缺省不显示。 */
export function printSettingsSection(t: PrintDesignerTranslations, options: PrintSettingsSectionOptions = {}): DesignerSettingsSection {
  const via: DesignerSettingItem[] = options.client === true
    ? [{
        path: ['via'],
        label: t.settingsVia,
        control: { kind: 'select', appearance: 'toggle', options: VIAS.map(value => ({ value, label: t.settingsViaOptions[value] })) },
        default: 'client',
        meta: { description: t.settingsViaHint },
      }]
    : []
  return {
    id: PRINT_SETTINGS_SECTION,
    label: t.settingsPrint,
    order: 100,
    items: [
      ...via,
      { path: ['showGrid'], label: t.settingsShowGrid, control: { kind: 'boolean' }, default: false, meta: { description: t.settingsShowGridHint } },
      { path: ['gridSize'], label: t.settingsGridSize, control: { kind: 'number', min: 0, step: 0.5, unit: 'mm' }, default: 1, meta: { description: t.settingsGridSizeHint } },
      { path: ['snap'], label: t.settingsSnap, control: { kind: 'boolean' }, default: true, meta: { description: t.settingsSnapHint } },
      { path: ['showMargins'], label: t.settingsShowMargins, control: { kind: 'boolean' }, default: true, meta: { description: t.settingsShowMarginsHint } },
    ],
  }
}

/** 「本地客户端」分区：一条连接状态，按 PRINT_CLIENT_STATUS_CONTROL 铺。 */
export function printClientSettingsSection(t: PrintDesignerTranslations, options: PrintClientSettingsSectionOptions = {}): DesignerSettingsSection {
  const control: PrintClientStatusControl = { kind: PRINT_CLIENT_STATUS_CONTROL, downloadUrl: options.downloadUrl ?? PRINT_CLIENT_DOWNLOAD_URL }
  return {
    id: PRINT_CLIENT_SETTINGS_SECTION,
    label: t.settingsClient,
    order: 110,
    items: [
      { path: ['status'], label: t.settingsClientStatus, control, meta: { description: t.settingsClientStatusHint } },
    ],
  }
}
