## Context

Configured runtime retrieval 现在始终通过 registry/service，但默认中文 BM25 会产生大量单字命中；BM25/Embedding candidate 又没有携带 parent 的 `last_verified_at`、quality、source block 和 document metadata。`retrievalCandidatesToEvidencePack` 用默认值补洞，Evidence Judge 主要根据 `matched_terms.length` 评分，导致真实质量错误无法阻断直答。CLI `knowledge eval` 仍走 compatibility search，无法证明生产路径安全。

本 change 是后续 Hybrid 与会话治理的前置合同。它只修复 evidence 完整性、严格直答资格、生产评测和 trace，不在本阶段重写中文 BM25 或重切全部语料。

## Goals / Non-Goals

**Goals:**

- 让 runtime 同时获得 Evidence Pack 和 Retrieval Trace，并能解释每条策略、过滤、融合与 rerank 行为。
- 从 canonical parent 文档和质量报告补齐 candidate/evidence metadata，不再用伪造默认值掩盖缺失。
- 建立 fail-closed 的严格直答资格，先阻断错误答案，再由后续 change 提高召回。
- 使用真实 production composition 做离线评测，并提供显式 SiliconFlow opt-in 验收。
- 保持 gateway、case JSON、旧 CLI 和旧 artifact 的兼容性。

**Non-Goals:**

- 不实现新的中文 tokenizer、parent-child chunker 或外部向量数据库。
- 不改变 SiliconFlow 协议字段，不实现 MiniMax/Gemini/Qwen 新 HTTP adapter。
- 不把 retrieval trace 加入公共 HTTP response。
- 不自动发布或修改用户知识文档。

## Decisions

### 1. 新增 runtime-only retrieval envelope

`src/retrieval/configured-search.ts` 新增返回 `{ evidencePack, trace }` 的内部入口；现有 `searchKnowledgeWithConfiguredRetrieval` 继续只返回 Evidence Pack。Runtime 使用 envelope，CLI/旧调用方保持兼容。

选择内部 envelope 而不是扩展公共 Evidence Pack，是为了避免 HTTP/CLI shape 漂移，同时让 `KnowledgeTurnService` 和 `RuntimeEventRecorder` 拿到完整 trace。

### 2. Parent metadata enrichment 发生在 retrieval adapter 边界

`src/knowledge/` 提供只读 parent/quality lookup；BM25/Embedding strategy 将 chunk 命中映射为完整 candidate。Candidate 增加可选 `documentType`、`lastVerifiedAt`、`sourceDocument`、`sourceDocumentId`、`sourcePages`、`sourceBlockIds`、`sectionPath`、`quality` 和 `answerSpan`。

旧 artifact 缺字段时可继续召回，但 evidence 明确标记 metadata 缺失；不得生成 1970 时间、伪 active、伪 module 或伪 quality。

### 3. 严格直答使用确定性 eligibility，而不是 native score 猜测

Evidence Judge 在现有风险、冲突、状态判断前增加 eligibility：

- status 为 active；
- quality 仅允许 `ok` 或 `info`；
- `source_document_id`、`source_block_ids`、`section_path` 完整；
- freshness 通过；
- 存在明确 answer span；
- 无风险、实现细节、冲突、模块错配；
- Rerank 已运行时 top score `>= 0.70`；Rerank 不可用时，仅允许 normalized query 包含完整 title，且存在至少两个非泛化多字符 matched terms。

任一条件缺失都 fail closed：返回 blocker 并升级只读调查。Embedding/vector score 只能召回，不能单独授权直答。

### 4. Runtime trace 是审计数据，不是用户答案

Trace 记录 strategy status、candidate count、安全失败原因、fusion、rerank 和过滤汇总。事件 detail 必须脱敏，不记录 API key、Authorization、原始向量、完整 provider payload 或完整原文。

### 5. 新增 production retrieval eval

新增 runtime/CLI service，执行真实 `routeKnowledgeQuestion -> configured retrieval -> judgeKnowledgeEvidence`。问题集必须声明 expected parent/behavior；报告包含 Recall、MRR、direct precision、abstention、must-escalate 和 per-question blockers。旧 `knowledge eval` 保持兼容。

默认 eval 使用 fake/disabled provider；真实 SiliconFlow 只有显式 opt-in 且凭证存在时运行。当前 provider 协议基线沿用仓库 2026-06-14 已验证官方文档：`https://api-docs.siliconflow.cn/docs/api/embeddings-post` 与 `https://api-docs.siliconflow.cn/docs/api/rerank-post`；本 change 不新增协议字段。

### 6. 当前部署启用与仓库默认分离

仓库 `defaultConfig()` 继续关闭 embedding/rerank，确保默认不联网。真实部署通过 settings/SecretRef 显式选择 SiliconFlow、运行 smoke、构建 compatible vectors 后启用；缺凭证、429、timeout、5xx、malformed、dimension mismatch 或 stale vectors 时记录安全 trace 并退回 BM25，但严格门禁决定是否允许直答。

## Risks / Trade-offs

- [Risk] 严格门禁会让 legacy 语料大量升级代码调查。→ 这是预期安全行为；P1 负责重建可直答语料。
- [Risk] Rerank 阈值对 provider 分布敏感。→ 固定 0.70 作为安全起点，并用 production eval 记录分布；未通过 precision gate 不降低阈值。
- [Risk] Enrichment 每次读取 parent/quality 增加本地 IO。→ 当前语料规模小，先保证正确性；单次 query 内缓存 lookup。
- [Risk] Trace 泄漏原文或 secret。→ 只存统计、ID、分数和经过 provider redaction 的 reason。
- [Risk] 旧测试只验证 synthetic English。→ 新增真实中文 fixture 和 runtime composition regression。

## Migration Plan

1. 先写真实中文 RED tests，证明误召回、quality loss、1970 默认和 runtime trace 缺失。
2. 增加 enrichment 与 retrieval envelope，保持旧 wrapper。
3. 增加严格 Judge eligibility 与 blocker。
4. 接入 runtime trace 和 production eval。
5. 使用 fake provider 完成离线验收；凭证存在时显式运行 SiliconFlow smoke/vector build。
6. 部署后 legacy evidence 可继续用于调查，但在 P1 完成前不得绕过严格门禁直答。

Rollback：关闭当前部署的 embedding/rerank 并保留严格 Judge；旧 wrapper 和 artifact reader 不变，无数据回滚要求。

## Open Questions

无。阈值、兼容和 provider 选择均由本 change 固定；任何放宽必须通过新的评测证据和 OpenSpec 变更。
