/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 从源码生成 reference/ 下的参考页：元素与属性取自 @xihan-print/core 的元素原型，中文名与问题说明取自 printZhCN，
// 类型、元素的属性、方法与事件取自 print/packages 的 TypeScript 源码与注释，客户端错误码的说明取自 client 的 C# 注释。
// 带 --check 时只比对，与已提交的页面不一致就列出并以非零退出。

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as core from '@xihan-print/core'
import { printZhCN } from '@xihan-print/runtime/locale'
import { PAPER_PRESETS } from '@xihan-ui/designer-kit'
import ts from 'typescript'

const docsDir = fileURLToPath(new URL('../', import.meta.url))
const repoDir = join(docsDir, '..')
const checkOnly = process.argv.includes('--check')

const GENERATED = '<!-- 本页由 docs/scripts/gen-reference.mjs 从源码生成，不要手改；源码变了之后在 docs/ 运行 pnpm gen。 -->'

const t = printZhCN.translations['xh-print-designer']

function packageSource(...parts) {
  return join(repoDir, 'print', 'packages', ...parts)
}

// —— Markdown ——

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内代码；含 {{ 的写成 v-pre 的 <code>，免得被当成 Vue 插值。 */
function code(text, cell = false) {
  if (text.includes('{{'))
    return `<code v-pre>${escapeHtml(text).replace(/\|/g, '&#124;')}</code>`
  const body = cell ? text.replace(/\|/g, '\\|') : text
  return body.includes('`') ? `\`\` ${body} \`\`` : `\`${body}\``
}

/** 注释里的一段话：反引号里的按代码写，其余转义尖括号、花括号与表格里的竖线。 */
function prose(text, cell = false) {
  return text.split(/(`[^`]*`)/).map((part, index) => {
    if (index % 2 === 1)
      return code(part.slice(1, -1), cell)
    const escaped = escapeHtml(part).replace(/\{\{/g, '&#123;&#123;')
    return cell ? escaped.replace(/\|/g, '\\|') : escaped
  }).join('')
}

/** 注释里折行的两段接起来：两边都是 ASCII 字母数字时补一个空格。 */
function joinWrapped(left, right) {
  return /[\w)]$/.test(left) && /^[\w(`]/.test(right) ? `${left} ${right}` : `${left}${right}`
}

/** 注释按段落与列表项分块：普通行接到上一块，列表项另起一块。 */
function docBlocks(doc) {
  const blocks = []
  for (const line of doc.split('\n').map(item => item.trim()).filter(Boolean)) {
    if (line.startsWith('- ') || blocks.length === 0)
      blocks.push(line)
    else
      blocks[blocks.length - 1] = joinWrapped(blocks.at(-1), line)
  }
  return blocks
}

/** 注释写进表格单元格：并成一行，列表项另起一行。 */
function cellDoc(doc) {
  return docBlocks(doc).map(block => prose(block, true)).join('<br>')
}

/** 注释写成段落：列表项保留为 Markdown 列表。 */
function blockDoc(doc) {
  return docBlocks(doc).map((block, index) => {
    const text = prose(block)
    if (index === 0)
      return text
    return block.startsWith('- ') ? `\n${text}` : `\n\n${text}`
  }).join('')
}

function table(head, rows) {
  if (rows.length === 0)
    return ''
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function page(title, intro, sections) {
  return `${[`# ${title}`, GENERATED, intro, ...sections].filter(Boolean).join('\n\n')}\n`
}

function anchorOf(name) {
  return name.toLowerCase()
}

// —— TypeScript 源码 ——

const sourceCache = new Map()

function sourceFile(file) {
  let source = sourceCache.get(file)
  if (source === undefined) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    sourceCache.set(file, source)
  }
  return source
}

function flat(node) {
  return node.getText().replace(/\s+/g, ' ').trim()
}

/** 节点的注释原文：按行去掉注释符号，文中的 @xihan-ui/... 之类不当作标签。 */
function jsdoc(node) {
  const doc = ts.getJSDocCommentsAndTags(node).filter(item => item.kind === ts.SyntaxKind.JSDoc).at(-1)
  if (doc === undefined)
    return ''
  return doc.getText()
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .trim()
}

function nameOf(node) {
  const name = node.name
  if (name === undefined)
    return ''
  return ts.isStringLiteral(name) || ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text : name.getText()
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind)
}

function isExported(statement) {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword)
}

function declarationsOf(source) {
  const found = new Map()
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        found.set(declaration.name.getText(), { node: declaration, statement, exported: isExported(statement) })
      continue
    }
    const name = nameOf(statement)
    if (name !== '')
      found.set(name, { node: statement, statement, exported: isExported(statement) })
  }
  return found
}

function declaration(file, name) {
  const found = declarationsOf(sourceFile(file)).get(name)
  if (found === undefined)
    throw new Error(`[gen-reference] ${name} not found in ${file}`)
  return found
}

/** 参数列表：带缺省值的参数写成可选，不写缺省值。 */
function parameters(node) {
  return node.parameters.map((parameter) => {
    const optional = parameter.questionToken !== undefined || parameter.initializer !== undefined
    const rest = parameter.dotDotDotToken === undefined ? '' : '...'
    const type = parameter.type === undefined ? '' : `: ${flat(parameter.type)}`
    return `${rest}${parameter.name.getText()}${optional ? '?' : ''}${type}`
  }).join(', ')
}

