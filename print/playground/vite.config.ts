/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 开发预览页：@xihan-print/* 直接指向各包源码（core、runtime、designer），改了源码即时生效，不必先构建；@xihan-ui/* 经 overrides 读同级 XiHan.UI 的产物。

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

function local(path: string): string {
  return fileURLToPath(new URL(`../packages/${path}`, import.meta.url))
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@xihan-print\/core$/, replacement: local('core/src/index.ts') },
      { find: /^@xihan-print\/runtime$/, replacement: local('runtime/src/index.ts') },
      { find: /^@xihan-print\/runtime\/locale$/, replacement: local('runtime/src/locale.ts') },
      { find: /^@xihan-print\/runtime\/client$/, replacement: local('runtime/src/client/index.ts') },
      { find: /^@xihan-print\/runtime\/style\.css$/, replacement: local('runtime/style.css') },
      { find: /^@xihan-print\/designer$/, replacement: local('designer/src/index.ts') },
      { find: /^@xihan-print\/designer\/style\.css$/, replacement: local('designer/style.css') },
    ],
  },
  server: {
    port: 5191,
    strictPort: true,
  },
})
