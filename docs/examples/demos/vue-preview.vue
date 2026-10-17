<script setup lang="ts">
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 在 Vue 里使用预览元素：对象经 .prop 交给元素的属性，事件用 @ 监听。

import type { PrintPreviewEventMap } from '@xihan-print/runtime'
import { definePrintPreview } from '@xihan-print/runtime'
import { ref } from 'vue'
import { data, schema } from '../templates/delivery'

definePrintPreview()

const status = ref('')

function onPaginated(event: Event): void {
  const { sheets } = (event as PrintPreviewEventMap['paginated']).detail
  status.value = `共 ${sheets} 张输出页`
}
</script>

<template>
  <p>{{ status }}</p>
  <xh-print-preview :schema.prop="schema" :data.prop="data" @paginated="onPaginated" />
</template>
