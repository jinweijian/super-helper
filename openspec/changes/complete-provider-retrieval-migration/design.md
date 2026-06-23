## Context

`refactor-retrieval-providers-cli-architecture` 已创建目标目录并把任务标记为完成，但当前真实依赖仍有三处穿透：

- `src/providers/embedding/siliconflow/adapter.ts` 和 `fake.ts` 只 re-export `src/embedding/` 内的实现。
- embedding factory 从 `src/embedding/` 导入 Gemini、MiniMax、Qwen scaffold。
- `searchKnowledgeWithConfiguredRetrieval` 在 provider 关闭时直接调用 knowledge keyword search，在开启时调用 `legacy-rag`；默认 registry 中的 BM25 没有进入生产路径。

本 change 是后续修复，不改写历史 change。实施时以当前模块规范和本 change 的真实调用链验收为准。

## Goals / Non-Goals

**Goals:**

- 使 `src/providers/embedding/` 成为 embedding contract、factory、fake、metadata 和所有厂商 adapter/scaffold 的唯一实现目录。
- 使 configured runtime retrieval 始终通过 registry/service，并以 BM25 为默认 lexical recall。
- 保留 embedding、rerank、retrieval、knowledge 的旧公开导出和可观察行为。
- 对 adapter 不可用、召回失败、rerank 失败、脏或不兼容 vector artifact 提供可观测且不泄密的降级。
- 增加能识别反向依赖和生产路径绕行的边界测试。

**Non-Goals:**

- 不实现 Gemini、MiniMax、Qwen 的真实 HTTP adapter。
- 不改变 provider 配置字段、默认模型、排序参数、HTTP response、CLI 输出、case JSON 或 knowledge artifact。
- 不移除旧 `src/embedding/` 或旧 `searchKnowledgeWithRag` public symbol；清理调用方属于下一 change。
- 不运行默认联网测试，不要求真实 SiliconFlow 凭证。

## Decisions

### 1. Provider 真实实现只存在于 `src/providers/`

SiliconFlow embedding 按以下所有权拆分：

- `siliconflow/endpoint.ts`：默认 base URL 和 endpoint 拼接。
- `siliconflow/protocol.ts`：request body、response DTO 校验、向量映射。
- `siliconflow/adapter.ts`：batch、timeout、HTTP 调用、错误转换和 usage 聚合。
- `fake.ts`：确定性离线 provider。
- `metadata.ts`：provider config fingerprint、维度和通用 manifest compatibility。

Gemini、MiniMax、Qwen 各自放在 `<vendor>/adapter.ts`，只实现明确的 docs-gated/unsupported 错误，不发起 fetch。factory 只选择 adapter 和校验基础配置。

`src/embedding/*.ts` 只允许 export/re-export/type export，不允许 class、function、provider request mapping 或业务流程。这样旧 import 能继续工作，但真实所有权不会倒置。

### 2. Provider 错误使用 capability-neutral contract

新 provider 实现使用 `ProviderError`、`isProviderError`、`formatProviderSafeError`。`EmbeddingProviderError` 和 embedding 命名的 helpers 继续作为兼容别名导出，避免旧调用方和测试破坏。rerank 不再创建 embedding 专属错误。

### 3. Configured retrieval 只有一条组合路径

`src/retrieval/configured-search.ts` 提供内部 `createConfiguredRetrievalService(config)`，其控制流固定为：

```text
config
  -> safe provider construction
  -> createDefaultRetrievalStrategies
       -> bm25 always registered
       -> embedding registered but disabled when unavailable
  -> createRetrievalService
       -> strategy isolation
       -> RRF fusion
       -> optional provider rerank
  -> KnowledgeEvidencePack compatibility output
```

provider factory 构造错误不会让整个 retrieval 失败；embedding strategy 以安全 reason 标记 skipped，rerank 标记 skipped。strategy 或 rerank 在执行中失败时由 retrieval service 写入 trace，BM25 已召回结果继续返回。

`searchKnowledgeWithConfiguredRetrieval` 保留返回 `KnowledgeEvidencePack`，不向公共 API 新增 trace 字段。生产路径测试通过 `createConfiguredRetrievalService` 直接检查 trace，同时通过 runtime/knowledge tests 检查兼容 evidence 行为。

