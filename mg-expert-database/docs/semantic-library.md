# 智能语义库

导航位于指标体系下方。每个语义库绑定一个体系业务版本，权限继承来源体系。可管理用户创建、构建、删除；可查看用户检索。构建正文与检索问题均调用智谱 embedding-3，固定 1024 维，输出统一归一化；不调用聊天模型。

## 配置

系统管理员在「用户管理」下方的「模型管理」维护智谱密钥、启用状态并测试连接。首期固定 embedding-3、1024 维，不允许变更向量空间。密钥留空保留原值，不返回密钥。未在页面维护时兼容后端 `ZHIPU_API_KEY` 环境变量。

数据库密钥使用 AES-256-GCM 加密。首次保存自动生成独立 32 字节主密钥文件：开发环境为 API 工作目录 `.runtime/model-config.key`，生产环境为 `/opt/mg-expert-database/shared/model-config.key`；可通过 `MODEL_CONFIG_KEY_FILE` 指定绝对路径。文件只授予进程用户读写权限，需与数据库分别安全备份。丢失文件无法解密旧配置，必须恢复文件或重新输入 API Key。不要提交密钥或将其放入 VITE 变量。

固定端点为 `https://open.bigmodel.cn/api/paas/v4/embeddings`，禁止 HTTP 重定向。未配置或停用时不调用智谱；测试连接仅发送固定测试短句，会产生少量费用。

创建库不调用智谱。构建前确认内容外发，检索前勾选问题外发。接口均需有效登录和 CSRF，服务端重新校验来源体系权限。不要将敏感或未获准外发的数据构建到云端 Embedding。

## 数据与构建

收录当前有效模板的所有层级正文、摘要、关联依据标题和摘录；空内容不收录；停用字段、无效及已替代依据不收录。保留指标路径、字段稳定标识、模板和内容修订、依据标识。没有附件下载、全文解析或 OCR。

数据库新增 SemanticLibrary、SemanticBuild、SemanticChunk。构建采用一致性快照、持久任务队列、单任务工作者、每批 8 条。成功后原子切换；相同片段复用上一版向量。失败可重试且旧成功索引保持可用。五分钟无心跳的任务标记失败，不自动无限调用收费接口。仅保留当前成功索引和正在构建的向量，构建记录保留统计。服务关闭时构建可中断并重试。

当前 PostgreSQL 未安装 pgvector，采用 PostgreSQL double precision[] 存储，在数据库内计算精确余弦相似度，不把整库向量下载到浏览器或 API 进程。单库最多 5000 片段，检索并发上限 2（每个 API 进程）。这是有规模上限的第一版，不是 ANN 索引；扩大数据量前应压测并迁移到 pgvector。当前只做向量召回，未加入关键词混合检索、重排序或聊天生成。

原内容变动后手动更新，详情显示待同步。每次检索以当前有效内容哈希过滤旧索引，变更、删除、停用的旧片段不会作为最新原文返回。结果展示相关度而非可信度，可跳转原指标。正文普通查看仍走原接口，不调用智谱。

## 发布与验证

迁移目录：20260907004000_semantic_library。先测试、备份数据库，再执行 prisma migrate deploy 和 generate；不执行 seed。当前实现未发布生产。

API：GET/POST /api/semantic-libraries；GET/DELETE /api/semantic-libraries/:id；POST /api/semantic-libraries/:id/build（consent=true）；POST /api/semantic-libraries/:id/search（query、consent=true）。

自动测试使用替身向量接口，无云端消费；真实密钥配置后需使用可外发的少量示例内容验证调用、维度、用量、召回和端到端时延，再构建生产内容。

参考：https://docs.bigmodel.cn/api-reference/模型-api/文本嵌入
