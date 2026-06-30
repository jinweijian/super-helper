## 1. OpenSpec 与基线

- [x] 1.1 创建 `openspec/changes/optimize-local-rag-pipeline/` 的 proposal/design/tasks。
- [x] 1.2 记录优化前 `pnpm knowledge:eval` 的 Hit@5/MRR/precision 基线指标到 implementation-notes，作为对比基准。

## 2. 阶段 A：排序快赢

- [x] 2.1 A1：`src/config.ts` `defaultConfig().rerank.topN: 2 → 8`，并确认 `configured-search.ts` 传递链路与 SiliconFlow `top_n` 回退一致。
- [x] 2.2 A2：`src/retrieval/service.ts` 把 `dedupeRetrievalCandidatesByParent` 从 rerank 之后移到之前；调整 trace 的 dedupe/rerank 计数归属。
- [x] 2.3 A3：`src/retrieval/rerank/service.ts` finalScore 改为本批候选内 min-max 归一化后加权（0.7 rerank + 0.3 rrf）；处理 `max===min` 退化与失败保留原分。
- [x] 2.4 补/改单测：rerank 顺序、finalScore 归一化值域、topN 传递。

## 3. 阶段 B：语义召回根因

- [x] 3.1 B1：`src/config.ts` `defaultConfig()` 把 `knowledge.buildVectorIndex` 与 `embedding.enabled` 默认改 true；确认 `loadConfig` merge 尊重用户显式 false。
- [x] 3.2 B1.2：确认 onboarding draft 生成处 `buildVectorIndex`/`embedding.enabled` 跟随 config 默认值，`maybeBuildVectorIndex` 无 key 时优雅跳过。
- [x] 3.3 B2：新增 `src/retrieval/query/normalize.ts`，实现全/半角、繁简高频表、空白合并、首尾标点处理、基于 taxonomy aliases 的扩展。
- [x] 3.4 B2.2：`createRetrievalService` 入口接入 queryNormalizer；BM25/Embedding 用 normalized/expandedTerms，rerank 用 original；`RetrievalInput` 增加 `normalizedQuery` 可选字段。
- [x] 3.5 B2.3：`configured-search.ts` 注入带 aliases 的 normalizer；service 不直接依赖 knowledge 模块。
- [x] 3.6 补单测：全/半角归一化、繁简归一化、首尾标点、alias 扩展、rerank 仍用 original。

## 4. 阶段 C：切片质量

- [x] 4.1 C1：`src/config.ts` 增加 `knowledge.chunking`（maxChars/overlapStrategy/overlapChars/minChars）可选配置与默认值。
- [x] 4.2 C1.2：`chunks.ts` `buildKnowledgeChunks`/`chunkDocument`/`packSection` 接收 options，移除硬编码 800/120；`indexes/build.ts` 与 CLI 从 config 读 options 传入（knowledge 不上行依赖 config）。
- [x] 4.3 C2：`packSection` 超长 block 改为句子边界滑动窗口递归切，扩展 `splitIntoSentences` 支持中英文标点；无标点超长句才 manualSplit 兜底。
- [x] 4.4 C3：`chunking_strategy: parent-child-v2 → parent-child-v3`、`artifact_version: 2 → 3`；`markLegacyChunk` 识别 v3 非 legacy；确认 `sourceChunkManifestHash` 触发向量重建。
- [x] 4.5 补单测：参数化切片、超长 block 递归切、v3 非 legacy、向量兼容性触发 rebuild。

## 5. 验证与收尾

- [x] 5.1 运行 `pnpm typecheck` 与 `pnpm build`，全部通过。
- [x] 5.2 运行 `pnpm test`（含 module-boundaries、retrieval、knowledge-vector、hybrid-retrieval、runtime-retrieval-eval），全部通过。
- [x] 5.3 运行 `pnpm knowledge:eval`，对比优化前后 Hit@5/MRR/precision，记录到 implementation-notes。
- [x] 5.4 审计模块边界：确认 `knowledge/` 未 import `providers/`/`config`，`retrieval/` 未外泄归一化细节，HTTP/case JSON shape 未变。
- [x] 5.5 Anti-Fake-Complete Audit / 回头重新思考：在完成阶段 C 和最终验证前，逐项回答是否存在接口已创建但真实数据未走通、mock 假绿、gateway/runtime/knowledge/retrieval/provider/onboarding 边界写穿、外部 API 细节未证实、默认命令联网/花钱、旧 artifact 假绿、secret/原文泄漏等风险，并把结论反向补充到 `design.md`、`specs/**/spec.md`、`tasks.md` 或 `implementation-notes.md`。
