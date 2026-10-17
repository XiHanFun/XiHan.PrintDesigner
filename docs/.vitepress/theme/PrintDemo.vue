<script setup lang="ts">
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 示例舞台：在浏览器里载入 examples/demos/<name>.ts，把它的 mount 挂到舞台上，卸载时调用它返回的清理函数。

import { onBeforeUnmount, onMounted, ref } from 'vue'

interface DemoModule {
  mount: (host: HTMLElement) => () => void
}

const props = defineProps<{ name: string }>()

const demos = import.meta.glob<DemoModule>('../../examples/demos/*.ts')
const stage = ref<HTMLElement>()
const missing = ref(false)
let dispose: (() => void) | undefined
let unmounted = false

onMounted(async () => {
  const load = demos[`../../examples/demos/${props.name}.ts`]
  if (load === undefined) {
    missing.value = true
    return
  }
  const { mount } = await load()
  if (!unmounted && stage.value !== undefined)
    dispose = mount(stage.value)
})

onBeforeUnmount(() => {
  unmounted = true
  dispose?.()
})
</script>

<template>
  <div class="print-demo">
    <p v-if="missing" class="print-demo__missing">
      找不到示例 {{ props.name }}
    </p>
    <div v-else ref="stage" class="print-demo__stage" />
  </div>
</template>
