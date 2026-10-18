#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 门禁：核对两条。① 标签号等于每个公开包的版本；② 标签带不带预发布后缀、带的是哪个通道，与 .changeset/pre.json 一致。
// 标签取 RELEASE_TAG，或 Actions 里的 GITHUB_REF_NAME（GITHUB_REF_TYPE 为 tag 时）；都没有就跳过。
import { readFile } from 'node:fs/promises'
import { publishablePackages } from './packages.mjs'

const PRE_PATH = '.changeset/pre.json'

const tag = process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined)

let pre = null
try {
  pre = JSON.parse(await readFile(PRE_PATH, 'utf8'))
}
catch {
  // 没有 pre.json 就是正式模式
}

if (!tag) {
  console.log(`[check-release-tag] 跳过：不在标签发布环境（当前 changesets 模式：${pre ? `预发布，tag=${pre.tag}` : '正式'}）`)
  process.exit(0)
}

const problems = []
if (!/^v\d+\.\d+\.\d+(?:-[0-9a-z]+\.\d+)?$/i.test(tag))
  problems.push(`标签 ${tag} 不是 v<主>.<次>.<修订> 或 v<主>.<次>.<修订>-<通道>.<序号> 的写法`)

const version = tag.replace(/^v/, '')
const prerelease = /-([0-9a-z]+)\.\d+$/i.exec(version)?.[1]
const packages = await publishablePackages()

const mismatched = packages.filter(pkg => pkg.version !== version)
if (mismatched.length > 0) {
  problems.push(`标签 ${tag} 要发的是 ${version}，这些包的 package.json 不是这个号：${mismatched.map(pkg => `${pkg.name}@${pkg.version}`).join('、')}。`
    + '先跑 VersionUpgrade 把版本提到位并合进 main，再在那个提交上打标签。')
}
if (prerelease === undefined && pre !== null) {
  problems.push(`标签 ${tag} 是正式版号，${PRE_PATH} 还在预发布模式（tag=${pre.tag}）：发出去的会是 ${version}-${pre.tag}.N。`
    + '先在 VersionUpgrade 里选正式版（changeset pre exit）再定版本、打标签。')
}
if (prerelease !== undefined && pre === null) {
  problems.push(`标签 ${tag} 带预发布后缀 -${prerelease}，${PRE_PATH} 不存在（正式模式）：发出去的会是正式版并占掉 npm 的 latest。`
    + `先在 VersionUpgrade 里选 ${prerelease} 通道（changeset pre enter ${prerelease}）。`)
}
if (prerelease !== undefined && pre !== null && prerelease !== pre.tag)
  problems.push(`标签 ${tag} 的预发布通道是 ${prerelease}，${PRE_PATH} 里是 ${pre.tag}：发出去的会被打上 dist-tag ${pre.tag}。`)

if (problems.length > 0) {
  console.error('[check-release-tag] ✗ 标签与包版本或 changesets 模式对不上：')
  for (const problem of problems)
    console.error(`  ${problem}`)
  process.exit(1)
}

console.log(`[check-release-tag] 通过：标签 ${tag} 与 ${packages.length} 个公开包的版本号、changesets 的${pre ? `预发布模式（tag=${pre.tag}）` : '正式模式'}一致`)
