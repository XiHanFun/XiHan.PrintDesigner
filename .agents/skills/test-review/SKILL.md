---
name: xihan-print-test-review
description: 审查 XiHan.PrintDesigner 的测试有没有价值、是否重复、是否锁定实现细节、是否需要改写时使用，覆盖 print/ 的 Vitest 用例与 client/ 的 xUnit 用例。默认只做静态审查，不新增测试、不改生产代码。
---

# XiHan.PrintDesigner 测试审查

## 判断标准

每个用例给出「保留、改写、合并或删除」，并说明它守住的是哪条可观察的约定。

- 保留：缺陷复发时会失败，覆盖公开行为（属性、事件、方法、模板读写、分页结果、问题码、语言包）、键盘与焦点、扩展点的登记与冲突。
- 改写：只复述实现、mock 之后证明 mock、断言私有字段或内部状态名、依赖脆弱的 DOM 顺序、用固定延时碰运气。
- 合并：与相邻用例输入和断言等价，没有提供新的失败定位。
- 删除：不可能失败，或已被更清楚的用例覆盖。

## 打印的专项

- **core**：纯 TS，不碰 DOM。分页与排版用假度量器，断言输出页、行的分布与页码；校验断言问题码、严重程度与路径，不断言文案。
- **runtime / designer**：jsdom（文件头 `// @vitest-environment jsdom`）。jsdom 不认 CSS `zoom`，没有 `document.fonts`，Canvas 上下文为 null，没有真实布局；这些结果在 jsdom 里证明不了，不要写成看似通过的断言。
- 挂设计器的用例写 `autoTour = false`，否则自动引导抢焦点、拖慢到超时；引导的用例自己给画布宽高再刷新。
- 语言包：少键、多键是类型错误，用例只核关键文案落到界面上，不逐键比对。
- 外观与真实交互（光标、动画、浮层位置）不在单测里保证，靠浏览器里核对；审查时指出哪些结论只能这样验。
- **client**：xUnit v3，走 Microsoft.Testing.Platform。原始通道的集成测试要一台指向文件的「Generic / Text Only」打印机，经 `XIHAN_PRINT_TEST_PRINTER`、`XIHAN_PRINT_TEST_OUTPUT` 告知，没配时跳过，不要把跳过当成通过。

输出按风险排序，附文件与行号。用户没要求运行时以静态审查为主，不因缺测试就动代码。
