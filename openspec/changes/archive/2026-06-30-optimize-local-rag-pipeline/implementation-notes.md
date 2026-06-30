## 基线指标（优化前）

运行 `node dist/cli.js retrieval eval --questions test/fixtures/retrieval/production-eval-50.json`（等价于历史 `pnpm knowledge:eval`，旧命令已被 `remove-internal-compatibility-surfaces` 移除，统一使用 `retrieval eval`）。

环境：本机未设置 `SILICONFLOW_API_KEY`，且 `~/.super-helper/config.json` 中 `embedding.enabled=false`、`rerank.enabled=false`、`rerank.topN=2`、`knowledge.buildVectorIndex=false`，因此评测以 offline 模式运行（仅 BM25 单路召回、无 rerank）。

| 指标 | 阈值 | 基线值 | 结果 |
| --- | --- | --- | --- |
| recallAt5 | 1.0 | 0.0 | fail |
| mrr | 1.0 | 0.0 | fail |
| directAnswerPrecision | 1.0 | 1.0 | pass |
| abstentionAccuracy | 1.0 | 1.0 | pass |
| mustEscalateAccuracy | 1.0 | 1.0 | pass |

- `passed: false`，22 条 exact/paraphrase 问题全部因 `expected parent kb_eval_course_visibility not found in top 5` 失败。
- trace 显示 `embedding` strategy skipped（`embedding disabled`）、`rerank` skipped（`rerank disabled`）、`fusion.dedupedCount=0`。
- 这与 proposal 的判断一致：默认单路 BM25 + 无 query 归一化扩展，对换述/同义问题零召回。

注：本基线反映"默认配置 + 无 API key"的纯本地下限。阶段 A/B 落地后，配置默认值改为双路召回 + rerank，有 key 环境下 recall/MRR 应显著提升；无 key 环境仍维持此下限但不会更差。

## 2026-06-27 Review 修复记录

修复范围：

- UI 默认值：`src/setup-ui.ts` 与 `src/ui.ts` 的 Rerank topN 输入默认值和 JS fallback 统一为 8，避免 setup/settings 保存时把 config 默认值回退成 2。
- Onboarding no-key fallback：新增 onboarding provider credential 判断。真实 embedding/rerank provider 缺凭证时，validator 不阻塞，provider smoke 标记 `missing_credentials` skip，vector build plan/pipeline 跳过向量构建并继续 keyword/BM25 路径；fake provider 仍完整执行。
- Query normalization：query、alias、term 共享全/半角、繁简、空白与首尾标点归一化；BM25 使用 normalized + expandedTerms，rerank 继续使用 original query。
- OpenSpec hardening：新增 `specs/knowledge-diagnosis-hardening/spec.md`，补充 SHALL/Scenario；`tasks.md` 新增 Anti-Fake-Complete Audit 门禁。

红灯证据：

- 运行 `node --test test/onboarding-http.test.mjs test/supper-helper.test.mjs test/onboarding.test.mjs test/retrieval-query-normalize.test.mjs`，新增断言在旧实现下失败：setup/settings topN 仍为 2、validator 阻塞缺 embedding key、provider smoke 调用无 key provider、vector build 未跳过、query alias 未归一化。

绿灯证据：

- 运行 `pnpm build && node --test test/onboarding-http.test.mjs test/supper-helper.test.mjs test/onboarding.test.mjs test/retrieval-query-normalize.test.mjs`，业务相关新增测试已通过；同次运行中 `test/supper-helper.test.mjs` 既有 `Claude Code worker surfaces CLI API connection failures` 出现一次 timeout 波动（实际输出 `Command timed out after 1000ms`），与本 change 修改路径无关，需以最终全量 `pnpm test` 为准。
- 运行 `openspec status --change optimize-local-rag-pipeline --json`，`proposal`、`design`、`specs`、`tasks` 均为 `done`，`specs/knowledge-diagnosis-hardening/spec.md` 被识别。
- 运行 `pnpm lint`，通过。
- 运行 `pnpm typecheck`，通过。
- 运行 `pnpm test`，通过：254 个测试全部 pass，包含 docs lint、typecheck、build、module-boundaries、retrieval、knowledge-vector、hybrid-retrieval、runtime-retrieval-eval 等。

剩余状态：

- 阶段 C（chunking 参数化、超长 block 滑动窗口、`parent-child-v3`/artifact v3）已实现并通过全量测试。
- 真实 provider opt-in 的 `retrieval eval` 尚未运行；默认无 key acceptance 仍以 offline/fake 测试为准。

## 2026-06-28 阶段 C 完成记录

实现范围：

