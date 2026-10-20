/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 设计器层的扩展：在运行时层之上加属性编辑器、命令、面板、导入器、物料项、物料来源与装上时的回调；设计器自带的编辑器与命令也写成一个扩展。

import type { ElementRegion, ElementRegistry, PrintElement, PrintElementType } from '@xihan-print/core'
import type { PrintDesignerTranslations, PrintRuntimeExtension, PrintRuntimeModel, PrintTourStepKey } from '@xihan-print/runtime'
import type { IconRecord } from '@xihan-ui/core'
import type { DesignerCommand, DesignerImporter } from '@xihan-ui/designer-kit'
import type { PropertyEditorTable } from '@xihan-ui/designer-kit/properties'
import type { DesignerCommandsTranslations, DesignerCommandTable, DesignerMenubarMenu, DesignerPaletteSource, DesignerPropertyEditor, DesignerSettings, DesignerSettingsSection, DesignerShellExtension, DesignerTourStep, DesignerTourTarget, XhDesignerFrameElement } from '@xihan-ui/designer-shell'
import type { XhPrintDesigner } from './print-designer'
import { ELEMENT_CATEGORIES } from '@xihan-print/core'
import { createPrintRuntimeModel } from '@xihan-print/runtime'
import { DesignerExtensionError, extensionCommands, extensionEditors } from '@xihan-ui/designer-kit'
import { collectMenubarMenus, collectPaletteSources, collectSettingsSections, collectTourSteps, designerMenubarLayout, designerMenubarMenus, designerPanelCommands } from '@xihan-ui/designer-shell'
import { BarcodeIcon, ImageIcon, MinusIcon, PageNumberIcon, QrCodeIcon, ShapeEllipseIcon, ShapeRectangleIcon, TableIcon, TextRichIcon, TextWrapIcon, TypeIcon } from '@xihan-ui/icons'
import { PRINT_CLIENT_SETTINGS_SECTION, PRINT_SETTINGS_SECTION } from './settings'
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

/** 物料来源的条目拖到画布上放下的落点：纸张坐标（mm，以纸张左上角为原点），以及这一点落在页眉、正文还是页脚。 */
export interface PrintPaletteDrop {
  readonly x: number
  readonly y: number
  readonly region: ElementRegion
}

/**
 * 打印设计器层的扩展：运行时层的全部字段（元素种类、渲染、编辑方式与规则），加上属性编辑器、命令、面板、设置分区、导入器、
 * 物料项、物料来源、菜单栏的菜单与 setup。物料来源（paletteSources）的条目拖到画布上放下时，落点是 PrintPaletteDrop。
 */