### 4. Legacy RAG 只做参数适配

`legacy-rag.ts` 保留旧 `KnowledgeRagSearchQuery`，但将旧 provider 参数转换为同一个 registry/service 组合。它不得自行 hardcode keyword/embedding strategy 列表。keyword 只有在 compatibility 调用显式请求时启用；configured runtime 默认不启用 keyword。

### 5. 外部 API 与凭证边界

SiliconFlow 官方 embeddings/rerank 文档曾于 2026-06-14 在 `add-embedding-provider-adapters/implementation-notes.md` 验证：

- `https://api-docs.siliconflow.cn/docs/api/embeddings-post`
- `https://api-docs.siliconflow.cn/docs/api/rerank-post`
- embeddings：`POST https://api.siliconflow.cn/v1/embeddings`，Bearer auth，请求包含 `model`、`input`、可选 `encoding_format`/`dimensions`，响应向量位于 `data[].embedding`。
- rerank：`POST https://api.siliconflow.cn/v1/rerank`，Bearer auth，请求包含 `model`、`query`、`documents`、`top_n`、`return_documents`，响应包含结果 index 和 relevance score。

2026-06-22 再次访问上述官方站点时被 Cloudflare 403 阻断。本 change 不改变已验证协议字段，只移动现有实现；若实现过程中需要新增字段，必须暂停并重新取得官方证据。adapter 只读取已 materialize 的 `apiKey` 或环境变量，不读取 file SecretRef。

## Failure Modes

- embedding/rerank disabled：不联网；embedding strategy/rerank trace 为 skipped；BM25 正常执行。
- unsupported provider 或 invalid config：构造错误转换为安全不可用原因，不泄漏 secret；BM25 继续。
- timeout、429、5xx、malformed response、dimension mismatch：provider error 归一化；对应 strategy failed；其余召回继续。
- vector artifact 缺失、脏、provider/model/dimensions/distance 不兼容：embedding recall failed/skipped，不混用旧向量。
- 空知识库或零命中：返回空 evidence，保持现有 Evidence Judge/escalation 行为。
- rerank 返回异常 index 或空结果：保留 fusion 排序，不丢失候选。

## Privacy And Compatibility

- trace、错误、smoke test 不得包含 API key、Authorization header、原始向量、完整原始文档或完整 provider payload。
- 旧 `src/embedding/index.ts` 导出、provider factory 签名、`KnowledgeEvidencePack`、配置和 artifact shape 保持兼容。
- 默认 `pnpm test` 只使用 fake provider/fake fetch；真实 SiliconFlow smoke 必须显式设置凭证并 opt-in。

## Risks / Trade-offs

- [Risk] 移动实现可能让旧导出产生循环依赖。→ 旧目录只单向 re-export `src/providers/`，provider 永不反向 import 兼容目录。
- [Risk] 默认从 keyword 切到 BM25 会产生排序漂移。→ 保留现有 BM25 参数和 focused fixture，并用 runtime direct-answer/no-hit 测试保护可观察行为。
- [Risk] provider 构造失败被过度静默。→ trace 必须保留脱敏 reason，测试断言失败可观察且 BM25 结果仍在。
- [Risk] legacy wrapper 继续形成第二条路径。→ 源码边界测试禁止其直接创建具体 strategy，行为测试验证同一 registry/service。

## Migration Plan

1. 先增加 provider 反向依赖、configured retrieval 生产路径和 fallback 的失败测试。
2. 移动 provider 实现并保持旧 re-export，运行 provider focused tests。
3. 实现唯一 configured service 和 legacy 参数适配，运行 retrieval/runtime focused tests。
4. 增强边界测试并执行 Anti-Fake-Complete audit。
5. 运行 lint、typecheck、build、全量 test；任何失败都在本 change 内修复后再进入下一 change。

回滚时可以按 provider migration 和 retrieval migration 两组还原；两组均不涉及数据迁移或 schema 变更。

## Open Questions

无。Gemini、MiniMax、Qwen 的真实协议，以及 keyword compatibility 的最终移除，必须通过后续独立 OpenSpec 决策。