function signature(name, node) {
  const typeParameters = node.typeParameters === undefined ? '' : `<${node.typeParameters.map(flat).join(', ')}>`
  const returns = node.type === undefined ? '' : `: ${flat(node.type)}`
  return `${name}${typeParameters}(${parameters(node)})${returns}`
}

/** 接口的成员：函数类型的属性当作方法。 */
function interfaceMembers(file, name) {
  const { node } = declaration(file, name)
  if (!ts.isInterfaceDeclaration(node))
    throw new Error(`[gen-reference] ${name} is not an interface`)
  return node.members.map((member) => {
    const memberName = nameOf(member)
    const doc = jsdoc(member)
    const optional = member.questionToken !== undefined
    const readonly = hasModifier(member, ts.SyntaxKind.ReadonlyKeyword)
    if (ts.isMethodSignature(member))
      return { kind: 'method', name: memberName, signature: signature(memberName, member), doc, optional }
    if (ts.isPropertySignature(member) && member.type !== undefined && ts.isFunctionTypeNode(member.type))
      return { kind: 'method', name: memberName, signature: signature(memberName, member.type), doc, optional }
    return { kind: 'property', name: memberName, type: member.type === undefined ? 'unknown' : flat(member.type), doc, optional, readonly }
  })
}

function heritageOf(node) {
  return (node.heritageClauses ?? []).flatMap(clause => clause.types.map(flat))
}

/** 元素类：注册的属性、声明的字段与存取器、公开方法。 */
function classMembers(file, className) {
  const { node } = declaration(file, className)
  const config = new Map()
  const properties = []
  const accessors = new Map()
  const methods = []
  for (const member of node.members) {
    const name = nameOf(member)
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword)
    if (isStatic && ts.isPropertyDeclaration(member) && name === 'properties' && member.initializer !== undefined && ts.isObjectLiteralExpression(member.initializer)) {
      for (const property of member.initializer.properties) {
        const options = {}
        if (ts.isObjectLiteralExpression(property.initializer)) {
          for (const item of property.initializer.properties)
            options[nameOf(item)] = item.initializer.getText()
        }
        config.set(nameOf(property), options)
      }
      continue
    }
    if (isStatic || ts.isPrivateIdentifier(member.name ?? member) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword) || hasModifier(member, ts.SyntaxKind.PrivateKeyword))
      continue
    if (ts.isPropertyDeclaration(member) && hasModifier(member, ts.SyntaxKind.DeclareKeyword)) {
      properties.push({ name, type: flat(member.type), doc: jsdoc(member) })
      continue
    }
    if (ts.isGetAccessorDeclaration(member)) {
      const entry = accessors.get(name) ?? { name }
      Object.assign(entry, { type: flat(member.type), doc: jsdoc(member) || entry.doc })
      accessors.set(name, entry)
      continue
    }
    if (ts.isSetAccessorDeclaration(member)) {
      const entry = accessors.get(name) ?? { name }
      Object.assign(entry, { writable: true, doc: entry.doc || jsdoc(member) })
      accessors.set(name, entry)
      continue
    }
    if (ts.isMethodDeclaration(member) && !hasModifier(member, ts.SyntaxKind.OverrideKeyword))
      methods.push({ name, signature: signature(name, member), doc: jsdoc(member) })
  }
  const attribute = (name) => {
    const options = config.get(name)
    if (options === undefined || options.attribute === 'false')
      return undefined
    if (options.attribute !== undefined)
      return options.attribute.replace(/^'|'$/g, '')
    return name.toLowerCase()
  }
  return {
    properties: properties.filter(property => config.has(property.name)).map(property => ({ ...property, attribute: attribute(property.name) })),
    accessors: [...accessors.values()],
    methods,
  }
}

/** 字符串字面量联合的取值。 */
function literalUnion(file, name) {
  const { node } = declaration(file, name)
  const type = node.type
  const members = ts.isUnionTypeNode(type) ? type.types : [type]
  return members.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal))
      throw new Error(`[gen-reference] ${name} is not a string literal union`)
    return member.literal.text
  })
}

/** 字符串数组常量的取值。 */
function stringArray(file, name) {
  const { node } = declaration(file, name)
  let initializer = node.initializer
  while (initializer !== undefined && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)))
    initializer = initializer.expression
  if (initializer === undefined || !ts.isArrayLiteralExpression(initializer))
    throw new Error(`[gen-reference] ${name} is not an array literal`)
  return initializer.elements.map(element => element.text)
}

function constantValue(file, name) {
  return flat(declaration(file, name).node.initializer)
}

function functionSignature(file, name) {
  const { node } = declaration(file, name)
  return { signature: signature(name, node), doc: jsdoc(node) }
}

// —— 渲染元素 API ——

function memberTable(members) {
  const properties = members.filter(member => member.kind === 'property')
  return table(['属性', '类型', '说明'], properties.map(member => [
    code(member.optional ? `${member.name}?` : member.name, true),
    code(member.type, true),
    cellDoc(member.doc),
  ]))
}

function methodTable(methods) {
  return table(['方法', '说明'], methods.map(method => [code(method.signature, true), cellDoc(method.doc)]))
}

