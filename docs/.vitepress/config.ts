/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { DefaultTheme } from 'vitepress'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineXiHanConfig } from '@xihanfun/vitepress-theme/config'

const title = '曦寒打印设计器文档'
const description = '框架无关的打印设计器，以 Web Components 交付，配套本地打印客户端'
const keywords = '曦寒,曦寒懿,打印设计器,打印模板,Web Components,静默打印,打印客户端,XiHanFun,XiHan.PrintDesigner'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))

// 三个公开包锁步同版，导航上的版本号取 core 的
const { version } = JSON.parse(readFileSync(new URL('../../print/packages/core/package.json', import.meta.url), 'utf8')) as { version: string }

const guideSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '开始',
    collapsed: false,
    items: [
      { text: '介绍', link: '/introduction' },
      { text: '快速开始', link: '/quickstart' },
    ],
  },
  {
    text: '指南',
    collapsed: false,
    items: [
      { text: '模板结构', link: '/guide/template' },
      { text: '数据绑定与格式化', link: '/guide/binding' },
      { text: '富文本', link: '/guide/rich-text' },
      { text: '运行时', link: '/guide/runtime' },
      { text: '设计器', link: '/guide/designer' },
      { text: '打印客户端', link: '/guide/client' },
      { text: '与宿主集成', link: '/guide/host' },
    ],
  },
]

// 参考页由 scripts/gen-reference.mjs 从源码生成
const referenceSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '模板',
    collapsed: false,
    items: [
      { text: '元素', link: '/reference/elements' },
      { text: '模板类型', link: '/reference/schema' },
      { text: '问题码与诊断', link: '/reference/issues' },
    ],
  },
  {
    text: 'API',
    collapsed: false,
    items: [
      { text: '预览与打印', link: '/reference/runtime' },
      { text: '设计器', link: '/reference/designer' },
      { text: '打印客户端 SDK', link: '/reference/client' },
      { text: '模型层 core', link: '/reference/core' },
    ],
  },
]

// 每个顶部导航板块各自一份侧栏，由路径前缀决定用哪一份；首页是 layout: home，不落任何一份。
const sidebar: DefaultTheme.Sidebar = {
  '/reference/': referenceSidebar,
  '/': guideSidebar,
}

const nav: DefaultTheme.NavItem[] = [
  { text: '指南', link: '/introduction', activeMatch: '^/(introduction|quickstart|guide/.*)$' },
  { text: '参考', link: '/reference/elements', activeMatch: '^/reference/' },
  {
    text: '生态',
    items: [
      {
        text: '官方生态',
        items: [
          { text: '开发框架', link: 'https://framework.docs.xihanfun.com' },
          { text: '视图组件', link: 'https://ui.docs.xihanfun.com' },
          { text: '基础应用', link: 'https://basicapp.docs.xihanfun.com' },
          { text: '打印设计器', link: '/' },
        ],
      },
    ],
  },
  {
    text: '支持',
    items: [
      { text: '公约', link: 'https://docs.xihanfun.com/cosmos/code-of-conduct' },
      { text: '参与', link: 'https://docs.xihanfun.com/cosmos/contributing' },
      { text: '赞助', link: 'https://docs.xihanfun.com/cosmos/sponsor' },
    ],
  },
  {
    text: `v${version}`,
    items: [{ text: '更新日志', link: '/changelog' }],
  },
]

/** 取代码文件里 `#region name` 与 `#endregion name` 之间的行，去掉公共缩进。 */
function region(source: string, name: string): string {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`#region ${name}\\b`).test(line))
  const end = lines.findIndex((line, index) => index > start && new RegExp(`#endregion ${name}\\b`).test(line))
  if (start < 0 || end < 0)
    throw new Error(`[docs] region ${name} not found`)
  const picked = lines.slice(start + 1, end)
  const indent = Math.min(...picked.filter(line => line.trim() !== '').map(line => /^ */.exec(line)![0].length))
  return picked.map(line => line.slice(indent)).join('\n')
}

/** 机读正文：`<<< @/路径#片段` 换成代码块，示例舞台去掉。 */
async function machineReadable(body: string): Promise<string> {
  const out: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const snippet = /^<<< @\/([^\s#]+)(?:#(\S+))?/.exec(line)
    if (snippet !== null) {
      const [, path, name] = snippet
      const source = await readFile(`${sourceRoot}${path}`, 'utf8')
      const code = name === undefined ? source.trimEnd() : region(source, name)
      out.push(`\`\`\`${extname(path!).slice(1)}`, code, '```')
      continue
    }
    if (/^<PrintDemo\b.*\/>\s*$/.test(line))
      continue
    out.push(line)
  }
  return out.join('\n')
}

export default defineXiHanConfig({
  title,
  description,
  keywords,
  repo: 'XiHan.PrintDesigner',
  llms: {
    title: '曦寒打印设计器',
    summary:
      '框架无关的打印设计器：以原生 Web Components 交付，模板是纯 JSON，在浏览器里按数据分页、预览与打印；配套的本地打印客户端负责静默打印、原始指令与导出 PDF。',
    site: 'https://print.docs.xihanfun.com',
    sections: [
      { dir: '.', label: '开始' },
      { dir: 'guide', label: '指南' },
      { dir: 'reference', label: '参考' },
    ],
    bundles: [
      { name: 'guide', label: '指南', dirs: ['guide'] },
      { name: 'reference', label: '参考', dirs: ['reference'] },
    ],
    transform: machineReadable,
  },
  // 打印三个包经 link: 接进来，它们要的 @xihan-ui/* 由文档站装唯一的一份：解析成同一份，全局配置（界面语言）才对得上
  vite: {
    resolve: {
      dedupe: [
        '@xihan-ui/core',
        '@xihan-ui/designer-kit',
        '@xihan-ui/designer-shell',
        '@xihan-ui/expression',
        '@xihan-ui/headless',
        '@xihan-ui/icons',
        '@xihan-ui/pointer',
        '@xihan-ui/styles',
        '@xihan-ui/viz',
        '@xihan-ui/web-components',
      ],
    },
  },
  // Vue 示例里的 xh- 标签都是自定义元素，不当作 Vue 组件解析
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: tag => tag.startsWith('xh-'),
      },
    },
  },
  themeConfig: {
    nav,
    sidebar,
  },
})
