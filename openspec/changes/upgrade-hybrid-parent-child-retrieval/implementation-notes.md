# Implementation Notes

## Baseline And RED Evidence

- Tokenizer/BM25：`pnpm build && node --test test/hybrid-retrieval.test.mjs` 初次 5/5 RED；失败分别证明旧 tokenizer 抹掉 TF/输出单字、parent-child 缺失、正文噪声压过标题、Hybrid 仍使用请求 limit。实现后中文业务词/bigram/Latin、注册单字、TF、4/3/3/2/1 字段贡献和 true no-hit 全部 GREEN。
- Parent-child：新增 section 边界、300–800 目标、一句且不超过 120 字 overlap、超大原子 block manual split、稳定 hash、多个 child 归并 parent、1600 字 bounded context 测试，全部通过。
- Hybrid/filtering：BM25/Embedding 各 Top 40、RRF `k=60` Top 20、Rerank Top 8；向量在 similarity 前过滤 module/intent/source type/visibility/status/quality/restricted/legacy，过滤原因进入 trace；rerank/provider 失败保留安全 fallback。

## Artifact And Migration Evidence

- Legacy inventory：新增 `knowledge migration-report` 与 `migration-report.json`/`migration-review-queue.json`，只读识别 legacy parent/chunk、缺 provenance、非 ok 质量和批次状态；测试证明原文件未被改写。
- V2 child/index rebuild：chunk JSONL additive 增加 order、source blocks、section path、text hash、parent title/terms、quality、strategy 和 legacy marker；vector manifest hash 覆盖 parent/boundary/provenance，边界变化强制 rebuild。
- AI Companion review/publish：仓库与当前任务上下文没有真实 knowledge source/人工 review 结果，批次状态必须记录 `blocked_missing_sources`，未运行 publish/vector/production 50 题 gate。
- EduSoho review/publish：必须等待 AI Companion 真实批次通过；当前保持 `blocked_missing_sources`，没有伪造发布成功。

## Evaluation

- Calibration metrics：已提交固定 35 条 calibration 数据结构；真实语料未挂载，因此未运行真实 calibration，状态 `not run`。
- Holdout metrics：已提交固定 15 条 holdout 数据结构；offline production-composition fixture 的 Recall@5/MRR/direct precision/abstention/must-escalate 均为 1，但不能冒充真实 15 条业务 holdout。
- Safety gates：严格 Judge 阈值未放宽；真实 50 题 gate 仍待 source review/publish 与显式 provider/corpus 验收，任务 6.2 保持未完成。

## Fake And Real Provider Acceptance

- Offline fake：关联三个 change 完成后的最新 `pnpm test` 为 247 项通过，provider 默认 disabled/fake，无网络或付费请求；Hybrid budgets、vector filtering、fallback 和 redaction 均有 deterministic tests。
- SiliconFlow opt-in：环境无 `SILICONFLOW_API_KEY`，真实 smoke/vector/rerank/holdout 为 `not run`，任务 5.2 保持未完成。

## Privacy, Compatibility, And Boundaries

- Artifact compatibility：旧 JSONL 可读并自动标记 legacy；legacy/unknown quality 不进入远程 embedding 或严格直答；parent/child boundary 变化使 vector compatibility 返回 rebuild-required。
- Provider/document redaction：trace/评测只保留 ID、计数、分数、字段贡献和安全错误；restricted 文本在 vector build 前排除，报告无原始向量、完整正文、key 或 provider payload。
- Boundary audit：knowledge 负责 artifact/taxonomy/migration report，retrieval 负责 tokenization/scoring/filter/fusion/rerank，runtime 负责 Judge/eval，CLI 仅适配命令；module-boundary tests 通过。

## Anti-Fake-Complete Findings

- Production path proof：runtime configured service 固定创建新 BM25/Embedding strategy 与 40/40→20→8 budgets；runtime direct-answer tests、trace events、production eval 和 Hybrid tests 均走新链路。
- Artifact/spec updates：审计发现 parent Markdown 无法证明每个正文段落与 source block 的一一映射，因此 child 保留 parent 声明的完整 source block 集合，不猜测更窄映射；精确映射需未来在 Markdown 中保留 block marker。