export interface PrintDesignerExtension extends PrintRuntimeExtension, Pick<DesignerShellExtension<PrintDesignerContext, DesignerPropertyEditor, unknown, unknown, PrintPaletteDrop>, 'editors' | 'commands' | 'panels' | 'settings' | 'fieldSources' | 'tourSteps' | 'paletteSources' | 'menubarMenus' | 'about' | 'setup'> {
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
 * 对齐（六条）、分布（两条）与层级（四条）每条一颗钮，各成一组一字排开；放不下的收进工具栏的「更多」。
 * 设置与帮助在菜单栏里，末组只留面板；菜单栏关掉时的变化见 printToolbarLayout。
 */
export const PRINT_TOOLBAR_LAYOUT: readonly (readonly string[])[] = [
  ['undo', 'redo'],
  ['cut', 'copy', 'paste', 'duplicate', 'delete'],
  ['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom'],
  ['distribute-horizontal', 'distribute-vertical'],
  ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'],
  ['pan-tool', 'zoom-out', 'zoom-in', 'zoom-to-fit', 'zoom-to-actual', 'grid', 'snap'],
  ['design', 'preview', 'page-setup', 'print'],
  ['panels'],
]

/** 工具栏此刻的缺省排列：PRINT_TOOLBAR_LAYOUT；菜单栏关掉（menubar 为假）时末组在面板后面放回设置与帮助，它们才有入口。 */
export function printToolbarLayout(menubar: boolean = true): (readonly string[])[] {
  return menubar ? [...PRINT_TOOLBAR_LAYOUT] : [...PRINT_TOOLBAR_LAYOUT.slice(0, -1), [...PRINT_TOOLBAR_LAYOUT.at(-1)!, 'settings', 'help']]
}

/** 打印自己在菜单栏上的两张菜单的 id：插入、页面；宿主写 commandLayout 的 menubar:<菜单 id> 时用。 */
export const PRINT_MENUBAR_MENUS = {
  insert: 'insert',
  page: 'page',
} as const

/** 插入一种元素的命令 id：insert:<元素类型>。 */
export function printInsertCommandId(type: string): string {
  return `insert:${type}`
}

/**
 * 菜单栏的缺省排列：在 designer-shell 四张菜单的缺省排列上，文件菜单的设置之前多出导入字段、打印两组，视图菜单的拖动之后
 * 多出网格与吸附一组；插入菜单按物料分组（elements 的 groupByCategory）各成一组列出插入元素的命令，最后一组是页眉、页脚的变体；
 * 页面菜单是纸张、方向与页面设置，上一页、下一页，新增、复制、删除页面，上移、下移页面。只留 commands 里有的命令，空组去掉。
 */
export function printMenubarLayout(commands: DesignerCommandTable<never>, elements: Pick<ElementRegistry, 'groupByCategory'>): Record<string, string[][]> {
  const layout = designerMenubarLayout(commands)
  const keep = (groups: readonly (readonly string[])[]): string[][] => groups.map(group => group.filter(id => commands.has(id))).filter(group => group.length > 0)
  const file = layout.file ?? []
  const settings = file.findIndex(group => group.includes('settings'))
  const fileAt = settings < 0 ? file.length : settings
  layout.file = keep([...file.slice(0, fileAt), ['import-fields'], ['print'], ...file.slice(fileAt)])
  const view = layout.view ?? []
  const pan = view.findIndex(group => group.includes('pan-tool'))
  const viewAt = pan < 0 ? view.length : pan + 1
  layout.view = keep([...view.slice(0, viewAt), ['grid', 'snap'], ...view.slice(viewAt)])
  layout[PRINT_MENUBAR_MENUS.insert] = keep([
    ...elements.groupByCategory().map(group => group.prototypes.map(prototype => printInsertCommandId(prototype.type))),
    ['header-variants', 'footer-variants'],
  ])
  layout[PRINT_MENUBAR_MENUS.page] = keep([
    ['page-paper', 'page-orientation', 'page-properties'],
    ['previous-page', 'next-page'],
    ['add-page', 'duplicate-page', 'remove-page'],
    ['move-page-up', 'move-page-down'],
  ])
  return layout
}

/**
 * 设计器的面板 id：宿主写 defaultLayout、settingsPolicy（layout.panels.<面板 id>）时用。
 * pages 是画布右侧的翻页条，minimap 是画布左下角的小地图，都是画布浮动件，只能显隐。
 */
export const PRINT_DESIGNER_PANELS = {
  palette: 'palette',
  outline: 'outline',
  properties: 'properties',
  history: 'history',
  issues: 'issues',
  pages: 'pages',
  minimap: 'minimap',
} as const

/** 内置命令 help 打开的帮助页：打印文档站的设计器一页。 */
export const PRINT_DESIGNER_HELP_URL = 'https://print.docs.xihanfun.com/guide/designer'

/** 画布右侧翻页条上的命令，排列固定：上一页、页码、下一页，新增、复制、删除页面。 */
export const PRINT_PAGE_STRIP_LAYOUT: readonly (readonly string[])[] = [
  ['previous-page', 'page-menu', 'next-page'],
  ['add-page', 'duplicate-page', 'remove-page'],
]

/** 选中工具条落在哪类选中上：都是文字类元素（文本、长文本、富文本、页码）、单个别的元素，或几个元素里有别的种类。 */
export type PrintSelectionSubject = 'text' | 'element' | 'multiple'

/**
 * 选中工具条（命令落点 selection:<主体>）的缺省排列：文字类元素多出字号、粗体、斜体、下划线、删除线与左中右对齐；
 * 多选多出对齐与分布；都有层级、创建副本、复制与删除。对齐、分布与层级每条一颗钮，放不下的收进选中工具条的「更多」。
 */
export function printSelectionLayout(subject: PrintSelectionSubject): string[][] {
  const layer = ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back']
  const common = [layer, ['duplicate', 'copy', 'delete']]
  if (subject === 'text')
    return [['font-size'], ['text-bold', 'text-italic', 'text-underline', 'text-line-through'], ['text-align-left', 'text-align-center', 'text-align-right'], ...common]
  if (subject === 'multiple')
    return [['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom'], ['distribute-horizontal', 'distribute-vertical'], ...common]
  return common
}

/** 右键菜单落在哪类对象上：画布空白处、元素，或表格编辑态里的表格部位。 */
export type PrintMenuSubject = 'blank' | 'element' | 'table'

/** 右键菜单的缺省排列；选中的是一张表格时，元素菜单最前面加「编辑表格」。 */
export function printMenuLayout(subject: PrintMenuSubject, tableSelected: boolean): string[][] {
  if (subject === 'blank')
    return [['paste', 'select-all'], ['zoom-to-fit'], ['edit-json']]
  if (subject === 'table')
    return [TABLE_COMMANDS.slice(0, 5), TABLE_COMMANDS.slice(5), ['exit-table-edit']]
  return [
    ...(tableSelected ? [['edit-table']] : []),
    ['cut', 'copy', 'duplicate', 'delete'],
    ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'],
  ]
}

/** 内置元素的种类图标：物料面板、页面结构与插入菜单用。 */
const ELEMENT_ICONS: Readonly<Record<PrintElementType, IconRecord>> = {
  text: TypeIcon,
  longText: TextWrapIcon,
  richText: TextRichIcon,
  pageNumber: PageNumberIcon,
  image: ImageIcon,
  table: TableIcon,
  line: MinusIcon,
  rect: ShapeRectangleIcon,
  ellipse: ShapeEllipseIcon,
  barCode: BarcodeIcon,
  matrixCode: QrCodeIcon,
}

/** 一种元素的图标：内置的取种类图标，扩展的取它物料项的图标。 */
export function elementIcon(model: Pick<PrintDesignerModel, 'palette'>, type: string): IconRecord | undefined {
  return Object.hasOwn(ELEMENT_ICONS, type) ? ELEMENT_ICONS[type as PrintElementType] : model.palette.get(type)?.icon
}

/** 元素类型的名字：内置类型取语言包，扩展的类型取扩展给的名称，都没有时用类型名。 */
export function elementName(t: PrintDesignerTranslations, model: Pick<PrintDesignerModel, 'palette'>, type: string): string {
  return Object.hasOwn(t.elements, type) ? t.elements[type as PrintElementType] : model.palette.get(type)?.label ?? type
}

/** 一组设计器扩展合出的东西：交给 core 函数与预览的列表、运行时的模型、属性编辑器表、命令表、导入器、物料项与物料来源。 */
export interface PrintDesignerModel {
  /** 设计器自带的扩展在前、传入的在后；校验、分页与预览都拿这一份。 */
  readonly list: readonly PrintDesignerExtension[]
  /** 元素登记表、编辑方式与扩展元素的渲染。 */
  readonly runtime: PrintRuntimeModel
  /** 各扩展的属性编辑器按顺序合成一张，后面的压前面的。 */
  readonly editors: PropertyEditorTable<DesignerPropertyEditor>
  /** 各扩展的命令，内置在前、扩展按登记顺序在后，然后是扩展面板的开关命令 panel:<区名>，末尾是每种元素一条插入命令 insert:<元素类型>。 */
  readonly commands: DesignerCommandTable<PrintDesignerContext>
  /** 各扩展的导入器，按扩展顺序。 */
  readonly importers: readonly PrintDesignerImporter[]
  /** 扩展的元素类型 → 物料项。 */
  readonly palette: ReadonlyMap<string, PrintPaletteEntry>
  /** 扩展的物料分组 → 名称。 */
  readonly categories: ReadonlyMap<string, string>
  /** 各扩展登记的设置分区，按扩展顺序。 */
  readonly settings: readonly DesignerSettingsSection[]
  /** 新手引导里设计器与各扩展的步骤，按登记顺序；designer-shell 的通用步骤由零件自带。 */
  readonly tourSteps: readonly DesignerTourStep<PrintDesignerContext>[]
  /** 各扩展的物料来源，按 order 排；分组接在内置的元素分组与字段分组后面。 */
  readonly paletteSources: readonly DesignerPaletteSource<PrintDesignerContext, PrintPaletteDrop>[]
  /** 菜单栏上的菜单：designer-shell 内置的文件、编辑、视图、帮助在前，各扩展登记的按顺序在后。 */
  readonly menubarMenus: readonly DesignerMenubarMenu<PrintDesignerContext>[]
}

function tourStep(key: PrintTourStepKey, target: DesignerTourTarget, order: number): DesignerTourStep<PrintDesignerContext> {
  return {
    id: `print.${key}`,
    target,
    order,
    title: ({ translations }) => translations.tourSteps[key].title,
    description: ({ translations }) => translations.tourSteps[key].description,
  }
}

/** 新手引导里打印自己的几步，排在通用步骤之后：页眉页脚、页面模板、字段物料与打印。目标看不见的那步由零件跳过。 */
export const PRINT_TOUR_STEPS: readonly DesignerTourStep<PrintDesignerContext>[] = [
  tourStep('bands', { selector: '[data-part="band-menu"][data-region="header"]' }, 100),
  tourStep('pages', { panel: PRINT_DESIGNER_PANELS.pages }, 110),
  tourStep('fields', { panel: PRINT_DESIGNER_PANELS.palette }, 120),
  tourStep('print', { command: 'print' }, 130),
]

/**
 * 合出设计器用的模型；任何一处重名（含设置分区与设计器自己的 print、内建的 general 重名，引导步骤 id 重名或用了 shell. 前缀，
 * 物料来源 id 重名，菜单栏的菜单 id 重名，扩展的命令占了 panel:<区名> 或 insert:<元素类型>）都抛 DesignerExtensionError，
 * 物料项给了别处登记的元素类型时抛 TypeError。
 */
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
  // 设计器自己的「打印」「本地客户端」两个分区占着 print 与 printClient，扩展的分区与它们、与内建的 general 或彼此重名都抛错
  const own = [PRINT_SETTINGS_SECTION, PRINT_CLIENT_SETTINGS_SECTION].map(id => ({ id, label: id, items: [] }))
  const settings = collectSettingsSections([{ id: builtin.id, settings: own }, ...extensions]).slice(own.length)
  const tourSteps = collectTourSteps<PrintDesignerContext>([builtin, ...extensions])
  const paletteSources = collectPaletteSources<PrintDesignerContext, PrintPaletteDrop>(list)
  const menubarMenus = collectMenubarMenus(designerMenubarMenus<PrintDesignerContext>({ translations: context => context.commands }), list)
  return { list, runtime, editors: extensionEditors<DesignerPropertyEditor>(undefined, all), commands: withInsertCommands(withPanelCommands(extensionCommands(all), builtin, extensions), runtime.elements, palette, builtin, extensions), importers: all.flatMap(extension => extension.importers ?? []), palette, categories, settings, tourSteps, paletteSources, menubarMenus }
}

