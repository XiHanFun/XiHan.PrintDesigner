/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 发版脚本共用：列出工作区 packages/ 下的公开包（不含 private），以及跑一条外部命令。在工作区根（有 packages/ 的那一层）运行。
import { execSync } from 'node:child_process'
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

/** 一个参数在命令行里的写法：只含安全字符的原样写，其余按所在平台的 shell 加引号。 */
function quote(arg) {
  if (/^[\w@+=:,./\\-]+$/.test(arg))
    return arg
  if (process.platform === 'win32') {
    if (/["%\r\n]/.test(arg))
      throw new Error(`参数里不能有引号、百分号或换行：${arg}`)
    return `"${arg}"`
  }
  return `'${arg.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * 跑一条外部命令：命令与参数拼成一行交给 shell（Windows 上 npm、npx、pnpm 与 node_modules/.bin 里的命令都是 .cmd，要经 shell 才找得到）。
 * capture 为 true 时返回标准输出，否则输出直接打到终端。命令失败时抛错。
 */
export function run(command, args, { cwd, capture = false } = {}) {
  return execSync([command, ...args].map(quote).join(' '), { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
}