function interfaceSection(file, name, level = '###', intro = '') {
  const { node } = declaration(file, name)
  const members = interfaceMembers(file, name)
  const heritage = heritageOf(node)
  const methods = members.filter(member => member.kind === 'method')
  return [
    `${level} ${name} {#${anchorOf(name)}}`,
    blockDoc(jsdoc(node)),
    intro,
    heritage.length > 0 ? `继承 ${heritage.map(item => code(item)).join('、')}。` : '',
    memberTable(members),
    methodTable(methods),
  ].filter(Boolean).join('\n\n')
}

function eventTable(file, name) {
  return table(['事件', 'detail', '说明'], interfaceMembers(file, name).map((member) => {
    const detail = /^CustomEvent<(.*)>$/.exec(member.type)?.[1] ?? member.type
    return [code(member.name, true), code(detail, true), cellDoc(member.doc)]
  }))
}

function elementSections(file, className, eventMap) {
  const { properties, accessors, methods } = classMembers(file, className)
  return [
    '### 属性',
    table(['属性', 'attribute', '类型', '说明'], properties.map(property => [
      code(property.name, true),
      property.attribute === undefined ? '—' : code(property.attribute, true),
      code(property.type, true),
      cellDoc(property.doc),
    ])),
    accessors.length > 0 ? '### 存取器' : '',
    table(['属性', '读写', '类型', '说明'], accessors.map(accessor => [
      code(accessor.name, true),
      accessor.writable ? '可读写' : '只读',
      code(accessor.type, true),
      cellDoc(accessor.doc ?? ''),
    ])),
    '### 方法',
    methodTable(methods),
    '### 事件',
    '事件都是冒泡的 `CustomEvent`。',
    eventTable(file, eventMap),
  ].filter(Boolean).join('\n\n')
}

/** 函数签名写成 TypeScript 代码块。 */
function fence(text) {
  return `\`\`\`ts\ndeclare function ${text}\n\`\`\``
}

function functionSection(file, name) {
  const { signature: text, doc } = functionSignature(file, name)
  return [`### ${name}() {#${anchorOf(name)}}`, fence(text), blockDoc(doc)].filter(Boolean).join('\n\n')
}

// —— 全部导出 ——

function resolveModule(fromFile, specifier) {
  const base = join(dirname(fromFile), specifier)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate))
      return candidate
  }
  throw new Error(`[gen-reference] cannot resolve ${specifier} from ${fromFile}`)
}

const KIND_NAMES = {
  [ts.SyntaxKind.FunctionDeclaration]: '函数',
  [ts.SyntaxKind.ClassDeclaration]: '类',
  [ts.SyntaxKind.InterfaceDeclaration]: '接口',
  [ts.SyntaxKind.TypeAliasDeclaration]: '类型',
  [ts.SyntaxKind.VariableDeclaration]: '常量',
}

/** 注释的第一句。 */
function summary(doc) {
  const first = docBlocks(doc)[0] ?? ''
  const stop = first.indexOf('。')
  return stop >= 0 ? first.slice(0, stop + 1) : first
}

/** 入口文件导出的全部名字，按来源模块分组；转导出的外部包标注来源。 */
function exportIndex(entry) {
  const groups = new Map()
  const add = (module, name, info) => {
    const list = groups.get(module) ?? []
    if (!list.some(item => item.name === name))
      list.push({ name, ...info })
    groups.set(module, list)
  }
  const describe = (file, name) => {
    const found = declarationsOf(sourceFile(file)).get(name)
    if (found === undefined)
      return { kind: '—', doc: '' }
    return { kind: KIND_NAMES[found.node.kind] ?? '—', doc: summary(jsdoc(found.node.kind === ts.SyntaxKind.VariableDeclaration ? found.statement : found.node)) }
  }
  const collect = (file, module) => {
    const source = sourceFile(file)
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier?.text
        if (specifier === undefined)
          continue
        if (!specifier.startsWith('.')) {
          for (const element of statement.exportClause?.elements ?? [])
            add(module, element.name.text, { kind: '类型', doc: `转导出自 ${specifier}` })
          continue
        }
        const target = resolveModule(file, specifier)
        const targetModule = target.slice(entry.root.length + 1).replace(/\\/g, '/').replace(/\.ts$/, '')
        if (statement.exportClause === undefined) {
          collect(target, targetModule)
          continue
        }
        for (const element of statement.exportClause.elements)
          add(targetModule, element.name.text, describe(target, (element.propertyName ?? element.name).text))
        continue
      }
      if (!isExported(statement))
        continue
      if (ts.isVariableStatement(statement)) {
        for (const item of statement.declarationList.declarations)
          add(module, item.name.getText(), { kind: '常量', doc: summary(jsdoc(statement)) })
        continue
      }
      const name = nameOf(statement)
      if (name !== '')
        add(module, name, { kind: KIND_NAMES[statement.kind] ?? '—', doc: summary(jsdoc(statement)) })
    }
  }
  collect(entry.file, entry.file.slice(entry.root.length + 1).replace(/\\/g, '/').replace(/\.ts$/, ''))
  return groups
}

