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

/** 受限表达式接入点：模板只保存表达式源码，检查由接入方实现。 */
export interface ExpressionEngine {
  /** 静态检查表达式源码，合法时返回空数组。 */
  check: (source: string) => readonly ExpressionDiagnostic[]
}
