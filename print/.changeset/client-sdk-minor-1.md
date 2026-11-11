---
'@xihan-print/runtime': minor
---

**新增** 打印客户端 SDK（`@xihan-print/runtime/client`）的打印选项与 PDF 打印：

- 打印选项：新增 `pageSet`（只打奇数页或偶数页）、`orientation`（版面方向）、`scale`（内容放进版面的方式）、`paper`（都打到指定的纸张上）与 `tray`（纸盒），`<xh-print-preview>` 的 `print()` 同样可用；导出 PDF 只用 `pageRanges`、`pageSet` 与 `color`。`printer(name)` 给出的能力新增纸盒 `trays`，指定的纸盒不存在时任务以 `TRAY_NOT_FOUND` 失败。
- 打印 PDF：新增 `printPdf(pdf, options)`，把现成的 PDF（`Blob`、`ArrayBuffer` 或 `Uint8Array`）交给客户端打印，按每页的尺寸匹配纸张，打印选项与 `printSheets` 相同，另可写 `docName`；PDF 超过 64 MiB 时以 `DOCUMENT_TOO_LARGE` 失败，客户端读不出这份 PDF 时以 `PDF_INVALID` 失败。客户端能力新增 `printPdf`。
- 旧版客户端：连着的客户端是协议次版本 0 时，任务给上面的新选项取了非缺省值，或者客户端没有 `printPdf` 能力却调用了 `printPdf`，任务以 `CAPABILITY_UNSUPPORTED` 失败、不发给客户端，`details` 带 `capability`（选项名或 `printPdf`）与客户端的协议次版本 `minor`。升级打印客户端后即可使用。
