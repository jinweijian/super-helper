# Redmine-first 历史案例调查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让启用 Redmine 历史来源的 super-helper 在每个可诊断问题中并行查询知识、经验和工单，以历史案例生成只读检查项，再由当前项目证据决定“可解决、不能解决、仅方向有帮助”。

**Architecture:** Redmine 作为独立 stdio MCP 进程，只暴露两个固定项目、GET-only、隐私过滤后的工具。Runtime 在 Preflight 后进入单一 `CaseInvestigationTurnService`，并行收集 Knowledge、Experience 和 Redmine evidence，必要时固定调用一次只读 Worker，最后通过确定性双侧证据门禁和现有 Review/Presentation 只生成一条回复。

**Tech Stack:** TypeScript 5.8、Node.js 20.19+、`@modelcontextprotocol/sdk` 1.29.0、Zod 4、原生 `fetch`、Vue 3、Node test runner、Vitest、OpenSpec。

## Global Constraints

- 权威设计：`docs/superpowers/specs/2026-08-20-redmine-first-case-investigation-design.md` 与 `openspec/changes/add-redmine-case-investigation/`。
- 用户已明确授权在当前目录、当前 `master` 实施；不创建或修改外部功能工作树。
- 配置了 historical source 的 workspace，每个 Preflight `dispatch` 恰好搜索一次 Redmine；模型只能生成查询，不能决定是否查询。
- 固定 origin `https://redmine.codeages.work`、固定 project `itsupportknowledge`、候选 10 条、详情 3 条、详情总预算 48,000 Unicode 字符。
- 私有备注永久删除；姓名、用户名、邮箱、IP、手机号、人员 ID、附件名/URL/token/body、未知 custom fields 和 raw error 都不能离开 Redmine MCP 边界。
- MCP 只允许 `redmine_search_issues` 与 `redmine_get_issue_case_details`，所有 Redmine HTTP 请求必须是 GET。
- Knowledge、Experience、完整 Redmine 分支以 `Promise.allSettled` 并行；任何快分支都不能提前回复。
- 有有效历史 lead 和 checks 时恰好调用一次只读 Worker；Worker 不查 Redmine、不做最终分类、不执行 deep-query follow-up。
- `same_root_cause_likely` 必须同时有本轮 Redmine `mcp` evidence 和本轮 `workspace`/`log` evidence；只有历史 evidence 时只能是初步方向。
- Case、日志和 API DTO 不持久化查询词、未选候选、未引用详情、模型 reason、完整验证计划、人员身份、正文、URL、凭证或 raw error。
- 默认测试完全离线；真实验收必须显式使用真实 Redmine、真实模型、真实 Worker、正式 stdio MCP 和正式 Runtime，缺依赖直接失败，不允许 fake fallback。
- 每个代码任务执行 Red-Green-Refactor；每完成一个 OpenSpec 子任务立即更新 `tasks.md` 和 `implementation-notes.md`。

---

## Task 1: 配置与 capability 合同

**Files:**
- Create: `test/historical-case-config.test.mjs`
- Modify: `src/contracts/base.ts`
- Modify: `src/config/contracts.ts`
- Modify: `src/config/io.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/onboarding/config-commit.ts`
- Modify: `src/mcp/contracts.ts`

**Interfaces:**

```ts
export interface HistoricalCaseSourceConfig {
  serverId: string;
}

export interface HistoricalCaseMcpCapability {
  type: 'historical_case';
  provider: 'redmine';
}

// WorkspaceConfig
historicalCaseSources?: HistoricalCaseSourceConfig[];

// McpServerBase
capability?: HistoricalCaseMcpCapability;
```

- [ ] 先测试旧配置兼容、round-trip、onboarding 保留，以及未知/disabled/read_write/未 allowlist server、错误 capability、多 source 的拒绝行为。
- [ ] 运行 `pnpm build && node --test test/historical-case-config.test.mjs test/onboarding.test.mjs`，记录合同缺失的 RED。
- [ ] 实现可选字段和集中校验；source 只允许 `serverId`，配置不得出现 URL/project/credential/`includePrivateNotes`。
- [ ] 重跑专项与 `pnpm typecheck`，记录 GREEN 并提交 `feat: add historical case source configuration`。

---

## Task 2: 固定范围 Redmine REST 搜索

