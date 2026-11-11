/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 按发布的安装包生成更新清单 update.json：每个平台每个架构一项，Windows 的排在最前（1.0 及以前的客户端只按架构取第一项）；
// Windows 的离线安装包另成一项、带 "variant": "offline"，全部排在在线安装包之后。
// 用法：node scripts/update-manifest.mjs --version 1.1.0 --base-url https://github.com/<repo>/releases/download/v1.1.0 [--notes notes.md] --out update.json <安装包文件…>
// 认得的文件名：XiHanPrint-<版本>-<x64|arm64>-setup.exe、XiHanPrint-<版本>-<x64|arm64>-offline-setup.exe、XiHanPrint-<版本>-macos-<x64|arm64>.dmg、XiHanPrint-<版本>-linux-<x64|arm64>.AppImage；其余文件跳过。

import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'version': { type: 'string' },
    'base-url': { type: 'string' },
    'notes': { type: 'string' },
    'out': { type: 'string' },
  },
})

if (values.version === undefined || values['base-url'] === undefined || values.out === undefined)
  throw new Error('要给 --version、--base-url 与 --out')

// 与客户端 core 的 MAX_ASSET_BYTES 相同：清单里有一项超过它，客户端就不认整份清单
const MAX_ASSET_BYTES = 512 * 1024 * 1024

const PATTERNS = [
  { os: 'windows', pattern: /^XiHanPrint-(.+)-(x64|arm64)-setup\.exe$/ },
  { os: 'windows', variant: 'offline', pattern: /^XiHanPrint-(.+)-(x64|arm64)-offline-setup\.exe$/ },
  { os: 'macos', pattern: /^XiHanPrint-(.+)-macos-(x64|arm64)\.dmg$/ },
  { os: 'linux', pattern: /^XiHanPrint-(.+)-linux-(x64|arm64)\.AppImage$/ },
]
const ORDER = ['windows', 'macos', 'linux']

const assets = []
for (const file of positionals) {
  const name = basename(file)
  for (const { os, variant, pattern } of PATTERNS) {
    const match = pattern.exec(name)
    if (match === null)
      continue
    if (match[1] !== values.version)
      throw new Error(`安装包 ${name} 的版本不是 ${values.version}`)
    const size = statSync(file).size
    if (size > MAX_ASSET_BYTES)
      throw new Error(`安装包 ${name} 有 ${size} 字节，超过客户端认的上限 ${MAX_ASSET_BYTES}`)
    const bytes = readFileSync(file)
    assets.push({
      os,
      arch: match[2],
      ...(variant === undefined ? {} : { variant }),
      url: `${values['base-url'].replace(/\/$/, '')}/${name}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size,
    })
  }
}
if (assets.length === 0)
  throw new Error('没有认得的安装包')
const variantRank = asset => (asset.variant === undefined ? 0 : 1)
assets.sort((a, b) => variantRank(a) - variantRank(b) || ORDER.indexOf(a.os) - ORDER.indexOf(b.os) || a.arch.localeCompare(b.arch))

const manifest = {
  version: values.version,
  notes: values.notes === undefined ? null : readFileSync(values.notes, 'utf8'),
  assets,
}
writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`更新清单 ${values.out}：${assets.map(asset => `${asset.os}/${asset.arch}${asset.variant === undefined ? '' : `/${asset.variant}`}`).join('、')}`)
