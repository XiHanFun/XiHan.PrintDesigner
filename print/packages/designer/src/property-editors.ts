/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器自带的复合属性编辑器。四边边框：上、右、下、左四个页签，每边一个开关，开时下面是线宽、线型与颜色。

import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { JsonValue } from '@xihan-ui/core/json'
import type { DesignerPropertyEditor } from '@xihan-ui/designer-shell'
import { STROKE_STYLES } from '@xihan-print/core'
import { isPlainObject } from '@xihan-ui/core/json'
import { createAuthoredElement, setText } from '@xihan-ui/web-components/authoring'
import { defaultStroke } from './property-expand'

const SIDES = ['top', 'right', 'bottom', 'left'] as const

type Side = (typeof SIDES)[number]

interface Stroke {
  readonly width: number
  readonly style: string
  readonly color: string
}

/** 库内元素上受控的值。 */
interface ControlElement extends HTMLElement {
  value?: unknown
  checked?: boolean
  collection?: unknown
  label?: string
}

/** 复合编辑器要从设计器拿的东西。 */
export interface CompositeEditorHost {
  readonly ownerDocument: Document
  readonly translations: () => PrintDesignerTranslations
}

/** 取值里的一条线；不是完整的线时为 undefined。 */
function strokeOf(value: unknown): Stroke | undefined {
  if (!isPlainObject(value))
    return undefined
  const { width, style, color } = value
  return typeof width === 'number' && typeof style === 'string' && typeof color === 'string' ? { width, style, color } : undefined
}

/** 一边的控件。 */
interface SideControls {
  readonly toggle: ControlElement
  readonly toggleText: HTMLElement
  readonly settings: HTMLElement
  readonly width: ControlElement
  readonly widthLabel: HTMLElement
  readonly unit: HTMLElement
  readonly style: ControlElement
  readonly color: ControlElement
  readonly colorLabel: HTMLElement
}

/**
 * 四边边框：取值是 { top?, right?, bottom?, left? }，每边一条线，缺的边不画。四边都关掉时清除整个属性。
 * 新打开的一边照第一条已有的边，没有时用缺省的线。多个元素取值不同时从四边都不画开始，改动整体写给每个元素。
 */
