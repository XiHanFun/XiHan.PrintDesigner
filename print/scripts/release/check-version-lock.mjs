#!/usr/bin/env node
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 门禁：公开包锁步同版，任何一个包发新版本都是全部一起发同一个号。
import { publishablePackages } from './packages.mjs'

const packages = await publishablePackages()
const byVersion = new Map()
for (const pkg of packages) {
  const names = byVersion.get(pkg.version) ?? []
  names.push(pkg.name)
  byVersion.set(pkg.version, names)
}

if (byVersion.size !== 1) {
  console.error('[check-version-lock] ✗ 公开包版本不一致，锁步发版被打破：')
  for (const [version, names] of byVersion)
    console.error(`  ${version}: ${names.join('、')}`)
  process.exit(1)
}

const [[version]] = byVersion
console.log(`[check-version-lock] 通过：${packages.length} 个公开包同版本 ${version}`)
