/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器自带的复合属性编辑器。四边边框：上、右、下、左四个页签，每边一个开关，开时下面是线宽、线型与颜色。
// 值格式：先选种类，常用格式交给库内的格式输入框，值映射是一张两列的表，表达式是表达式输入框。
// 能用内建编辑方式表达的字段都用 designer-shell 的 createPropertyField 建，与属性面板同一套。
// 上下文里的里层问题标到对应的子项上：子项旁边显示问题文字，子项的控件标无效并经 aria-describedby 接上这段文字。

import type { PropertyUnit } from '@xihan-print/core'
import type { PrintDesignerTranslations } from '@xihan-print/runtime'
import type { JsonPath, JsonValue } from '@xihan-ui/core/json'
import type { PropertyIssue } from '@xihan-ui/designer-kit/properties'
import type { DesignerPropertyEditor, PropertyField, PropertyFieldOptions } from '@xihan-ui/designer-shell'
import type { ExpressionEngine } from '@xihan-ui/expression'
import { STROKE_STYLES } from '@xihan-print/core'
import { createCounterIdGenerator } from '@xihan-ui/core'
import { isJsonPathPrefix, isPlainObject, jsonEquals } from '@xihan-ui/core/json'
import { createPropertyField } from '@xihan-ui/designer-shell'
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

/** 路径以 prefix 开头的问题，路径去掉 prefix 那几段。 */
export function issuesUnder(issues: readonly PropertyIssue[], prefix: JsonPath): PropertyIssue[] {
  return issues.filter(issue => isJsonPathPrefix(issue.path, prefix)).map(issue => ({ path: issue.path.slice(prefix.length), message: issue.message }))
}

/** 问题文字落在哪个子项上：control 是库内控件的宿主（标 invalid，控件据此写 aria-invalid）；focusable 是读屏落点，经 aria-describedby 指向问题文字，ariaInvalid 时也由这里写 aria-invalid。 */
export interface IssueTarget {
  readonly control?: HTMLElement
  readonly focusable?: HTMLElement | null
  readonly ariaInvalid?: boolean
}

/** 子项旁边的一段问题文字。 */
export interface IssueText {
  readonly element: HTMLElement
  /** 换上问题文字，undefined 时收起；同时标出或收回子项上的无效与描述。 */
  readonly show: (message: string | undefined, target?: IssueTarget) => void
}

/** 建一段子项旁边的问题文字，id 由调用方给出、在文档里唯一。 */
export function createIssueText(doc: Document, id: string): IssueText {
  const element = createAuthoredElement(doc, 'p', { 'data-scope': 'print-designer', 'data-part': 'editor-issue', id, 'hidden': true })
  return {
    element,
    show(message, target = {}) {
      setText(element, message ?? '')
      element.hidden = message === undefined
      target.control?.toggleAttribute('invalid', message !== undefined)
      const focusable = target.focusable
      if (!focusable)
        return
      if (message === undefined) {
        if (focusable.getAttribute('aria-describedby') === id)
          focusable.removeAttribute('aria-describedby')
        if (target.ariaInvalid)
          focusable.removeAttribute('aria-invalid')
        return
      }
      if (focusable.getAttribute('aria-describedby') !== id)
        focusable.setAttribute('aria-describedby', id)
      if (target.ariaInvalid)
        focusable.setAttribute('aria-invalid', 'true')
    },
  }
}

/** 取值里的一条线；不是完整的线时为 undefined。 */
function strokeOf(value: unknown): Stroke | undefined {
  if (!isPlainObject(value))
    return undefined
  const { width, style, color } = value
  return typeof width === 'number' && typeof style === 'string' && typeof color === 'string' ? { width, style, color } : undefined
}

/** 一边的字段：开关，开时下面是线宽、线型与颜色。 */
interface SideFields {
  readonly toggle: PropertyField
  readonly settings: HTMLElement
  readonly width: PropertyField
  readonly style: PropertyField
  readonly color: PropertyField
}

