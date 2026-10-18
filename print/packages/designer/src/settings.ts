/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器自己的设置分区「画布」：显示网格、网格间距、吸附对齐、显示边距线。值的键是 print.<条目 id>，
// 设计器与扩展从上下文的 settings 读。

import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { DesignerSettingsSection } from '@xihan-ui/designer-shell'

/** 设计器自己那个设置分区的 id，扩展不能再用。宿主给缺省或读设置时用它与 PRINT_SETTING_KEYS，不手写字符串。 */
export const PRINT_SETTINGS_SECTION = 'print'

/** 「画布」分区各条目的键，即 settings 里的键（分区 id.条目 id）。 */
export const PRINT_SETTING_KEYS = {
  showGrid: 'print.showGrid',
  gridSize: 'print.gridSize',
  snap: 'print.snap',
  showMargins: 'print.showMargins',
} as const

/** 「画布」分区：网格间距缺省 1 mm，吸附对齐与边距线缺省打开，网格缺省不显示。 */
export function printSettingsSection(t: PrintDesignerTranslations): DesignerSettingsSection {
  return {
    id: PRINT_SETTINGS_SECTION,
    label: t.settingsCanvas,
    order: 100,
    items: [
      { path: ['showGrid'], label: t.settingsShowGrid, control: { kind: 'boolean' }, default: false, meta: { description: t.settingsShowGridHint } },
      { path: ['gridSize'], label: t.settingsGridSize, control: { kind: 'number', min: 0, step: 0.5, unit: 'mm' }, default: 1, meta: { description: t.settingsGridSizeHint } },
      { path: ['snap'], label: t.settingsSnap, control: { kind: 'boolean' }, default: true, meta: { description: t.settingsSnapHint } },
      { path: ['showMargins'], label: t.settingsShowMargins, control: { kind: 'boolean' }, default: true, meta: { description: t.settingsShowMarginsHint } },
    ],
  }
}
