## Why

在直答安全门禁建立后，当前中文 BM25 的“整段 + 单字集合”分词、parent 与 child 一对一、taxonomy 缺失和向量过滤不完整仍会导致召回与排序不稳定。现有 legacy active 语料还包含大量 provenance 和多主题质量问题，不能直接作为高置信知识继续使用。

需要在不引入外部向量数据库的前提下，建立可解释的中文字段加权 BM25、真正的 Parent-Child Retrieval、SiliconFlow Hybrid/Rerank 和可审计语料迁移。

## What Changes

- 使用业务词、中文 bigram 和 Latin token 建立保留真实词频的字段加权 BM25。
- 将 parent Markdown 保持为最终证据单位，按 source block/section 生成 300–800 字 child，命中后展开 bounded parent context 和 answer span。
- BM25 与 Embedding 各召回 Top 40，RRF 保留 Top 20，SiliconFlow Rerank 输出 Top 8。
- Embedding recall 在相似度计算前执行 module、intent、source type、visibility、status 和质量过滤。
- 补齐 taxonomy 模块与别名，并在索引阶段报告未知 module。
- 隔离 legacy `semantic-section-v1` 直答资格，从原始 source 重建 v2 草稿，严格审计、人工复核、分批发布并重建 BM25/vector artifacts。
- 建立 50 条生产路径评测集与 precision、abstention、Recall@5、MRR 发布门禁。

## Capabilities

### New Capabilities

- `chinese-field-weighted-bm25`: 定义中文分词、字段权重、no-hit 和可解释 lexical score。
- `parent-child-knowledge-index`: 定义 child chunk 构建、parent 展开、section/provenance 和 answer span 行为。
- `configured-hybrid-retrieval`: 定义 BM25、Embedding、RRF、Rerank、metadata filter 和 provider fallback。
- `audited-knowledge-migration`: 定义 legacy 语料隔离、v2 重建、人工审核、分批发布和旧向量失效。

### Modified Capabilities

- `knowledge-diagnosis-hardening`: 修改 draft slice、质量审计、publish、evaluation 和 compatibility 要求，以支持多 child parent、严格质量资格和真实迁移证据。

## Impact

- 主要影响 `src/knowledge/` 的可重建索引产物和 `src/retrieval/recall/`、fusion、rerank 实现。
- Provider HTTP 协议不变，沿用已验证的 SiliconFlow adapter；默认测试不联网。
- `chunks.jsonl` 仅增加可选 metadata 并允许一个 parent 对应多个 child；旧 artifact 可读取但缺安全字段时不能直答。
- 不引入外部向量数据库、GraphRAG 或新的公共 HTTP 字段。
