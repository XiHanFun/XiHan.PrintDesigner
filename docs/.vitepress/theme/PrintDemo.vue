<script setup lang="ts">
/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 示例舞台：在浏览器里载入 examples/demos/<name>.ts 或 <name>.vue。.ts 示例导出 mount，挂到舞台上，卸载时调用它返回的清理函数；
// .vue 示例是一个组件，直接渲染在舞台里。
// 舞台里的预览元素按第一张输出页定高度，整页都看得到：示例没有自己设 zoom 时，缩放取适合舞台宽度（不放大）。
// 写了 fullscreen 的示例可以全屏，全屏时舞台里的设计器长到屏幕底。

import type { Component } from 'vue'
import { XhFullscreen } from '@xihanfun/vitepress-theme'
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

interface DemoModule {
  mount?: (host: HTMLElement) => () => void
  default?: Component
}

type PreviewElement = HTMLElement & { zoom?: number, readonly updateComplete?: Promise<unknown> }

const props = defineProps<{ name: string, fullscreen?: boolean }>()

const demos = import.meta.glob<DemoModule>('../../examples/demos/*.{ts,vue}')
const stage = ref<HTMLElement>()
const component = shallowRef<Component>()
const missing = ref(false)
let dispose: (() => void) | undefined
let unmounted = false
let observer: ResizeObserver | undefined
let stopFullscreen: (() => void) | undefined
/** 舞台替它定过缩放的预览，与定的那个值；示例自己改了缩放以后不再替它定。 */
const fittedZoom = new WeakMap<PreviewElement, number>()

/** 舞台里不在设计器里的预览元素。 */
function previews(): PreviewElement[] {
  return Array.from(stage.value?.querySelectorAll<PreviewElement>('xh-print-preview') ?? []).filter(preview => preview.closest('xh-print-designer') === null)
}

/** 一个预览：先按需定缩放，再把高度写成第一张输出页的高度加上下留白。 */
async function fitPreview(preview: PreviewElement): Promise<void> {
  const sheet = preview.querySelector<HTMLElement>('[data-part="sheet"]')
  if (sheet === null || preview.clientWidth === 0)
    return
  const current = preview.zoom ?? 1
  const owned = preview.zoom === undefined || fittedZoom.get(preview) === preview.zoom
  const box = preview.getBoundingClientRect()
  const rect = sheet.getBoundingClientRect()
  // 输出页列表四周的留白随缩放一起变，与输出页顶边到预览内容顶边的距离相同
  const inset = rect.top - box.top - preview.clientTop + preview.scrollTop
  if (owned) {
    const zoom = Math.min(1, Math.floor(preview.clientWidth / ((rect.width + 2 * inset) / current) * 1000) / 1000)
    fittedZoom.set(preview, zoom)
    if (Math.abs(zoom - current) > 0.001) {
      preview.zoom = zoom
      await preview.updateComplete
      requestAnimationFrame(() => void fitPreview(preview))
      return
    }
  }
  preview.style.blockSize = `${Math.ceil(2 * inset + rect.height)}px`
}

function fitPreviews(): void {
  for (const preview of previews())
    void fitPreview(preview)
}

/** 全屏时舞台里的设计器从自己的顶边长到舞台底，退出全屏后回到样式表给的高度。 */
function fillDesigners(host: HTMLElement): () => void {
  const fill = (): void => {
    const full = document.fullscreenElement?.contains(host) === true
    const bottom = host.getBoundingClientRect().bottom
    for (const designer of host.querySelectorAll<HTMLElement>('xh-print-designer'))
      designer.style.blockSize = full ? `${Math.floor(bottom - designer.getBoundingClientRect().top)}px` : ''
  }
  const resize = new ResizeObserver(fill)
  resize.observe(host)
  document.addEventListener('fullscreenchange', fill)
  return () => {
    resize.disconnect()
    document.removeEventListener('fullscreenchange', fill)
  }
}

onMounted(async () => {
  const load = demos[`../../examples/demos/${props.name}.ts`] ?? demos[`../../examples/demos/${props.name}.vue`]
  if (load === undefined) {
    missing.value = true
    return
  }
  const demo = await load()
  if (unmounted)
    return
  if (props.fullscreen && stage.value !== undefined)
    stopFullscreen = fillDesigners(stage.value)
  if (demo.mount !== undefined && stage.value !== undefined)
    dispose = demo.mount(stage.value)
  else if (demo.default !== undefined)
    component.value = markRaw(demo.default)
  // 预览排完一次分页就重算；舞台变宽变窄时也重算
  stage.value?.addEventListener('paginated', fitPreviews)
  if (stage.value !== undefined && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(fitPreviews)
    observer.observe(stage.value)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  observer?.disconnect()
  stopFullscreen?.()
  stage.value?.removeEventListener('paginated', fitPreviews)
  dispose?.()
})
</script>

<template>
  <div class="print-demo">
    <p v-if="missing" class="print-demo__missing">
      找不到示例 {{ props.name }}
    </p>
    <XhFullscreen v-else-if="props.fullscreen">
      <div ref="stage" class="print-demo__stage">
        <component :is="component" v-if="component" />
      </div>
    </XhFullscreen>
    <div v-else ref="stage" class="print-demo__stage">
      <component :is="component" v-if="component" />
    </div>
  </div>
</template>