const STROKE_STYLE_OPTIONS = STROKE_STYLES.map(value => ({ value }))

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
    const toggleSide = (side: Side, on: boolean): void => {
      const sides = current()
      const fill = sides[side] ?? SIDES.map(other => sides[other]).find(stroke => stroke !== undefined) ?? (defaultStroke() as unknown as Stroke)
      write(Object.fromEntries(SIDES.flatMap((other) => {
        const stroke = other === side ? (on ? fill : undefined) : sides[other]
        return stroke === undefined ? [] : [[other, stroke]]
      })))
    }
    const t = (): PrintDesignerTranslations => host.translations()
    const name = (key: string): string => t().propertyNames[key] ?? key
    const field = (control: PropertyFieldOptions['control'], label: string, setValue: (value: JsonValue | undefined) => void): PropertyField =>
      createPropertyField({
        ownerDocument: doc,
        control,
        label,
        required: control.kind !== 'boolean',
        setValue,
        commit: () => context.commit(),
        unitLabel: unit => t().units[unit as PropertyUnit] ?? unit,
        optionLabel: option => t().propertyOptions[String(option.value)] ?? String(option.value),
      }, { value: undefined })
    const sides = new Map<Side, SideFields>(SIDES.map((side) => {
      const toggle = field({ kind: 'boolean' }, name(`borderSides/${side}`), value => toggleSide(side, value === true))
      const width = field({ kind: 'number', min: 0, step: 0.05, unit: 'mm' }, name('stroke/width'), (value) => {
        if (typeof value === 'number')
          change(side, { width: value })
      })
      const style = field({ kind: 'select', options: STROKE_STYLE_OPTIONS, appearance: 'dropdown' }, name('stroke/style'), (value) => {
        if (typeof value === 'string')
          change(side, { style: value })
      })
      const color = field({ kind: 'color' }, name('stroke/color'), (value) => {
        if (typeof value === 'string')
          change(side, { color: value })
      })
      const settings = createAuthoredElement(doc, 'div', { 'data-part': 'border-side-stroke' }, [width.element, style.element, color.element])
      tabs.append(createAuthoredElement(doc, 'div', { 'slot': `panel:${side}`, 'data-part': 'border-side' }, [toggle.element, settings]))
      return [side, { toggle, settings, width, style, color }]
    }))
    const render = (next: typeof initial): void => {
      context = next
      written = undefined
      tabs.collection = SIDES.map(side => ({ value: side, label: name(`edges/${side}`) }))
      const values = current()
      const readonly = next.readonly
      for (const side of SIDES) {
        const fields = sides.get(side)!
        const stroke = values[side]
        fields.toggle.update({ value: stroke !== undefined, readonly, label: name(`borderSides/${side}`) })
        fields.settings.hidden = stroke === undefined
        if (stroke === undefined)
          continue
        fields.width.update({ value: stroke.width, readonly, label: name('stroke/width') })
        fields.style.update({ value: stroke.style, readonly, label: name('stroke/style') })
        fields.color.update({ value: stroke.color, readonly, label: name('stroke/color') })
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

/** 值映射表里的一个单行文本框：库内 xh-text-field，名字写在宿主的 aria-label 上。 */
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
 * 常用格式是库内的格式输入框，样例按设计器的语言与时区；值映射是「数据值、显示文本」两列的表，可增删，
 * 下面是没有命中时显示的文本；表达式是表达式输入框，以 value 引用待格式化的值，边输入边按设计器的表达式引擎检查。
 * 换种类时整体换成这一种的缺省值，不设格式即清除。
 * 里层的问题标到子项上：值映射某一项的问题标在那一格（落在整项上的标在数据值那一格），未命中文本与种类的问题交给各自的字段，
 * 常用格式与表达式的问题写在它们下面；落在整个属性上的问题由属性面板写在这一行下面。
 */
export function valueFormatEditor(host: CompositeEditorHost): DesignerPropertyEditor {
  return (initial) => {
    const doc = host.ownerDocument
    let context = initial
    const ids = createCounterIdGenerator('xh-print-value-format')
    const issueText = (): IssueText => createIssueText(doc, ids.scopeId())
    // 自己最近写出的值：面板回填之前接着改，以它为准
    let written: { readonly value: JsonValue | undefined } | undefined
    const current = (): JsonValue | undefined => written === undefined ? context.value : written.value
    const write = (value: JsonValue | undefined): void => {
      written = { value }
      context.setValue(value)
    }
    const writeMap = (patch: { entries?: readonly MapEntry[], fallback?: string }): void => {
      const value = current()
      const entries = patch.entries ?? mapEntries(value)
      const text = patch.fallback ?? (isPlainObject(value) && typeof value.fallback === 'string' ? value.fallback : '')
      write({ kind: 'map', entries: entries.map(entry => ({ ...entry })), ...(text === '' ? {} : { fallback: text }) })
    }
    const switchKind = (next: ValueFormatKind): void => {
      if (next === valueFormatKind(current()))
        return
      write(next === 'none'
        ? undefined
        : next === 'format'
          ? { kind: 'number' }
          : next === 'map' ? { kind: 'map', entries: [] } : { kind: 'expression', expression: '' })
    }

    const kind = createPropertyField({
      ownerDocument: doc,
      control: { kind: 'select', options: VALUE_FORMAT_KINDS.map(value => ({ value })), appearance: 'dropdown' },
      label: host.translations().valueFormatKind,
      required: true,
      setValue: (value) => {
        if (typeof value === 'string')
          switchKind(value as ValueFormatKind)
      },
      commit: () => context.commit(),
      optionLabel: option => host.translations().valueFormatKinds[option.value as ValueFormatKind],
    }, { value: valueFormatKind(initial.value) })
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
    const fallback = createPropertyField({
      ownerDocument: doc,
      control: { kind: 'text' },
      label: host.translations().valueMapFallback,
      setValue: value => writeMap({ fallback: typeof value === 'string' ? value : '' }),
      commit: () => context.commit(),
    }, { value: undefined })
    const mapIssue = issueText()
    const mapPart = createAuthoredElement(doc, 'div', { 'data-part': 'value-map' }, [map, mapIssue.element, fallback.element])
    const expression = createAuthoredElement(doc, 'xh-expression-input', { size: 'sm' }) as ControlElement & { check?: unknown }
    const parts: Readonly<Record<Exclude<ValueFormatKind, 'none'>, HTMLElement>> = { format, map: mapPart, expression }
    const formatIssue = issueText()
    const expressionIssue = issueText()
    const root = createAuthoredElement(doc, 'div', { 'data-part': 'value-format' }, [kind.element, format, formatIssue.element, mapPart, expression, expressionIssue.element])

    const rows = (): HTMLElement[] => Array.from(table.querySelectorAll<HTMLElement>(':scope > [data-xh-part="item"]'))
    const cell = (row: HTMLElement, column: (typeof MAP_COLUMNS)[number]): ControlElement =>
      row.querySelector<ControlElement>(`[data-xh-part="item-cell"][value="${column}"] > xh-text-field`)!
    // 每一行两格各自的问题文字
    const cellIssues = new WeakMap<HTMLElement, Readonly<Record<(typeof MAP_COLUMNS)[number], IssueText>>>()
    const createRow = (): HTMLElement => {
      const issues = { value: issueText(), text: issueText() }
      const row = createAuthoredElement(doc, 'div', { 'data-xh-part': 'item' }, [
        ...MAP_COLUMNS.map(column => createAuthoredElement(doc, 'div', { 'data-xh-part': 'item-cell', 'value': column }, [textField(doc), issues[column].element])),
        createAuthoredElement(doc, 'div', { 'data-xh-part': 'item-action' }, [
          createAuthoredElement(doc, 'button', { 'data-xh-part': 'item-delete-trigger', 'type': 'button' }),
        ]),
      ])
      for (const column of MAP_COLUMNS) {
        const input = cell(row, column)
        input.addEventListener('value-change', (event) => {
          event.stopPropagation()
          const text = (event as CustomEvent<{ value: string }>).detail.value
          input.value = text
          const index = rows().indexOf(row)
          const entries = mapEntries(current())
          if (index < 0 || index >= entries.length)
            return
          entries[index] = { ...entries[index]!, [column]: text }
          writeMap({ entries })
        })
      }
      cellIssues.set(row, issues)
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
          const input = cell(row, column)
          const name = t.valueMapCell(index + 1, t.valueMapColumns[column])
          if (input.getAttribute('aria-label') !== name)
            input.setAttribute('aria-label', name)
          input.toggleAttribute('read-only', context.readonly)
          showText(input, entries[index]![column])
        }
      })
    }

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
    expression.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const text = (event as CustomEvent<{ value: string }>).detail.value
      expression.value = text
      write({ kind: 'expression', expression: text })
    })
    root.addEventListener('focusout', () => context.commit())

    /** 按上下文的问题标出各子项；不是当前种类的子项一律收起。 */
    const paintIssues = (issues: readonly PropertyIssue[], active: ValueFormatKind): void => {
      const nested = issues.filter(issue => issue.path.length > 0)
      const first = (list: readonly PropertyIssue[]): string | undefined => list[0]?.message
      const outsideKind = nested.filter(issue => issue.path[0] !== 'kind')
      formatIssue.show(active === 'format' ? first(outsideKind) : undefined, { control: format })
      expressionIssue.show(active === 'expression' ? first(outsideKind) : undefined, { control: expression, focusable: expression.querySelector<HTMLElement>('[role="combobox"], textarea') })
      const list = rows()
      list.forEach((row, index) => {
        const entry = issuesUnder(nested, ['entries', index])
        const whole = entry.filter(issue => !(MAP_COLUMNS as readonly unknown[]).includes(issue.path[0]))
        for (const column of MAP_COLUMNS) {
          const input = cell(row, column)
          const message = first(issuesUnder(entry, [column])) ?? (column === 'value' ? first(whole) : undefined)
          cellIssues.get(row)![column].show(active === 'map' ? message : undefined, { control: input, focusable: input.querySelector('input') })
        }
      })
      const mapLevel = outsideKind.filter(issue => issue.path[0] !== 'fallback' && !(issue.path[0] === 'entries' && typeof issue.path[1] === 'number' && issue.path[1] < list.length))
      mapIssue.show(active === 'map' ? first(mapLevel) : undefined)
    }

    let engine: ExpressionEngine | undefined
    const render = (next: typeof initial): void => {
      context = next
      written = undefined
      const t = host.translations()
      const value = next.value
      const active = valueFormatKind(value)
      kind.update({ value: active, readonly: next.readonly, label: t.valueFormatKind, error: next.issues.find(issue => isJsonPathPrefix(issue.path, ['kind']))?.message })
      for (const [name, part] of Object.entries(parts))
        part.hidden = name !== active
      for (const control of [format, map, expression])
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
        fallback.update({
          value: isPlainObject(value) && typeof value.fallback === 'string' ? value.fallback : undefined,
          readonly: next.readonly,
          label: t.valueMapFallback,
          error: next.issues.find(issue => isJsonPathPrefix(issue.path, ['fallback']))?.message,
        })
      }
      if (active === 'expression') {
        expression.setAttribute('aria-label', t.valueFormatKinds.expression)
        if (engine !== host.engine()) {
          engine = host.engine()
          expression.check = createExpressionCheck(engine)
        }
        showText(expression, isPlainObject(value) && typeof value.expression === 'string' ? value.expression : '')
      }
      paintIssues(next.issues, active)
    }
    render(initial)
    return { element: root, update: render, nestedIssues: true }
  }
}