/** 命令表并上扩展面板的开关命令 panel:<区名>；扩展自己登记了同名命令时抛 DesignerExtensionError。 */
function withPanelCommands(commands: DesignerCommandTable<PrintDesignerContext>, builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): DesignerCommandTable<PrintDesignerContext> {
  const panels = extensions.flatMap(extension => (extension.panels ?? []).map(panel => panel.region.name))
  if (panels.length === 0)
    return commands
  const table = new Map(commands)
  for (const command of designerPanelCommands<PrintDesignerContext>({ panels, frame: context => context.frame })) {
    if (table.has(command.id))
      throw new DesignerExtensionError('command', command.id, [builtin.id, commandOwner(command.id, builtin, extensions)])
    table.set(command.id, command)
  }
  return table
}

/**
 * 命令表并上每种元素一条插入命令 insert:<元素类型>，内置与扩展的元素都有：文字是元素种类的名字，图标同物料面板；
 * 执行时与点物料一样把元素放在视口中央并选中，只读或不在设计态时不可用。扩展自己登记了同名命令时抛 DesignerExtensionError。
 */
function withInsertCommands(commands: DesignerCommandTable<PrintDesignerContext>, elements: ElementRegistry, palette: ReadonlyMap<string, PrintPaletteEntry>, builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): DesignerCommandTable<PrintDesignerContext> {
  const table = new Map(commands)
  for (const { prototypes } of elements.groupByCategory()) {
    for (const { type } of prototypes) {
      const id = printInsertCommandId(type)
      if (table.has(id))
        throw new DesignerExtensionError('command', id, [builtin.id, commandOwner(id, builtin, extensions)])
      const icon = elementIcon({ palette }, type)
      table.set(id, {
        id,
        label: ({ translations }) => elementName(translations, { palette }, type),
        ...(icon === undefined ? {} : { icon }),
        enabled: ({ designer }) => designer.readonly !== true && designer.mode === 'design',
        run: ({ designer }) => void designer.addElement(type),
      })
    }
  }
  return table
}

/** 登记了这条命令的扩展的 id；哪个扩展都没登记时是设计器自带的扩展。 */
function commandOwner(id: string, builtin: PrintDesignerExtension, extensions: readonly PrintDesignerExtension[]): string {
  return [builtin, ...extensions].find(extension => extension.commands?.some(item => item.id === id))?.id ?? builtin.id
}
