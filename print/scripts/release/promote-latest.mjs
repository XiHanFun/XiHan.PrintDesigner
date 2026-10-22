#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 发完包以后：正式版还没发出之前，候选版等预发布版也把 npm 的 latest 指过来，宿主不写版本号也装到最新的一版。
// 只在 .changeset/pre.json 在（预发布模式）、包版本带预发布后缀时做；npm 上某个包已经有正式版（不带后缀的版本）时，那个包不动。
// 打标签前等 npm 上取得到这一版（刚发完会晚一会儿）。--dry-run 只打印要做什么，不改 npm。
// 用法：在工作区根运行 node scripts/release/promote-latest.mjs [--dry-run]；改 dist-tag 用 npm 的登录或 NODE_AUTH_TOKEN。
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { publishablePackages, run } from './packages.mjs'

const PRE_PATH = '.changeset/pre.json'
const RETRIES = 30
const RETRY_MS = 10_000
const dryRun = process.argv.includes('--dry-run')

function npmJson(args) {
  try {
    return JSON.parse(run('npm', [...args, '--json'], { capture: true }) || 'null')
  }
  catch {
    return undefined
  }
}

async function waitForVersion(name, version) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    if (npmJson(['view', `${name}@${version}`, 'version']) === version)
      return
    if (attempt === RETRIES)
      throw new Error(`npm 上等了 ${RETRIES * RETRY_MS / 1000} 秒还取不到 ${name}@${version}`)
    await sleep(RETRY_MS)
  }
}

const packages = await publishablePackages()
const version = packages[0].version
if (!existsSync(PRE_PATH) || !version.includes('-')) {
  console.log(`[promote-latest] 跳过：${existsSync(PRE_PATH) ? `${version} 不带预发布后缀` : '不在预发布模式'}，latest 由 changeset publish 管`)
  process.exit(0)
}

for (const pkg of packages) {
  const versions = [npmJson(['view', pkg.name, 'versions']) ?? []].flat()
  const stable = versions.filter(item => !item.includes('-'))
  if (stable.length > 0) {
    console.log(`[promote-latest] ${pkg.name}：npm 上已有正式版 ${stable.at(-1)}，latest 不动`)
    continue
  }
  const latest = npmJson(['view', pkg.name, 'dist-tags.latest'])
  if (latest === pkg.version) {
    console.log(`[promote-latest] ${pkg.name}：latest 已是 ${pkg.version}`)
    continue
  }
  if (dryRun) {
    console.log(`[promote-latest] ${pkg.name}：会把 latest 从 ${latest ?? '（无）'} 改到 ${pkg.version}（dry-run，没改）`)
    continue
  }
  await waitForVersion(pkg.name, pkg.version)
  run('npm', ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest'])
  console.log(`[promote-latest] ${pkg.name}：latest 从 ${latest ?? '（无）'} 改到 ${pkg.version}`)
}
