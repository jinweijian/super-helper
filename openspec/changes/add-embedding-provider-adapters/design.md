## Context

当前系统已有两条独立能力链路：

- Agent 模型链路：`src/model.ts` 通过 `models.providers` 调用 OpenAI-compatible chat/completions，用于 preflight / review 等模型辅助判断。
- 知识库链路：`src/knowledge/` 负责 Markdown/frontmatter/source metadata、keyword chunks 和本地 evidence pack search。

embedding 不应复用 Agent 模型链路。用户计划优先使用 MiniMax embedding，次选 Gemini，后续再接千问。如果把 embedding API 写死到 `src/knowledge/indexer.ts` 或复用 `src/model.ts`，会产生几个问题：

- 文档向量和查询向量可能来自不同 provider/model/dimensions，导致检索结果不可解释。
- 换 provider 后旧向量容易被误用。
- secret、batch、timeout、错误格式和 usage 统计会散落在知识库代码里。
- 后续接 Gemini/千问时会改动核心索引逻辑。

本设计新增 `src/embedding/`，作为 embedding provider adapter 层。它只负责把文本转成向量、归一化 provider 错误、返回 metadata，不负责最终检索排序、Evidence Judge、用户回复或 HTTP 路由。

## Goals / Non-Goals

**Goals:**

- 新增统一 `EmbeddingProvider` 接口，支持 document embedding、query embedding、batch 和 provider metadata。
- 第一轮实现 MiniMax embedding adapter。
- 第一轮实现 Gemini embedding adapter 或至少完成同等 adapter contract 和 fake HTTP 测试；若真实 API 细节无法确认，必须在任务中标记需要核对官方文档后再编码。
- 为千问/Qwen 预留 adapter 文件、provider id、配置形态和测试入口，但不要求真实可调用。
- 将 Agent model provider 与 embedding provider 配置分离。
- 为向量索引定义 metadata 和一致性检查，确保同一索引内文档向量与查询向量使用同一 provider/model/dimensions/distance。
- 提供 CLI smoke test 和本地 fake provider 测试，避免普通测试产生付费网络调用。

**Non-Goals:**

- 不实现 BM25、hybrid/RRF、reranker、GraphRAG。
- 不引入外部向量数据库。
- 不要求本 change 完成向量检索排序替代现有 keyword search。
- 不让 embedding provider 调用 product Agent prompt。
- 不让 embedding provider 生成最终用户答案。
- 不把 provider secret 写入日志、报告或 knowledge artifact。

## Decisions

### 1. 新增 `src/embedding/`，不复用 `src/model.ts`

Decision:

- 新增模块：

```text
src/embedding/
  types.ts
  errors.ts
  provider.ts
  minimax.ts
  gemini.ts
  qwen.ts
  fake.ts
  metadata.ts
  index.ts
```

- `src/model.ts` 继续只处理 chat/completions。
- `src/embedding/` 只暴露 provider interface、factory、metadata helpers、错误类型和 fake provider。

Rationale:

- chat model 和 embedding model 的输入、输出、batch、维度、usage 和错误都不同。
- 分离后可以允许 Agent 用 MiniMax-M3，同时 embedding 用 MiniMax/Gemini/千问。
- 后续接向量索引时，`src/knowledge/` 只依赖 embedding public surface，不关心厂商 API 细节。

Alternatives considered:

- 复用 `ModelProviderConfig` 和 `createModelClient`。拒绝：会混淆 completion 与 embedding 的接口，也容易把 `/chat/completions` 路径写错。
- 把 provider 直接写到 `src/knowledge/indexer.ts`。拒绝：会让知识库索引和厂商 API 强耦合。

### 2. Embedding 配置独立于 Agent 模型配置

Decision:

- 在 `SuperHelperConfig` 中新增 `embedding` 节点。
- 默认 `enabled: false`，避免 `knowledge:init` 或测试无意调用远程 API。
- 典型配置：