**Files:**
- Modify: `src/mcp-servers/redmine/redmine-api/protocol.ts`
- Modify: `src/mcp-servers/redmine/redmine-api/client.ts`
- Create: `src/mcp-servers/redmine/redmine-api/search.ts`
- Create: `test/redmine-api-client.test.mjs`
- Create: `test/fixtures/redmine/search-results.json`
- Create: `test/fixtures/redmine/issues-page.json`

**Interfaces:**

```ts
export type RedmineSearchBackend = 'rest_search' | 'issues_scan';

export interface RedmineSearchPort {
  search(input: { query: string; signals: string[]; limit: 10 }): Promise<RawIssueCandidate[]>;
  details(issueIds: readonly number[]): Promise<RawIssueDetails[]>;
}

export function createRedmineSearch(input: {
  client: RedmineApiClient;
  backend: RedmineSearchBackend;
  projectIdentifier: 'itsupportknowledge';
  maxPages: number;
  updatedWithinDays: number;
  cacheTtlMs: 300_000;
}): RedmineSearchPort;
```

- [ ] 先测试 Search/Issues GET 参数、`status_id=*`、固定 origin/project、候选项目数值 ID 复核、有界分页、5 分钟内存缓存、timeout/401/403/429/5xx/非法 schema。
- [ ] 运行 `pnpm build && node --test test/redmine-api-client.test.mjs`，记录 RED。
- [ ] 用严格 Zod schema 扩展现有 probe client；启动时冻结 backend，请求期间不得降级到另一 backend 或扩大项目。
- [ ] 仅 429/5xx 最多重试一次；401/403/schema 错误不重试；所有异常映射为稳定安全码。
- [ ] 重跑专项，确认捕获的每个请求 `method === 'GET'`，记录 GREEN 并提交 `feat: add bounded Redmine search adapter`。

---

## Task 3: 隐私归一化与 48K 结构预算

**Files:**
- Create: `src/mcp-servers/redmine/redmine-api/normalizer.ts`
- Create: `src/mcp-servers/redmine/redmine-api/bounding.ts`
- Create: `test/redmine-normalizer.test.mjs`
- Create: `test/fixtures/redmine/issue-sensitive.json`

**Interfaces:**

```ts
export function normalizeIssueCandidate(raw: unknown): RedmineIssueCandidate;
export function normalizeIssueDetails(raw: unknown): RedmineIssueCaseDetails;
export function boundCaseDetails(
  details: readonly RedmineIssueCaseDetails[],
  maxCharacters?: 48_000,
): { details: RedmineIssueCaseDetails[]; omittedBlocks: number; truncated: boolean };
```

- [ ] 先放入私有 journal、姓名/账号/邮件/IP/手机号/人员 ID、附件名/URL/token/body、未知字段和 raw error 诱饵，证明未实现路径 RED。
- [ ] 实现输出白名单：private journal 无条件删除；人员字段删除；附件仅 `mimeType`、`size`、`count`；custom fields 仅显式 allowlist。
- [ ] 按完整 evidence block 从低优先级开始删除，禁止截断 JSON 或 block；返回 omitted/truncated metadata。
- [ ] 运行 `pnpm build && node --test test/redmine-normalizer.test.mjs`，扫描序列化输出不存在诱饵与 `includePrivateNotes`，记录 GREEN 并提交。

---

## Task 4: 两个只读 MCP 工具和 stdio 进程

**Files:**
- Create: `src/mcp-servers/redmine/candidate-grants.ts`
- Create: `src/mcp-servers/redmine/tools/search-issues.ts`
- Create: `src/mcp-servers/redmine/tools/get-issue-case-details.ts`
- Create: `src/mcp-servers/redmine/server.ts`
- Create: `src/mcp-servers/redmine/config.ts`
- Create: `src/mcp-servers/redmine/transports/stdio.ts`
- Create: `src/mcp-servers/redmine/main.ts`
- Create: `test/redmine-mcp-server.test.mjs`
- Create: `test/redmine-mcp-stdio.test.mjs`
- Modify: `package.json`

**Interfaces:**

```ts
const SearchInput = z.object({
  query: z.string().max(500),
  signals: z.array(z.string().max(120)).max(20),
}).strict();

const DetailInput = z.object({
  searchId: z.string().uuid(),
  issueIds: z.array(z.number().int().positive()).min(1).max(3),
}).strict();
```

