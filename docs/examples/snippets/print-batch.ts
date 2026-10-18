/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 一次打多份：每份数据各排一次，合并成一份后交给浏览器打印或打印客户端。

// #region browser
import type { MergedPaginationResult } from '@xihan-print/runtime'
import type { PrintClient } from '@xihan-print/runtime/client'
import { mergePaginationResults, paginateDocument, printSheets } from '@xihan-print/runtime'
import { schema } from '../templates/delivery'

/** 每份数据各排一次再合并：页码与总页数各自从第 1 页算起；分页的缺省注入项与 printDocument 相同。 */
export function paginateAll(records: readonly unknown[]): MergedPaginationResult {
  return mergePaginationResults(records.map(record => paginateDocument(schema, record)))
}

export async function printAll(records: readonly unknown[]): Promise<void> {
  await printSheets(paginateAll(records), { title: '送货单' })
}
// #endregion browser

// #region client
export async function printAllViaClient(client: PrintClient, records: readonly unknown[]): Promise<void> {
  await client.printSheets(paginateAll(records), { printer: 'Delivery Printer' }).done
}
// #endregion client
