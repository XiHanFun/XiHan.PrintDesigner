/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器层的扩展：在运行时层之上加属性编辑器、命令、面板、导入器、物料项与装上时的回调；设计器自带的编辑器与命令也写成一个扩展。

import type { ElementRegion, PrintElement } from '@xihan-print/core'
import type { PrintDesignerTranslations, PrintRuntimeExtension, PrintRuntimeModel } from '@xihan-print/runtime'
import type { IconRecord } from '@xihan-ui/core'
import type { DesignerCommand, DesignerImporter } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type { DesignerCommandsTranslations, DesignerCommandTable, DesignerPropertyEditor, DesignerSettings, DesignerSettingsSection, DesignerShellExtension, XhDesignerFrameElement } from '@xihan-ui/designer-shell'
import type { XhPrintDesigner } from './print-designer'
import { ELEMENT_CATEGORIES } from '@xihan-print/core'
import { createPrintRuntimeModel } from '@xihan-print/runtime'
import { DesignerExtensionError, extensionCommands, extensionEditors } from '@xihan-ui/designer-kit'
import { collectSettingsSections } from '@xihan-ui/designer-shell'
import { PRINT_SETTINGS_SECTION } from './settings'
import { TABLE_COMMANDS } from './table-edit'

/** 扩展装上时拿到的上下文。 */
export interface PrintDesignerContext {
  readonly designer: XhPrintDesigner
  /** 此刻生效的设计器文案。 */
  readonly translations: PrintDesignerTranslations
  /** 此刻生效的共用命令文案（designer-shell 语言包的 xh-designer-commands）：撤销、对齐、缩放这些四款都有的命令。 */
  readonly commands: DesignerCommandsTranslations
  /**
   * 此刻生效的设置，键是「分区 id.条目 id」：设计器自己的「画布」与各扩展分区里的条目写了用写的、没写取缺省值，
   * 基础分区（general.*）只有宿主或用户写了的键。
   */
  readonly settings: DesignerSettings
  /** 设计器的外框；内置的「面板」命令从它列出能开关的面板。设计器还没建出外框时为 undefined。 */
  readonly frame: XhDesignerFrameElement | undefined
}

/** 设计器的命令：工具栏按钮、右键菜单项与快捷键共用。 */
export type PrintDesignerCommand = DesignerCommand<PrintDesignerContext>

/** 导入的结果：一组元素，整体挪到落点（粘贴时为视口中央）后按粘贴的规则放进当前页面模板。 */
export interface PrintImportFragment {
  readonly elements: readonly PrintElement[]
  /** 放进哪个区，缺省按落点所在的区。 */
  readonly region?: ElementRegion
}

/** 导入器：把粘贴或拖放进来的外部内容换成一组元素；返回 undefined 即不放任何元素。 */
export type PrintDesignerImporter = DesignerImporter<PrintDesignerContext, PrintImportFragment | undefined>

/** 物料面板里的一项：扩展元素的名称与图标。 */
export interface PrintPaletteEntry {
  /** 元素种类的名称，物料面板、画布与属性面板的可访问名、问题列表都用它；不给时显示类型名。 */
  readonly label?: string
  readonly icon?: IconRecord
}

/** 打印设计器层的扩展：运行时层的全部字段（元素种类、渲染、编辑方式与规则），加上属性编辑器、命令、面板、设置分区、导入器、物料项与 setup。 */
export interface PrintDesignerExtension extends PrintRuntimeExtension, Pick<DesignerShellExtension<PrintDesignerContext, DesignerPropertyEditor>, 'editors' | 'commands' | 'panels' | 'settings' | 'setup'> {
  /** 导入器：粘贴与拖放共用，按扩展顺序问 accepts，第一个接下的导入；id 不能与别的导入器重名。 */
  readonly importers?: readonly PrintDesignerImporter[]
  /** 本扩展登记的元素的物料项，键是元素类型；只能给本扩展 elements 里的类型。 */
  readonly palette?: Readonly<Record<string, PrintPaletteEntry>>
  /** 本扩展新加的物料分组的名称，键是分组名；不能是内置分组，也不能与别的扩展重名。没给名称的分组显示分组名。 */
  readonly categories?: Readonly<Record<string, string>>
}

/** 设计器自带的扩展的 id：内置命令，以及表格列与表尾行的条目、页码格式、四边边框与值格式的编辑器。 */
export const PRINT_DESIGNER_EXTENSION_ID = '@xihan-print/designer'

/**
 * 工具栏的缺省排列；commandLayout 没写 toolbar 时用它，再把 placement 含 toolbar 的扩展命令追加成一组。
 * 对齐、分布与层级各收进一个菜单（align-menu、layer-menu），单条命令照样能经 commandLayout 排上工具栏。
 */
export const PRINT_TOOLBAR_LAYOUT: readonly (readonly string[])[] = [
  ['undo', 'redo'],
  ['cut', 'copy', 'paste', 'duplicate', 'delete'],
  ['align-menu', 'layer-menu'],
  ['zoom-out', 'zoom-in', 'zoom-to-fit', 'zoom-to-actual', 'grid', 'snap'],
  ['design', 'preview', 'page-setup', 'print'],
  ['panels', 'settings', 'help'],
]

