## Context

上一轮 `add-layered-knowledge-workspace` 已完成企业知识库 MVP：

- `knowledge:init` 能导入 `/Users/king/Documents/knowledge/` 下两个白皮书 DOCX。
- runtime 已接入 Knowledge Router、Knowledge Search、Evidence Judge、Deep Query Planner、Case Curator。
- 真实检索已经能命中白皮书问题；实现细节和 no-hit 问题能升级到 Claude Code worker。

但它仍是 MVP，不是企业级稳定系统。当前高优先级缺口来自用户对完整技术方案的复盘：

1. 白皮书切割质量仍偏弱，存在空片、目录片、重复片、短片、缺页码 provenance 等风险。
2. 检索体系升级需要单独研究，暂不进入执行。
3. Evidence Judge 仍是规则版，语义覆盖、冲突、时效、版本、风险判断不够强。
4. Deep Query / Query Correction 只生成一次上下文，还没有多轮 retry / pivot 闭环。
5. 真实远程模型和 Claude Code 验收需要形成可重复、安全、不泄露 secret 的验收命令。
6. Case Curator 只能生成草稿，还没有 review / approve / reject / active 流程。

本 change 只做 1/3/4/5/6 的后续规划。待用户审核后，再用 `/opsx:apply harden-knowledge-diagnosis-mvp` 执行。

## Goals / Non-Goals

**Goals:**

- 建立知识切割质量审计和质量门禁，避免低质量 slice 被默默纳入检索。
- 增强 Evidence Judge 的结构化判断，降低泛词误召回、过期知识、冲突知识和高风险问题导致的误答。
- 建立 Deep Query retry / pivot 闭环，在第一次只读代码调查证据不足时可安全换方向再查。
- 建立真实服务验收命令，覆盖本地配置、远程模型、Claude Code、知识直答、no-hit 升级、实现细节升级。
- 建立 solved case review 工作流，让 `review_required` 草稿经审核后才进入 active 知识库。
- 更新过时文档，反映 knowledge-first runtime 已接入。

**Non-Goals:**

- 不实现 BM25、向量检索、hybrid/RRF、reranker、parent-child rerank 或 GraphRAG。
- 不引入外部向量数据库或在线 RAG 服务。
- 不让 Claude Code 或 MCP tool 直接生成最终用户回复。
- 不改变现有 HTTP response shape，除非提供兼容测试。
- 不破坏现有 case JSON shape；新增状态必须通过可选字段、独立 knowledge review 文件或可迁移结构实现。
- 不在 gateway route、worker adapter 或 product Agent prompt 中塞业务流程逻辑。

## Decisions

### 1. 切割质量审计归属 `src/knowledge/`

Decision:

- 在 `src/knowledge/` 增加质量审计能力，例如 `quality.ts` 或同等模块。
- 审计输入是已经生成的 source metadata、parent slice Markdown 和 derived chunks。
- 审计输出写入 `knowledge/indexes/chunk-quality-report.json`，并在 CLI 中给出摘要。
- `knowledge:init` 和 `knowledge:update` 都应可触发审计。

Rationale:

- 切割质量是知识库数据层责任，不属于 runtime。
- 质量报告必须能独立于聊天运行，方便人工先处理知识库。

Quality issue examples:

- `empty_body`: parent slice 没有正文或只有标题。
- `toc_like`: 内容疑似目录、页眉页脚、重复标题。
- `too_short`: 低于最小字符数，不能独立回答。
- `too_long`: 超过 parent slice 上限，需要再切。
- `duplicate_content`: 多个 slice 正文 hash 高度相同。
- `missing_source_document`: 缺 source provenance。
- `missing_section_path`: 缺逻辑章节路径。
- `orphan_chunk`: chunk 找不到 parent slice。
- `low_signal_terms`: related_terms / headings 缺少可检索业务词。

Severity:

- `error`: 不能纳入 active 检索，例如 orphan chunk、缺 parent、无 source provenance。
- `warn`: 可检索但需要人工复核，例如 toc-like、too-short、duplicate。
- `info`: 可优化问题，例如 related_terms 偏少。

Default behavior:

- MVP 不阻塞初始化成功，但必须输出 warning、report path 和 issue count。
- 后续可通过 `--quality-gate strict` 或配置开启 error 阻塞。

Alternatives considered:

- 在 ingest 时直接丢弃低质量 slice。暂不采用：可能误删有价值内容；先报告、再由人工确认。
- 把质量审核交给模型。暂不作为默认：成本、稳定性和隐私不可控；可作为后续可选审计器。

### 2. Evidence Judge 采用“确定性规则 + 可选语义评估”分层