export function borderSidesEditor(host: CompositeEditorHost): DesignerPropertyEditor {
  return (initial) => {
    const doc = host.ownerDocument
    let context = initial
    const tabs = createAuthoredElement(doc, 'xh-tabs', { 'size': 'sm', 'default-value': 'top', 'data-part': 'border-sides' }) as ControlElement
    tabs.addEventListener('value-change', event => event.stopPropagation())
    // 自己最近写出的值：面板回填之前接着改，以它为准，不被回填前的旧值盖掉
    let written: Partial<Record<Side, Stroke>> | undefined
    const current = (): Partial<Record<Side, Stroke>> => {
      if (written !== undefined)
        return written
      const value = isPlainObject(context.value) ? context.value : {}
      return Object.fromEntries(SIDES.flatMap((side) => {
        const stroke = strokeOf(value[side])
        return stroke === undefined ? [] : [[side, stroke]]
      }))
    }
    const write = (next: Partial<Record<Side, Stroke>>): void => {
      written = next
      context.setValue(Object.keys(next).length === 0 ? undefined : next as unknown as JsonValue)
    }
    const change = (side: Side, patch: Partial<Stroke>): void => {
      const sides = current()
      const stroke = sides[side]
      if (stroke !== undefined)
        write({ ...sides, [side]: { ...stroke, ...patch } })
    }
    const sides = new Map<Side, SideControls>(SIDES.map((side) => {
      const toggleText = createAuthoredElement(doc, 'span', { 'data-xh-part': 'text' })
      const toggle = createAuthoredElement(doc, 'xh-switch', { size: 'sm' }, [
        createAuthoredElement(doc, 'label', { 'data-xh-part': 'label' }, [
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'root', 'type': 'button' }, [createAuthoredElement(doc, 'span', { 'data-xh-part': 'thumb' })]),
          toggleText,
        ]),
      ]) as ControlElement
      const widthLabel = createAuthoredElement(doc, 'label', { 'data-xh-part': 'label' })
      const unit = createAuthoredElement(doc, 'span', { 'data-xh-part': 'suffix' })
      const width = createAuthoredElement(doc, 'xh-number-field', { size: 'sm', min: 0, step: 0.05 }, [
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [
          widthLabel,
          createAuthoredElement(doc, 'div', { 'data-xh-part': 'control' }, [
            createAuthoredElement(doc, 'button', { 'data-xh-part': 'decrement-trigger', 'type': 'button' }),
            createAuthoredElement(doc, 'input', { 'data-xh-part': 'input' }),
            unit,
            createAuthoredElement(doc, 'button', { 'data-xh-part': 'increment-trigger', 'type': 'button' }),
          ]),
        ]),
      ]) as ControlElement
      const style = createAuthoredElement(doc, 'xh-select', { size: 'sm' }) as ControlElement
      const colorLabel = createAuthoredElement(doc, 'label', { 'data-xh-part': 'label' })
      const color = createAuthoredElement(doc, 'xh-color-field', { size: 'sm' }, [
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [
          colorLabel,
          createAuthoredElement(doc, 'div', { 'data-xh-part': 'control' }, [
            createAuthoredElement(doc, 'span', { 'data-xh-part': 'swatch' }),
            createAuthoredElement(doc, 'input', { 'data-xh-part': 'input' }),
          ]),
        ]),
      ]) as ControlElement
      const settings = createAuthoredElement(doc, 'div', { 'data-part': 'border-side-stroke' }, [width, style, color])
      tabs.append(createAuthoredElement(doc, 'div', { 'slot': `panel:${side}`, 'data-part': 'border-side' }, [toggle, settings]))

      toggle.addEventListener('checked-change', (event) => {
        const { checked } = (event as CustomEvent<{ checked: boolean }>).detail
        const sides = current()
        const fill = sides[side] ?? SIDES.map(other => sides[other]).find(stroke => stroke !== undefined) ?? (defaultStroke() as unknown as Stroke)
        write(Object.fromEntries(SIDES.flatMap((other) => {
          const stroke = other === side ? (checked ? fill : undefined) : sides[other]
          return stroke === undefined ? [] : [[other, stroke]]
        })))
        context.commit()
      })
      width.addEventListener('value-change', (event) => {
        event.stopPropagation()
        const { value, valueAsNumber } = (event as CustomEvent<{ value: string, valueAsNumber: number }>).detail
        width.value = value
        if (Number.isFinite(valueAsNumber) && valueAsNumber >= 0)
          change(side, { width: valueAsNumber })
      })
      width.addEventListener('focusout', () => context.commit())
      style.addEventListener('value-change', (event) => {
        event.stopPropagation()
        const [value] = (event as CustomEvent<{ value: string[] }>).detail.value
        if (value !== undefined) {
          style.value = [value]
          change(side, { style: value })
          context.commit()
        }
      })
      color.addEventListener('value-change', (event) => {
        event.stopPropagation()
        const { value } = (event as CustomEvent<{ value: string }>).detail
        color.value = value
        if (value !== '') {
          change(side, { color: value })
          context.commit()
        }
      })
      return [side, { toggle, toggleText, settings, width, widthLabel, unit, style, color, colorLabel }]
    }))
    const render = (next: typeof initial): void => {
      context = next
      written = undefined
      const t = host.translations()
      const name = (key: string): string => t.propertyNames[key] ?? key
      tabs.collection = SIDES.map(side => ({ value: side, label: name(`edges/${side}`) }))
      const values = current()
      for (const side of SIDES) {
        const controls = sides.get(side)!
        const stroke = values[side]
        setText(controls.toggleText, name(`borderSides/${side}`))
        setText(controls.widthLabel, name('stroke/width'))
        setText(controls.unit, t.units.mm)
        setText(controls.colorLabel, name('stroke/color'))
        controls.style.label = name('stroke/style')
        controls.style.collection = STROKE_STYLES.map(value => ({ value, label: t.propertyOptions[value] ?? value }))
        for (const control of [controls.toggle, controls.width, controls.style, controls.color])
          control.toggleAttribute('read-only', next.readonly)
        if (controls.toggle.checked !== (stroke !== undefined))
          controls.toggle.checked = stroke !== undefined
        controls.settings.hidden = stroke === undefined
        if (stroke === undefined)
          continue
        const shown = typeof controls.width.value === 'string' ? controls.width.value.trim() : ''
        if (shown === '' || Number(shown) !== stroke.width)
          controls.width.value = String(stroke.width)
        const style = Array.isArray(controls.style.value) ? controls.style.value[0] : undefined
        if (style !== stroke.style)
          controls.style.value = [stroke.style]
        if (controls.color.value !== stroke.color)
          controls.color.value = stroke.color
      }
    }
    render(initial)
    return { element: tabs, update: render }
  }
}