```json
{
  "embedding": {
    "enabled": false,
    "provider": "minimax",
    "model": "embo-01",
    "baseUrl": "https://api.minimaxi.com/v1",
    "apiKeyEnv": "MINIMAX_API_KEY",
    "dimensions": 1536,
    "distance": "cosine",
    "batchSize": 16,
    "timeoutMs": 60000
  }
}
```

- Gemini 示例配置使用 provider `gemini`，模型名和 endpoint 必须通过配置提供，不在核心代码中作为不可变常量。
- Qwen 示例配置使用 provider `qwen`，第一轮可以只保留 unsupported adapter scaffold。

Rationale:

- provider/model/dimensions 是向量索引兼容性的一部分，不能从 Agent 模型配置推断。
- 默认关闭可以保护本地测试和用户成本。

Alternatives considered:

- 复用 `models.providers` 增加 `kind: embedding`。暂不采用：当前 `models.providers` 已是 Agent 模型配置，混入后会增加 settings UI 和 runtime 选择复杂度。

### 3. Provider interface 使用 query/document 分离

Decision:

接口应表达 document embedding 和 query embedding 的差异：

```ts
export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;

  embedDocuments(input: EmbeddingDocumentInput[], options?: EmbeddingRequestOptions): Promise<EmbeddingBatchResult>;
  embedQuery(input: EmbeddingQueryInput, options?: EmbeddingRequestOptions): Promise<EmbeddingVectorResult>;
}
```

输入/输出必须包含：

- stable input id
- text
- optional content hash
- vector
- dimensions
- provider
- model
- usage
- raw response summary without secrets

Rationale:

- 有些 provider 支持 query/document task type 或不同 input type。接口先分开，后续不会破坏调用方。
- batch result 统一后，knowledge vector builder 可以做 retry、partial failure 和 usage 统计。

Alternatives considered:

- 只提供 `embed(texts: string[])`。拒绝：后续 query/document 优化会破坏接口。

### 4. 向量 metadata 是强契约

Decision:

每条向量记录必须包含：

```ts
{
  vector_id: string;
  source: string;
  document_id: string;
  chunk_id: string;
  text_hash: string;
  provider: 'minimax' | 'gemini' | 'qwen' | 'fake';
  model: string;
  dimensions: number;
  distance: 'cosine' | 'dot' | 'euclidean';
  vector: number[];
  created_at: string;
}
```

索引 manifest 还必须记录：

```ts
{
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  source_chunk_manifest_hash: string;
  vector_count: number;
  generated_at: string;
}
```

Rationale:

- 同一向量空间内混用 provider/model/dimensions 会产生不可解释结果。
- 换模型后必须能检测旧向量并要求重建。

Alternatives considered:

- 只在全局配置里记录 provider/model。拒绝：配置会变，历史向量需要自描述。

### 5. 一致性检查先于查询

Decision:

- 查询 embedding 前必须读取 vector manifest。
- 如果 manifest provider/model/dimensions/distance 与当前配置不一致，系统不得使用旧向量。
- 处理策略：
  - CLI build：提示需要重建并可覆盖。
  - search/runtime：降级到 keyword search，并记录 vector index mismatch。
  - acceptance：将 mismatch 记为失败或 warning，取决于命令模式。

Rationale:

- 错误地混用向量比没有向量更危险，会制造看似高分但不可解释的召回。

### 6. 远程调用必须可测试、可限流、可脱敏

Decision:

- provider 使用 native `fetch` 和 `AbortController`，不新增依赖，除非后续 provider SDK 明确必要。
- 所有 provider adapter 支持 timeout、batch size 和 bounded retry。
- 错误统一为 `EmbeddingProviderError`，包含 provider、status、retryable、safeMessage，不包含 secret。
- 普通单测只用 fake provider 或 fake fetch，不访问网络。
- 真实 provider smoke test 必须由显式 CLI 命令触发。

Rationale:

