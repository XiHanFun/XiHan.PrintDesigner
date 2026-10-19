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

/** 值映射的各项交给内建的选项表：每项只有值与文字，没有禁用。 */
const MAP_ENTRIES_CONTROL = { kind: 'options', allowDisabled: false } as const

function valueFormatKind(value: JsonValue | undefined): ValueFormatKind {
  if (!isPlainObject(value))
    return 'none'
  return value.kind === 'map' || value.kind === 'expression' ? value.kind : 'format'
}

/** 值映射的各项：取值里的 entries，不是数组时为空。 */
function mapEntries(value: JsonValue | undefined): JsonValue[] {
  return isPlainObject(value) && Array.isArray(value.entries) ? value.entries : []
}

/** 把框里的文字换成 text；正在输入同一段文字时不动。 */
function showText(field: ControlElement, text: string): void {
  if (field.value !== text)
    field.value = text
}

/**
 * 值格式：先在种类下拉里选不设格式、常用格式、值映射或表达式，下面只显示这一种的编辑区。
 * 常用格式是库内的格式输入框，样例按设计器的语言与时区；值映射是 designer-shell 内建的选项表（options，不带禁用列），
 * 「数据值、显示文本」两列，可增删、上移下移，下面是没有命中时显示的文本；表达式是表达式输入框，
 * 以 value 引用待格式化的值，边输入边按设计器的表达式引擎检查。换种类时整体换成这一种的缺省值，不设格式即清除。
 * 里层的问题标到子项上：值映射各项的问题交给选项表，由它标在那一格；未命中文本与种类的问题交给各自的字段，
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
    const writeMap = (patch: { entries?: readonly JsonValue[], fallback?: string }): void => {
      const value = current()
      const entries = patch.entries ?? mapEntries(value)
      const text = patch.fallback ?? (isPlainObject(value) && typeof value.fallback === 'string' ? value.fallback : '')
      write({ kind: 'map', entries: [...entries], ...(text === '' ? {} : { fallback: text }) })
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
    // 列名与格子的名字用打印的说法；按每次刷新现取，换了语言跟着变
    const entries = createPropertyField({
      ownerDocument: doc,
      control: MAP_ENTRIES_CONTROL,
      label: host.translations().valueFormatKinds.map,
      setValue: value => writeMap({ entries: Array.isArray(value) ? value : [] }),
      commit: () => context.commit(),
      translations: {
        get optionColumns() {
          const columns = host.translations().valueMapColumns
          return { value: columns.value, label: columns.label, disabled: '' }
        },
        get optionCell() {
          const t = host.translations()
          return (column: string, row: number) => t.valueMapCell(row, column)
        },
      },
    }, { value: undefined })
    const fallback = createPropertyField({
      ownerDocument: doc,
      control: { kind: 'text' },
      label: host.translations().valueMapFallback,
      setValue: value => writeMap({ fallback: typeof value === 'string' ? value : '' }),
      commit: () => context.commit(),
    }, { value: undefined })
    const mapPart = createAuthoredElement(doc, 'div', { 'data-part': 'value-map' }, [entries.element, fallback.element])
    const expression = createAuthoredElement(doc, 'xh-expression-input', { size: 'sm' }) as ControlElement & { check?: unknown }
    const parts: Readonly<Record<Exclude<ValueFormatKind, 'none'>, HTMLElement>> = { format, map: mapPart, expression }
    const formatIssue = issueText()
    const expressionIssue = issueText()
    const root = createAuthoredElement(doc, 'div', { 'data-part': 'value-format' }, [kind.element, format, formatIssue.element, mapPart, expression, expressionIssue.element])

    format.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const { value } = (event as CustomEvent<{ value: JsonValue | null }>).detail
      format.value = value
      if (value !== null)
        write(value)
    })
    expression.addEventListener('value-change', (event) => {
      event.stopPropagation()
      const text = (event as CustomEvent<{ value: string }>).detail.value
      expression.value = text
      write({ kind: 'expression', expression: text })
    })
    root.addEventListener('focusout', () => context.commit())

    /** 常用格式与表达式的问题写在它们下面；不是当前种类的一律收起。 */
    const paintIssues = (issues: readonly PropertyIssue[], active: ValueFormatKind): void => {
      const outsideKind = issues.filter(issue => issue.path.length > 0 && issue.path[0] !== 'kind')
      const first = outsideKind[0]?.message
      formatIssue.show(active === 'format' ? first : undefined, { control: format })
      expressionIssue.show(active === 'expression' ? first : undefined, { control: expression, focusable: expression.querySelector<HTMLElement>('[role="combobox"], textarea') })
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
      for (const control of [format, expression])
        control.toggleAttribute('read-only', next.readonly)
      if (active === 'format') {
        format.setAttribute('aria-label', t.valueFormatKinds.format)
        format.locale = host.locale()
        format.timeZone = host.timeZone()
        if (format.value === undefined || !jsonEquals(format.value as JsonValue, value as JsonValue))
          format.value = value
      }
      if (active === 'map') {
        // 落在 entries 本身的问题写在选项表的行下，落在某一项里的交给选项表标在那一格
        const under = issuesUnder(next.issues, ['entries'])
        entries.update({
          value: mapEntries(value),
          readonly: next.readonly,
          label: t.valueFormatKinds.map,
          error: under.find(issue => issue.path.length === 0)?.message,
          issues: under.filter(issue => issue.path.length > 0),
        })
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
