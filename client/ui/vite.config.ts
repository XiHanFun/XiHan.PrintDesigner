/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 窗口界面的构建：主窗口、授权窗口、新版提示三页，产物在 ui/dist，由 Tauri 打进程序。

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: `${root}index.html`,
        consent: `${root}consent.html`,
        update: `${root}update.html`,
      },
    },
  },
  server: {
    port: 5193,
    strictPort: true,
  },
})
