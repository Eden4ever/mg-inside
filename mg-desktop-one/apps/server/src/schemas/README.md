# OpenAPI 文档校验来源

`openapi-3.1.json` 固定取自 [OpenAPI 官方 Schema 2025-09-15](https://spec.openapis.org/oas/3.1/schema/2025-09-15)，用于 OpenAPI 3.1 文档结构校验；本平台锁定接受 `3.1.1`。原文件未改写，运行时不下载 Schema。

该官方 Schema 明确不校验 Schema Object 内部。`service-contracts.ts` 使用 [Ajv 的 JSON Schema 2020-12 实现](https://ajv.js.org/json-schema.html) 独立编译全部参数、请求正文、响应和公共数据结构。本平台固定使用 2020-12 方言，拒绝外部 `$ref`、嵌套 `$id` 与动态引用，限制大小、节点数和深度。相对引用仅允许完整文档内的 `components`。

官方文档 Schema 的 `#meta` 动态引用在本配置中没有扩展或覆盖。由于 Ajv 对嵌套动态锚点的解析会将此引用错误落到参数或响应对象，编译前将这几个引用显式绑定到原 `#/$defs/schema`；不删除文档结构约束。Schema Object 仍单独经过 Ajv 校验。真实提供方 HTTP 验证、错误文档及错误数据结构测试覆盖此处理。

Ajv 8.20.0 与 ajv-formats 3.0.1 已锁定并打入服务端单文件产物，部署无需临时安装依赖。