- 当前项目无运行时 HTTP 客户端依赖，Node >= 20 已有 fetch。
- 测试稳定性和成本优先。

### 7. Knowledge 集成先做 vector artifact，不替代 keyword search

Decision:

- 第一阶段只新增 vector artifact 生成和 metadata 校验。
- 建议路径：

```text
knowledge/indexes/vectors.jsonl
knowledge/indexes/vector-manifest.json
```

- `knowledge update` 默认不调用远程 embedding；新增显式命令或 flag，例如：

```bash
super-helper knowledge vector build --workspace <path>
super-helper embedding test --provider minimax
```

- 后续 hybrid retrieval change 再决定如何把 vector scores 融合到 evidence pack。

Rationale:

- 当前用户仍在研究多路召回，embedding adapter 不应该提前定义 hybrid 检索策略。
- 先把 provider 和 vector artifact 做稳，后续检索改造风险更低。

## Risks / Trade-offs

- [Risk] MiniMax/Gemini API endpoint 或响应格式变化。 -> Mitigation: 任务要求编码前核对官方文档；adapter 测试用 fake HTTP 固定 contract，真实 smoke test 独立运行。
- [Risk] 维度配置错误导致索引不可用。 -> Mitigation: provider 返回维度必须与配置校验，不一致即失败。
- [Risk] embedding 远程调用泄露敏感知识文本。 -> Mitigation: 默认 disabled；文档要求 restricted 文档策略；日志禁止输出原文和 secret。
- [Risk] 向量索引体积变大。 -> Mitigation: vectors.jsonl 为派生文件，可删除重建；第一阶段不引入外部 DB。
- [Risk] provider adapter 抽象过度。 -> Mitigation: 只定义 query/document/batch/metadata/error 最小接口，不做复杂插件系统。
- [Risk] 普通测试触发付费调用。 -> Mitigation: 单测只使用 fake provider；真实调用必须显式 CLI flag。

## Migration Plan

Phase 1: 配置和类型

- 新增 `embedding` 配置结构，默认 disabled。
- 新增 `src/embedding/types.ts`、`errors.ts`、`provider.ts`、`fake.ts`。
- 不影响现有 `models.providers` 和 Agent 模型选择。

Phase 2: Provider adapters

- 实现 MiniMax adapter。
- 实现 Gemini adapter 或完成 adapter scaffold 并标记需要官方 API 确认的任务。
- 新增 Qwen scaffold，返回明确 unsupported error，避免误以为已可用。

Phase 3: Vector metadata artifacts

- 新增 vector manifest 和 vector JSONL 类型。
- 从现有 `chunks.jsonl` 构造 embedding inputs。
- 实现 vector build 命令，默认显式执行。

Phase 4: Consistency and CLI

- 实现 vector index compatibility check。
- 实现 `embedding test` 或 `knowledge vector build` CLI。
- 增加 redaction、timeout、batch、error tests。

Phase 5: Documentation and acceptance

- 文档说明 MiniMax/Gemini/Qwen 配置、换模型重建、restricted 文档策略、真实 smoke test。
- 本机 acceptance 记录 provider、model、dimensions、vector count，不保存 secret 或完整原文。

Rollback strategy:

- `embedding.enabled` 设为 false 后系统应回到 keyword-only search。
- 删除 `knowledge/indexes/vectors.jsonl` 和 `vector-manifest.json` 后可从 chunks 重建。
- Agent model 配置不受 embedding 配置影响。

## Open Questions

- MiniMax embedding 的默认模型名、维度和 endpoint 需要实现前按官方文档确认，不能只依赖历史记忆。
- Gemini embedding 的默认模型名、维度和 endpoint 需要实现前按官方文档确认。
- restricted 文档是否允许发送到远程 embedding API，需要后续产品策略明确；第一版至少要支持跳过 restricted 文档。
- Qwen adapter 是只保留 scaffold，还是在本 change 一并实现真实调用，取决于用户后续是否准备好 API key 和选型。
