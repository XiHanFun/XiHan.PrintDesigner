#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 从文档站的更新日志（../docs/changelog.md）取出一个版本的那一节，写成 GitHub Release 的说明：
// VitePress 的提示块换成 GitHub 的提示写法，站内相对链接换成文档站的完整地址，末尾补一行文档站地址。
// 版本取 --version，或标签（RELEASE_TAG / Actions 里的 GITHUB_REF_NAME），都没有就取公开包的版本。
// 用法：node scripts/release/release-notes.mjs [--version <版本>] [--out <文件>] [--check]；--check 只核对这一节在不在。
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { publishablePackages } from './packages.mjs'

const CHANGELOG_PATH = '../docs/changelog.md'
const DOCS_MANIFEST_PATH = '../docs/package.json'

/** VitePress 提示块的种类 → GitHub 提示的种类。 */
const ALERTS = { tip: 'TIP', info: 'NOTE', details: 'NOTE', warning: 'WARNING', danger: 'CAUTION' }

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    out: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
})

const tag = process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined)
const version = values.version ?? tag?.replace(/^v/, '') ?? (await publishablePackages())[0].version

const changelog = (await readFile(CHANGELOG_PATH, 'utf8')).split(/\r?\n/)
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^## v${escaped}(?:[\\s（(]|$)`)
const start = changelog.findIndex(line => heading.test(line))
if (start < 0) {
  console.error(`[release-notes] ✗ ${CHANGELOG_PATH} 里没有 v${version} 一节。先在更新日志里补上这一版，再提交版本、打标签。`)
  process.exit(1)
}
if (values.check) {
  console.log(`[release-notes] 通过：${CHANGELOG_PATH} 里有 v${version} 一节`)
  process.exit(0)
}

const next = changelog.findIndex((line, index) => index > start && line.startsWith('## '))
const section = changelog.slice(start + 1, next < 0 ? changelog.length : next)

const homepage = JSON.parse(await readFile(DOCS_MANIFEST_PATH, 'utf8')).homepage.replace(/\/$/, '')

/** 站内相对链接（./x、../x、/x，可带 .md）换成文档站的完整地址。 */
function absolute(line) {
  return line.replace(/\]\((?!https?:|mailto:|#)(?:\.\.?\/|\/)?([^)\s]*)\)/g, (_, target) => {
    const [path, hash] = target.split('#')
    const page = path.replace(/\.md$/, '').replace(/(?:^|\/)index$/, '')
    return `](${homepage}/${page}${hash === undefined ? '' : `#${hash}`})`
  })
}

const out = []
let alert = false
for (const line of section) {
  const open = /^:::\s*([a-z]+)(?:\s+(\S.*))?$/.exec(line)
  if (!alert && open && open[1] in ALERTS) {
    alert = true
    out.push(`> [!${ALERTS[open[1]]}]`)
    if (open[2])
      out.push(`> **${open[2].trim()}**`)
    continue
  }
  if (alert && /^:::\s*$/.test(line)) {
    alert = false
    continue
  }
  const text = absolute(line)
  out.push(alert ? (text ? `> ${text}` : '>') : text)
}

while (out.length > 0 && out[0].trim() === '')
  out.shift()
while (out.length > 0 && out.at(-1).trim() === '')
  out.pop()

const notes = `${out.join('\n')}\n\n文档：${homepage}\n`
if (values.out)
  await writeFile(values.out, notes)
else
  process.stdout.write(notes)
