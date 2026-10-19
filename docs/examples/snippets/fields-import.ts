/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 导入字段：用户在设计器里导入的字段与示例数据交回宿主存起来，下次赋回；字段由后端定时关掉导入。

import type { XhPrintDesigner } from '@xihan-print/designer'
import type { JsonValue } from '@xihan-ui/core/json'
import type { DataField } from '@xihan-ui/designer-kit'

interface FieldStore {
  readonly fields: readonly DataField[] | undefined
  readonly sample: JsonValue | undefined
  save: (patch: { fields?: readonly DataField[], sample?: JsonValue }) => void
}

// #region example
export function wireFields(designer: XhPrintDesigner, store: FieldStore, fromBackend: boolean): void {
  designer.fields = store.fields
  designer.sampleData = store.sample
  // 字段来自后端元数据时不许在设计器里改
  designer.fieldsReadonly = fromBackend
  designer.addEventListener('fields-change', (event) => {
    store.save({ fields: (event as CustomEvent<{ fields: readonly DataField[] }>).detail.fields })
  })
  designer.addEventListener('sample-data-change', (event) => {
    store.save({ sample: (event as CustomEvent<{ sampleData: JsonValue }>).detail.sampleData })
  })
}
// #endregion example
