/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器自带的复合属性编辑器。四边边框：上、右、下、左四个页签，每边一个开关，开时下面是线宽、线型与颜色。
// 值格式：先选种类，常用格式交给库内的格式输入框，值映射是一张两列的表，表达式是表达式输入框。

import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { JsonValue } from '@xihan-ui/core/json'
import type { DesignerPropertyEditor } from '@xihan-ui/designer-shell'
import type { ExpressionEngine } from '@xihan-ui/expression'
import { STROKE_STYLES } from '@xihan-print/core'
import { isPlainObject, jsonEquals } from '@xihan-ui/core/json'
import { createExpressionCheck } from '@xihan-ui/expression'
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
  /** 表达式输入框检查用的引擎。 */
  readonly engine: () => ExpressionEngine
  /** 格式样例用的语言与时区。 */
  readonly locale: () => string | undefined
  readonly timeZone: () => string | undefined
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

/** 值格式的种类：不设格式、常用格式（@xihan-ui/expression 的 FormatSpec）、值映射、表达式。 */
type ValueFormatKind = 'none' | 'format' | 'map' | 'expression'

const VALUE_FORMAT_KINDS: readonly ValueFormatKind[] = ['none', 'format', 'map', 'expression']

/** 值映射的一项。 */
interface MapEntry {
  readonly value: string
  readonly text: string
}

const MAP_COLUMNS = ['value', 'text'] as const

function valueFormatKind(value: JsonValue | undefined): ValueFormatKind {
  if (!isPlainObject(value))
    return 'none'
  return value.kind === 'map' || value.kind === 'expression' ? value.kind : 'format'
}

function mapEntries(value: JsonValue | undefined): MapEntry[] {
  const entries = isPlainObject(value) && Array.isArray(value.entries) ? value.entries : []
  return entries.map(entry => ({
    value: isPlainObject(entry) && typeof entry.value === 'string' ? entry.value : '',
    text: isPlainObject(entry) && typeof entry.text === 'string' ? entry.text : '',
  }))
}

/** 一个单行文本框：库内 xh-text-field，名字写在宿主的 aria-label 上。 */
function textField(doc: Document): ControlElement {
  return createAuthoredElement(doc, 'xh-text-field', { size: 'sm' }, [
    createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'control' }, [createAuthoredElement(doc, 'input', { 'data-xh-part': 'input' })]),
    ]),
  ]) as ControlElement
}

/** 把框里的文字换成 text；正在输入同一段文字时不动。 */
function showText(field: ControlElement, text: string): void {
  if (field.value !== text)
    field.value = text
}

/**
 * 值格式：先在种类下拉里选不设格式、常用格式、值映射或表达式，下面只显示这一种的编辑区。
 * 常用格式是库内的格式输入框；值映射是「数据值、显示文本」两列的表，可增删，下面是没有命中时显示的文本；
 * 表达式是表达式输入框，以 value 引用待格式化的值，边输入边按设计器的表达式引擎检查。
 * 换种类时整体换成这一种的缺省值，不设格式即清除。
 */
