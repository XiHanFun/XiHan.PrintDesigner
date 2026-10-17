/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 只改一个设计器实例的几处文案，其余仍用全局的语言包。

// #region example
import type { XhPrintDesigner } from '@xihan-print/designer'

export function renamePanels(designer: XhPrintDesigner): void {
  designer.translations = {
    palette: '控件',
    issues: '检查结果',
  }
}
// #endregion example
