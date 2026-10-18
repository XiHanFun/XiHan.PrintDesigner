#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 冒烟：在系统临时目录里照 scripts/release/smoke/ 建一个空的宿主项目，用 npm 装上公开包，
// 跑一遍类型检查（tsc）、打包（vite build）与 Node 侧的导入（node-check.mjs）。在工作区根运行。
//
//   node scripts/release/smoke.mjs --version 1.0.0          装 npm 上的这个版本（Release 发完包后用）
//   node scripts/release/smoke.mjs --pack                    装工作区现在的产物（先 pnpm build），用 pnpm pack 打包
//   node scripts/release/smoke.mjs --pack --ui <UI 工作区>   @xihan-ui/* 也从那份 UI 工作区打包，不从 npm 装
//   --keep                                                   留下临时项目，打印它的位置
//
// smoke/package.json 列出宿主要装的包，版本留空：本仓的公开包按 --version 或打包结果填，@xihan-ui/* 与开发依赖按
// pnpm-workspace.yaml 的 catalog 填。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { publishablePackages } from './packages.mjs'

const TEMPLATE_DIR = 'scripts/release/smoke'
const NPM_RETRIES = 12
const NPM_RETRY_MS = 10_000

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const version = option('--version')
const pack = process.argv.includes('--pack')
const uiRoot = option('--ui')
const keep = process.argv.includes('--keep')
if ((version === undefined) === !pack) {
  console.error('[smoke] ✗ 要么给 --version <版本>，要么给 --pack')
  process.exit(1)
}

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' })
}

/** pnpm-workspace.yaml 的 catalog：包名 → 范围。 */
function readCatalog() {
  const text = readFileSync('pnpm-workspace.yaml', 'utf8')
  const block = /^catalog:\n((?:[ \t].*\n|\n)+)/m.exec(text)?.[1] ?? ''
  const catalog = {}
  for (const line of block.split('\n')) {
    const match = /^\s+'?([^':#\s]+)'?:\s*([^#\s]+)/.exec(line)
    if (match)
      catalog[match[1]] = match[2]
  }
  return catalog
}

/** 在 dir 里 pnpm pack，打包结果放进 destination，返回文件名。 */
function packInto(dir, destination) {
  const before = new Set(readdirSync(destination))
  run('pnpm', ['pack', '--pack-destination', destination], dir, true)
  const created = readdirSync(destination).filter(name => !before.has(name) && name.endsWith('.tgz'))
  if (created.length !== 1)
    throw new Error(`在 ${dir} 打包后没有找到唯一的新 .tgz`)
  return created[0]
}

/** UI 工作区里的包：包名 → 目录。 */
function uiPackageDirs(root) {
  const dirs = new Map()
  const packagesRoot = join(root, 'packages')
  for (const group of readdirSync(packagesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const leaf of readdirSync(join(packagesRoot, group.name), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const manifestPath = join(packagesRoot, group.name, leaf.name, 'package.json')
      if (existsSync(manifestPath))
        dirs.set(JSON.parse(readFileSync(manifestPath, 'utf8')).name, join(packagesRoot, group.name, leaf.name))
    }
  }
  return dirs
}

/** 一份清单里依赖到的 @xihan-ui/* 包（dependencies 与非可选的 peerDependencies）。 */
function uiDependencies(manifest) {
  const optional = manifest.peerDependenciesMeta ?? {}
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}).filter(name => optional[name]?.optional !== true),
  ]
  return names.filter(name => name.startsWith('@xihan-ui/'))
}

async function waitForNpm(name, wanted) {
  for (let attempt = 1; attempt <= NPM_RETRIES; attempt++) {
    try {
      run('npm', ['view', `${name}@${wanted}`, 'version'], undefined, true)
      return
    }
    catch {
      if (attempt === NPM_RETRIES)
        throw new Error(`npm 上找不到 ${name}@${wanted}`)
      await sleep(NPM_RETRY_MS)
    }
  }
}

const packages = await publishablePackages()
const catalog = readCatalog()
const project = mkdtempSync(join(tmpdir(), `${basename(resolve('..'))}-smoke-`))
console.log(`[smoke] 临时项目：${project}`)

try {
  cpSync(TEMPLATE_DIR, project, { recursive: true })
  const manifestPath = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const own = new Set(packages.map(pkg => pkg.name))
  const specs = {}
  const overrides = {}

  if (version !== undefined) {
    for (const pkg of packages) {
      await waitForNpm(pkg.name, version)
      specs[pkg.name] = version
    }
  }
  else {
    const tarballs = join(project, 'tarballs')
    mkdirSync(tarballs)
    // 本仓的包之间互相依赖，经 overrides 都指向打包结果，不去 npm 上找
    for (const pkg of packages) {
      specs[pkg.name] = `file:./tarballs/${packInto(pkg.dir, tarballs)}`
      overrides[pkg.name] = specs[pkg.name]
    }
    if (uiRoot !== undefined) {
      // 从本仓公开包与宿主清单出发，把用到的 @xihan-ui/* 连同它们依赖的 @xihan-ui/* 都打包，经 overrides 换掉 npm 上的版本
      const dirs = uiPackageDirs(resolve(uiRoot))
      const queue = [...packages.flatMap(pkg => uiDependencies(pkg.manifest)), ...Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@xihan-ui/'))]
      const seen = new Set()
      while (queue.length > 0) {
        const name = queue.shift()
        if (seen.has(name))
          continue
        seen.add(name)
        const dir = dirs.get(name)
        if (dir === undefined)
          throw new Error(`UI 工作区 ${uiRoot} 里没有 ${name}`)
        overrides[name] = `file:./tarballs/${packInto(dir, tarballs)}`
        queue.push(...uiDependencies(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))))
      }
      console.log(`[smoke] 从 ${uiRoot} 打包了 ${seen.size} 个 @xihan-ui 包`)
    }
  }

  // 按版本留空的清单填版本：本仓的包取上面算好的，其余取 catalog（--ui 打包过的取打包结果）
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      const spec = own.has(name) ? specs[name] : overrides[name] ?? catalog[name]
      if (spec === undefined)
        throw new Error(`${TEMPLATE_DIR}/package.json 里的 ${name} 既不是本仓的包，catalog 里也没有它`)
      manifest[field][name] = spec
    }
  }
  if (Object.keys(overrides).length > 0)
    manifest.overrides = overrides
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], project)
  run('npx', ['tsc', '--noEmit', '-p', '.'], project)
  run('npx', ['vite', 'build', '--logLevel', 'error'], project)
  run('node', ['node-check.mjs'], project)
  console.log(`[smoke] 通过：${packages.map(pkg => `${pkg.name}@${version ?? pkg.version}`).join('、')} 装得上、类型检查与打包都过、Node 侧导入正常`)
}
catch (error) {
  console.error(`[smoke] ✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
finally {
  if (keep)
    console.log(`[smoke] 留下了临时项目：${project}`)
  else
    rmSync(project, { recursive: true, force: true })
}