- [ ] 先测试 listTools 只返回两个名字，schema 禁止 transport/project/credential，search 最多 10，detail 只能读取 live grant 内最多 3 个唯一 ID。
- [ ] 实现短 TTL `searchId → candidate IDs` grant，所有未知/过期/重复/越限 ID 在 REST 请求前拒绝。
- [ ] stdio 入口只从环境接收 materialized `REDMINE_API_KEY` 与有界预算，不读取 secrets 文件；普通 stdout 只属于 MCP 协议。
- [ ] 用真实 MCP SDK `StdioClientTransport` 完成 fixture list/search/detail 往返。
- [ ] 增加 `super-helper-redmine-mcp` bin、offline/real acceptance scripts，构建后断言 `dist/mcp-servers/redmine/main.js` 存在；记录 RED/GREEN 并提交。

---

## Task 5: 主应用 HistoricalCaseEvidenceService

**Files:**
- Create: `src/mcp/historical-case-evidence-service.ts`
- Modify: `src/mcp/normalizer.ts`
- Create: `test/historical-case-evidence-service.test.mjs`

**Interfaces:**

```ts
export type HistoricalCaseSourceStatus = 'completed' | 'no_hit' | 'timeout' | 'failed';

export interface HistoricalCaseEvidenceOutcome {
  status: HistoricalCaseSourceStatus;
  candidates: RedmineIssueCandidate[];
  details: RedmineIssueCaseDetails[];
  evidence: Evidence[];
  coverageEnvelopes: EvidenceCoverageEnvelope[];
  searchId?: string;
  safeErrorCode?: string;
}

export class HistoricalCaseEvidenceService {
  search(request: HistoricalSearchRequest): Promise<HistoricalSearchOutcome>;
  details(request: HistoricalDetailsRequest): Promise<HistoricalCaseEvidenceOutcome>;
}
```

- [ ] 先测试 source/capability/permission/allowlist、search→detail 同 grant、状态不混淆、provenance、48K structured result，以及历史结果不能直接生成 final answer。
- [ ] 仅对 `historical_case/redmine` capability 使用 schema-aware 48K 路径，普通 MCP 继续使用现有 20K 归一化。
- [ ] 服务必须通过现有 `executeMcpTool` 运行 stdio transport，并产生本轮 readOnly/allowlisted/completed coverage envelope。
- [ ] 运行专项和 legacy MCP 测试，记录 GREEN 并提交。

---

## Task 6: 四个产品 Agent 与严格模型服务

**Files:**
- Create: `src/agents/historical-search-query-planner.md`
- Create: `src/agents/historical-case-reranker.md`
- Create: `src/agents/historical-case-analyzer.md`
- Create: `src/agents/historical-case-verifier.md`
- Modify: `src/agents/registry.json`
- Modify: `src/agents/README.md`
- Create: `src/runtime/case-investigation/contracts.ts`
- Create: `src/runtime/case-investigation/query-planner-service.ts`
- Create: `src/runtime/case-investigation/candidate-reranker-service.ts`
- Create: `src/runtime/case-investigation/historical-case-analyzer-service.ts`
- Create: `src/runtime/case-investigation/historical-case-verifier-service.ts`
- Create: `test/historical-case-model-services.test.mjs`

**Interfaces:**

```ts
type HistoricalClassification =
  | 'same_root_cause_likely'
  | 'same_symptom_different_cause'
  | 'diagnostic_lead_only'
  | 'irrelevant';

type ReadOnlyCheckAction =
  | 'read_file'
  | 'search_workspace'
  | 'inspect_config'
  | 'inspect_log'
  | 'run_read_only_command';
```

- [ ] 注册四个 `mayProduceUserFacingText=false` 的 Agent；不得新增/保留 Current Evidence Assessor。
- [ ] 先测试 planner 异常仍返回确定性 fallback 查询，reranker 只能选择候选内 3 个唯一 ID，Analyzer 每条 lead 绑定 evidence/check/action，Verifier 不得新增事实或 ID。
- [ ] 每个服务用集中 Agent config、Zod `strict()` 与确定性引用校验；非法 JSON、越界 schema 和模型异常均有 fail-open 结果。
- [ ] 返回对象删除模型 raw output/reason；运行专项、agent registry 测试，记录 GREEN 并提交。

---

## Task 7: Evidence-only collectors

**Files:**
- Modify: `src/runtime/knowledge-turn.ts`
- Modify: `src/runtime/experience-turn.ts`
- Modify: `src/runtime/worker-diagnosis.ts`
- Create: `test/case-investigation-collectors.test.mjs`

