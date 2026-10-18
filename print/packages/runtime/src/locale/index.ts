/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// @xihan-print/runtime/locale —— 打印的内建语言包，语言与 UI 的内建语言包一一对应。
//
// 每份含预览、设计器与设计器零件（designer-shell）的文案，宿主用 mergeXhConfig 与 UI 同一语言的
// 语言包合并后交给 setXhConfig 或 <xh-config>。每种语言是独立的具名导出，打包器按引用摇树。

import type {} from '../translations'

export { printDeDE } from './de-DE'
export { printEnUS } from './en-US'
export { printEsES } from './es-ES'
export { printFrFR } from './fr-FR'
export { printJaJP } from './ja-JP'
export { printKoKR } from './ko-KR'
export { printPtBR } from './pt-BR'
export { printRuRU } from './ru-RU'
export { printZhCN } from './zh-CN'
export { printZhTW } from './zh-TW'