/** 选中文字类元素时浮在选中框上方的格式工具条，排列固定：字号，粗体、斜体、下划线、删除线，左中右对齐。 */
export const PRINT_FORMAT_LAYOUT: readonly (readonly string[])[] = [
  ['font-size'],
  ['text-bold', 'text-italic', 'text-underline', 'text-line-through'],
  ['text-align-left', 'text-align-center', 'text-align-right'],
]

/** 内置命令 help 打开的帮助页：打印文档站的设计器一页。 */
export const PRINT_DESIGNER_HELP_URL = 'https://print.docs.xihanfun.com/guide/designer'

/** 画布右侧翻页条上的命令，排列固定：上一页、页码、下一页，新增、复制、删除页面。 */
export const PRINT_PAGE_STRIP_LAYOUT: readonly (readonly string[])[] = [
  ['previous-page', 'page-menu', 'next-page'],
  ['add-page', 'duplicate-page', 'remove-page'],
]

/** 右键菜单落在哪类对象上：画布空白处、元素，或表格编辑态里的表格部位。 */
export type PrintMenuSubject = 'blank' | 'element' | 'table'

/** 右键菜单的缺省排列；选中的是一张表格时，元素菜单最前面加「编辑表格」。 */
export function printMenuLayout(subject: PrintMenuSubject, tableSelected: boolean): string[][] {
  if (subject === 'blank')
    return [['paste', 'select-all'], ['zoom-to-fit']]
  if (subject === 'table')
    return [TABLE_COMMANDS.slice(0, 5), TABLE_COMMANDS.slice(5), ['exit-table-edit']]
  return [
    ...(tableSelected ? [['edit-table']] : []),
    ['cut', 'copy', 'duplicate', 'delete'],
    ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'],
  ]
}

/** 一组设计器扩展合出的东西：交给 core 函数与预览的列表、运行时的模型、属性编辑器表、命令表、导入器与物料项。 */
export interface PrintDesignerModel {
  /** 设计器自带的扩展在前、传入的在后；校验、分页与预览都拿这一份。 */
  readonly list: readonly PrintDesignerExtension[]
  /** 元素登记表、编辑方式与扩展元素的渲染。 */
  readonly runtime: PrintRuntimeModel
  /** 各扩展的属性编辑器按顺序合成一张，后面的压前面的。 */
  readonly editors: PropertyEditorTable<DesignerPropertyEditor>
  /** 各扩展的命令，内置在前、扩展按登记顺序在后。 */
  readonly commands: DesignerCommandTable<PrintDesignerContext>
  /** 各扩展的导入器，按扩展顺序。 */
  readonly importers: readonly PrintDesignerImporter[]
  /** 扩展的元素类型 → 物料项。 */
  readonly palette: ReadonlyMap<string, PrintPaletteEntry>
  /** 扩展的物料分组 → 名称。 */
  readonly categories: ReadonlyMap<string, string>
  /** 各扩展登记的设置分区，按扩展顺序。 */
  readonly settings: readonly DesignerSettingsSection[]
}

/** 合出设计器用的模型；任何一处重名（含设置分区与设计器自己的 print、内建的 general 重名）都抛 DesignerExtensionError，物料项给了别处登记的元素类型时抛 TypeError。 */
export function createPrintDesignerModel(builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): PrintDesignerModel {
  const list = [builtin, ...extensions]
  const runtime = createPrintRuntimeModel(list)
  const all = runtime.extensions as readonly PrintDesignerExtension[]
  const palette = new Map<string, PrintPaletteEntry>()
  const categories = new Map<string, string>()
  const owners = new Map<string, string>(ELEMENT_CATEGORIES.map(category => [category, 'builtin']))
  for (const extension of all) {
    const own = new Set((extension.elements ?? []).map(prototype => prototype.type))
    for (const [type, entry] of Object.entries(extension.palette ?? {})) {
      if (!own.has(type))
        throw new TypeError(`[xh-print] 扩展 ${extension.id} 的 palette 里的 ${type} 不是它自己登记的元素类型`)
      palette.set(type, entry)
    }
    for (const [category, label] of Object.entries(extension.categories ?? {})) {
      const previous = owners.get(category)
      if (previous !== undefined)
        throw new DesignerExtensionError('palette-category', category, [previous, extension.id])
      owners.set(category, extension.id)
      categories.set(category, label)
    }
  }
  // 设计器自己的「画布」分区占着 print，扩展的分区与它、与内建的 general 或彼此重名都抛错
  const settings = collectSettingsSections([{ id: builtin.id, settings: [{ id: PRINT_SETTINGS_SECTION, label: PRINT_SETTINGS_SECTION, items: [] }] }, ...extensions]).slice(1)
  return { list, runtime, editors: extensionEditors<DesignerPropertyEditor>(undefined, all), commands: extensionCommands(all), importers: all.flatMap(extension => extension.importers ?? []), palette, categories, settings }
}
