/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 复合属性拆成属性面板自带的编辑方式：线拆成线宽、线型、颜色，边距拆成四边，单元格样式、纸张与水印逐项拆开（四边边框有自带编辑器，不拆）；
// 可选的对象前面加一个开关。开关等面板上读不到的值放在编辑对象的 $view 下，写入时再换回模板里的修改；
// 个别分项改动时要连带改别处（如改纸张宽高时去掉预设），也在写入时换成一组修改。
// 文本内容、富文本内容、单元格内容与图片来源先选来源种类，再按种类显示对应输入，切换种类时整体换成该种类的缺省对象；
// 富文本写死的文档在面板上不能编辑，只能切换来源；
// 内容里的绑定字段用属性面板内建的 dataField，值格式暂用 JSON 文本框；二维码纠错级别按码制显示下拉或数字。

import type { PropertyChange, PropertyDescriptor } from '@xihan-print/core'
import type { JsonPath, JsonValue } from '@xihan-ui/core/json'
import type { DataFieldKind } from '@xihan-ui/designer-kit'
import type { PropertyCondition, PropertyControl } from '@xihan-ui/designer-kit/properties'
import type { DesignerPropertyDescriptor } from '@xihan-ui/designer-shell'
import { AGGREGATE_FUNCTIONS, AGGREGATE_SCOPES, createPaper, HORIZONTAL_ALIGNS, RICH_TEXT_SOURCES, STROKE_STYLES, VERTICAL_ALIGNS } from '@xihan-print/core'
import { formatJsonPath, getJsonAt } from '@xihan-ui/core/json'
import { PAPER_PRESET_NAMES } from '@xihan-ui/designer-kit'
import { MATRIX_CODE_LEVEL_RANGES, QR_LEVELS } from '@xihan-ui/headless'

/** 面板上读写、模板里没有的值放在编辑对象的这个键下。 */
export const VIEW_KEY = '$view'

/**
 * 拆出来的一项：路径本身查不到名字时，名字由 labelKey 查出；给了 labelParent 时再与它查出的名字
 * 合成「复合属性 · 分项」。两者都是属性名文案里的键。
 */
export type ExpandedDescriptor = DesignerPropertyDescriptor & { readonly labelKey?: string, readonly labelParent?: string }

/** 面板上的一个视图值：从模板读出，写入时换成模板里的修改。 */
interface ViewRule {
  readonly read: (value: JsonValue) => JsonValue | undefined
  readonly write: (value: JsonValue, next: JsonValue | undefined) => PropertyChange[]
}

/** 一处分项的写入要换成的一组修改，入参是对象当前的值与新值。 */
type WriteRule = (value: JsonValue, next: JsonValue | undefined) => PropertyChange[]

/** 一个复合属性拆出的结果：writes 的键是分项路径的 formatJsonPath 写法。 */
interface Expansion {
  readonly descriptors: ExpandedDescriptor[]
  readonly views?: Readonly<Record<string, ViewRule>>
  readonly writes?: Readonly<Record<string, WriteRule>>
}

/** 拆分后的属性：交给面板的描述、面板读值用的视图，以及把面板的写入换成模板修改的方法。 */
export interface ExpandedProperties {
  readonly descriptors: readonly ExpandedDescriptor[]
  readonly view: (value: JsonValue) => JsonValue
  readonly write: (value: JsonValue, path: JsonPath, next: JsonValue | undefined) => PropertyChange[]
}

/** 拆分时用到的数据：表格列与表尾汇总的字段相对的数组字段路径。 */
export interface ExpandContext {
  readonly rowBase?: JsonPath
}

type Expander = (descriptor: PropertyDescriptor, context: ExpandContext) => Expansion

function viewPath(key: string): JsonPath {
  return [VIEW_KEY, key]
}

function both(first: PropertyCondition | undefined, second: PropertyCondition): PropertyCondition {
  return first === undefined ? second : { all: [first, second] }
}

/** 由原描述派生一项：路径、编辑方式与文案键换掉，分组、显示条件沿用原描述，可再加一个显示条件。 */
function part(base: PropertyDescriptor, path: JsonPath, control: PropertyControl, labelKey: string, when?: PropertyCondition, labelParent?: string): ExpandedDescriptor {
  const visibleWhen = when === undefined ? base.visibleWhen : both(base.visibleWhen, when)
  return {
    path,
    control,
    group: base.group,
    labelKey,
    ...(labelParent === undefined ? {} : { labelParent }),
    ...(visibleWhen === undefined ? {} : { visibleWhen }),
  }
}

function choices(values: readonly string[]): { value: string }[] {
  return values.map(value => ({ value }))
}

