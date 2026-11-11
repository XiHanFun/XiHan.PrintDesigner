---
'@xihan-print/runtime': minor
'@xihan-print/designer': minor
---

**新增** 打印客户端 SDK（`@xihan-print/runtime/client`）支持访问密钥：`createPrintClient` 新增 `accessKey`，握手时交给客户端。客户端设了访问密钥、页面没带或带得不对时，`connect()` 以 `ACCESS_DENIED` 拒绝，不自动重连，也不退回浏览器打印；没设访问密钥的客户端照常连上。

**新增** 设计器设置里的「本地客户端」页：「测试连接」因访问密钥不对被客户端拒绝时，连接状态显示「访问密钥不对」，不再给出下载客户端的链接。
