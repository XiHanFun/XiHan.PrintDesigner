/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

import type { PropertyCondition, PropertyControl, PropertyDescriptor, PropertyGroup } from './types'
import { TEXT_ALIGNS, VERTICAL_ALIGNS } from '../schema/options'

/** 属性描述的可选项。 */
export interface PropertyOptions {
  required?: boolean
  when?: PropertyCondition
}

/** 生成一条属性描述，默认必填。 */
export function property(
  path: readonly string[],
  group: PropertyGroup,
  control: PropertyControl,
  options: PropertyOptions = {},
): PropertyDescriptor {
  const descriptor: PropertyDescriptor = { path, group, control, required: options.required ?? true }
  if (options.when !== undefined)
    descriptor.when = options.when
  return descriptor
}

/** 坐标、宽高与可选的旋转角度。 */
export function layoutProperties(options: { rotation: boolean }): PropertyDescriptor[] {
  const descriptors = [
    property(['x'], 'layout', { kind: 'number', unit: 'mm', step: 0.1 }),
    property(['y'], 'layout', { kind: 'number', unit: 'mm', step: 0.1 }),
    property(['width'], 'layout', { kind: 'number', unit: 'mm', min: 0, step: 0.1 }),
    property(['height'], 'layout', { kind: 'number', unit: 'mm', min: 0, step: 0.1 }),
  ]
  if (options.rotation)
    descriptors.push(property(['rotation'], 'layout', { kind: 'number', unit: 'deg', min: -360, max: 360, step: 1 }))
  return descriptors
}

/** 名称、锁定与只预览不打印。 */
export function behaviorProperties(): PropertyDescriptor[] {
  return [
    property(['name'], 'behavior', { kind: 'text' }, { required: false }),
    property(['locked'], 'behavior', { kind: 'boolean' }, { required: false }),
    property(['previewOnly'], 'behavior', { kind: 'boolean' }, { required: false }),
  ]
}

/** `style` 下的文本样式。 */
export function textStyleProperties(): PropertyDescriptor[] {
  return [
    property(['style', 'fontFamily'], 'text', { kind: 'text' }, { required: false }),
    property(['style', 'fontSize'], 'text', { kind: 'number', unit: 'pt', exclusiveMin: 0, max: 500, step: 0.5 }),
    property(['style', 'bold'], 'text', { kind: 'boolean' }),
    property(['style', 'italic'], 'text', { kind: 'boolean' }),
    property(['style', 'underline'], 'text', { kind: 'boolean' }),
    property(['style', 'lineThrough'], 'text', { kind: 'boolean' }),
    property(['style', 'color'], 'text', { kind: 'color' }),
    property(['style', 'align'], 'text', { kind: 'select', options: TEXT_ALIGNS }),
    property(['style', 'verticalAlign'], 'text', { kind: 'select', options: VERTICAL_ALIGNS }),
    property(['style', 'lineHeight'], 'text', { kind: 'number', unit: 'ratio', exclusiveMin: 0, max: 10, step: 0.1 }),
    property(['style', 'letterSpacing'], 'text', { kind: 'number', unit: 'pt', min: -10, max: 100, step: 0.1 }),
  ]
}

/** `box` 下的背景、边框与内边距。 */
export function boxProperties(): PropertyDescriptor[] {
  return [
    property(['box', 'background'], 'appearance', { kind: 'color' }, { required: false }),
    property(['box', 'border'], 'appearance', { kind: 'borderSides' }, { required: false }),
    property(['box', 'padding'], 'appearance', { kind: 'edges' }, { required: false }),
  ]
}
