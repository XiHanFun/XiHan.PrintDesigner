/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 富文本：把停电检修通知交给 <xh-print-preview> 显示。

import { definePrintPreview } from '@xihan-print/runtime'
import { data, schema } from '../templates/rich-text'

export function mount(host: HTMLElement): () => void {
  definePrintPreview()
  const preview = document.createElement('xh-print-preview')
  preview.schema = schema
  preview.data = data
  host.append(preview)
  return () => host.replaceChildren()
}
