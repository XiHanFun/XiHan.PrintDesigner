/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 最小模板：一张 A6 纵向页面，正文里一行绑定数据的文字。整份模板就是这个 JSON。

import type { PrintDocument } from '@xihan-print/core'

// #region schema
export const schema: PrintDocument = {
  schemaVersion: 1,
  name: '取件凭条',
  pages: [
    {
      id: 'page-1',
      paper: { preset: 'A6', width: 105, height: 148 },
      orientation: 'portrait',
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      header: { default: { height: 0, elements: [] }, singleSheet: 'first' },
      footer: { default: { height: 0, elements: [] }, singleSheet: 'last' },
      numbering: { continuous: true, start: 1 },
      elements: [
        {
          id: 'pickup-code',
          type: 'text',
          x: 8,
          y: 12,
          width: 89,
          height: 12,
          content: { kind: 'template', template: '取件码 {{code}}' },
          style: {
            fontSize: 18,
            bold: true,
            italic: false,
            underline: false,
            lineThrough: false,
            color: '#000000',
            align: 'center',
            verticalAlign: 'middle',
            lineHeight: 1.2,
            letterSpacing: 0,
          },
          wrap: false,
          overflow: 'shrink',
          rotation: 0,
        },
      ],
    },
  ],
}
// #endregion schema

export const data = { code: 'A-0517' }
