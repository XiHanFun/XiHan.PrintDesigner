/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import { defineXiHanTheme } from '@xihanfun/vitepress-theme'
import PrintDemo from './PrintDemo.vue'
// 组件皮肤用无层版本：VitePress 自带无层的元素重置，无层声明胜过任何有层声明。设计器零件的样式与皮肤成对，也用无层的那一份。
import '@xihan-ui/styles/index.unlayered.css'
import '@xihan-ui/designer-shell/style.unlayered.css'
import '@xihan-print/runtime/style.css'
import '@xihan-print/designer/style.css'
import './demo.css'

export default defineXiHanTheme({
  // 每页正文上方一条取 Markdown 的直链，指向构建期落在同路径的 .md
  pageMarkdown: true,
  enhanceApp(ctx) {
    // 示例写成 <PrintDemo name="..." />，对应 examples/demos/ 下的同名文件
    ctx.app.component('PrintDemo', PrintDemo)
  },
})

if (typeof window !== 'undefined') {
  // 深浅模式桥接：VitePress 切主题是给 html 加 .dark 类，UI 令牌认的是 [data-theme]。
  const root = document.documentElement
  const syncTheme = (): void => {
    root.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light'
  }
  syncTheme()
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['class'] })

  // 示例里的预览与设计器全站用中文界面
  void Promise.all([
    import('@xihan-ui/web-components'),
    import('@xihan-ui/web-components/locale'),
    import('@xihan-print/runtime/locale'),
  ]).then(([{ mergeXhConfig, setXhConfig }, { zhCN }, { printZhCN }]) => setXhConfig(mergeXhConfig(zhCN, printZhCN)))
}
