/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 发版脚本共用：列出工作区 packages/ 下的公开包（不含 private）。在工作区根（有 packages/ 的那一层）运行。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PACKAGES_DIR = 'packages'

/** packages/<包>/package.json 里不是 private 的包：目录、包名、版本与整份清单。 */
export async function publishablePackages() {
  const out = []
  for (const entry of await readdir(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue
    const dir = join(PACKAGES_DIR, entry.name)
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    }
    catch {
      continue
    }
    if (manifest.private !== true)
      out.push({ dir, name: manifest.name, version: manifest.version, manifest })
  }
  if (out.length === 0)
    throw new Error(`${PACKAGES_DIR}/ 下一个公开包都没扫到，目录层级变了就把这里的遍历一起改`)
  return out
}
