/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器的设置：宿主管着主题，用户偏好存在宿主自己那里；独立使用时交给本机存储；从工具栏外的按钮打开设置；面板布局的缺省与管控。
// 键都用包入口导出的常量，不手写字符串。

import type { XhPrintDesigner } from '@xihan-print/designer'
import { PRINT_DESIGNER_PANELS, PRINT_SETTING_KEYS, PRINT_SETTINGS_SECTION } from '@xihan-print/designer'
import { DESIGNER_SETTING_KEYS } from '@xihan-ui/designer-shell'

type PrintSettings = NonNullable<XhPrintDesigner['settings']>

// #region host
export function wireSettings(designer: XhPrintDesigner, saved: PrintSettings, store: (settings: PrintSettings) => void): void {
  // 宿主自己的缺省压在下面，用户存过的值盖在上面
  designer.settings = { [PRINT_SETTING_KEYS.gridSize]: 5, [PRINT_SETTING_KEYS.showGrid]: true, ...saved }
  designer.settingsPolicy = { [DESIGNER_SETTING_KEYS.theme]: 'hidden', [DESIGNER_SETTING_KEYS.brand]: 'hidden', [PRINT_SETTING_KEYS.snap]: 'locked' }
  designer.addEventListener('settings-change', (event) => {
    store((event as CustomEvent<{ settings: PrintSettings }>).detail.settings)
  })
}
// #endregion host

// #region storage
export function standalone(designer: XhPrintDesigner): void {
  designer.settingsStorageKey = 'print-designer:settings'
  designer.addEventListener('settings-storage-error', (event) => {
    console.warn('设置没能读写本机存储，这次改的只在内存里', (event as CustomEvent<{ error: unknown }>).detail.error)
  })
}
// #endregion storage

// #region open
export function openCanvasSettings(designer: XhPrintDesigner): void {
  designer.openSettings(PRINT_SETTINGS_SECTION)
}
// #endregion open

// #region layout
export function wireLayout(designer: XhPrintDesigner): void {
  // 缺省收起问题列表；宿主的业务里用不到翻页条，也不许用户把它开出来
  designer.defaultLayout = { version: 1, hidden: [PRINT_DESIGNER_PANELS.issues] }
  designer.settingsPolicy = { [`${DESIGNER_SETTING_KEYS.layout}.${PRINT_DESIGNER_PANELS.pages}`]: 'hidden' }
}
// #endregion layout
