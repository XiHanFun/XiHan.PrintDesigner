/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 受限表达式源码中的一处问题，`start`、`end` 为 UTF-16 码元偏移（左闭右开）。 */
export interface ExpressionDiagnostic {
  code: string
  start: number
  end: number
  /** 按问题码携带的附加数据。 */
  data?: Readonly<Record<string, string | number>>
}

/** 受限表达式检查接入点：模板只保存表达式源码，检查由接入方实现。 */
export interface ExpressionChecker {
  /** 静态检查表达式源码，合法时返回空数组。 */
  check: (source: string) => readonly ExpressionDiagnostic[]
}

/** 表达式求值结果。 */
export type ExpressionEvaluation
  = | { ok: true, value: unknown }
    | { ok: false, diagnostics: readonly ExpressionDiagnostic[] }

/** 受限表达式求值接入点：以给定变量求出表达式的值，求值由接入方实现。 */
export interface ExpressionEvaluator {
  evaluate: (source: string, scope: Readonly<Record<string, unknown>>) => ExpressionEvaluation
}

/** 同时提供检查与求值的受限表达式接入点。 */
export interface ExpressionEngine extends ExpressionChecker, ExpressionEvaluator {}