**Interfaces:**

```ts
KnowledgeTurnService.collect(request): Promise<KnowledgeCollectionOutcome>;
ExperienceTurnService.collect(request): Promise<ExperienceCollectionOutcome>;
WorkerDiagnosisService.collectEvidence(input: {
  request: DiagnosticRequest;
  leads: readonly VerifiedHistoricalLead[];
}): Promise<WorkerEvidenceOutcome>;
```

- [ ] 先测试三个 collect 都不创建 Run、Review、Presentation 或 helper reply，也不修改共享 request。
- [ ] `answer()` 复用 `collect()`，确保旧 workspace 行为保持；配置 historical source 时 Experience/Knowledge 不能早停。
- [ ] Worker collector 合并所有有效 lead 为一次 ephemeral bounded request，不执行 deep-query follow-up；persisted request 不含历史正文/reason/完整计划。
- [ ] 校验 action allowlist 和支持/反证结果；运行现有 answer/diagnose 回归与专项，记录 GREEN 并提交。

---

## Task 8: 并行编排、自动 Worker 与确定性门禁

**Files:**
- Create: `src/runtime/case-investigation/parallel-source-collector.ts`
- Create: `src/runtime/case-investigation/redmine-branch.ts`
- Create: `src/runtime/case-investigation/worker-verification.ts`
- Create: `src/runtime/case-investigation/historical-case-gate.ts`
- Create: `src/runtime/case-investigation/result-builder.ts`
- Create: `src/runtime/case-investigation/case-investigation-turn-service.ts`
- Modify: `src/runtime/diagnostic-runtime.ts`
- Modify: `src/gateway/application-context.ts`
- Create: `test/case-investigation-runtime.test.mjs`
- Create: `test/historical-case-gate.test.mjs`

**Production flow:**

```text
Preflight dispatch
  -> Promise.allSettled(Knowledge.collect, Experience.collect, Redmine branch)
  -> Redmine: planner -> search exactly once -> rerank -> details at most once -> analyzer
  -> valid leads: Worker.collectEvidence exactly once
  -> verifier -> deterministic gate -> result builder
  -> one sanitized Run -> one Review/Presentation -> one helper reply
```

- [ ] 用 deferred Promise 先证明三个来源同时启动、任何快分支不能提前回复、barrier 保留所有 terminal status。
- [ ] 实现 Redmine 分支内串行和跨来源 `Promise.allSettled`；planner fallback 也必须搜索一次。
- [ ] 有任一合法 lead/check 时固定一次只读 Worker；非法 action 阻止派发；三条工单也只能有一次 Worker 调用。
- [ ] gate 测试双侧 evidence 通过；仅历史、旧 envelope、user claim、source failure、Worker 反证、Knowledge 冲突均降级。
- [ ] 配置 source 的 dispatch 从旧 early-return 前进入 collaborator；无 source 的 workspace 保留原路径。
- [ ] 每回合只创建一个 sanitized Run、调用一次 `reviewAndFormat()` 与 `completePresentedTurn()`；公共 DTO shape 不变。
- [ ] 跑专项、runtime/gateway/session 回归，记录 RED/GREEN 并提交。

---

## Task 9: 可观测性、Dashboard 与文档

**Files:**
- Create: `src/runtime/event-recorder/case-investigation.ts`
- Modify: `src/runtime/event-recorder/index.ts`
- Modify: `src/observability/`
- Modify: `web/src/`
- Modify: `docs/standards/development.md`
- Modify: `docs/standards/module-boundaries.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/agents.md`
- Create: `docs/operations/redmine-case-investigation.md`
- Create: `test/case-investigation-observability.test.mjs`

- [ ] 先测试 Agent/MCP/Worker actor 身份，以及 event/Case/API logs 不含 query、signals、body、identity、URL、key、reason、plan、raw error。
- [ ] 只记录阶段、白名单状态、安全错误码、耗时、数量、safe IDs、degraded 和 Worker flag；observability 不参与诊断决策。
- [ ] Dashboard 显示“查询知识与工单、分析案例、验证当前项目、交叉审核”，继续复用 async 202 与 session polling。
- [ ] runbook 写 SecretRef、stdio、预算、灰度、回滚、manifest 与故障定位，不写真实工单正文/凭证。
- [ ] 运行专项、`pnpm test:web`、`pnpm lint`，记录 GREEN 并提交。