function exportIndexSection(title, entry) {
  const groups = exportIndex(entry)
  const parts = [`## ${title}`]
  for (const [module, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`### ${module}`)
    parts.push(table(['名称', '种类', '说明'], items.sort((a, b) => a.name.localeCompare(b.name)).map(item => [code(item.name, true), item.kind, prose(item.doc, true)])))
  }
  return parts.join('\n\n')
}

// —— 元素参考 ——

const UNIT_NAMES = { mm: 'mm', pt: 'pt', deg: '度', ratio: '倍', count: '个' }

const COMPOSITE_KINDS = {
  textContent: '[文本内容](./schema#textcontent)',
  richTextContent: '[富文本内容](./schema#richtextcontent)',
  imageSource: '[图片来源](./schema#imagesource)',
  valueFormat: '[值格式](./schema#valueformat)',
  stroke: '[描边](./schema#stroke)',
  edges: '[四边距离](./schema#edges)',
  borderSides: '[四边边框](./schema#bordersides)',
  cellStyle: '[单元格样式](./schema#cellstyle)',
  tableColumns: '[列](#table-column)的数组',
  tableFooterRows: '[表尾行](#table-footer-row)的数组',
  pageNumberFormat: `页码模板，可用 ${code('{{$page}}')} 与 ${code('{{$pages}}')}`,
  matrixCodeLevel: '纠错级别，见 [MatrixCodeElement](./schema#matrixcodeelement)',
  paper: '[纸张](./schema#paperspec)',
  watermark: '[水印](./schema#watermark)',
  cellContent: '[单元格内容](./schema#tablecellcontent)',
  footerCellContent: '[表尾单元格内容](./schema#tablefootercellcontent)',
}

function propertyName(targetKind, key) {
  return t.propertyNames[`${targetKind}:${key}`] ?? t.propertyNames[key] ?? key
}

function optionName(key, value) {
  return t.propertyOptions[`${key}=${value}`] ?? t.propertyOptions[String(value)]
}

function describeControl(control, key) {
  switch (control.kind) {
    case 'number': {
      const range = [
        control.min === undefined ? undefined : `≥ ${control.min}`,
        control.exclusiveMin === undefined ? undefined : `> ${control.exclusiveMin}`,
        control.max === undefined ? undefined : `≤ ${control.max}`,
      ].filter(Boolean)
      const unit = UNIT_NAMES[control.unit] ?? control.unit
      return `${control.integer ? '整数' : '数值'}（${unit}）${range.length > 0 ? `，${range.join('，')}` : ''}`
    }
    case 'text':
      return '文本'
    case 'boolean':
      return '布尔'
    case 'color':
      return '[颜色](./schema#color)'
    case 'select':
      return control.options.map((option) => {
        const name = optionName(key, option.value)
        return name === undefined ? code(String(option.value), true) : `${code(String(option.value), true)} ${name}`
      }).join('、')
    case 'field':
      return control.target === 'list' ? '指向数组的字段路径' : '字段路径'
    default:
      if (COMPOSITE_KINDS[control.kind] === undefined)
        throw new Error(`[gen-reference] unknown property control kind: ${control.kind}`)
      return COMPOSITE_KINDS[control.kind]
  }
}

function describeCondition(condition, targetKind) {
  if (condition === undefined)
    return ''
  if (condition.all !== undefined)
    return condition.all.map(item => describeCondition(item, targetKind)).join('且')
  if (condition.any !== undefined)
    return condition.any.map(item => describeCondition(item, targetKind)).join('或')
  if (condition.not !== undefined)
    return `不满足「${describeCondition(condition.not, targetKind)}」`
  const key = condition.path.join('.')
  const translated = propertyName(targetKind, key)
  const name = translated === key ? code(key, true) : `「${translated}」`
  if (condition.filled === true)
    return `设置了 ${name} `
  if ('equals' in condition) {
    const value = condition.equals
    if (typeof value === 'boolean')
      return value ? `${name}打开` : `${name}关闭`
    return `${name}为 ${code(String(value), true)} `
  }
  return ''
}

function valueAt(value, path) {
  return path.reduce((current, segment) => (current === undefined || current === null ? undefined : current[segment]), value)
}

function defaultText(value) {
  if (value === undefined)
    return '—'
  const json = JSON.stringify(value)
  return json.length > 48 ? '…' : code(json, true)
}

function propertyTable(targetKind, descriptors, defaults) {
  return table(['属性', '名称', '取值', '必有', '新建时'], descriptors.map((descriptor) => {
    const key = descriptor.path.join('.')
    const condition = describeCondition(descriptor.visibleWhen, targetKind)
    return [
      code(key, true),
      propertyName(targetKind, key),
      `${describeControl(descriptor.control, key)}${condition === '' ? '' : `；${condition}时显示`}`,
      descriptor.present ? '是' : '可省',
      defaultText(valueAt(defaults, descriptor.path)),
    ]
  }))
}

function elementInterface(type) {
  return `${type[0].toUpperCase()}${type.slice(1)}Element`
}