- `src/config.ts` 增加 `knowledge.chunking` 默认值：`maxChars=800`、`overlapStrategy=sentence`、`overlapChars=120`、`minChars=80`。
- `src/knowledge/documents/chunks.ts` 增加 `KnowledgeChunkingOptions`，`buildKnowledgeChunks` / `chunkDocument` / `packSection` 接收 options；默认行为仍保持 800/120，但不再硬编码。
- `packSection` 对超长 block 先按中英文句子边界切分，再按窗口生成 child；无安全句子边界或单句超过上限时保留原文并标记 `manual_split_required`。
- 新 chunk 输出 `chunking_strategy=parent-child-v3`、`artifact_version=3`；`markLegacyChunk` 将 v3 识别为 current，v2 识别为 legacy。
- `sourceChunkManifestHash` 纳入 `artifact_version` 与 `chunking_strategy`；v2 manifest 对 v3 chunks 返回 `rebuild-required`。
- `isChunkEligibleForRemoteEmbedding` 只允许 v3 current chunks 进入远程 embedding；测试 fixture 中需要可用向量的手写 chunks 已升级为 v3。
- `updateKnowledgeIndex` / `updateKnowledgeIndexWithQuality` 接收 chunking options；CLI `knowledge init|update`、gateway `/api/knowledge/bind|reindex`、onboarding pipeline/review refresh 从 config/draft 传入 options。`knowledge/` 没有 import `config.ts`。
- 模板和 draft slicer 的 parent `chunking_strategy` 更新为 `parent-child-v3`；migration report 以 v3 作为 direct-eligible current strategy。

新增/更新测试：

- `test/embedding.test.mjs` 覆盖默认 `knowledge.chunking`。
- `test/hybrid-retrieval.test.mjs` 覆盖参数化切片、句子窗口、v3 metadata、v3 非 legacy、v2 legacy。
- `test/knowledge-vector.test.mjs` 覆盖 v3 chunk embedding eligibility 与 v2 manifest 对 v3 chunk 的 `source_chunks` rebuild。
- `test/retrieval.test.mjs` 手写可用 vector chunks 默认升级为 v3，旧 chunk 兼容仍由 `test/retrieval-grounding.test.mjs` 覆盖。

验证：

- RED：`node --test test/embedding.test.mjs test/hybrid-retrieval.test.mjs test/knowledge-vector.test.mjs` 在实现前按预期失败，失败点为缺少 chunking 默认、v3 被识别 legacy、v3 chunk 不可 embedding。
- GREEN：`pnpm build && node --test test/embedding.test.mjs test/hybrid-retrieval.test.mjs test/knowledge-vector.test.mjs` 通过。
- 全量：`pnpm test` 通过，266 项测试全部 pass。

生产评测：

运行 `node dist/cli.js retrieval eval --questions test/fixtures/retrieval/production-eval-50.json --report reports/optimize-local-rag-pipeline-eval-2026-06-28.json`。

| 指标 | 阈值 | 本次值 | 结果 |
| --- | --- | --- | --- |
| recallAt5 | 1.0 | 0.0 | fail |
| mrr | 1.0 | 0.0 | fail |
| directAnswerPrecision | 1.0 | 1.0 | pass |
| abstentionAccuracy | 1.0 | 1.0 | pass |
| mustEscalateAccuracy | 1.0 | 1.0 | pass |

- `passed=false`，50 题中 22 条 exact/paraphrase 因 expected parent `kb_eval_course_visibility` 未进入 Top 5 失败。
- `offline=true`；本机 `~/.super-helper/config.json` 显式保留 `embedding.enabled=false`、`rerank.enabled=false`，因此 trace 显示 embedding/rerank skipped。该结果是当前本机配置的真实下限，不代表有 key + enabled 双路召回环境。
- 报告已写入 `reports/optimize-local-rag-pipeline-eval-2026-06-28.json`，未包含 API key、原始向量或 provider payload。

Anti-Fake-Complete 审计：

- 真实链路已走通：chunking options 从 config/draft 进入 CLI、gateway、onboarding 和 `updateKnowledgeIndex`，不是只创建接口。
- mock 假绿风险：新增测试包含旧实现 RED 失败证据；全量测试覆盖 runtime/retrieval/vector/onboarding/gateway，不只测 mock provider。
- 边界风险：`knowledge/` 未 import `config` 或 `providers`；provider 不依赖 knowledge schema；gateway 只传 config options 给 knowledge service，未实现 chunking 策略。
- 外部 API 风险：默认测试与本次 eval 未联网、不消耗真实额度；真实 SiliconFlow enabled/corpus gate 仍需 opt-in。
- 旧 artifact 假绿风险：v2 chunks 现在被识别为 legacy，v2 manifest 对 v3 chunks 触发 vector rebuild；旧 chunks 仍可读但不可冒充 current eligibility。
- secret/原文泄漏风险：新增报告只记录指标、trace 状态、ID 与安全摘要；未记录原始向量、完整正文或 secret。
