/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 把 tauri build 出的 macOS 与 Linux 安装包按发布的写法改名、复制到一个目录，并写出各自的 SHA-256：
// XiHanPrint-<版本>-macos-<arch>.dmg、XiHanPrint-<版本>-linux-<arch>.{deb,rpm,AppImage}。
// 用法（在 client/）：node scripts/collect-bundles.mjs --target <Rust 目标三元组> --out <目录>

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { target: { type: 'string' }, out: { type: 'string' } } })
if (values.target === undefined || values.out === undefined)
  throw new Error('要给 --target 与 --out')

const manifest = readFileSync('Cargo.toml', 'utf8')
const version = /^\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1]
if (version === undefined)
  throw new Error('在 Cargo.toml 里找不到 [workspace.package] 的 version')

const arch = values.target.startsWith('aarch64') ? 'arm64' : 'x64'
const os = values.target.includes('apple') ? 'macos' : 'linux'
const KINDS = { dmg: 'dmg', deb: 'deb', rpm: 'rpm', appimage: 'AppImage' }
const bundleRoot = join('target', values.target, 'release', 'bundle')

mkdirSync(values.out, { recursive: true })
const collected = []
for (const [folder, extension] of Object.entries(KINDS)) {
  const directory = join(bundleRoot, folder)
  if (!existsSync(directory))
    continue
  const found = readdirSync(directory).filter(name => name.toLowerCase().endsWith(`.${extension.toLowerCase()}`))
  if (found.length !== 1)
    throw new Error(`${directory} 里应当正好有一个 .${extension}，实际 ${found.length} 个`)
  const name = `XiHanPrint-${version}-${os}-${arch}.${extension}`
  const target = join(values.out, name)
  copyFileSync(join(directory, found[0]), target)
  const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
  writeFileSync(`${target}.sha256`, `${hash}  ${name}\n`)
  collected.push(name)
}
if (collected.length === 0)
  throw new Error(`${bundleRoot} 下没有安装包`)
console.log(`安装包：${collected.join('、')}`)
