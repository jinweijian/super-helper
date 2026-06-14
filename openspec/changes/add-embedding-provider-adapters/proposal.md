## Why

当前知识库检索仍以本地关键词检索为主。用户计划先用 MiniMax embedding，次选 Gemini，后续有条件再接千问；如果直接把某一家 API 写进知识库索引，会导致后续切换模型、重建向量、校验维度和管理 secret 都变得脆弱。

本 change 新增 embedding provider adapter 抽象，让文档向量化、查询向量化、向量索引 metadata、模型一致性检查和后续 provider 扩展有稳定边界。

## What Changes

- 新增 embedding provider adapter 能力：
  - 定义统一 `EmbeddingProvider` 接口，支持 document embedding、query embedding、batch、dimensions、distance metric、usage、错误归一化。
  - 首选实现 MiniMax provider；预留 Gemini provider；预留千问/Qwen provider。
  - Agent 模型 provider 与 embedding provider 分离配置，允许 Agent 用 MiniMax，同时 embedding 后续切 Gemini 或千问。
- 新增 embedding 配置：
  - 在 `SuperHelperConfig` 中增加 `embedding` 配置，不复用 `models.providers`。
  - 支持 provider、model、dimensions、distance、batchSize、timeoutMs、apiKey/apiKeyEnv、baseUrl 等字段。
  - 默认不启用远程 embedding，避免无意付费调用。
- 新增向量索引 metadata 契约：
  - 每条向量必须记录 provider、model、dimensions、distance、content_hash、source document/chunk id、created_at。
  - 文档向量和查询向量必须使用同一 provider/model/dimensions/distance 配置。
  - 配置变化时必须标记 vector index dirty 或拒绝混用旧向量。
- 新增 embedding CLI / service 边界：
  - 提供本地配置检查、provider smoke test、文档向量构建入口。
  - 真实远程调用命令必须显式启用，不进入普通 `pnpm test`。
- 新增测试与文档：
  - 使用 fake provider 覆盖 adapter contract、batch、错误、维度校验、配置切换、索引 metadata。
  - 文档说明 MiniMax 当前优先、Gemini 次选、千问预留，以及换模型必须重建向量索引。

## Capabilities

### New Capabilities

- `embedding-provider-adapters`: embedding provider 抽象、配置、MiniMax/Gemini/Qwen adapter 边界、向量 metadata、一致性校验、CLI 验证与知识库集成约束。

### Modified Capabilities

- None. 当前仓库没有归档到 `openspec/specs/` 的主线 spec；本 change 新增 embedding adapter capability，不修改已归档 spec。

## Impact

- 预计影响模块：
  - `src/embedding/`: 新增 embedding provider 接口、factory、MiniMax adapter、Gemini/Qwen 预留 adapter、fake provider、错误类型。
  - `src/config.ts`: 新增 embedding 配置和默认值；保持 agent model provider 配置兼容。
  - `src/knowledge/`: 后续向量索引 metadata、dirty flag、vector build 入口和知识 chunk 到 embedding input 的转换。
  - `src/cli.ts`: 新增 `embedding` 或 `knowledge vector` 相关命令入口；CLI 只解析参数，不承载 provider 业务逻辑。
  - `docs/`: 更新 embedding 配置、模型切换、重建索引、secret 管理和验收命令说明。
  - `test/`: 新增 adapter contract、config、metadata、一致性校验和 CLI smoke 测试。
- 不计划在本 change 中实现 BM25、hybrid/RRF、reranker、GraphRAG 或外部向量数据库。
- 不计划让 embedding provider 参与最终用户回复；它只生成向量和检索派生数据。
- 不改变现有 HTTP response shape；如需 settings API 展示 embedding 配置，必须通过可选字段并加兼容测试。