/** 可选对象的开关：开时写入缺省对象，关时删掉；文案键为 labelKey。 */
function presence(base: PropertyDescriptor, path: JsonPath, labelKey: string, create: () => JsonValue): Expansion {
  const key = `present:${formatJsonPath(path)}`
  return {
    descriptors: [part(base, viewPath(key), { kind: 'boolean' }, labelKey)],
    views: {
      [key]: {
        read: value => getJsonAt(value, path) !== undefined,
        write: (_value, next) => [next === true ? { path, value: create() } : { path }],
      },
    },
  }
}

function merge(...expansions: Expansion[]): Expansion {
  return {
    descriptors: expansions.flatMap(expansion => expansion.descriptors),
    views: Object.assign({}, ...expansions.map(expansion => expansion.views ?? {})),
    writes: Object.assign({}, ...expansions.map(expansion => expansion.writes ?? {})),
  }
}

function set(path: JsonPath, next: JsonValue | undefined): PropertyChange {
  return next === undefined ? { path } : { path, value: next }
}

/** 纸张选「自定义」时的选项值。 */
export const CUSTOM_PAPER = 'custom'

/** 新加的水印。 */
function defaultWatermark(): JsonValue {
  return { text: '', fontSize: 36, color: '#000000', opacity: 0.1, rotation: 30, gapX: 40, gapY: 40 }
}

/** 新加的线。 */
export function defaultStroke(): JsonValue {
  return { width: 0.2, style: 'solid', color: '#000000' }
}

