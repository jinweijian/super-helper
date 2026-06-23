# Implementation Notes

## Baseline

- `pnpm install --frozen-lockfile && pnpm test`：基线 218 项测试通过。

## RED / GREEN Evidence

- Retrieval metadata/trace：先运行 `pnpm build && node --test test/retrieval-grounding.test.mjs`，因 `retrieveKnowledgeWithConfiguredRetrieval` 不存在按预期 RED；实现 runtime-only envelope、parent grounding 和 filters 后，4 项 focused tests 全部 GREEN。
- Strict answer gate：新增质量 warn/error、缺溯源、低 rerank、精确标题回退、单字弱命中测试；旧 `warn` 可直答测试先失败，改为 fail-closed 合同后通过。
- Production evaluation：`test/runtime-retrieval-eval.test.mjs` 初次因 `dist/runtime/retrieval-evaluation.js` 不存在 RED；实现生产组合评测及 `retrieval eval` CLI 后，programmatic 与 CLI 两条路径均 GREEN。

## Fake Acceptance

- Command/result：`pnpm build && node --test test/runtime-retrieval-eval.test.mjs test/retrieval-grounding.test.mjs test/embedding.test.mjs` 通过。
- No-network evidence：默认 config 保持 embedding/rerank disabled；评测报告 `offline: true`，测试使用 disabled/fake fetch，未发起真实 provider 请求。

## Real SiliconFlow Opt-In

- Embedding smoke：`not run`，环境中没有 `SILICONFLOW_API_KEY`。
- Rerank smoke：`not run`，环境中没有 `SILICONFLOW_API_KEY`。
- Vector build/eval：`not run`，环境中没有 `SILICONFLOW_API_KEY`；README 已记录 SecretRef/settings、smoke、vector build、production eval 的显式验收步骤。
- 官方协议核对：2026-06-23 通过官方页面确认 `/v1/embeddings` 的 `model/input/encoding_format/dimensions` 与 `/v1/rerank` 的 `model/query/documents/top_n/return_documents`、`relevance_score`；未增加猜测字段。Web 搜索代理返回 403，随后使用官方 URL 直接只读核对。

## Compatibility, Privacy, And Boundary Audit

- HTTP/case/artifact compatibility：保留 Evidence-Pack-only wrapper；新字段均 optional；旧 chunk 测试证明可读且不伪造 epoch/quality/provenance；公共 API、case store、stale vector、disabled provider 和旧 CLI 回归全部通过。
- Secret/raw document/vector redaction：runtime trace 仅含策略状态、计数、分数和安全错误；production eval 只写 evidence ID、parent ID、标题、来源、分数、质量和 blockers；测试证明 secret、请求正文和原始向量不进入结果。
- Module boundary review：knowledge 只负责 parent/quality 读取，retrieval 负责 enrichment/recall/fusion，runtime 负责 Judge/评测/事件，CLI 只解析参数和输出；module-boundaries tests 通过。

## Anti-Fake-Complete Findings

- Production path proof：`prepareKnowledgeDiagnosis -> retrieveKnowledgeWithConfiguredRetrieval -> createConfiguredRetrievalService -> BM25/Embedding -> evidence pack + trace -> judgeKnowledgeEvidence` 已由 runtime direct-answer、escalation 和 production eval tests 覆盖。
- Gaps found and artifact updates：发现 BM25 只返回单字时精确标题回退仍无法证明两个多字符词，已从 canonical chunk keywords 补充 query 中的完整多字符匹配；发现 Deep Query 丢失 answer span/quality/provenance/strategy score，已扩展 optional context 字段；发现旧 `warn` 测试违反新合同，已改为必须阻断。

## Final Verification

- `openspec validate`：`openspec validate harden-runtime-retrieval-grounding --strict` 通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm test`：关联三个 change 完成后的最新全量回归为 247 项测试通过，0 失败（本 change 初次完成时为 224 项）。
- Production retrieval evaluation：`test/runtime-retrieval-eval.test.mjs` 通过，Recall@5=1、MRR=1、直答精度=1、拒答准确率=1、必须升级准确率=1；同一测试执行真实 `retrieval eval` CLI adapter。

## Deviations And Remaining Risks

- 真实 SiliconFlow smoke/vector/eval 因凭证不可用未运行，明确记录为 `not run`；fake/offline 结果未冒充真实验收。
- 本 change 未重写中文 tokenizer 或 parent-child index；召回精度提升由后续 `upgrade-hybrid-parent-child-retrieval` 负责。
