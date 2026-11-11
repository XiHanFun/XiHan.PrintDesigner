// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 在渲染页的隔离环境里执行的检测与排版脚本，都是 callAsyncJavaScript 的函数体，结果写成 JSON 文本

/// 先找第一个引用了任务以外地址的写法，找到就立即返回；否则懒加载的图片改为立即载入，等图片载完、字体就绪，再数出输出页与没有载入成功的图片
pub(super) const READY: &str = r#"
let blocked = null;
const check = (value, base) => {
  if (blocked !== null || !value) return;
  let url;
  try {
    url = new URL(value.trim(), base || document.baseURI);
  } catch (_) {
    return;
  }
  const scheme = url.protocol;
  if (scheme === 'data:' || scheme === 'blob:' || scheme === 'about:' || scheme === 'javascript:') return;
  if (scheme === 'xihan-print:' && url.host === 'print.local') return;
  blocked = url.host ? (scheme === 'xihan-print:' ? 'https:' : scheme) + '//' + url.host : url.href.slice(0, 64);
};
const checkCss = (text, base) => {
  for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) check(match[2], base);
};
const checkSrcset = value => {
  let rest = value;
  while (rest) {
    rest = rest.replace(/^[\s,]+/, '');
    const found = rest.match(/^\S+/);
    if (!found) break;
    let candidate = found[0];
    rest = rest.slice(candidate.length);
    if (candidate.endsWith(',')) {
      candidate = candidate.replace(/,+$/, '');
    } else {
      const comma = rest.indexOf(',');
      rest = comma < 0 ? '' : rest.slice(comma + 1);
    }
    check(candidate);
  }
};
const legacyBackground = new Set(['body', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
const svgReferences = new Set(['image', 'use', 'feImage', 'feimage']);
for (const element of document.querySelectorAll('*')) {
  const tag = element.localName;
  check(element.getAttribute('src'));
  if (element.hasAttribute('srcset')) checkSrcset(element.getAttribute('srcset'));
  check(element.getAttribute('poster'));
  if (tag === 'object') check(element.getAttribute('data'));
  if (tag === 'link') check(element.getAttribute('href'));
  if (legacyBackground.has(tag)) check(element.getAttribute('background'));
  if (svgReferences.has(tag)) check(element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
  if (element.hasAttribute('style')) checkCss(element.getAttribute('style'));
}
const checkRules = (rules, base) => {
  for (const rule of rules) {
    if (rule instanceof CSSImportRule) {
      check(rule.href, base);
      if (rule.styleSheet) checkSheet(rule.styleSheet);
      continue;
    }
    if (rule.style) checkCss(rule.style.cssText, base);
    if (rule.cssRules) checkRules(rule.cssRules, base);
  }
};
const checkSheet = sheet => {
  let rules;
  try {
    rules = sheet.cssRules;
  } catch (_) {
    return;
  }
  checkRules(rules, sheet.href || document.baseURI);
};
for (const sheet of document.styleSheets) checkSheet(sheet);
if (blocked !== null) return JSON.stringify({ sheets: 0, broken: 0, blocked });

const images = Array.from(document.images);
for (const image of images) {
  if (image.getAttribute('loading') === 'lazy') image.setAttribute('loading', 'eager');
}
await Promise.all(images.map(image => image.complete ? null : new Promise(resolve => {
  image.addEventListener('load', resolve, { once: true });
  image.addEventListener('error', resolve, { once: true });
})));
await document.fonts.ready;

return JSON.stringify({
  sheets: document.querySelectorAll('[data-part="sheet"]').length,
  broken: images.filter(image => !image.complete || image.naturalWidth === 0).length,
  blocked: null,
});
"#;

/// 打印时保留背景色与背景图；grayscale 时整页转灰度
pub(super) fn prepare(grayscale: bool) -> String {
    format!(
        r#"
const root = document.documentElement.style;
root.setProperty('-webkit-print-color-adjust', 'exact');
root.setProperty('print-color-adjust', 'exact');
if ({grayscale}) root.setProperty('filter', 'grayscale(1)');
return JSON.stringify(true);
"#
    )
}

/// 只显示列出的输出页，其余隐藏；显示的输出页下边距为 -1px，不占满整页高度；最后一张显示的输出页之后不再分页。结果是显示的张数
pub(super) fn show(sheets: &[usize]) -> String {
    let list = sheets.iter().map(usize::to_string).collect::<Vec<_>>().join(",");
    format!(
        r#"
const shown = new Set([{list}]);
const last = Math.max(...shown);
let count = 0;
document.querySelectorAll('[data-part="sheet"]').forEach((sheet, index) => {{
  if (shown.has(index)) {{
    sheet.style.removeProperty('display');
    sheet.style.setProperty('margin-bottom', '-1px');
    count += 1;
  }} else {{
    sheet.style.setProperty('display', 'none');
    sheet.style.removeProperty('margin-bottom');
  }}
  if (index === last) sheet.style.setProperty('break-after', 'auto');
  else sheet.style.removeProperty('break-after');
}});
return JSON.stringify(count);
"#
    )
}