Decision:

- 保留当前本地确定性规则作为最低安全层。
- 增加更细的 score breakdown：`relevance`、`coverage`、`source_authority`、`freshness`、`version_match`、`agreement`、`actionability`、`ambiguity_penalty`、`risk_penalty`。
- 增加 `judge.rationale` 和 `judge.blockers`，便于日志和测试解释。
- 如配置了模型，可增加 bounded model-assisted semantic check，但它只能输出结构化 judge 辅助字段，不能直接回复用户。

Must-block signals:

- 实现细节、接口路径、文件路径、日志、表名、配置项、当前项目/代码库、follow-up 指代。
- 生产事故、数据修复、支付、权限、安全。
- 只有目录片/空片/低质量片命中。
- active 与 deprecated/archived/review_required 文档冲突。
- 文档过期且问题依赖当前实现或当前产品状态。

False-positive controls:

- 如果 top hit 只匹配泛词，例如“课程/配置/功能/怎么”，但缺少业务实体或标题覆盖，应降低 answer_score。
- 如果 query module 和 top hit module 不一致，且没有 alias/taxonomy 支撑，应要求补检或升级。
- 如果 evidence excerpt 不包含可回答动作或规则句，应标记 `missing_info: ["可回答证据句"]`。

Alternatives considered:

- 完全模型化 Judge。拒绝：会让安全边界依赖模型稳定性，也更难测试。
- 继续只用当前规则。拒绝：泛词召回和白皮书噪音会导致误答风险。

### 3. Deep Query Correction 由“上下文提示”升级为“受限重试控制”

Decision:

- 在 runtime 中维护 deep query attempt 状态，最多执行有限次数，默认最多 2 次 worker run。
- 第一次 worker 结果如果证据不足、missingInfo 指向未查到、或 review 要求继续，Query Correction 可选择下一轮 pivot。
- retry 仍构造标准 `DiagnosticRequest`，通过现有 worker port 派发。
- correction 结果只进入 `DiagnosticRequest.context.deepQuery` 和 constraints，不改变 Claude Code 只读策略。

Attempt state:

```ts
{
  attempt: 1,
  maxAttempts: 2,
  artifactTargets: ["scheduler"],
  anchorTerms: ["学习提醒", "8点"],
  triedQueries: ["scheduler reminder"],
  failedReasons: ["no scheduler evidence"],
  nextPivot: "queue_callback_state",
  stopReason?: "max_attempts" | "sufficient_evidence" | "needs_user" | "human_escalation"
}
```

Pivot families:

- scheduler -> queue / callback / state_machine
- route -> controller / service / config
- payment -> order / refund / permission / audit log
- permission -> auth / role / policy / tenant scope
- config -> env / settings / feature flag / admin UI

Stop conditions:

- 已获得足够 evidence。
- 达到 `maxAttempts`。
- 风险高，需要人工。
- 下一步需要用户提供 traceId、tenant、环境或时间范围。

Alternatives considered:

- 让 Claude Code 自行多轮探索。拒绝：会丢失 super helper 的审计和停止条件。
- runtime 无限 retry。拒绝：成本不可控，也可能污染会话。

### 4. 真实验收作为 CLI / script 能力，不写入普通单测

Decision:

- 增加本地 acceptance 命令或脚本，例如 `npm run accept:knowledge` 或 `node dist/cli.js accept knowledge`。
- 验收命令应读取当前配置，但输出必须脱敏，不打印 API key、token、cookie。
- 验收覆盖真实远程模型、Claude Code 可执行性、knowledge direct answer、no-hit escalation、implementation detail escalation。
- 普通 CI 仍使用 mock 测试；真实验收由用户本机按需运行。

Acceptance report:

- 输出 JSON 或 Markdown 到 `reports/knowledge-acceptance-<timestamp>.json`。
- 记录每个 scenario 的 pass/fail、caseId、关键日志 phase、worker 是否调用、deepQuery 是否附加。
- 不保存 secret，不保存完整 raw model payload。

Alternatives considered:

- 把真实远程调用放进 `pnpm test`。拒绝：不稳定、成本不可控、依赖本机认证。
- 只靠手工聊天验证。拒绝：不可重复、不可审计。

### 5. Case Curator Review 使用知识库内 review record，runtime 只编排状态流

Decision:

- solved case 草稿仍写到 `knowledge/tickets/solved-cases/<module-id>/`，默认 `status: review_required`。
- review 信息可以选择两种方式：
  - 写回 frontmatter 可选字段：`reviewer`、`reviewed_at`、`review_notes`。
  - 或写 sidecar：`<case>.review.json`。