---

## Task 10: 离线正式边界验收与兼容

**Files:**
- Create: `test/redmine-case-investigation-offline.test.mjs`
- Modify: `package.json`
- Modify: relevant boundary/privacy/compatibility tests

- [ ] 使用真实 MCP SDK stdio fixture 与正式 Runtime 覆盖 `resolved_by_ticket`、`not_resolved_by_ticket`、`direction_helpful` 三类结构门禁。
- [ ] 断言只有两个读工具、无 write endpoint、所有捕获请求 GET、默认测试不联网、旧 config/Case 可读、公共 API shape 不变。
- [ ] 对 Case JSON、`/api/logs` 和 helper reply 运行敏感诱饵扫描。
- [ ] 运行 `pnpm acceptance:redmine:offline` 与 `pnpm test`，记录精确计数和 GREEN 并提交。

---

## Task 11: 真实 Redmine + 真实项目 E2E

**Files:**
- Create: `scripts/verify-redmine-case-investigation-real.mjs`
- Modify: `package.json`
- Modify: `openspec/changes/add-redmine-case-investigation/implementation-notes.md`
- External, untracked: `~/.super-helper/acceptance/redmine-case-investigation.json`

**Manifest contract:**

```json
{
  "version": 1,
  "scenarios": [
    { "id": "resolved_by_ticket", "prompt": "...", "expected": "resolved_by_ticket" },
    { "id": "not_resolved_by_ticket", "prompt": "...", "expected": "not_resolved_by_ticket" },
    { "id": "direction_helpful", "prompt": "...", "expected": "direction_helpful" }
  ]
}
```

- [ ] 脚本显式读取用户目录 manifest 和既有 SecretRef，确认 workspace 是真实 git 仓库、模型配置真实、Worker 为 `ClaudeCodeWorker`、MCP 是正式 stdio 进程、Runtime 是生产 composition；缺一项非零退出。
- [ ] 在不输出正文的前提下选择三个稳定 scenario；期望写入运行前的 manifest，脚本不得按实际输出改写。
- [ ] 运行 `pnpm acceptance:redmine:real -- --manifest <absolute-path> --workspace /Users/king/website/edusoho`。
- [ ] `resolved_by_ticket` 必须有 current+Redmine evidence；`not_resolved_by_ticket` 不得把历史包装成结论；`direction_helpful` 只能输出初步方向。
- [ ] 审计 HTTP method、tool names、Case、logs、报告：全部 GET、只有两个工具、无私密备注/身份/raw body/URL/key/write action。
- [ ] 只把 scenario ID、分类、source status、evidence kinds/IDs、Review decision 和只读计数写入 implementation notes；真实正文继续留在用户目录。

---

## Task 12: Anti-fake-complete、全量验证与 master 提交

**Files:**
- Modify: `openspec/changes/add-redmine-case-investigation/tasks.md`
- Modify: `openspec/changes/add-redmine-case-investigation/implementation-notes.md`

- [ ] 逐入口追踪 CLI/config → MCP stdio → Redmine REST → grant → details → Analyzer → Worker → gate → Review → Presentation，记录生产调用证据。
- [ ] 扫描 real E2E 不注入 fake client/evidence/model/worker，offline tests 使用正式 SDK/Runtime 边界，生产代码无测试专用分支。
- [ ] 审计模块边界、旧 artifact/cache/schema、默认联网/费用和数据泄漏；发现问题直接修正并重跑，不只记录。
- [ ] 运行：

```bash
openspec status --change add-redmine-case-investigation --json
pnpm lint
pnpm typecheck
pnpm build
node --test test/redmine-*.test.mjs test/historical-case-*.test.mjs test/case-investigation-*.test.mjs
pnpm test
pnpm test:web
pnpm acceptance:redmine:offline
pnpm acceptance:redmine:real -- --manifest "$MANIFEST" --workspace /Users/king/website/edusoho
git diff --check
```

- [ ] 检查 `/Users/king/website/edusoho` 仍为 `develop @ 483eecf201f` 且无本任务写入；外部 `codex/redmine-case-investigation` 工作树 dirty diff 与基线一致。
- [ ] 对照 proposal/design/spec/tasks/本计划逐条勾选，有直接证据后提交当前 `master`；不 push，除非用户另行要求。
