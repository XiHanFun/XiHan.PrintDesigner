/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 受限表达式接入点的类型，结构与 @xihan-ui/expression 的 ExpressionEngine 相同；只有类型，没有实现。

/** 表达式的一处问题，`start`、`end` 为源码中的 UTF-16 码元偏移（左闭右开）。 */
export interface ExpressionIssue {
  readonly code: string
  readonly start: number
  readonly end: number
  /** 按问题码携带的附加数据。 */
  readonly data?: Readonly<Record<string, string | number>>
}

/** 表达式中的一处字段引用：从顶层标识符起的静态路径。 */
export interface ExpressionReference {
  readonly path: readonly string[]
  readonly start: number
  readonly end: number
}

/** 表达式求值结果。 */
export type ExpressionEvaluation
  = | { readonly ok: true, readonly value: unknown }
    | { readonly ok: false, readonly issue: ExpressionIssue }

/** 编译成功的表达式。 */
export interface CompiledExpression {
  readonly ok: true
  readonly references: readonly ExpressionReference[]
  evaluate: (scope: Readonly<Record<string, unknown>>) => ExpressionEvaluation
}

/** 表达式编译结果。 */
export type ExpressionCompilation
  = | CompiledExpression
    | { readonly ok: false, readonly issues: readonly ExpressionIssue[] }

/** 表达式编译选项。 */
export interface ExpressionCompileOptions {
  /** 已知的顶层标识符，提供时其余标识符报告为未知。 */
  identifiers?: Iterable<string> | ((name: string) => boolean)
}

/** 受限表达式接入点：模板只保存表达式源码，编译与求值由接入方实现。 */
export interface ExpressionEngine {
  compile: (source: string, options?: ExpressionCompileOptions) => ExpressionCompilation
}
