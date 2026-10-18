#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 门禁：逐个公开包跑 publint 与 attw，核对发布产物的契约（exports 条件、类型解析、files）。先 build 再跑。
// 三个包都是 ESM only、engines node>=18，attw 只核 node16-from-ESM 与 bundler 两列（profile esm-only）；
// 纯资源子路径（CSS）没有类型也没有 JS，attw 解析不了，按 exports 摘掉。
import { execFileSync } from 'node:child_process'
import { publishablePackages } from './packages.mjs'

const ATTW_PROFILE = 'esm-only'

function assetEntrypoints(manifest) {
  const asset = /\.(?:css|json)$/
  return Object.entries(manifest.exports ?? {})
    .filter(([key, target]) => asset.test(key) || (typeof target === 'string' && asset.test(target)))
    .map(([key]) => (key === '.' ? '.' : key.replace(/^\.\//, '')))
}

function run(command, args, cwd) {
  try {
    execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    return true
  }
  catch {
    return false
  }
}

const failed = []
const packages = await publishablePackages()
for (const pkg of packages) {
  console.log(`\n── ${pkg.name} ──`)
  if (!run('publint', ['--strict'], pkg.dir))
    failed.push(`${pkg.name}（publint）`)
  const attwArgs = ['--pack', '.', '--profile', ATTW_PROFILE]
  for (const entry of assetEntrypoints(pkg.manifest))
    attwArgs.push('--exclude-entrypoints', entry)
  if (!run('attw', attwArgs, pkg.dir))
    failed.push(`${pkg.name}（attw）`)
}

if (failed.length > 0) {
  console.error(`\n[check-publish] ✗ 产物契约不通过：${failed.join('、')}`)
  process.exit(1)
}
console.log(`\n[check-publish] 通过：${packages.length} 个公开包的产物契约没有问题`)
