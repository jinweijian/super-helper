## Context

本 change 优化本地 RAG 的排序、召回、切片三层，不引入新的外部依赖或持久化格式。所有改动落在 `src/retrieval/`、`src/knowledge/documents/`、`src/config.ts`、`src/onboarding/`，遵循 AGENTS.md 模块边界：

- `knowledge/` 不 import `providers/`（module-boundaries.test.mjs 已强制）→ 切片参数化必须留在 `knowledge/` 内部，配置类型放 `config.ts`。
- `retrieval/` 拥有 recall/fusion/rerank/dedupe 编排 → query 归一化扩展作为 retrieval 内部细节，不外泄到 runtime/gateway。
- 不改 `DiagnosticRequest`/`DiagnosticResult`/Evidence contract、不改 HTTP/case JSON shape。

## 阶段 A：排序快赢

### A1. rerank topN 默认值

`src/config.ts` `defaultConfig().rerank.topN: 2 → 8`。最终检索 `limit` 也是 8（`configured-search.ts:57` `Math.min(query.limit ?? 8, 8)`），topN 对齐让 rerank 主导全部 top 候选。`SiliconFlowRerankProvider` 的 `top_n` 在 `protocol.ts:13` 回退到 `documents.length`，配置值会正确传递。

### A2. rerank 与 parent-dedupe 顺序

`src/retrieval/service.ts` 现状：

```
fuseWithRrf → slice(fusionLimit=20) → rerank → dedupeByParent → slice(limit=8)
```

改为：

```
fuseWithRrf → slice(fusionLimit=20) → dedupeByParent → rerank → slice(limit=8)
```

`dedupeRetrievalCandidatesByParent`（`parent-dedupe.ts`）已支持合并同 parent 的 child（保留 `childHits` 元数据、取 answerStrength 最强的代表）。把它的调用点从 rerank 之后移到之前即可。rerank 的输入变为"每 parent 一个代表 child"，配额不被同 parent 重复消耗。

trace 字段顺序相应调整：dedupe 计数并入 fusion trace 的 `dedupedCount`，rerank trace 记录去重后的 inputCount。

### A3. rerank finalScore 归一化

`src/retrieval/rerank/service.ts:48` 现状：

```ts
finalScore: Number(((candidate.finalScore ?? candidate.score) + item.score).toFixed(8))
```

改为在本次 rerank 候选集内做 min-max 归一化后加权融合：

```
normalizedRerank = (rerankScore - min) / (max - min)   // 本批候选内，[0,1]
normalizedRrf    = (rrfScore  - min) / (max - min)      // 本批候选内，[0,1]
finalScore = 0.7 * normalizedRerank + 0.3 * normalizedRrf
```

- 归一化在本次 rerank 输入候选集内做，避免跨 query 不可比。
- `max === min`（所有 rerank 分相同）时退化为纯 RRF 排序。
- 无 rerank provider 时回退到纯 RRF finalScore（现状不变，service.ts 不进 rerank 分支）。
- rerank 失败的候选保留原 finalScore，不参与归一化（已在 service.ts catch 分支处理）。

rerank weight 0.7 反映 cross-encoder 比 RRF 更可信；可作为 `config.rerank.weight` 暴露但默认 0.7，先不外置配置项，避免过度设计。

## 阶段 B：语义召回根因

### B1. 默认启用双路召回

`src/config.ts` `defaultConfig()`：

- `knowledge.buildVectorIndex: false → true`
- `embedding.enabled: false → true`

降级保护分两层：

- Retrieval：`resolveConfiguredEmbeddingProvider` 在 `enabled !== true`、缺少 materialized API key、或构造失败时返回 reason，`createEmbeddingRecallStrategy` 的 `enabled()` 据此返回 `{ enabled: false, reason }`，service 跳过该 strategy 只跑 BM25。所以即便默认 true，无 key 时仍优雅降级。
- Onboarding：validator 不把 embedding/rerank 缺 key 当 blocking error；provider smoke 在真实 provider 缺 key 时返回 `skipped: true, reason: missing_credentials`；vector build plan/pipeline 在真实 embedding provider 缺 key时跳过向量构建并继续 keyword/BM25 索引。fake provider 仍可在测试中完整执行。

`src/onboarding/knowledge-pipeline.ts` `maybeBuildVectorIndex` 检查 `draft.knowledge.buildVectorIndex && draft.embedding.enabled && providerHasExecutionCredentials(draft.embedding)`。默认值改后，有 key 环境会自动构建向量索引；无 key 环境不会联网、不会产生费用，并以 BM25/keyword 作为默认可用下限。

### B2. query 归一化与扩展

新增 `src/retrieval/query/normalize.ts`，导出：

```ts
export interface NormalizedQuery {
  original: string;        // 原始 query，供 rerank 使用
  normalized: string;      // 归一化后，供 recall 使用
  expandedTerms: string[]; // 扩展出的别名词，供 BM25 tokenize 增强
}
export function normalizeAndExpandQuery(input: {
  query: string;
  aliases?: Array<{ alias: string; term?: string }>;
}): NormalizedQuery
```

**归一化层**（纯函数，无依赖）：

1. 全角→半角：ASCII 可见字符范围 `！＂＃…｝` → `!"#…}`，全角空格 `　` → 半角。
2. 繁简转换：内置一张高频字映射表（~200 字，覆盖常见异体/繁体），不做全量 OpenCC。表放在同文件常量。
3. 合并连续空白、trim。
4. 标点统一：中文逗号/句号保留（BM25 bigram 需要中文标点切句），去除首尾标点。

