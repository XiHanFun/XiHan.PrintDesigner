/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一种语言的打印文案：预览与设计器各一份，都是全量的；与 designer-shell 同一语言的那份合成一个语言包。

import type { XhConfig } from '@xihan-ui/web-components'
import type { PrintDesignerLocale } from '../designer-locale'
import type { PrintPreviewTranslations } from '../translations'
import { mergeXhConfig } from '@xihan-ui/web-components'
import { printDesignerTranslations } from '../designer-locale'

/** 打印一种语言的全部文案。 */
export interface PrintLocale {
  readonly preview: PrintPreviewTranslations
  readonly designer: PrintDesignerLocale
}

/** 把打印文案与 designer-shell 同一语言的那份合成一个语言包。 */
export function printLocale(shell: XhConfig, locale: PrintLocale): XhConfig {
  return mergeXhConfig(shell, {
    translations: {
      'xh-print-preview': locale.preview,
      'xh-print-designer': printDesignerTranslations(locale.designer),
    },
  })
}
