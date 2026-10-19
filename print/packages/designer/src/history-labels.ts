/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 撤销历史里一步的说明：按这一步的正向操作与应用前的文档给出，文案在显示时现取、换语言跟着变，
// 元素的种类与名称在这一步执行时取好。单个元素写「种类 名称」，几个元素写个数。

import type { PrintDocument, PrintElement, PrintOperation } from '@xihan-print/core'
import type { PrintDesignerTranslations, PrintHistoryTranslations } from '@xihan-print/runtime'
import type { HistoryLabel } from '@xihan-ui/designer-kit'
import { findElement } from '@xihan-print/core'

/** 生成说明要用到的：现取的文案，与元素种类的显示名。 */
export interface PrintHistoryLabelSource {
  readonly translations: () => PrintDesignerTranslations
  readonly kindName: (type: string, translations: PrintDesignerTranslations) => string
}

/** 说明里的一个元素：种类与名称（没有名称时是 id）。 */
interface ElementIdentity {
  readonly type: string
  readonly name: string
}

type ElementPhrase = 'add' | 'remove' | 'edit' | 'move' | 'resize' | 'rotate' | 'reorder' | 'copy'

const SINGLE: Readonly<Record<ElementPhrase, keyof PrintHistoryTranslations>> = {
  add: 'addElement',
  remove: 'removeElement',
  edit: 'editElement',
  move: 'moveElement',
  resize: 'resizeElement',
  rotate: 'rotateElement',
  reorder: 'reorderElement',
  copy: 'copyElement',
}

const MANY: Readonly<Record<ElementPhrase, keyof PrintHistoryTranslations>> = {
  add: 'addElements',
  remove: 'removeElements',
  edit: 'editElements',
  move: 'moveElements',
  resize: 'resizeElements',
  rotate: 'rotateElements',
  reorder: 'reorderElements',
  copy: 'copyElements',
}

function identityOf(element: PrintElement | undefined, id: string): ElementIdentity {
  return element === undefined ? { type: '', name: id } : { type: element.type, name: element.name ?? element.id }
}

/** 一组元素的说明：一个写「种类 名称」，几个写个数。 */
export function elementsLabel(phrase: ElementPhrase, elements: readonly ElementIdentity[], source: PrintHistoryLabelSource): HistoryLabel {
  return () => {
    const t = source.translations()
    if (elements.length === 1) {
      const [element] = elements
      const kind = element!.type === '' ? '' : source.kindName(element!.type, t)
      const label = kind === '' ? element!.name : t.elementLabel(kind, element!.name)
      return (t.history[SINGLE[phrase]] as (label: string) => string)(label)
    }
    return (t.history[MANY[phrase]] as (count: number) => string)(elements.length)
  }
}

/** 文档里这些元素的种类与名称，取不到的写 id。 */
export function identitiesIn(document: PrintDocument, ids: readonly string[]): ElementIdentity[] {
  return [...new Set(ids)].map(id => identityOf(findElement(document, id)?.element, id))
}

/** 打印编辑模型的 describe：按这一步的正向操作与应用前的文档给出说明；认不出的组合为 undefined。 */
export function describePrintOperations(operations: readonly PrintOperation[], before: PrintDocument, source: PrintHistoryLabelSource): HistoryLabel | undefined {
  const first = operations[0]
  if (first === undefined)
    return undefined
  const history = (pick: (t: PrintHistoryTranslations) => string): HistoryLabel => () => pick(source.translations().history)
  const ofType = <K extends PrintOperation['type']>(type: K): Extract<PrintOperation, { type: K }>[] =>
    operations.filter((operation): operation is Extract<PrintOperation, { type: K }> => operation.type === type)

  // 换区：同一个元素先删掉再加到别的区，可能还夹着留在原区的平移
  const removed = ofType('removeElement').map(operation => operation.id)
  const added = ofType('addElement').map(operation => operation.element.id)
  const moved = ofType('moveElements').flatMap(operation => operation.ids)
  if (removed.length > 0 && operations.every(operation => ['removeElement', 'addElement', 'moveElements'].includes(operation.type))
    && removed.length === added.length && removed.every(id => added.includes(id))) {
    return elementsLabel('move', identitiesIn(before, [...moved, ...removed]), source)
  }

  switch (first.type) {
    case 'addElement':
      return elementsLabel('add', ofType('addElement').map(operation => identityOf(operation.element, operation.element.id)), source)
    case 'removeElement':
      return elementsLabel('remove', identitiesIn(before, removed), source)
    case 'updateElement':
      return elementsLabel('edit', identitiesIn(before, ofType('updateElement').map(operation => operation.id)), source)
    case 'moveElements':
      return elementsLabel('move', identitiesIn(before, moved), source)
    case 'resizeElement':
      return elementsLabel('resize', identitiesIn(before, ofType('resizeElement').map(operation => operation.id)), source)
    case 'reorderElement':
      return elementsLabel('reorder', identitiesIn(before, ofType('reorderElement').map(operation => operation.id)), source)
    case 'addPage':
      return history(t => t.addPage)
    case 'removePage':
      return history(t => t.removePage)
    case 'movePage':
      return history(t => t.movePage)
    case 'updatePage':
      return ofType('updatePage').every(operation => operation.changes.every(change => change.path[0] === 'guides'))
        ? history(t => t.editGuides)
        : history(t => t.editPage)
    case 'addBand':
    case 'removeBand': {
      const { region, variant } = first
      return () => {
        const t = source.translations()
        const name = t.propertyPart(t.regions[region], t.bandVariants[variant])
        return first.type === 'addBand' ? t.history.addBand(name) : t.history.removeBand(name)
      }
    }
    case 'updateDocument':
      return history(t => t.editDocument)
    case 'replaceDocument':
      return history(t => t.editJson)
  }
}
