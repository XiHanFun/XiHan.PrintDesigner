/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 打印的英文语言包，与预览、设计器不配语言包时的缺省文案相同。

import type { XhConfig } from '@xihan-ui/web-components'
import { designerShellEnUS } from '@xihan-ui/designer-shell/locale'
import { PRINT_DESIGNER_EN_US } from '../designer-locale'
import { DEFAULT_PRINT_PREVIEW_TRANSLATIONS } from '../translations'
import { printLocale } from './types'

/** 打印的英文文案：预览、设计器与 designer-shell 零件。 */
export const printEnUS: XhConfig = /* @__PURE__ */ printLocale(designerShellEnUS, {
  preview: DEFAULT_PRINT_PREVIEW_TRANSLATIONS,
  designer: PRINT_DESIGNER_EN_US,
})