- MVP 优先使用 frontmatter + optional sidecar，避免改 case JSON。
- 审核通过后才允许把 `status` 改为 `active`；拒绝则保持 `review_required` 或转到 unresolved case。
- 每次 review 状态变化必须写 dirty flag 并记录日志。

Review actions:

- `approve`: review_required -> active。
- `reject`: 保持 review_required，写 review_notes 和 rejection reason。
- `convert_to_unresolved`: 移到 unresolved-cases 或生成 unresolved copy。
- `request_edits`: 保持 review_required，提示需要补充 evidence、适用范围或风险说明。

Ownership:

- `src/knowledge/` 负责读写 solved case Markdown、frontmatter、review metadata、dirty flag。
- `src/runtime/` 负责在用户或 API 触发 review 动作时编排日志和状态。
- `src/gateway/` 仅在需要 API 时暴露 DTO。

Alternatives considered:

- 把 review 状态存在 case JSON。暂不采用：会扩大迁移风险。
- 自动把所有 solved case 激活。拒绝：会固化错误结论。

### 6. 文档更新纳入本 change

Decision:

- 更新 `docs/technical-architecture.md` 和 `docs/agent-design.md` 中与当前实现不一致的旧段落。
- 新增或更新验收文档，说明 knowledge hardening 的运行命令、报告位置和风险。

Rationale:

- 当前文档仍有“runtime 尚未接入 knowledge”之类上一阶段遗留描述。
- 下一轮执行前必须让架构文档与代码真实状态对齐。

## Risks / Trade-offs

- [Risk] 质量门禁过严导致可用知识无法检索。 -> Mitigation: 默认 warn，不默认 fail；strict gate 需要显式开启。
- [Risk] Judge 过度保守，太多问题升级代码。 -> Mitigation: 保留 answer_score breakdown 和日志，按真实样本调阈值。
- [Risk] Deep Query retry 增加成本和耗时。 -> Mitigation: 默认最多 2 次，且必须有 correction reason。
- [Risk] 真实验收误打印 secret。 -> Mitigation: 输出层统一脱敏，禁止打印 env/config secret 字段。
- [Risk] Review workflow 引入 HTTP API 后 gateway 混入业务逻辑。 -> Mitigation: gateway 只做 DTO；review 决策在 runtime/knowledge。
- [Risk] Case frontmatter 变复杂。 -> Mitigation: 新字段全是可选，frontmatter parser 保持兼容。

## Migration Plan

Phase 1: 文档和质量审计设计

- 更新架构文档旧描述。
- 定义 `chunk-quality-report.json` schema。
- 为真实白皮书生成一次质量基线报告。

Phase 2: Knowledge Quality Gate

- 实现 parent slice / chunk 质量审计。
- 接入 `knowledge:init` / `knowledge:update` 输出。
- 增加 fixture 覆盖空片、目录片、重复片、orphan chunk、missing provenance。

Phase 3: Evidence Judge Hardening

- 增加 score breakdown、blockers、false-positive controls。
- 增加过期、冲突、泛词误召回、低质量 slice、高风险等测试。
- 确保直答仍经过 Output Review / Presentation。

Phase 4: Deep Query Retry / Pivot

- 增加 deep query attempt state。
- 在 review 结果证据不足时允许一次受限 retry。
- 增加 scheduler -> queue/callback/state、route -> service/config 等 pivot 测试。

Phase 5: Live Acceptance

- 增加本机验收命令。
- 覆盖模型 provider、Claude Code、知识直答、no-hit 升级、实现细节升级。
- 生成脱敏 acceptance report。

Phase 6: Case Review Workflow

- 增加 review metadata 和状态转换。
- 接入 dirty flag、日志和可选 API。
- 增加 approve/reject/convert/request_edits 测试。

Rollback strategy:

- Quality report 是派生文件，可删除重建。
- Judge hardening 可通过配置降级到当前规则。
- Deep Query retry 可通过 `maxAttempts: 1` 关闭。
- Acceptance command 不影响运行时。
- Case review 字段必须可选；旧 solved case 仍可读取。

## Open Questions

- 质量门禁 strict 模式是否要作为默认，还是只在用户显式运行 acceptance 时启用？
- Case review 是否先做 CLI，还是直接做 HTTP API + UI？
- Reviewer 身份在本地单用户模式下用 `local-user`、配置 owner，还是要求显式输入？
- 可选模型辅助 Judge 是否进入这一轮执行，还是只预留接口？
- Live acceptance 是否允许真实调用 Claude Code，还是第一版只验证 Claude CLI 可用并用 mock worker 做行为验收？