function elementsPage() {
  const registry = core.createElementRegistry()
  const sections = []
  for (const group of registry.groupByCategory()) {
    sections.push(`## ${t.categories[group.category]}`)
    for (const prototype of group.prototypes) {
      const name = elementInterface(prototype.type)
      const facts = [
        prototype.flow ? '随内容纵向延展、可跨页续排，只能放在正文区' : '固定尺寸，可放在页眉、正文与页脚',
        `最小 ${prototype.minSize.width} × ${prototype.minSize.height} mm`,
        `新建时 ${prototype.defaults.width} × ${prototype.defaults.height} mm`,
        `类型 [${name}](./schema#${anchorOf(name)})`,
      ]
      sections.push(`### ${t.elements[prototype.type]} ${code(prototype.type)} {#${prototype.type.toLowerCase()}}`)
      sections.push(`${facts.join(' · ')}。`)
      sections.push(propertyTable(prototype.type, prototype.properties, prototype.defaults))
    }
  }

  const presets = table(['预设名', '宽 × 高（mm，纵向）'], Object.entries(PAPER_PRESETS).map(([preset, size]) => [code(preset, true), `${size.width} × ${size.height}`]))
  const table0 = registry.get('table').defaults
  const parts = [
    ['列', 'table-column', core.tableColumnProperties(), table0.columns[0]],
    ['表头', 'table-header', core.tableHeaderProperties(), table0.header],
    ['表体', 'table-body', core.tableBodyProperties(), table0.body],
    ['表尾行', 'table-footer-row', core.tableFooterRowProperties(), undefined],
    ['表尾单元格', 'table-footer-cell', core.tableFooterCellProperties(), undefined],
  ]
  return page('元素', [
    '内置元素按物料面板的分组列出。属性路径相对元素，嵌套属性用点连接；「名称」是属性面板里的中文名，「新建时」是在设计器里新建元素时的取值，过长的值以 … 代替，详见各元素的类型。',
    '每个元素还有共有字段 `id`、`type`、`name`、`x`、`y`、`width`、`height`、`locked`、`previewOnly`、`meta`，见 [ElementBase](./schema#elementbase)。坐标相对纸张左上角，长度单位为 mm，字号与字间距单位为 pt。',
  ].join('\n\n'), [
    ...sections,
    '## 页面设置 {#page}',
    '没有选中元素时，属性面板编辑当前页面模板。属性路径相对页面模板，见 [PrintPage](./schema#printpage)。',
    propertyTable('page', core.pageProperties(), undefined),
    '纸张预设：',
    presets,
    '## 表格部位 {#table-parts}',
    '双击表格进入表格编辑态后，可以分别选中列、表头、表体、表尾行与表尾单元格编辑。属性路径相对该部位。',
    ...parts.flatMap(([title, kind, descriptors, defaults]) => [
      `### ${title} {#${kind}}`,
      propertyTable(kind, descriptors, defaults),
    ]),
  ])
}

// —— 模板类型 ——

const SCHEMA_FILES = [
  ['文档与页面', 'document.ts'],
  ['元素', 'elements.ts'],
  ['表格', 'table.ts'],
  ['通用类型', 'common.ts'],
  ['取值', 'options.ts'],
]

function schemaNames() {
  const names = new Set()
  for (const [, file] of SCHEMA_FILES) {
    for (const [name, found] of declarationsOf(sourceFile(packageSource('core', 'src', 'schema', file)))) {
      if (found.exported && (ts.isInterfaceDeclaration(found.node) || ts.isTypeAliasDeclaration(found.node)))
        names.add(name)
    }
  }
  return names
}

/** 类型文字里出现的本页类型名换成页内链接。 */
function linkedType(text, names) {
  const html = escapeHtml(text).replace(/\|/g, '&#124;').replace(/\b[A-Z]\w*\b/g, word => (names.has(word) ? `<a href="#${anchorOf(word)}">${word}</a>` : word))
  return `<code>${html}</code>`
}

function enumValues(name) {
  const registry = core.createElementRegistry()
  const optionsOf = (type, key) => registry.get(type).properties.find(item => item.path.join('.') === key).control.options.map(option => option.value)
  if (name === 'BarCodeFormat')
    return { values: optionsOf('barCode', 'format'), key: 'format' }
  if (name === 'MatrixCodeFormat')
    return { values: optionsOf('matrixCode', 'format'), key: 'format' }
  return undefined
}