export function valueFormatEditor(host: CompositeEditorHost): DesignerPropertyEditor {
  return (initial) => {
    const doc = host.ownerDocument
    let context = initial
    // 自己最近写出的值：面板回填之前接着改，以它为准
    let written: { readonly value: JsonValue | undefined } | undefined
    const current = (): JsonValue | undefined => written === undefined ? context.value : written.value
    const write = (value: JsonValue | undefined): void => {
      written = { value }
      context.setValue(value)
    }

    const kind = createAuthoredElement(doc, 'xh-select', { size: 'sm' }) as ControlElement
    const format = createAuthoredElement(doc, 'xh-format-input', { size: 'sm' }) as ControlElement & { clearable?: boolean, locale?: string, timeZone?: string }
    format.clearable = false
    const table = createAuthoredElement(doc, 'div', { 'data-xh-part': 'table' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'header' }, MAP_COLUMNS.map(column => createAuthoredElement(doc, 'div', { 'data-xh-part': 'column-header', 'value': column }))),
    ])
    const add = createAuthoredElement(doc, 'button', { 'data-xh-part': 'add-trigger', 'type': 'button' })
    const map = createAuthoredElement(doc, 'xh-field-array', { layout: 'table' }, [
      createAuthoredElement(doc, 'div', { 'data-xh-part': 'root' }, [table, add]),
    ]) as ControlElement & { createItem?: () => unknown, columns?: unknown }
    map.createItem = () => ({ value: '', text: '' })
    const fallback = textField(doc)
    const mapPart = createAuthoredElement(doc, 'div', { 'data-part': 'value-map' }, [map, fallback])
    const expression = createAuthoredElement(doc, 'xh-expression-input', { size: 'sm' }) as ControlElement & { check?: unknown }
    const parts: Readonly<Record<Exclude<ValueFormatKind, 'none'>, HTMLElement>> = { format, map: mapPart, expression }
    const root = createAuthoredElement(doc, 'div', { 'data-part': 'value-format' }, [kind, format, mapPart, expression])

    const rows = (): HTMLElement[] => Array.from(table.querySelectorAll<HTMLElement>(':scope > [data-xh-part="item"]'))
    const cell = (row: HTMLElement, column: (typeof MAP_COLUMNS)[number]): ControlElement =>
      row.querySelector<ControlElement>(`[data-xh-part="item-cell"][value="${column}"] > xh-text-field`)!
    const writeMap = (patch: { entries?: readonly MapEntry[], fallback?: string }): void => {
      const value = current()
      const entries = patch.entries ?? mapEntries(value)
      const text = patch.fallback ?? (isPlainObject(value) && typeof value.fallback === 'string' ? value.fallback : '')
      write({ kind: 'map', entries: entries.map(entry => ({ ...entry })), ...(text === '' ? {} : { fallback: text }) })
    }
    const createRow = (): HTMLElement => {
      const row = createAuthoredElement(doc, 'div', { 'data-xh-part': 'item' }, [
        ...MAP_COLUMNS.map(column => createAuthoredElement(doc, 'div', { 'data-xh-part': 'item-cell', 'value': column }, [textField(doc)])),
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'item-action' }, [
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'item-delete-trigger', 'type': 'button' }),
        ]),
      ])
      for (const column of MAP_COLUMNS) {
        const field = cell(row, column)
        field.addEventListener('value-change', (event) => {
          event.stopPropagation()
          const text = (event as CustomEvent<{ value: string }>).detail.value
          field.value = text
          const index = rows().indexOf(row)
          const entries = mapEntries(current())
          if (index < 0 || index >= entries.length)
            return
          entries[index] = { ...entries[index]!, [column]: text }
          writeMap({ entries })
        })
      }
      return row
    }
    /** 表里的行数跟上取值，再把各格的文字与名字换成取值里的。 */
    const renderRows = (entries: readonly MapEntry[], t: PrintDesignerTranslations): void => {
      let list = rows()
      while (list.length > entries.length)
        list.pop()!.remove()
      while (list.length < entries.length) {
        table.append(createRow())
        list = rows()
      }
      list.forEach((row, index) => {
        for (const column of MAP_COLUMNS) {
          const field = cell(row, column)
          const name = t.valueMapCell(index + 1, t.valueMapColumns[column])
          if (field.getAttribute('aria-label') !== name)
            field.setAttribute('aria-label', name)
          field.toggleAttribute('read-only', context.readonly)
          showText(field, entries[index]![column])
        }
      })
    }

    kind.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const [next] = (event as CustomEvent<{ value: string[] }>).detail.value as ValueFormatKind[]
      if (next === undefined || next === valueFormatKind(current()))
        return
      kind.value = [next]
      write(next === 'none'
        ? undefined
        : next === 'format'
          ? { kind: 'number' }
          : next === 'map' ? { kind: 'map', entries: [] } : { kind: 'expression', expression: '' })
      context.commit()
    })
    format.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const { value } = (event as CustomEvent<{ value: JsonValue | null }>).detail
      format.value = value
      if (value !== null)
        write(value)
    })
    map.addEventListener('value-change', (event) => {
      if (event.target !== map)
        return
      event.stopPropagation()
      const entries = mapEntries({ entries: (event as CustomEvent<{ value: JsonValue[] }>).detail.value })
      map.value = entries
      writeMap({ entries })
      renderRows(entries, host.translations())
      context.commit()
    })
    fallback.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const text = (event as CustomEvent<{ value: string }>).detail.value
      fallback.value = text
      writeMap({ fallback: text })
    })
    expression.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const text = (event as CustomEvent<{ value: string }>).detail.value
      expression.value = text
      write({ kind: 'expression', expression: text })
    })
    root.addEventListener('focusout', () => context.commit())

    let engine: ExpressionEngine | undefined
    const render = (next: typeof initial): void => {
      context = next
      written = undefined
      const t = host.translations()
      const value = next.value
      const active = valueFormatKind(value)
      kind.collection = VALUE_FORMAT_KINDS.map(item => ({ value: item, label: t.valueFormatKinds[item] }))
      if (kind.getAttribute('aria-label') !== t.valueFormatKind)
        kind.setAttribute('aria-label', t.valueFormatKind)
      const shown = Array.isArray(kind.value) ? kind.value[0] : undefined
      if (shown !== active)
        kind.value = [active]
      for (const [name, part] of Object.entries(parts))
        part.hidden = name !== active
      for (const control of [kind, format, map, fallback, expression])
        control.toggleAttribute('read-only', next.readonly)
      if (active === 'format') {
        format.setAttribute('aria-label', t.valueFormatKinds.format)
        format.locale = host.locale()
        format.timeZone = host.timeZone()
        if (format.value === undefined || !jsonEquals(format.value as JsonValue, value as JsonValue))
          format.value = value
      }
      if (active === 'map') {
        const entries = mapEntries(value)
        map.setAttribute('aria-label', t.valueFormatKinds.map)
        map.columns = MAP_COLUMNS.map(column => ({ id: column, label: t.valueMapColumns[column] }))
        setText(add, t.valueMapAdd)
        if (!jsonEquals((map.value ?? null) as JsonValue, entries as unknown as JsonValue))
          map.value = entries
        renderRows(entries, t)
        fallback.setAttribute('aria-label', t.valueMapFallback)
        fallback.setAttribute('placeholder', t.valueMapFallback)
        showText(fallback, isPlainObject(value) && typeof value.fallback === 'string' ? value.fallback : '')
      }
      if (active === 'expression') {
        expression.setAttribute('aria-label', t.valueFormatKinds.expression)
        if (engine !== host.engine()) {
          engine = host.engine()
          expression.check = createExpressionCheck(engine)
        }
        showText(expression, isPlainObject(value) && typeof value.expression === 'string' ? value.expression : '')
      }
    }
    render(initial)
    return { element: root, update: render }
  }
}