/** 线的三项，when 为显示条件，labelParent 为名字前缀的文案键。 */
function strokeParts(base: PropertyDescriptor, path: JsonPath, labelParent: string, when?: PropertyCondition): ExpandedDescriptor[] {
  return [
    part(base, [...path, 'width'], { kind: 'number', unit: 'mm', min: 0, step: 0.05 }, 'stroke/width', when, labelParent),
    part(base, [...path, 'style'], { kind: 'select', options: choices(STROKE_STYLES) }, 'stroke/style', when, labelParent),
    part(base, [...path, 'color'], { kind: 'color' }, 'stroke/color', when, labelParent),
  ]
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/** 绑定字段：只能选 kinds 里的字段，给了 base 时路径相对它。 */
function fieldControl(kinds: readonly DataFieldKind[], base?: JsonPath): PropertyControl {
  return { kind: 'dataField', kinds, ...(base === undefined ? {} : { base }) }
}

/** 内容的一个分项：只在 kinds 里的来源种类下显示。 */
interface ContentPart {
  readonly key: string
  readonly control: PropertyControl
  readonly kinds: readonly string[]
}

/** 来源种类加各种类的分项；切换种类时整体换成 create 给出的缺省对象。 */
function content(descriptor: PropertyDescriptor, kinds: readonly string[], create: (kind: string) => JsonValue, parts: readonly ContentPart[]): Expansion {
  const { path } = descriptor
  const parent = formatJsonPath(path)
  const kind = [...path, 'kind']
  return {
    descriptors: [
      part(descriptor, kind, { kind: 'select', options: choices(kinds) }, parent),
      ...parts.map(item => part(descriptor, [...path, item.key], item.control, `content/${item.key}`, { path: kind, oneOf: [...item.kinds] }, parent)),
    ],
    writes: {
      [formatJsonPath(kind)]: (_value, next) => typeof next === 'string' && kinds.includes(next) ? [{ path, value: create(next) }] : [],
    },
  }
}

const MULTILINE: PropertyControl = { kind: 'text', multiline: true }
const FORMAT: PropertyControl = { kind: 'json' }

/** 文本内容的种类与缺省对象。 */
const TEXT_KINDS = ['static', 'field', 'template', 'expression'] as const

function textContent(kind: string): JsonValue {
  switch (kind) {
    case 'static':
      return { kind, text: '' }
    case 'template':
      return { kind, template: '' }
    case 'expression':
      return { kind, expression: '' }
    default:
      return { kind, field: '' }
  }
}

function textParts(field: PropertyControl): ContentPart[] {
  return [
    { key: 'text', control: MULTILINE, kinds: ['static'] },
    { key: 'field', control: field, kinds: ['field'] },
    { key: 'emptyText', control: { kind: 'text' }, kinds: ['field'] },
    { key: 'template', control: MULTILINE, kinds: ['template'] },
    { key: 'expression', control: MULTILINE, kinds: ['expression'] },
    { key: 'format', control: FORMAT, kinds: ['field', 'expression'] },
  ]
}

const EXPANDERS: Readonly<Record<string, Expander>> = {
  valueFormat: descriptor => ({ descriptors: [{ ...descriptor, control: FORMAT }] }),
  matrixCodeLevel: (descriptor) => {
    const { path } = descriptor
    const format = [...path.slice(0, -1), 'format']
    const when = (value: string): PropertyCondition => ({ path: format, equals: value })
    const range = (kind: keyof typeof MATRIX_CODE_LEVEL_RANGES): PropertyControl => {
      const { min, max, step } = MATRIX_CODE_LEVEL_RANGES[kind]
      return { kind: 'number', min, max, step, integer: true }
    }
    const level = (control: PropertyControl, value: string): ExpandedDescriptor => {
      const visibleWhen = both(descriptor.visibleWhen, when(value))
      return { path, control, group: descriptor.group, visibleWhen }
    }
    return {
      descriptors: [
        level({ kind: 'select', options: choices(QR_LEVELS) }, 'qr'),
        level(range('pdf417'), 'pdf417'),
        level(range('aztec'), 'aztec'),
      ],
      writes: {
        [formatJsonPath(format)]: (_value, next) => [set(format, next), { path }],
      },
    }
  },
  textContent: descriptor => content(descriptor, TEXT_KINDS, textContent, textParts(fieldControl(['value']))),
  richTextContent: descriptor => content(
    descriptor,
    ['static', 'field'],
    (kind): JsonValue => kind === 'static' ? { kind, document: { blocks: [{ type: 'paragraph', runs: [] }] } } : { kind, field: '', source: 'html' },
    [
      { key: 'field', control: fieldControl(['value']), kinds: ['field'] },
      { key: 'source', control: { kind: 'select', options: choices(RICH_TEXT_SOURCES) }, kinds: ['field'] },
    ],
  ),
  imageSource: descriptor => content(
    descriptor,
    ['static', 'field'],
    (kind): JsonValue => kind === 'static' ? { kind, url: '' } : { kind, field: '' },
    [
      { key: 'url', control: { kind: 'text' }, kinds: ['static'] },
      { key: 'field', control: fieldControl(['value']), kinds: ['field'] },
    ],
  ),
  cellContent: (descriptor, context) => content(
    descriptor,
    ['field', 'template', 'rowNumber', 'expression'],
    kind => kind === 'rowNumber' ? { kind } : textContent(kind),
    [
      { key: 'field', control: fieldControl(['value'], context.rowBase), kinds: ['field'] },
      { key: 'emptyText', control: { kind: 'text' }, kinds: ['field'] },
      { key: 'template', control: MULTILINE, kinds: ['template'] },
      { key: 'expression', control: MULTILINE, kinds: ['expression'] },
      { key: 'format', control: FORMAT, kinds: ['field', 'expression'] },
    ],
  ),
  footerCellContent: (descriptor, context) => content(
    descriptor,
    [...TEXT_KINDS, 'aggregate'],
    kind => kind === 'aggregate' ? { kind, fn: 'count', scope: 'all' } : textContent(kind),
    [
      ...textParts(fieldControl(['value'])).filter(item => item.key !== 'format'),
      { key: 'fn', control: { kind: 'select', options: choices(AGGREGATE_FUNCTIONS) }, kinds: ['aggregate'] },
      { key: 'field', control: fieldControl(['value'], context.rowBase), kinds: ['aggregate'] },
      { key: 'scope', control: { kind: 'select', options: choices(AGGREGATE_SCOPES) }, kinds: ['aggregate'] },
      { key: 'format', control: FORMAT, kinds: ['field', 'expression', 'aggregate'] },
    ],
  ),
  stroke: (descriptor) => {
    const { path } = descriptor
    const key = formatJsonPath(path)
    if (descriptor.present)
      return { descriptors: strokeParts(descriptor, path, key) }
    return merge(
      presence(descriptor, path, key, defaultStroke),
      { descriptors: strokeParts(descriptor, path, key, { path, filled: true }) },
    )
  },
  edges: (descriptor) => {
    const { path } = descriptor
    const when: PropertyCondition | undefined = descriptor.present ? undefined : { path, filled: true }
    const sides: Expansion = {
      descriptors: SIDES.map(side => part(descriptor, [...path, side], { kind: 'number', unit: 'mm', min: 0, step: 0.1 }, `edges/${side}`, when, formatJsonPath(path))),
    }
    if (descriptor.present)
      return sides
    return merge(presence(descriptor, path, formatJsonPath(path), () => ({ top: 0, right: 0, bottom: 0, left: 0 })), sides)
  },
  paper: (descriptor) => {
    const { path } = descriptor
    const parent = formatJsonPath(path)
    const preset = [...path, 'preset']
    const key = `paper:${parent}`
    const size = (side: 'width' | 'height'): ExpandedDescriptor =>
      part(descriptor, [...path, side], { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 1 }, `paper/${side}`, undefined, parent)
    return {
      descriptors: [
        part(descriptor, viewPath(key), { kind: 'select', options: choices([...PAPER_PRESET_NAMES, CUSTOM_PAPER]) }, 'paper/preset', undefined, parent),
        size('width'),
        size('height'),
      ],
      views: {
        [key]: {
          read: value => getJsonAt(value, preset) ?? CUSTOM_PAPER,
          write: (_value, next) => next === CUSTOM_PAPER || typeof next !== 'string'
            ? [{ path: preset }]
            : [{ path, value: createPaper(next as Parameters<typeof createPaper>[0]) as unknown as JsonValue }],
        },
      },
      writes: Object.fromEntries((['width', 'height'] as const).map((side) => {
        const at = [...path, side]
        return [formatJsonPath(at), ((_value, next) => [set(at, next), { path: preset }]) satisfies WriteRule]
      })),
    }
  },
  watermark: (descriptor) => {
    const { path } = descriptor
    const parent = formatJsonPath(path)
    const when: PropertyCondition = { path, filled: true }
    const item = (key: string, control: PropertyControl): ExpandedDescriptor => part(descriptor, [...path, key], control, `watermark/${key}`, when, parent)
    return merge(presence(descriptor, path, parent, defaultWatermark), {
      descriptors: [
        item('text', { kind: 'text' }),
        item('fontFamily', { kind: 'text' }),
        item('fontSize', { kind: 'number', unit: 'pt', exclusiveMin: 0, step: 1 }),
        item('color', { kind: 'color' }),
        item('opacity', { kind: 'number', min: 0, max: 1, step: 0.05 }),
        item('rotation', { kind: 'number', unit: 'deg', min: -360, max: 360, step: 1 }),
        item('gapX', { kind: 'number', unit: 'mm', min: 0, step: 1 }),
        item('gapY', { kind: 'number', unit: 'mm', min: 0, step: 1 }),
      ],
    })
  },
  cellStyle: (descriptor) => {
    const { path } = descriptor
    const parent = formatJsonPath(path)
    const at = (key: string): JsonPath => [...path, key]
    const item = (key: string, control: PropertyControl): ExpandedDescriptor => part(descriptor, at(key), control, `cellStyle/${key}`, undefined, parent)
    return {
      descriptors: [
        item('fontFamily', { kind: 'text' }),
        item('fontSize', { kind: 'number', unit: 'pt', exclusiveMin: 0, step: 0.5 }),
        item('bold', { kind: 'boolean' }),
        item('italic', { kind: 'boolean' }),
        item('color', { kind: 'color' }),
        item('background', { kind: 'color' }),
        item('align', { kind: 'select', options: choices(HORIZONTAL_ALIGNS) }),
        item('verticalAlign', { kind: 'select', options: choices(VERTICAL_ALIGNS) }),
        item('padding', { kind: 'number', unit: 'mm', min: 0, step: 0.1 }),
        item('lineHeight', { kind: 'number', unit: 'mm', exclusiveMin: 0, step: 0.1 }),
      ],
    }
  },
}

/**
 * 把复合属性拆开：keep 为真的描述（宿主或设计器给了编辑器）原样保留，能拆的拆成自带的编辑方式，
 * 其余原样保留，由调用方决定是否显示。
 */
export function expandProperties(descriptors: readonly PropertyDescriptor[], keep: (descriptor: PropertyDescriptor) => boolean, context: ExpandContext = {}): ExpandedProperties {
  const expanded: ExpandedDescriptor[] = []
  const views: Record<string, ViewRule> = {}
  const writes: Record<string, WriteRule> = {}
  for (const descriptor of descriptors) {
    const expander = keep(descriptor) ? undefined : EXPANDERS[descriptor.control.kind]
    if (expander === undefined) {
      expanded.push(descriptor)
      continue
    }
    const expansion = expander(descriptor, context)
    expanded.push(...expansion.descriptors)
    Object.assign(views, expansion.views)
    Object.assign(writes, expansion.writes)
  }
  const keys = Object.keys(views)
  return {
    descriptors: expanded,
    view: (value) => {
      if (keys.length === 0 || typeof value !== 'object' || value === null || Array.isArray(value))
        return value
      const read: Record<string, JsonValue> = {}
      for (const key of keys) {
        const current = views[key]!.read(value)
        if (current !== undefined)
          read[key] = current
      }
      return { ...value, [VIEW_KEY]: read }
    },
    write: (value, path, next) => {
      if (path.length === 2 && path[0] === VIEW_KEY) {
        const rule = views[String(path[1])]
        return rule === undefined ? [] : rule.write(value, next)
      }
      const rule = writes[formatJsonPath(path)]
      return rule === undefined ? [set(path, next)] : rule(value, next)
    },
  }
}