function schemaPage() {
  const names = schemaNames()
  const sections = []
  for (const [title, file] of SCHEMA_FILES) {
    const path = packageSource('core', 'src', 'schema', file)
    const source = sourceFile(path)
    sections.push(`## ${title}`)
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
        for (const element of statement.exportClause?.elements ?? []) {
          const name = element.name.text
          const known = enumValues(name)
          sections.push(`### ${name} {#${anchorOf(name)}}`)
          sections.push(known === undefined
            ? `转导出自 ${code(statement.moduleSpecifier.text)}，取值随元素说明。`
            : `转导出自 ${code(statement.moduleSpecifier.text)}。取值：${known.values.map(value => code(String(value))).join('、')}。`)
        }
        continue
      }
      if (!isExported(statement))
        continue
      if (ts.isInterfaceDeclaration(statement)) {
        const name = nameOf(statement)
        const members = interfaceMembers(path, name)
        const heritage = heritageOf(statement)
        sections.push([
          `### ${name} {#${anchorOf(name)}}`,
          blockDoc(jsdoc(statement)),
          heritage.length > 0 ? `继承 ${heritage.map(item => linkedType(item, names)).join('、')} 的字段。` : '',
          table(['字段', '类型', '必填', '说明'], members.map(member => [
            code(member.name, true),
            member.kind === 'method' ? code(member.signature, true) : linkedType(member.type, names),
            member.optional ? '可省' : '是',
            cellDoc(member.doc),
          ])),
        ].filter(Boolean).join('\n\n'))
        continue
      }
      if (ts.isTypeAliasDeclaration(statement)) {
        const name = nameOf(statement)
        const type = statement.type
        const parts = [`### ${name} {#${anchorOf(name)}}`, blockDoc(jsdoc(statement))]
        const fromConst = /^\(typeof (\w+)\)\[number\]$/.exec(flat(type))
        if (fromConst !== null) {
          const values = core[fromConst[1]]
          const named = value => (fromConst[1] === 'PAGE_BAND_VARIANTS' ? t.bandVariants[value] : optionName('', value)) ?? '—'
          parts.push(`取值见常量 ${code(fromConst[1])}：`)
          parts.push(table(['取值', '中文名'], values.map(value => [code(String(value), true), named(value)])))
        }
        else if (ts.isUnionTypeNode(type) && type.types.every(item => ts.isTypeReferenceNode(item))) {
          parts.push(`取其一：${type.types.map(item => linkedType(flat(item), names)).join('、')}。`)
        }
        else {
          parts.push(`类型：${linkedType(flat(type), names)}`)
        }
        sections.push(parts.filter(Boolean).join('\n\n'))
      }
    }
  }
  const version = constantValue(packageSource('core', 'src', 'schema', 'document.ts'), 'PRINT_SCHEMA_VERSION')
  return page('模板类型', [
    `模板文档 ${code('PrintDocument')} 的全部类型，按 ${code('@xihan-print/core')} 的源码列出。当前 schema 版本 ${code('PRINT_SCHEMA_VERSION')} 为 ${code(version)}。`,
    '长度单位为 mm，字号与字间距单位为 pt，角度单位为度；颜色写作 `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA` 或 `transparent`。',
  ].join('\n\n'), sections)
}

// —— 问题码 ——

/** 按问题码生成中文说明：参数写成 {名}，数字类参数显示为 …；返回说明与用到的参数名。 */
function sampleIssue(code) {
  const keys = []
  const params = new Proxy({}, {
    get(_, key) {
      if (typeof key !== 'string')
        return undefined
      if (!keys.includes(key))
        keys.push(key)
      return `{${key}}`
    },
  })
  return { text: t.issue({ code, path: [], params }).replace(/NaN/g, '…'), keys }
}

const SEVERITY_NAMES = { error: '错误', warning: '警告' }

function issueTable(severities) {
  return table(['问题码', '严重程度', '说明', '参数'], Object.entries(severities).map(([issueCode, severity]) => {
    const { text, keys } = sampleIssue(issueCode)
    return [code(issueCode, true), SEVERITY_NAMES[severity] ?? severity, prose(text, true), keys.map(key => code(key, true)).join('、') || '—']
  }))
}

function issuesPage() {
  const layoutTypes = packageSource('core', 'src', 'layout', 'types.ts')
  const runtimeOptions = packageSource('runtime', 'src', 'options.ts')
  return page('问题码与诊断', [
    '校验问题由 `validateDocument` 与设计器的问题列表给出，分页诊断随分页结果一起给出。问题都不带文案，只有问题码、严重程度、路径与参数；下表的说明来自中文语言包 `printZhCN`，其中的 {名} 是参数，实际文案只含问题给出的参数。',
  ].join('\n\n'), [
    '## 校验问题',
    '有错误级问题的模板不能分页：`paginate` 抛出 `PrintLayoutError`（码为 `document.invalid`），预览元素派发 `pagination-error`。警告不影响分页。',
    issueTable(core.VALIDATION_ISSUE_SEVERITIES),
    '## 分页诊断',
    '分页诊断不打断分页：错误表示按模板该画的内容没有画出或输出页被截断，警告表示内容画出了但与设计有出入。同一位置的同一问题只报告一次。',
    issueTable(core.PAGINATION_DIAGNOSTIC_SEVERITIES),
    '## 分页与打印失败',
    blockDoc(jsdoc(declaration(layoutTypes, 'PrintLayoutErrorCode').node)),
    `${code('PrintLayoutError')} 的码：${literalUnion(layoutTypes, 'PrintLayoutErrorCode').map(item => code(item)).join('、')}。`,
    blockDoc(jsdoc(declaration(runtimeOptions, 'PrintRuntimeErrorCode').node)),
    `${code('PrintRuntimeError')} 的码：${literalUnion(runtimeOptions, 'PrintRuntimeErrorCode').map(item => code(item)).join('、')}。`,
  ])
}

// —— 预览与打印 ——

