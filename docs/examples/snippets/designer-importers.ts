/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一个导入器：粘贴或拖进来的图片文件读成 data: 地址，放成一个图片元素。图片要存到宿主自己的存储时，在 import 里上传后返回地址。

// #region example
import type { PrintDesignerExtension } from '@xihan-print/designer'
import { createElementRegistry } from '@xihan-print/core'

const registry = createElementRegistry()

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export const imageImporter: PrintDesignerExtension = {
  id: '@acme/print-images',
  importers: [{
    id: '@acme/print-images.file',
    accepts: source => source.file !== undefined && source.mime?.startsWith('image/') === true,
    import: async (source) => {
      const url = await readAsDataUrl(source.file!)
      const image = registry.createElement('image', { id: 'image', x: 0, y: 0, overrides: { source: { kind: 'static', url } } })
      return { elements: [image] }
    },
  }],
}
// #endregion example