**扩展层**：

- 输入 `taxonomy.aliases`（BM25 strategy 已通过 `loadKnowledgeTaxonomy` 读出，见 `bm25/strategy.ts:27`）。
- 对 alias 和 term 也执行同一归一化；若归一化 query 命中归一化 alias，把归一化后的 `term` 加入 `expandedTerms`。
- 扩展只加词不删词，避免过度改写。

**接入点**：`createRetrievalService.retrieve`（`service.ts:27`）入口处统一调用一次，所有 strategy 共享同一个 `NormalizedQuery`：

- BM25 strategy 的 `recall` 用 `normalized` + `expandedTerms` 增强 tokenize。
- Embedding strategy 的 `recall` 用 `normalized` 做 `embedQuery`。
- rerank 用 `original`（避免扩展噪声干扰 cross-encoder）。
- `RetrievalInput` 增加 `normalizedQuery?: NormalizedQuery` 可选字段，strategy 内部消费；`configured-search.ts` 不感知归一化细节。

taxonomy aliases 的来源：在 service 层调用 `loadKnowledgeTaxonomy(workspaceRoot)` 一次（与 BM25 strategy 内部调用同一函数，开销可接受），传给 normalize。为避免 service 直接依赖 knowledge 模块，aliases 由调用方（`configured-search.ts`）注入：service 构造时接收 `queryNormalizer?: (query: string) => NormalizedQuery`，configured-search 负责注入带 aliases 的实现。

## 阶段 C：切片质量

### C1. 切片参数外置

`src/config.ts` `SuperHelperConfig.knowledge` 增加可选字段：

```ts
knowledge: {
  ...
  chunking?: {
    maxChars?: number;        // 默认 800
    overlapStrategy?: 'sentence' | 'sliding';  // 默认 'sentence'
    overlapChars?: number;    // 默认 120
    minChars?: number;        // 默认 80，低于此不单独成 chunk
  };
};
```

`src/knowledge/documents/chunks.ts` `buildKnowledgeChunks(documents, options?)` / `chunkDocument` / `packSection` 接收 options，移除硬编码 800 / 120。`defaultConfig()` 提供 chunking 默认值。`updateKnowledgeIndex`（`indexes/build.ts:27`）调用 `buildKnowledgeChunks(docs)` 时从 config 读取 options 传入——但 `knowledge/` 不能 import `config.ts`（config 在更上层），所以 options 由 CLI/onboarding 层从 config 读出后传入 `buildKnowledgeChunks`，保持 knowledge 模块无上行依赖。

### C2. 超长 block 滑动窗口递归切

`packSection`（`chunks.ts:166-173`）现状：单 block > maxChars 直接 `manualSplitRequired=true` 结束。改为：

1. 先尝试按句子边界切：扩展现有 `lastCompleteSentence` 为 `splitIntoSentences`，支持中英文标点 `.。!！?？;；\n`，返回句子数组。
2. 用滑动窗口把句子打包到 ≤ maxChars，相邻窗口 overlapChars 重叠（取上一窗口末句）。
3. 若单个句子本身就 > maxChars（无标点超长句），才回退 `manualSplitRequired` 兜底。
4. 每个 window 生成一个 ChildDraft，`overlapChars` 记录实际重叠量。

### C3. chunking_strategy 版本升级

`chunks.ts:80` `chunking_strategy: 'parent-child-v2'` → `'parent-child-v3'`，`artifact_version: 2 → 3`。

兼容机制（既有，无需新代码）：

- `markLegacyChunk`（`chunks.ts:216`）改为识别 v3 为非 legacy，v2 chunk 标 legacy。
- `vector-index.ts:282` `sourceChunkManifestHash` 把 `chunking_strategy` 纳入 hash，版本变化 → hash 变化 → `checkKnowledgeVectorCompatibility` 返回 `rebuild-required`（`source_chunks` mismatch）→ 下次 `knowledge update` / onboarding 自动重建向量索引。
- 检索侧 `vector-search.ts:61` 已过滤 `legacy_chunk`，v2 旧 chunk 不会被当作有效候选。

## 数据流总览（优化后）

```
query
  → normalizeAndExpandQuery(original, taxonomy.aliases)
  → { original, normalized, expandedTerms }
  → BM25(normalized + expandedTerms) + Embedding(normalized) [+ Keyword]
  → fuseWithRrf(k=60)
  → slice(fusionLimit=20)
  → dedupeByParent(每 parent 取代表 child)
  → rerank(original query, topN=8)
  → finalScore = 0.7*norm(rerank) + 0.3*norm(rrf)
  → slice(limit=8)
```

## 风险与回退

- **C3 触发全量向量重建**：首次 `knowledge update` 后重新 embedding 全量 chunk，有 API 成本/延迟。C 放在 A/B 之后，A/B 先交付收益。可通过临时把 `chunking_strategy` 留 v2 来推迟重建，但不推荐。
- **B2 繁简表覆盖有限**：仅高频字，非全量；对罕见繁体字无效，但不会引入错误（未命中保持原样）。
- **A3 归一化边界**：`max===min` 退化、rerank 失败保留原分，均已处理。
- **B1 默认 true 的兼容性**：现有用户 config.json 若显式写 `embedding.enabled: false`，`loadConfig` 的 merge 仍尊重显式值（`{ ...defaults.embedding, ...parsed.embedding }`），不会强开。
