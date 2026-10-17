<script setup lang="ts">
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 示例舞台：在浏览器里载入 examples/demos/<name>.ts 或 <name>.vue。.ts 示例导出 mount，挂到舞台上，卸载时调用它返回的清理函数；
// .vue 示例是一个组件，直接渲染在舞台里。

import type { Component } from 'vue'
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

interface DemoModule {
  mount?: (host: HTMLElement) => () => void
  default?: Component
}

const props = defineProps<{ name: string }>()

const demos = import.meta.glob<DemoModule>('../../examples/demos/*.{ts,vue}')
const stage = ref<HTMLElement>()
const component = shallowRef<Component>()
const missing = ref(false)
let dispose: (() => void) | undefined
let unmounted = false

onMounted(async () => {
  const load = demos[`../../examples/demos/${props.name}.ts`] ?? demos[`../../examples/demos/${props.name}.vue`]
  if (load === undefined) {
    missing.value = true
    return
  }
  const demo = await load()
  if (unmounted)
    return
  if (demo.mount !== undefined && stage.value !== undefined)
    dispose = demo.mount(stage.value)
  else if (demo.default !== undefined)
    component.value = markRaw(demo.default)
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
    <div v-else ref="stage" class="print-demo__stage">
      <component :is="component" v-if="component" />
    </div>
  </div>
</template>