function runtimePage() {
  const preview = packageSource('runtime', 'src', 'print-preview.ts')
  const print = packageSource('runtime', 'src', 'print.ts')
  const options = packageSource('runtime', 'src', 'options.ts')
  const translations = packageSource('runtime', 'src', 'translations.ts')
  const sheets = packageSource('runtime', 'src', 'render', 'sheets.ts')
  const root = packageSource('runtime', 'src')
  return page('预览与打印', `${code('@xihan-print/runtime')} 的公开接口：预览元素、直接打印的函数与相关类型。样式在 ${code('@xihan-print/runtime/style.css')}。`, [
    `## ${code('<xh-print-preview>')}`,
    blockDoc(functionSignature(preview, 'definePrintPreview').doc),
    elementSections(preview, 'XhPrintPreview', 'PrintPreviewEventMap'),
    '## 函数',
    functionSection(print, 'printDocument'),
    functionSection(print, 'printSheets'),
    functionSection(preview, 'definePrintPreview'),
    functionSection(sheets, 'renderSheets'),
    '## 类型',
    interfaceSection(options, 'PrintRenderOptions'),
    interfaceSection(print, 'PrintOptions'),
    interfaceSection(print, 'PrintSheetsOptions'),
    interfaceSection(print, 'PrintOutcome'),
    interfaceSection(preview, 'PrintPreviewPrintOptions'),
    interfaceSection(preview, 'PaginationErrorDetail'),
    interfaceSection(translations, 'PrintPreviewTranslations'),
    exportIndexSection('全部导出', { root, file: join(root, 'index.ts') }),
    exportIndexSection(`${code('@xihan-print/runtime/locale')} 的导出`, { root, file: join(root, 'locale.ts') }),
  ])
}

// —— 设计器 ——

function designerPage() {
  const designer = packageSource('designer', 'src', 'print-designer.ts')
  const editor = packageSource('designer', 'src', 'editor.ts')
  const translations = packageSource('runtime', 'src', 'translations.ts')
  const root = packageSource('designer', 'src')
  return page('设计器', `${code('@xihan-print/designer')} 的公开接口。样式在 ${code('@xihan-print/designer/style.css')}，还要同时引入 ${code('@xihan-ui/designer-shell/style.css')} 与 ${code('@xihan-print/runtime/style.css')}。`, [
    `## ${code('<xh-print-designer>')}`,
    blockDoc(functionSignature(designer, 'definePrintDesigner').doc),
    elementSections(designer, 'XhPrintDesigner', 'PrintDesignerEventMap'),
    '## 类型',
    `### PrintDesignerMode {#printdesignermode}\n\n${blockDoc(jsdoc(declaration(designer, 'PrintDesignerMode').node))}取值：${literalUnion(designer, 'PrintDesignerMode').map(item => code(item)).join('、')}。`,
    `### PrintSchemaChangeKind {#printschemachangekind}\n\n${blockDoc(jsdoc(declaration(designer, 'PrintSchemaChangeKind').node))}取值：${literalUnion(designer, 'PrintSchemaChangeKind').map(item => code(item)).join('、')}。`,
    interfaceSection(editor, 'PrintSelection'),
    `### PrintTablePart {#printtablepart}\n\n${blockDoc(jsdoc(declaration(editor, 'PrintTablePart').node))}\n\n${code(flat(declaration(editor, 'PrintTablePart').node.type))}`,
    interfaceSection(editor, 'PrintClipboard'),
    interfaceSection(translations, 'PrintDesignerTranslations', '###', `文案键是 ${code('xh-print-designer')}，中文在 ${code('@xihan-print/runtime/locale')} 的 ${code('printZhCN')} 里。`),
    '## 编辑模型',
    `设计器内部的编辑模型也一并导出，不显示界面、只想按操作改模板时可以直接用。${blockDoc(functionSignature(editor, 'createPrintEditor').doc)}`,
    fence(functionSignature(editor, 'createPrintEditor').signature),
    interfaceSection(editor, 'PrintEditorOptions'),
    interfaceSection(editor, 'PrintEditor'),
    exportIndexSection('全部导出', { root, file: join(root, 'index.ts') }),
  ])
}

// —— 打印客户端 SDK ——

/** C# 常量的 XML 注释：错误码到说明。 */
function csharpCodes(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim())
  const codes = new Map()
  lines.forEach((line, index) => {
    const constant = /^public const string \w+ = "([A-Z_]+)";$/.exec(line)
    if (constant !== null && lines[index - 1] === '/// </summary>' && lines[index - 3] === '/// <summary>')
      codes.set(constant[1], lines[index - 2].replace(/^\/\/\/ /, ''))
  })
  return codes
}