## Final Verification

- `openspec validate`：`openspec validate upgrade-hybrid-parent-child-retrieval --strict` 通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm test`：247 项测试通过，0 失败。

## Deviations And Remaining Risks

- 真实 source 不在仓库/当前 workspace，不能执行 4.3–4.5 的人工 review/publish 批次。
- 缺少 SiliconFlow 凭证，真实 provider 验收 5.2 为 `not run`。
- 50 题真实 holdout 尚未对 reviewed corpus 执行，6.2 不能标记完成；当前 change 保持 active，不能归档。

## 2026-06-28 Blocker Recheck

复核命令与结果：

- `openspec instructions apply --change upgrade-hybrid-parent-child-retrieval --json`：仍为 18/23，剩余 4.3、4.4、4.5、5.2、6.2。
- 本机 `~/.super-helper/config.json`：`embedding.enabled=false`、`rerank.enabled=false`，无 inline key、无 `apiKeyRef`；`SILICONFLOW_API_KEY` 仅为 env 名称配置，当前没有可确认的 materialized credential。
- `find ~/.super-helper -path '*migration-report.json' -o -path '*migration-review-queue.json'`：未发现现成 migration report 或 review queue。
- `reports/optimize-local-rag-pipeline-eval-2026-06-28.json` 是 offline BM25-only 评测报告，不是真实 provider + reviewed corpus holdout 证明。

结论：

- 4.3–4.5 需要真实 source pipeline artifacts 与人工 review 结果。当前不能自动批准 warning/error 或伪造 review queue，因此保持未完成。
- 5.2 需要明确凭证 opt-in 才能运行 SiliconFlow smoke/vector/rerank/holdout。当前配置禁用且无凭证，因此保持未完成。
- 6.2 需要 reviewed corpus 的 holdout 指标证明；当前 offline 报告 Recall@5/MRR 为 0，不能冒充通过。
- 本次 `optimize-local-rag-pipeline` 已把 current chunk artifact 推进到 `parent-child-v3`。该 change 的历史任务名仍写 v2，是该 change 创建时的版本语义；真实 completion gate 仍取决于人工 review/provider/holdout，而不是任务文字里的 v2/v3 名称差异。

## 2026-06-28 Feature Overview Regression

触发 case：`case_d4623950`，用户问“AI伴学助手有哪些功能”。检索命中了 `drf_src_1c0bc3610f76_003`，rerank score 0.998，但因为 published/draft 镜像重复与 `warn` 质量状态进入 `low_quality_evidence`，最终升级到代码排查；Presentation 又只渲染第一条 claim 并按运营模板定性为“设计使然/配置或使用问题”。

本次补强：

- `quality.ts` 重复检测忽略相同 `documentId` 的 draft/published 镜像，仍保留不同 document ID 之间的真实重复 warning。
- `taxonomy.ts` 与 taxonomy template 新增 `feature_overview` 识别，用于“有哪些功能/支持哪些/功能清单”等具体模块问题。
- `diagnosticResultFromKnowledge` 对 `feature_overview` 聚合多条 active evidence 为多个 fact claim，避免只输出 Top answer span。
- `presenter.ts` 对运营 persona 增加功能概览模板，功能咨询不再强制归类为 bug、设计使然或配置问题。
- `production-eval-50.json` 将 `exact-04` 替换为“AI伴学助手有哪些功能？”并指向实际 AI Companion 功能概览父切片。

验证：

- RED：`node --test test/quality-fixtures.test.mjs test/retrieval-grounding.test.mjs test/conversation-evidence-lifecycle.test.mjs` 新增 3 个测试按预期失败。
- GREEN：`pnpm build && node --test test/quality-fixtures.test.mjs test/retrieval-grounding.test.mjs test/conversation-evidence-lifecycle.test.mjs` 通过，39/39 pass。

仍未完成：

- 未直接修改用户外部知识库、未运行真实向量重建或真实 SiliconFlow eval；这些仍受 4.3–4.5、5.2、6.2 的人工 review/provider opt-in gate 约束。