function clientPage() {
  const client = packageSource('runtime', 'src', 'client', 'client.ts')
  const protocol = packageSource('runtime', 'src', 'client', 'protocol.ts')
  const errors = packageSource('runtime', 'src', 'client', 'errors.ts')
  const fallback = packageSource('runtime', 'src', 'client', 'fallback.ts')
  const documentFile = packageSource('runtime', 'src', 'client', 'document.ts')
  const root = packageSource('runtime', 'src')
  const clientCodes = csharpCodes(join(repoDir, 'client', 'src', 'XiHan.PrintClient.Core', 'Protocol', 'PrintErrorCodes.cs'))
  const fallbackCodes = stringArray(errors, 'FALLBACK_CODES')
  const sdkDoc = jsdoc(declaration(protocol, 'SdkErrorCode').node)
  const sdkCodes = new Map([...sdkDoc.matchAll(/^- (\w+)：(.+?)[；。]?$/gm)].map(match => [match[1], match[2]]))
  const codeRows = [
    ...literalUnion(protocol, 'SdkErrorCode').map(item => [item, 'SDK', sdkCodes.get(item)]),
    ...literalUnion(protocol, 'ClientErrorCode').map(item => [item, '客户端', clientCodes.get(item)]),
  ]
  for (const [item, , doc] of codeRows) {
    if (doc === undefined)
      throw new Error(`[gen-reference] no description for error code ${item}`)
  }
  const constants = ['DEFAULT_PORTS', 'SUB_PROTOCOL', 'PROTOCOL_VERSION', 'PROTOCOL_MINOR'].map((name) => {
    const { statement } = declaration(protocol, name)
    return [code(name, true), code(constantValue(protocol, name), true), cellDoc(jsdoc(statement))]
  })
  return page('打印客户端 SDK', `${code('@xihan-print/runtime/client')} 连接本地打印客户端：静默打印、写原始指令、导出 PDF、查打印机。这个子入口单独打包，不用客户端的页面不会加载它。`, [
    '## 创建连接',
    functionSection(client, 'createPrintClient'),
    interfaceSection(client, 'PrintClientOptions'),
    interfaceSection(client, 'PrintClient'),
    interfaceSection(client, 'PrintClientJob'),
    interfaceSection(client, 'PrintClientEventMap', '###', `用 ${code('client.on(type, listener)')} 订阅。连接状态 ${code('PrintClientState')} 取 ${literalUnion(client, 'PrintClientState').map(item => code(item)).join('、')}。`),
    '## 退回浏览器打印',
    functionSection(fallback, 'printWithFallback'),
    interfaceSection(fallback, 'PrintWithFallbackOptions'),
    interfaceSection(fallback, 'PrintWithFallbackOutcome'),
    functionSection(errors, 'shouldFallBack'),
    '## 错误码',
    `出错时抛出或以 ${code('PrintClientError')} 拒绝，${code('code')} 为下表之一，${code('details')} 带补充信息。「SDK」一栏的码在浏览器里产生，其余由客户端给出。`,
    table(['错误码', '出自', '说明', '退回浏览器打印'], codeRows.map(([item, origin, doc]) => [code(item, true), origin, prose(doc, true), fallbackCodes.includes(item) ? '是' : '否'])),
    '## 打印选项与结果',
    interfaceSection(protocol, 'ClientPrintOptions'),
    interfaceSection(client, 'PrintClientDocumentOptions'),
    interfaceSection(client, 'PrintRawOptions'),
    interfaceSection(protocol, 'JobStatus', '###', `任务状态 ${code('JobState')} 取 ${literalUnion(protocol, 'JobState').map(item => code(item)).join('、')}。`),
    '## 打印机与客户端信息',
    interfaceSection(protocol, 'PrinterInfo', '###', `打印机状态 ${code('PrinterState')} 取 ${literalUnion(protocol, 'PrinterState').map(item => code(item)).join('、')}。`),
    interfaceSection(protocol, 'PrinterCapabilities'),
    interfaceSection(protocol, 'PaperInfo'),
    interfaceSection(protocol, 'ClientWelcome'),
    interfaceSection(protocol, 'ClientInfo'),
    interfaceSection(protocol, 'ClientCapabilities'),
    '## 交给客户端的文档',
    functionSection(documentFile, 'buildClientDocument'),
    interfaceSection(documentFile, 'ClientDocumentOptions'),
    interfaceSection(protocol, 'ClientDocument'),
    interfaceSection(protocol, 'ClientResource'),
    interfaceSection(protocol, 'ClientSheetGroup'),
    '## 常量',
    table(['名称', '值', '说明'], constants),
    exportIndexSection('全部导出', { root, file: join(root, 'client', 'index.ts') }),
  ])
}

// —— 模型层 ——

function corePage() {
  const root = packageSource('core', 'src')
  return page('模型层 core', `${code('@xihan-print/core')} 是纯 TypeScript 的模型层：模板类型、校验、编辑操作、元素登记表与分页算法，不依赖 DOM，浏览器、Node.js 与其它 JavaScript 运行环境里都能用。模板类型的字段见[模板类型](./schema)，元素属性见[元素](./elements)。下表按源码模块列出全部导出。`, [
    exportIndexSection('全部导出', { root, file: join(root, 'index.ts') }),
  ])
}

// —— 输出 ——

const pages = {
  'reference/elements.md': elementsPage(),
  'reference/schema.md': schemaPage(),
  'reference/issues.md': issuesPage(),
  'reference/runtime.md': runtimePage(),
  'reference/designer.md': designerPage(),
  'reference/client.md': clientPage(),
  'reference/core.md': corePage(),
}

const stale = []
for (const [relative, content] of Object.entries(pages)) {
  const target = join(docsDir, relative)
  const current = existsSync(target) ? await readFile(target, 'utf8') : undefined
  if (current === content)
    continue
  stale.push(relative)
  if (!checkOnly) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

if (checkOnly && stale.length > 0) {
  console.error(`参考页与源码不一致，在 docs/ 运行 pnpm gen 重新生成：\n${stale.map(item => `  ${item}`).join('\n')}`)
  process.exit(1)
}
console.log(stale.length === 0 ? '参考页已是最新' : `已生成：${stale.join('、')}`)
