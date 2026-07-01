# Answer Contract Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 main Agent 成为“问题目标契约”的 owner，并让 Experience、RAG、Worker、Output Review、Presentation 都围绕同一个 Answer Contract 工作；RAG 结果即使只能部分回答，也要萃取可用结论并带入后续升级诊断。

**Architecture:** 在 runtime 早期生成 `AnswerContract`，作为当前 turn 的共享目标契约；RAG 阶段升级为 `RAG Answerability Agent`，输出 `full | partial | none`、已覆盖 claim、缺失要素和升级焦点。main/runtime 根据契约调度：full 走知识库直答，partial 带着已萃取知识升级代码排查，none 直接升级；最终 Output Review 审核合并证据，Presentation 只负责基于契约组织回答。

**Tech Stack:** TypeScript runtime pure functions, existing Agent markdown registry, existing DiagnosticRequest/DiagnosticResult contracts, Node test runner, pnpm lint/typecheck/build/test.

---

## 当前需求梳理

用户关注的核心不是单点 RAG 召回，而是多 Agent 协作目标跑偏：

1. **所有 Agent 都需要理解同一个问题目标。**
   每个 Agent 可以职责不同，但必须知道用户真正要的答案是什么、哪些要素必须覆盖、哪些信息只能作为上下文。

2. **main Agent 不只是流程入口，而应该是协同调度者。**
   main 要负责生成并维护公共 `AnswerContract`，约束下游 Agent 的输入输出，并在阶段之间传递“已覆盖/未覆盖/下一步焦点”。

3. **RAG 不能只有“直答/丢弃”两种结果。**
   知识库只回答一部分时，必须提炼有效部分，把缺口和可用上下文一起交给升级策略。

4. **RAG 评分要从“相关性”升级为“答案充分性”。**
   `matched_terms`、title、module、source type 只能说明召回相关，不能授权直答。直答必须看 evidence 是否覆盖 `AnswerContract.mustAnswer`。

5. **最终回答要合并多来源证据。**
   partial RAG + code review 结果都应进入 Output Review，再由 Presentation 按原问题目标总结，减少追问概率。

## 目标工作流

### 1. 用户消息进入 main/runtime

```text
User message
  -> Load current case context
  -> Build ResolvedTurnContext
  -> Build AnswerContract
```

`AnswerContract` 是本轮协作目标，至少包含：

```ts
export interface AnswerContract {
  originalQuestion: string;
  resolvedQuestion: string;
  questionType:
    | 'definition'
    | 'feature_overview'
    | 'configuration_location'
    | 'operation_procedure'
    | 'troubleshooting_cause'
    | 'rule_explanation'
    | 'bug_or_behavior'
    | 'unknown';
  userNeed: string;
  mustAnswer: AnswerRequirement[];
  usefulContext: AnswerRequirement[];
  missingTolerance: 'full_required' | 'partial_allowed_with_escalation';
  finalAnswerExpectation: string;
}
```

示例：`学员管理的学员数据统计里面缺少6月份的数据...如何补上...有没有现成的命令行处理`

```json
{
  "questionType": "operation_procedure",
  "userNeed": "补齐缺失月份的学员统计数据",
  "mustAnswer": [
    { "id": "backfill_method", "label": "补数据方式或命令" },
    { "id": "command_name", "label": "现成命令名称或入口" },
    { "id": "month_scope", "label": "如何指定6月份范围" },
    { "id": "execution_caveat", "label": "执行前后注意事项或验证方式" }
  ],
  "usefulContext": [
    { "id": "stat_generation_source", "label": "统计数据生成来源，例如定时任务" }
  ],
  "missingTolerance": "partial_allowed_with_escalation"
}
```

### 2. Experience 复用阶段

```text
AnswerContract
  -> Experience Agent
  -> only reuse when source answer covers the same mustAnswer items
```

经验复用不能只看相似问题文本，必须判断历史答案是否覆盖当前 `mustAnswer`。如果只覆盖部分，可以作为 history partial context，但不能直接复用成最终答案。

### 3. RAG 检索与 Answerability 阶段

```text
AnswerContract
  -> Knowledge Router / Retrieval
  -> RAG Answerability Agent
     -> full: build knowledge DiagnosticResult
     -> partial: extract coveredClaims + escalate with missingElements
     -> none: escalate with focused missingElements
```

RAG Answerability 输出：

```ts
export interface RagAnswerabilityResult {
  answerability: 'full' | 'partial' | 'none' | 'unknown';
  selectedEvidenceIds: string[];
  coveredClaims: RagCoveredClaim[];
  missingElements: string[];
  shouldEscalate: boolean;
  escalationFocus: string;
  reason: string;
}
```

关键原则：

- `full`：覆盖全部关键 `mustAnswer`，可以进入知识直答。
- `partial`：至少有一部分可用事实，但不足以最终回答；必须升级，并把 `coveredClaims` 带入 worker。
- `none`：相关但不回答，或无有效证据；升级。
- `unknown`：模型失败或返回不可用。若本地契约判断当前问题需要操作步骤、命令、原因、入口等强答案形态，则保守升级；不要默认放行。

### 4. 代码升级阶段

```text
partial/none RAG
  -> DiagnosticRequest.context.answerContract
  -> DiagnosticRequest.context.knowledge.answerability
  -> DiagnosticRequest.context.deepQuery
  -> Worker investigates missingElements
```

Worker 请求中必须明确：

- 用户真正目标是什么。
- RAG 已确认哪些事实。
- RAG 缺哪些答案要素。
- 本次代码排查要优先补哪些缺口。

### 5. Output Review 合并审核

```text
RAG coveredClaims + Worker claims
  -> Output Review
  -> verify every final claim has evidence
  -> verify final coverage against AnswerContract
```

Output Review 不替代 RAG Answerability。它负责最终输出前的证据审核：

- RAG claim 是否仍有 evidence 支撑。
- Worker claim 是否有代码/日志/MCP evidence 支撑。
- 最终结论是否覆盖 `mustAnswer`。
- 哪些仍是 unknown，不能被 Presentation 漂白。

### 6. Presentation 最终回答

```text
Reviewed claims + AnswerContract
  -> Presentation
  -> answer original question first
  -> combine confirmed RAG part and worker part
```

Presentation 的目标不是套 persona 模板，而是把已审核事实组织成能减少追问的答案：

- 先回答用户问的问题。
- 如果 RAG 只提供了背景，要说“知识库确认了 X，但缺 Y，所以继续查了代码”。
- 如果最终还缺关键事实，要明确缺口和下一步，而不是伪装成结论。

## 文件结构

- Create: `src/runtime/answer-contract.ts`
  - 生成 `AnswerContract`。
  - 提供 `evaluateRequirementCoverage` 等纯函数。
  - 不调用模型、不读取文件、不写 case。

- Modify: `src/domain.ts`
  - 在 `DiagnosticRequestContext` 中新增可选 `answerContract?: AnswerContract`。
  - 在 `DiagnosticRequestContext.knowledge` 中新增可选 `answerability?: RagAnswerabilityResultSummary`。
  - 这是持久化 case JSON 的向后兼容扩展；旧 case 字段缺失时按 undefined 处理。

- Create: `src/runtime/rag-answerability-service.ts`
  - 替代当前 `EvidenceCoverageService` 的职责。
  - 输入 `AnswerContract + KnowledgeEvidencePack.results`。
  - 输出 full/partial/none/unknown、coveredClaims、missingElements、escalationFocus。
  - 模型输出必须经过确定性校验。

- Modify: `src/runtime/evidence-coverage-service.ts`
  - 删除或改成兼容 re-export。
  - 若保留，必须标记 deprecated，并转发到 `RagAnswerabilityService`，避免双逻辑。

- Create: `src/agents/rag-answerability.md`
  - 新 Agent prompt：判断 RAG 是否回答原问题、萃取有效部分、列缺口。
  - 明确不能新增事实，coveredClaims 必须引用 evidence。

- Modify: `src/agents/evidence-coverage.md`
  - 改为 deprecated 文档，指向 `rag-answerability.md`。

- Modify: `src/agents/registry.json`
  - 新增 `rag_answerability` stage。
  - 旧 `evidence_coverage` 可临时保留，避免 `/api/agents` 可观测性断裂。

- Modify: `src/runtime/agent-configs.ts`
  - `AgentStage` 新增 `'rag_answerability'`。

- Modify: `src/runtime/request-builder.ts`
  - 创建请求时生成并附加 `answerContract`。
  - follow-up 请求继承并更新同一个目标契约。

- Modify: `src/runtime/preflight-decision.ts`
  - 本地 preflight 构造 `DiagnosticRequest` 时也附加 `answerContract`。

- Modify: `src/runtime/knowledge-diagnosis.ts`
  - `prepareKnowledgeDiagnosis` 接收 `answerContract`。
  - `diagnosticResultFromKnowledge` 用 `coveredClaims` 生成 fact claims，不再用“知识库命中...可回答...”总括 claim。
  - `attachKnowledgeCodeEscalationContext` 把 partial RAG 结果写入 request context。

- Modify: `src/runtime/knowledge-turn.ts`
  - 调用 `RagAnswerabilityService`。
  - 不再在记录 `evidenceJudgeResult` 后原地 mutate `judge`。
  - full 直答，partial/none 升级。

- Modify: `src/runtime/deep-query-planner.ts`
  - 用 `answerContract.mustAnswer` 和 `answerability.escalationFocus` 生成更聚焦的 `artifactTargets/anchorTerms/likelyPaths`。

- Modify: `src/runtime/review-presentation.ts`
  - 给 Output Review 和 Presentation prompt 附加 `answerContract` 与 partial RAG 摘要。
  - 校验最终 reply 不能丢掉已审核关键结论。

- Modify: `src/runtime/presenter.ts`
  - rule-based fallback 也按 `AnswerContract` 先回答问题，不再依赖固定 persona 三段式。

- Modify: `src/runtime/event-recorder.ts`
  - 新增 `rag_answerability_started/result` 日志。
  - 记录 `answerContract` 摘要、covered claim ids、missing elements。
  - 避免保存可变对象引用。

- Modify: `src/config.ts`, `src/settings/contracts.ts`, `src/settings/model-settings.ts`, `src/ui.ts`
  - 配置项从 `useModelForEvidenceCoverage` 迁移为 `useModelForRagAnswerability`。
  - 保留旧字段作为兼容 alias。
  - UI 保存设置时不能因为字段缺失把开关重置为 true。

- Modify: `src/workers/claude/claude-prompts.ts`
  - Worker prompt 明确读取 `DiagnosticRequest.context.answerContract` 和 partial RAG 上下文。

- Modify: `src/agents/main.md`
  - 明确 main 是 `AnswerContract owner` 和协同调度者。
  - 删除/弱化固定 persona final answer templates，改为回答质量标准。

- Modify: `src/agents/input-review.md`
  - 输入审核输出应服务 Answer Contract，不直接形成最终结论。

- Modify: `src/agents/evidence-judge.md`
  - Evidence Judge 只做确定性 evidence gate；answerability 交给契约/Answerability 阶段。

- Modify: `src/agents/output-review.md`
  - 增加“最终 claims 是否覆盖 AnswerContract”的审核要求。

- Modify: `src/agents/presentation.md`
  - 增加“围绕 AnswerContract 组织回答”的约束。

- Modify: `src/agents/README.md`, `docs/agent-design.md`
  - 更新 Agent 协作模型和完整工作流。

- Test: `test/answer-contract.test.mjs`
  - 覆盖问题类型识别与 mustAnswer 生成。

- Test: `test/rag-answerability-service.test.mjs`
  - 覆盖 full/partial/none/unknown、非法 claim/evidence fallback。

- Test: `test/retrieval-grounding.test.mjs`
  - 覆盖相关但不回答、matched_terms 不能授权直答。

- Test: `test/supper-helper.test.mjs`
  - 覆盖 runtime partial RAG 升级、worker 接收 partial context、最终回复合并两类证据。

- Test: `test/conversation-evidence-lifecycle.test.mjs`
  - 覆盖 Presentation 不丢失结论、不固定模板。

- Test: `test/runtime-hardening.test.mjs`
  - 覆盖日志对象不因后续 mutation 改变。

## Task 1: 定义 AnswerContract 并写红绿测试

**Files:**
- Create: `src/runtime/answer-contract.ts`
- Modify: `src/domain.ts`
- Create: `test/answer-contract.test.mjs`

- [ ] **Step 1: 写 AnswerContract 测试**

Create `test/answer-contract.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerContract } from '../dist/runtime/answer-contract.js';

test('builds operation procedure contract for statistics backfill command questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计。有没有现成的命令行处理',
    resolvedQuestion: '学员管理的学员数据统计里面缺少6月份的数据，如何补上这个数据统计，有没有现成的命令行处理',
  });

  assert.equal(contract.questionType, 'operation_procedure');
  assert.equal(contract.missingTolerance, 'partial_allowed_with_escalation');
  assert.deepEqual(contract.mustAnswer.map((item) => item.id), [
    'operation_method',
    'command_or_entry',
    'scope_or_parameters',
    'verification_or_caveat',
  ]);
  assert.match(contract.finalAnswerExpectation, /可执行|命令|步骤/);
});

test('builds configuration location contract for entry questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课在哪配置的',
    resolvedQuestion: '班课在哪配置的',
  });

  assert.equal(contract.questionType, 'configuration_location');
  assert.deepEqual(contract.mustAnswer.map((item) => item.id), [
    'entry_path',
    'permission_or_role',
    'configurable_items',
  ]);
});

test('builds feature overview contract for what-is-and-functions questions', () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课是什么，有什么功能',
    resolvedQuestion: '班课是什么，有什么功能',
  });

  assert.equal(contract.questionType, 'feature_overview');
  assert.ok(contract.mustAnswer.some((item) => item.id === 'definition'));
  assert.ok(contract.mustAnswer.some((item) => item.id === 'capabilities'));
});
```

- [ ] **Step 2: 运行红测**

Run:

```bash
pnpm build && node --test test/answer-contract.test.mjs
```

Expected:

```text
FAIL Cannot find module '../dist/runtime/answer-contract.js'
```

- [ ] **Step 3: 实现 `src/runtime/answer-contract.ts`**

Create `src/runtime/answer-contract.ts`:

```ts
export type AnswerQuestionType =
  | 'definition'
  | 'feature_overview'
  | 'configuration_location'
  | 'operation_procedure'
  | 'troubleshooting_cause'
  | 'rule_explanation'
  | 'bug_or_behavior'
  | 'unknown';

export interface AnswerRequirement {
  id: string;
  label: string;
  description: string;
}

export interface AnswerContract {
  originalQuestion: string;
  resolvedQuestion: string;
  questionType: AnswerQuestionType;
  userNeed: string;
  mustAnswer: AnswerRequirement[];
  usefulContext: AnswerRequirement[];
  missingTolerance: 'full_required' | 'partial_allowed_with_escalation';
  finalAnswerExpectation: string;
}

export function buildAnswerContract(input: {
  originalQuestion: string;
  resolvedQuestion: string;
}): AnswerContract {
  const originalQuestion = bound(input.originalQuestion.trim(), 1600);
  const resolvedQuestion = bound(input.resolvedQuestion.trim(), 2000);
  const normalized = normalize(`${resolvedQuestion}\n${originalQuestion}`);

  if (/(在哪|哪里|入口|路径|位置|从哪).{0,20}(配置|设置)|(配置|设置).{0,20}(在哪|哪里|入口|路径|位置)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'configuration_location',
      userNeed: '找到功能配置入口和可配置范围',
      mustAnswer: [
        req('entry_path', '入口路径', '菜单、后台路径、路由或页面位置'),
        req('permission_or_role', '权限或角色', '哪些角色或权限可以进入该配置'),
        req('configurable_items', '可配置项', '该入口下能配置哪些内容'),
      ],
      usefulContext: [req('feature_context', '功能背景', '功能定义或适用模块')],
      missingTolerance: 'full_required',
      finalAnswerExpectation: '直接说明入口路径、权限/路由信息和主要可配置项。',
    });
  }

  if (/(怎么|如何|怎样|处理|补上|补齐|补数据|补统计|补跑|重跑|命令行|脚本|任务|定时任务|队列)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'operation_procedure',
      userNeed: '获得可执行的处理方式',
      mustAnswer: [
        req('operation_method', '处理方式', '明确采用命令、入口、任务或脚本中的哪一种方式处理'),
        req('command_or_entry', '命令或入口', '现成命令名称、入口路径、任务名称或脚本名称'),
        req('scope_or_parameters', '范围或参数', '如何指定对象、月份、时间范围或其他必要参数'),
        req('verification_or_caveat', '验证或注意事项', '执行后的验证方式、风险、前置条件或适用条件'),
      ],
      usefulContext: [
        req('generation_source', '生成来源', '相关数据由哪个任务、服务或流程产生'),
        req('known_cause', '已知原因', '用户已确认或知识库确认的背景原因'),
      ],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '给出可执行步骤；如无法确认现成命令，说明已确认部分和继续排查焦点。',
    });
  }

  if (/(为什么|原因|为何|失败|异常|报错|无法|缺少|没有数据|不生效)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: 'troubleshooting_cause',
      userNeed: '确认原因、影响和下一步处理',
      mustAnswer: [
        req('observed_symptom', '现象', '用户看到的现象或失败点'),
        req('cause_or_likely_cause', '原因或高置信推断', '有证据支持的原因或排查结论'),
        req('next_action', '下一步动作', '处理方式、验证方式或需要补充的信息'),
      ],
      usefulContext: [req('related_rule', '相关规则', '能帮助理解问题的产品规则')],
      missingTolerance: 'partial_allowed_with_escalation',
      finalAnswerExpectation: '区分已确认原因、推断和未知，并给出下一步处理。',
    });
  }

  if (/(是什么|什么是|有什么功能|有哪些功能|支持哪些|能做什么|能力)/.test(normalized)) {
    return contract({
      originalQuestion,
      resolvedQuestion,
      questionType: /功能|支持|能力|能做/.test(normalized) ? 'feature_overview' : 'definition',
      userNeed: '理解功能定义和能力范围',
      mustAnswer: [
        req('definition', '定义', '这个功能或概念是什么'),
        req('capabilities', '功能能力', '主要功能点、能力范围或典型使用场景'),
      ],
      usefulContext: [req('entry_or_scope', '入口或适用范围', '入口、角色、模块范围等补充信息')],
      missingTolerance: 'full_required',
      finalAnswerExpectation: '先解释是什么，再概括主要功能能力。',
    });
  }

  return contract({
    originalQuestion,
    resolvedQuestion,
    questionType: 'unknown',
    userNeed: '回答用户当前问题',
    mustAnswer: [req('direct_answer', '直接回答', '与原问题直接相关的答案')],
    usefulContext: [],
    missingTolerance: 'partial_allowed_with_escalation',
    finalAnswerExpectation: '围绕原问题直接回答；不足时说明缺口。',
  });
}

function contract(input: AnswerContract): AnswerContract {
  return input;
}

function req(id: string, label: string, description: string): AnswerRequirement {
  return { id, label, description };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function bound(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
```

- [ ] **Step 4: 扩展 domain 类型**

Modify `src/domain.ts`:

```ts
import type { AnswerContract } from './runtime/answer-contract.js';
```

Add inside `DiagnosticRequestContext`:

```ts
  answerContract?: AnswerContract;
```

Add inside `DiagnosticRequestContext.knowledge`:

```ts
    answerability?: {
      answerability: 'full' | 'partial' | 'none' | 'unknown';
      selectedEvidenceIds: string[];
      coveredClaims: Array<{
        id: string;
        text: string;
        evidenceIds: string[];
        coveredRequirementIds: string[];
        usefulness: string;
      }>;
      missingElements: string[];
      shouldEscalate: boolean;
      escalationFocus: string;
      reason: string;
    };
```

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build && node --test test/answer-contract.test.mjs
```

Expected:

```text
PASS test/answer-contract.test.mjs
```

## Task 2: 让 main/runtime 在请求早期生成并传递 AnswerContract

**Files:**
- Modify: `src/runtime/request-builder.ts`
- Modify: `src/runtime/preflight-decision.ts`
- Modify: `src/runtime/preflight-service.ts`
- Modify: `test/conversation-evidence-lifecycle.test.mjs`

- [ ] **Step 1: 写请求上下文测试**

Add to `test/conversation-evidence-lifecycle.test.mjs`:

```js
test('diagnostic request carries answer contract for every dispatch path', () => {
  const caseSession = minimalCase({
    id: 'case_answer_contract',
    userPersona: 'operations',
    messages: [{ id: 'msg_1', role: 'user', body: '班课在哪配置的', createdAt: new Date().toISOString() }],
  });
  const request = buildDiagnosticRequest({
    caseSession,
    userMessage: '班课在哪配置的',
    unknowns: [],
    config: minimalConfig(),
  });

  assert.equal(request.context.answerContract.questionType, 'configuration_location');
  assert.equal(request.context.answerContract.resolvedQuestion, '班课在哪配置的');
  assert.ok(request.constraints.some((item) => item.includes('AnswerContract')));
});
```

If local helpers have different names in this file, use the existing test fixture helpers from the same file and keep the assertions identical.

- [ ] **Step 2: 修改 `buildDiagnosticRequest`**

In `src/runtime/request-builder.ts`, import:

```ts
import { buildAnswerContract } from './answer-contract.js';
```

After `const resolvedTurn = ...`, add:

```ts
  const answerContract = buildAnswerContract({
    originalQuestion: userMessage,
    resolvedQuestion: resolvedTurn.resolvedQuery,
  });
```

After `attachCaseContext(caseSession, request);`, add:

```ts
  request.context!.resolvedTurn = resolvedTurn;
  request.context!.answerContract = answerContract;
```

Add to constraints:

```ts
      'Use DiagnosticRequest.context.answerContract as the shared goal contract; answer the mustAnswer items first and mark missing items as unknown.',
```

- [ ] **Step 3: 修改 follow-up 请求继承契约**

In `buildFollowUpDiagnosticRequest`, after `attachCaseContext(caseSession, request);`, add:

```ts
  request.context!.answerContract = previousRequest.context?.answerContract ?? buildAnswerContract({
    originalQuestion: request.context!.currentUserMessage,
    resolvedQuestion: previousRequest.userGoal,
  });
```

- [ ] **Step 4: 修改 preflight 本地路径**

In `src/runtime/preflight-decision.ts` and `src/runtime/preflight-service.ts`, whenever a model/local decision creates or mutates a `DiagnosticRequest`, ensure:

```ts
decision.request.context!.answerContract ??= buildAnswerContract({
  originalQuestion: decision.request.context?.currentUserMessage ?? userMessage,
  resolvedQuestion: decision.request.userGoal,
});
```

Use the existing local variable names in each file; do not create a root-level helper.

- [ ] **Step 5: 运行目标测试**

Run:

```bash
pnpm build && node --test test/conversation-evidence-lifecycle.test.mjs --test-name-pattern "answer contract"
```

Expected:

```text
PASS diagnostic request carries answer contract for every dispatch path
```

## Task 3: 用 RAG Answerability Agent 替代 Evidence Coverage 二元门禁

**Files:**
- Create: `src/agents/rag-answerability.md`
- Modify: `src/agents/evidence-coverage.md`
- Modify: `src/agents/registry.json`
- Modify: `src/runtime/agent-configs.ts`
- Create: `src/runtime/rag-answerability-service.ts`
- Modify: `src/runtime/evidence-coverage-service.ts`
- Create: `test/rag-answerability-service.test.mjs`

- [ ] **Step 1: 写 service 单测**

Create `test/rag-answerability-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RagAnswerabilityService } from '../dist/runtime/rag-answerability-service.js';
import { buildAnswerContract } from '../dist/runtime/answer-contract.js';

const evidence = [{
  evidence_id: 'ev_stat_task',
  title: '用户数据统计',
  summary: '用户数据统计由定时任务生成。',
  answer_span: '用户数据统计由定时任务每日生成。',
  excerpt: '用户数据统计由定时任务每日生成。',
  source: 'knowledge/faq/stats.md',
  status: 'active',
  confidence: 'high',
}];

function model(json) {
  return { complete: async () => json };
}

test('rag answerability extracts partial covered claims and requests escalation', async () => {
  const contract = buildAnswerContract({
    originalQuestion: '学员数据统计缺少6月份，如何补上，有没有命令行处理',
    resolvedQuestion: '学员数据统计缺少6月份，如何补上，有没有命令行处理',
  });
  const service = new RagAnswerabilityService(model(JSON.stringify({
    answerability: 'partial',
    selectedEvidenceIds: ['ev_stat_task'],
    coveredClaims: [{
      id: 'rag_claim_1',
      text: '用户数据统计由定时任务生成。',
      evidenceIds: ['ev_stat_task'],
      coveredRequirementIds: ['generation_source'],
      usefulness: '可作为补数排查背景',
    }],
    missingElements: ['现成命令名称', '月份参数', '执行验证方式'],
    shouldEscalate: true,
    escalationFocus: '查找统计补数命令、定时任务实现和历史重算入口',
    reason: '知识库只说明生成来源，未覆盖补数命令。',
  })), 'agent spec');

  const result = await service.evaluate({ contract, evidence });

  assert.equal(result.answerability, 'partial');
  assert.equal(result.shouldEscalate, true);
  assert.deepEqual(result.selectedEvidenceIds, ['ev_stat_task']);
  assert.match(result.coveredClaims[0].text, /定时任务/);
  assert.match(result.escalationFocus, /补数命令/);
});

test('rag answerability rejects nonexistent evidence ids', async () => {
  const contract = buildAnswerContract({
    originalQuestion: '班课在哪配置的',
    resolvedQuestion: '班课在哪配置的',
  });
  const service = new RagAnswerabilityService(model(JSON.stringify({
    answerability: 'full',
    selectedEvidenceIds: ['ev_missing'],
    coveredClaims: [{
      id: 'rag_claim_1',
      text: '班课在后台配置。',
      evidenceIds: ['ev_missing'],
      coveredRequirementIds: ['entry_path'],
      usefulness: '直接回答入口',
    }],
    missingElements: [],
    shouldEscalate: false,
    escalationFocus: '',
    reason: 'bad ids',
  })), 'agent spec');

  const result = await service.evaluate({ contract, evidence });

  assert.equal(result.answerability, 'unknown');
  assert.equal(result.shouldEscalate, true);
  assert.match(result.reason, /invalid evidence/i);
});
```

- [ ] **Step 2: 创建 Agent prompt**

Create `src/agents/rag-answerability.md`:

```md
---
id: rag-answerability
role: rag-answerability-and-extraction-judge
stage: rag_answerability
may_produce_user_facing_text: false
---

# RAG Answerability Agent

## Responsibility

判断 RAG 检索结果是否真正服务当前 AnswerContract，并萃取可用部分。它不直接回复用户、不新增事实，只输出结构化 answerability、covered claims、missing elements 和 escalation focus。

## Input Contract

- AnswerContract
- top-N knowledge evidence 的 id、title、summary、answer_span、excerpt

## Output Contract

```json
{
  "answerability": "full | partial | none",
  "selectedEvidenceIds": ["ev_1"],
  "coveredClaims": [
    {
      "id": "rag_claim_1",
      "text": "只来自 evidence 的可用事实",
      "evidenceIds": ["ev_1"],
      "coveredRequirementIds": ["generation_source"],
      "usefulness": "这部分事实对原问题的作用"
    }
  ],
  "missingElements": ["缺失的关键答案要素"],
  "shouldEscalate": true,
  "escalationFocus": "后续代码排查应该优先查什么",
  "reason": "一句话说明判断"
}
```

## Rules

- 必须先理解 AnswerContract.mustAnswer，再判断 evidence。
- `matched_terms`、字段命中、标题相似只能说明相关，不能说明已回答。
- `coveredClaims.text` 只能来自 evidence 的 title、summary、answer_span 或 excerpt，不得新增事实。
- `full` 只能在关键 mustAnswer 都被 evidence 覆盖时返回。
- `partial` 表示 evidence 有一部分事实有用，但不足以最终回答；必须给出 coveredClaims 和 missingElements。
- `none` 表示 evidence 没有可用于回答原问题的事实；coveredClaims 必须为空。
- 操作、补数、命令类问题如果缺少命令/入口/参数/验证方式，不能返回 full。
- 入口配置类问题如果缺少入口路径，不能返回 full。
- 故障原因类问题如果只有功能说明，不能返回 full。
```

- [ ] **Step 3: 注册 agent stage**

Modify `src/agents/registry.json` by adding:

```json
{
  "id": "rag-answerability",
  "role": "rag-answerability-and-extraction-judge",
  "stage": "rag_answerability",
  "configPath": "rag-answerability.md",
  "executionMode": "model_assisted"
}
```

Modify `src/runtime/agent-configs.ts`:

```ts
  | 'rag_answerability'
```

- [ ] **Step 4: 实现 service**

Create `src/runtime/rag-answerability-service.ts`:

```ts
import type { KnowledgeEvidenceResult } from '../knowledge/index.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { AnswerContract } from './answer-contract.js';
import { parseAgentModelJson } from './agent-model-review.js';

export type RagAnswerability = 'full' | 'partial' | 'none' | 'unknown';

export interface RagCoveredClaim {
  id: string;
  text: string;
  evidenceIds: string[];
  coveredRequirementIds: string[];
  usefulness: string;
}

export interface RagAnswerabilityResult {
  answerability: RagAnswerability;
  selectedEvidenceIds: string[];
  coveredClaims: RagCoveredClaim[];
  missingElements: string[];
  shouldEscalate: boolean;
  escalationFocus: string;
  reason: string;
}

interface ParsedRagAnswerability {
  answerability?: string;
  selectedEvidenceIds?: string[];
  coveredClaims?: RagCoveredClaim[];
  missingElements?: string[];
  shouldEscalate?: boolean;
  escalationFocus?: string;
  reason?: string;
}

export class RagAnswerabilityService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
    private readonly topN: number = 3,
  ) {}

  async evaluate(input: {
    contract: AnswerContract;
    evidence: KnowledgeEvidenceResult[];
  }): Promise<RagAnswerabilityResult> {
    const topEvidence = input.evidence.slice(0, this.topN);
    const evidencePayload = topEvidence.map((item) => ({
      id: item.evidence_id,
      title: item.title,
      summary: item.summary,
      answer_span: item.answer_span,
      excerpt: item.excerpt,
    }));

    const systemPrompt = `${this.agentSpec}

Return JSON only. Do not include markdown, comments, explanations, or text outside the JSON object.`;

    try {
      const response = await this.model.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ answerContract: input.contract, evidence: evidencePayload }, null, 2) },
      ], { json: true });
      const parsed = parseAgentModelJson<ParsedRagAnswerability>(response);
      return validateRagAnswerability(parsed, new Set(topEvidence.map((item) => item.evidence_id)), input.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return conservativeUnknown(input.contract, `rag answerability evaluation failed: ${message}`);
    }
  }
}

function validateRagAnswerability(
  parsed: ParsedRagAnswerability,
  validEvidenceIds: Set<string>,
  contract: AnswerContract,
): RagAnswerabilityResult {
  const answerability = normalizeAnswerability(parsed.answerability);
  const selectedEvidenceIds = safeStringArray(parsed.selectedEvidenceIds);
  const missingElements = safeStringArray(parsed.missingElements);
  const coveredClaims = safeClaims(parsed.coveredClaims);
  const allEvidenceIds = new Set([
    ...selectedEvidenceIds,
    ...coveredClaims.flatMap((claim) => claim.evidenceIds),
  ]);
  for (const evidenceId of allEvidenceIds) {
    if (!validEvidenceIds.has(evidenceId)) {
      return conservativeUnknown(contract, `invalid evidence id: ${evidenceId}`);
    }
  }
  if (answerability === 'full' && coveredClaims.length === 0) {
    return conservativeUnknown(contract, 'full answerability requires covered claims');
  }
  if ((answerability === 'partial' || answerability === 'none') && parsed.shouldEscalate === false) {
    return conservativeUnknown(contract, 'partial/none answerability must escalate');
  }
  return {
    answerability,
    selectedEvidenceIds,
    coveredClaims: answerability === 'none' ? [] : coveredClaims,
    missingElements,
    shouldEscalate: answerability !== 'full' || parsed.shouldEscalate === true,
    escalationFocus: typeof parsed.escalationFocus === 'string' ? parsed.escalationFocus : defaultEscalationFocus(contract),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

function conservativeUnknown(contract: AnswerContract, reason: string): RagAnswerabilityResult {
  return {
    answerability: 'unknown',
    selectedEvidenceIds: [],
    coveredClaims: [],
    missingElements: contract.mustAnswer.map((item) => item.label),
    shouldEscalate: contract.missingTolerance === 'partial_allowed_with_escalation' || contract.questionType !== 'definition',
    escalationFocus: defaultEscalationFocus(contract),
    reason,
  };
}

function normalizeAnswerability(value: unknown): RagAnswerability {
  if (value === 'full' || value === 'partial' || value === 'none') return value;
  return 'unknown';
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function safeClaims(value: unknown): RagCoveredClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<RagCoveredClaim>;
    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return [];
    return [{
      id: candidate.id,
      text: candidate.text,
      evidenceIds: safeStringArray(candidate.evidenceIds),
      coveredRequirementIds: safeStringArray(candidate.coveredRequirementIds),
      usefulness: typeof candidate.usefulness === 'string' ? candidate.usefulness : '',
    }];
  });
}

function defaultEscalationFocus(contract: AnswerContract): string {
  return `补齐这些答案要素：${contract.mustAnswer.map((item) => item.label).join('、')}`;
}
```

- [ ] **Step 5: 兼容旧 EvidenceCoverageService**

Modify `src/runtime/evidence-coverage-service.ts` to either:

```ts
export { RagAnswerabilityService as EvidenceCoverageService } from './rag-answerability-service.js';
```

or keep the old file only for tests that still import it during transition. If keeping old behavior temporarily, mark the file with:

```ts
// Deprecated: use RagAnswerabilityService. This compatibility layer will be removed after runtime migration.
```

- [ ] **Step 6: 运行 service 测试**

Run:

```bash
pnpm build && node --test test/rag-answerability-service.test.mjs
```

Expected:

```text
PASS test/rag-answerability-service.test.mjs
```

## Task 4: 改造 KnowledgeTurn 工作流，支持 full/partial/none

**Files:**
- Modify: `src/runtime/knowledge-turn.ts`
- Modify: `src/runtime/knowledge-diagnosis.ts`
- Modify: `src/runtime/event-recorder.ts`
- Modify: `test/retrieval-grounding.test.mjs`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写 runtime partial 升级测试**

Add to `test/supper-helper.test.mjs`:

```js
test('runtime carries partial RAG claims into code escalation instead of discarding them', async () => {
  const workerRequests = [];
  const worker = {
    diagnose: async (request) => {
      workerRequests.push(request);
      return mockWorkerResponse(request, {
        status: 'concluded',
        summary: '代码中存在统计补数命令。',
        evidence: [{
          id: 'ev_cmd',
          kind: 'workspace',
          source: 'src/Command/RefreshStudentStatisticsCommand.php',
          summary: '命令支持按月份刷新学员统计。',
          confidence: 'high',
        }],
        claims: [{
          type: 'fact',
          text: '可以通过统计刷新命令补齐指定月份的学员统计。',
          evidenceIds: ['ev_cmd'],
        }],
        recommendedNextAction: 'final_answer',
      });
    },
  };

  const runtime = await createRuntimeFixture({
    worker,
    ragAnswerabilityModelResponse: {
      answerability: 'partial',
      selectedEvidenceIds: ['ev_stat_task'],
      coveredClaims: [{
        id: 'rag_claim_1',
        text: '学员统计数据由定时任务生成。',
        evidenceIds: ['ev_stat_task'],
        coveredRequirementIds: ['generation_source'],
        usefulness: '解释缺数背景',
      }],
      missingElements: ['现成命令名称', '月份参数'],
      shouldEscalate: true,
      escalationFocus: '查找统计补数命令和月份参数',
      reason: '知识库只说明生成来源。',
    },
  });

  const response = await runtime.sendUserMessage('case_partial_rag', '学员数据统计缺少6月份，如何补上，有没有现成命令行处理');

  assert.equal(workerRequests.length, 1);
  assert.equal(workerRequests[0].context.knowledge.answerability.answerability, 'partial');
  assert.match(workerRequests[0].context.knowledge.answerability.coveredClaims[0].text, /定时任务/);
  assert.match(workerRequests[0].context.deepQuery.anchorTerms.join('\n'), /补数命令|月份参数/);
  assert.match(response.assistantMessage, /定时任务|命令|6月/);
});
```

Use existing test fixture names in `test/supper-helper.test.mjs`; if `createRuntimeFixture` or `mockWorkerResponse` differs, adapt the wrapper but preserve the assertions.

- [ ] **Step 2: `KnowledgeTurnService` 调用新 service**

Modify `src/runtime/knowledge-turn.ts`:

```ts
const answerContract = request.context?.answerContract;
```

Before direct-answer decision, evaluate:

```ts
const answerability = answerContract && this.ragAnswerabilityService
  ? await this.ragAnswerabilityService.evaluate({
      contract: answerContract,
      evidence: evidencePack.results,
    })
  : undefined;
```

Decision rules:

```ts
const ragBlocksDirectAnswer = answerability &&
  (answerability.answerability === 'partial' ||
   answerability.answerability === 'none' ||
   (answerability.answerability === 'unknown' && answerability.shouldEscalate));

if (!judge.answerable || judge.need_code_escalation || ragBlocksDirectAnswer) {
  attachKnowledgeCodeEscalationContext({
    request,
    question: userMessage,
    route,
    evidencePack,
    judge,
    answerability,
    projectType: this.config.knowledge.projectType,
    glossaryTerms,
  });
  this.events.codeEscalationRequested(caseSession, request);
  return undefined;
}
```

Do not mutate `judge` after logging it. If a combined decision is needed, create:

```ts
const finalJudge = {
  ...judge,
  answerable: judge.answerable && !ragBlocksDirectAnswer,
  need_code_escalation: judge.need_code_escalation || Boolean(ragBlocksDirectAnswer),
};
```

- [ ] **Step 3: `diagnosticResultFromKnowledge` 使用 coveredClaims**

Modify `src/runtime/knowledge-diagnosis.ts`:

```ts
export function diagnosticResultFromKnowledge(input: {
  evidencePack: KnowledgeEvidencePack;
  judge: EvidenceJudgeResult;
  route: KnowledgeRoute;
  answerability?: RagAnswerabilityResult;
}): DiagnosticResult
```

When `answerability?.answerability === 'full'`, create claims from `answerability.coveredClaims`:

```ts
const claims = input.answerability?.answerability === 'full'
  ? input.answerability.coveredClaims.map((claim) => ({
      type: 'fact' as const,
      text: claim.text,
      evidenceIds: claim.evidenceIds,
    }))
  : existingClaims;
```

Fallback to existing feature overview logic for legacy no-model/no-answerability paths, but do not create a single generic “知识库命中...可回答...” fact when answerability claims exist.

- [ ] **Step 4: `attachKnowledgeCodeEscalationContext` 写入 partial RAG**

Modify function signature:

```ts
  answerability?: RagAnswerabilityResult;
```

After `attachDeepQueryContext`, add:

```ts
request.context!.knowledge!.answerability = input.answerability
  ? summarizeRagAnswerability(input.answerability)
  : undefined;
```

The summary object must include only IDs, text, missing elements, and escalation focus; do not duplicate large evidence payloads.

- [ ] **Step 5: 更新事件日志**

In `src/runtime/event-recorder.ts`, add:

```ts
ragAnswerabilityStarted(caseSession: StoredCase, detail: { questionType?: string; evidenceIds: string[] }): DiagnosticLogEvent
ragAnswerabilityResult(caseSession: StoredCase, result: RagAnswerabilityResult): DiagnosticLogEvent
```

Use shallow cloned details:

```ts
detail: JSON.parse(JSON.stringify(result))
```

This prevents later mutation from changing earlier logs.

- [ ] **Step 6: 运行目标测试**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "partial RAG"
```

Expected:

```text
PASS runtime carries partial RAG claims into code escalation instead of discarding them
```

## Task 5: 移除 answerability 对 matched_terms 的依赖

**Files:**
- Modify: `src/runtime/evidence-judge.ts`
- Modify: `src/runtime/answer-contract.ts`
- Modify: `test/retrieval-grounding.test.mjs`

- [ ] **Step 1: 写“matched_terms 不能授权直答”测试**

Add to `test/retrieval-grounding.test.mjs`:

```js
test('matched terms cannot satisfy answerability without answer-bearing text', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '学员统计缺少6月份如何补上，有没有命令行处理',
      moduleCandidates: ['student'],
      intentCandidates: ['how_to'],
      keywords: ['学员统计', '6月份', '命令行'],
      sourceTypes: ['faq', 'runbook'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_matched_terms_only',
      document_id: 'kb_matched_terms_only',
      parent_id: 'kb_matched_terms_only',
      title: '学员统计',
      module: 'student',
      intent: 'product_rule',
      source_type: 'faq',
      matched_terms: ['学员统计', '6月份', '命令行', '补上'],
      summary: '学员统计页面展示学员数据。',
      answer_span: '学员统计页面展示学员数据。',
      source: 'knowledge/faq/student/statistics.md',
    })),
    question: '学员统计缺少6月份如何补上，有没有命令行处理？',
  });

  assert.equal(result.answerable, false);
  assert.equal(result.blockers.includes('question_not_answered'), true);
});
```

- [ ] **Step 2: 修改 evidence text 归一化**

In `src/runtime/evidence-judge.ts`, locate evidence text normalization used for answerability checks. Remove `matched_terms` from the text used by `question_not_answered` / answer coverage.

The answerability text must only include:

```ts
[
  evidence.title,
  evidence.summary,
  evidence.answer_span,
  evidence.excerpt,
].filter(Boolean).join('\n')
```

`matched_terms` may remain in retrieval relevance logs and debug breakdown, but not in answer coverage.

- [ ] **Step 3: 运行目标测试**

Run:

```bash
pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "matched terms"
```

Expected:

```text
PASS matched terms cannot satisfy answerability without answer-bearing text
```

## Task 6: 让 Worker 和 Deep Query 围绕缺失答案要素排查

**Files:**
- Modify: `src/runtime/deep-query-planner.ts`
- Modify: `src/workers/claude/claude-prompts.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写 Worker prompt/context 测试**

Add to `test/supper-helper.test.mjs`:

```js
test('worker prompt includes answer contract and partial rag escalation focus', async () => {
  const request = buildDiagnosticRequest({
    caseSession: fixtureCaseWithUserMessage('学员统计缺少6月份如何补上，有没有命令行处理'),
    userMessage: '学员统计缺少6月份如何补上，有没有命令行处理',
    unknowns: [],
    config: minimalConfig(),
  });
  request.context.knowledge = {
    evidence: [],
    judge: {
      answerable: false,
      confidence: 'low',
      need_code_escalation: true,
      reason: 'partial RAG',
      evidence: [],
      risks: [],
      missing_info: ['现成命令名称'],
      conflicts: [],
      recommended_next_action: 'dispatch_code_diagnosis',
      answer_score: 0.4,
    },
    answerability: {
      answerability: 'partial',
      selectedEvidenceIds: ['ev_stat_task'],
      coveredClaims: [{
        id: 'rag_claim_1',
        text: '学员统计由定时任务生成。',
        evidenceIds: ['ev_stat_task'],
        coveredRequirementIds: ['generation_source'],
        usefulness: '补数排查背景',
      }],
      missingElements: ['现成命令名称', '月份参数'],
      shouldEscalate: true,
      escalationFocus: '查找统计补数命令和月份参数',
      reason: '知识库缺命令',
    },
  };

  const prompt = buildClaudeUserPrompt(request);

  assert.match(prompt, /answerContract/);
  assert.match(prompt, /查找统计补数命令和月份参数/);
  assert.match(prompt, /学员统计由定时任务生成/);
});
```

- [ ] **Step 2: 更新 Claude prompt**

In `src/workers/claude/claude-prompts.ts`, add to system/user instructions:

```text
DiagnosticRequest.context.answerContract is the shared goal. Prioritize missing mustAnswer items.
If DiagnosticRequest.context.knowledge.answerability contains partial coveredClaims, treat them as context, not final proof for missing items.
Return claims that explicitly fill missingElements when possible.
```

- [ ] **Step 3: 更新 Deep Query planner**

In `src/runtime/deep-query-planner.ts`, include:

```ts
const answerability = request.context?.knowledge?.answerability;
const missingAnswerTerms = [
  ...request.context?.answerContract?.mustAnswer.map((item) => item.label) ?? [],
  ...answerability?.missingElements ?? [],
  answerability?.escalationFocus,
].filter(Boolean);
```

Use these terms to enrich `anchorTerms` and `artifactTargets`, bounded to existing limits.

- [ ] **Step 4: 运行目标测试**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "worker prompt includes answer contract"
```

Expected:

```text
PASS worker prompt includes answer contract and partial rag escalation focus
```

## Task 7: Output Review 与 Presentation 按 AnswerContract 审核和表达

**Files:**
- Modify: `src/runtime/review-presentation.ts`
- Modify: `src/runtime/presenter.ts`
- Modify: `src/agents/output-review.md`
- Modify: `src/agents/presentation.md`
- Modify: `test/conversation-evidence-lifecycle.test.mjs`

- [ ] **Step 1: 写最终回复合并测试**

Add to `test/conversation-evidence-lifecycle.test.mjs`:

```js
test('presentation combines reviewed partial RAG context and worker conclusion without fixed template drift', async () => {
  const result = reviewedDiagnosticResult({
    evidence: [
      { id: 'ev_rag_1', kind: 'knowledge', source: 'knowledge/faq/stat.md', summary: '学员统计由定时任务生成。', confidence: 'high' },
      { id: 'ev_cmd_1', kind: 'workspace', source: 'src/Command/RefreshStudentStatisticsCommand.php', summary: '命令支持按月份刷新统计。', confidence: 'high' },
    ],
    claims: [
      { type: 'fact', text: '学员统计由定时任务生成。', evidenceIds: ['ev_rag_1'] },
      { type: 'fact', text: '可以通过统计刷新命令按月份补齐学员统计。', evidenceIds: ['ev_cmd_1'] },
    ],
  });
  const caseSession = caseWithAnswerContract('学员统计缺少6月份如何补上，有没有现成命令行处理');
  const reply = await reviewAndPresent(caseSession, result);

  assert.match(reply, /定时任务/);
  assert.match(reply, /命令|按月份/);
  assert.doesNotMatch(reply, /设计使然/);
  assert.doesNotMatch(reply, /对业务的影响：[\s\S]*你可以怎么处理：/);
});
```

Use existing helpers from the file; keep the assertions.

- [ ] **Step 2: 给 model prompt 传 AnswerContract**

In `src/runtime/review-presentation.ts`, include in model payload:

```ts
answerContract: run.request?.context?.answerContract,
ragAnswerability: run.request?.context?.knowledge?.answerability,
```

Add validation rule:

```ts
if (answerContract && selectedClaimsDoNotAddressAnyMustAnswer(reply, selectedClaims, answerContract)) {
  return ruleBasedReviewAndFormat(...);
}
```

The helper should be conservative: it only rejects empty/generic replies and replies that omit all selected claim texts for non-developer personas. It must not become a new semantic model.

- [ ] **Step 3: 更新 fallback presenter**

In `src/runtime/presenter.ts`, when `run.request?.context?.answerContract` exists:

- feature/definition: first sentence answers definition/capabilities.
- operation procedure: first sentence states confirmed method or states still missing.
- partial: include “已确认” and “仍缺” sections only when missing items exist.
- do not use operations bug/design/config classification unless `questionType` is `troubleshooting_cause` or `bug_or_behavior`.

- [ ] **Step 4: 更新 Agent docs**

Modify `src/agents/output-review.md`:

```md
- 必须检查最终 claim 是否覆盖 AnswerContract.mustAnswer；未覆盖的要素必须保留为 unknown/missing，不能被 presentation 弱化或删除。
```

Modify `src/agents/presentation.md`:

```md
- 最终回复必须围绕 AnswerContract.finalAnswerExpectation 组织；persona 只能改变语气和顺序，不能让答案偏离 mustAnswer。
- partial RAG + worker 结果同时存在时，先回答最终可执行结论，再说明哪些背景来自知识库、哪些结论来自代码排查。
```

- [ ] **Step 5: 运行目标测试**

Run:

```bash
pnpm build && node --test test/conversation-evidence-lifecycle.test.mjs --test-name-pattern "partial RAG context"
```

Expected:

```text
PASS presentation combines reviewed partial RAG context and worker conclusion without fixed template drift
```

## Task 8: 更新 main Agent 设计，把它明确为协同调度者

**Files:**
- Modify: `src/agents/main.md`
- Modify: `src/agents/README.md`
- Modify: `docs/agent-design.md`

- [ ] **Step 1: 修改 main 角色描述**

In `src/agents/main.md`, update frontmatter role:

```yaml
role: user-facing-intake-goal-contract-owner-and-evidence-reviewer
primary_contracts:
  - AnswerContract
  - Preflight Gate
  - DiagnosticRequest
  - DiagnosticResult
  - Evidence Review
```

Add section after `Core Mission`:

```md
### 0. Own The Shared Answer Contract

Main Agent owns the current turn's AnswerContract. Every sub-agent works for the same user goal:

- Input Review clarifies the contract.
- Experience can reuse only answers that satisfy the contract.
- RAG Answerability evaluates and extracts knowledge against the contract.
- Worker fills missing contract items.
- Output Review verifies claims and remaining gaps against the contract.
- Presentation expresses the reviewed answer without changing the contract.

If a stage returns information that is relevant but incomplete, Main Agent must preserve the useful part and route the missing part to the next stage.
```

- [ ] **Step 2: 替换旧固定 final templates**

In `src/agents/main.md`, replace rigid persona final templates with answer-quality criteria:

```md
### Final Reply Quality Criteria

- 先回答 AnswerContract.userNeed。
- 覆盖所有已能回答的 mustAnswer 项。
- 对未覆盖 mustAnswer 项明确标记 unknown 或 still missing。
- 保留有证据的 partial RAG 结论，不因为升级代码排查而丢弃。
- persona 只能改变表达方式，不能改变问题类型或结论语义。
- 功能、入口、规则、操作说明类问题不强制归类为 bug/设计/配置问题。
```

- [ ] **Step 3: 更新 Agent README**

Modify `src/agents/README.md` current agents list:

```md
- `rag-answerability.md`: RAG 可回答性与有效信息萃取 Agent，负责判断知识库结果是否满足 AnswerContract，并在 partial 时输出可保留 claim 和升级焦点。
```

- [ ] **Step 4: 更新设计文档工作流**

Modify `docs/agent-design.md` operating model:

```text
User message
  -> Build ResolvedTurnContext
  -> Build AnswerContract
  -> Preflight Gate
  -> Experience against AnswerContract
  -> Knowledge Router / Retrieval
  -> RAG Answerability Agent
     -> full direct knowledge answer
     -> partial extracted knowledge + code escalation
     -> none code escalation
  -> Claude Code Worker fills missing AnswerContract items
  -> Output Review verifies merged claims against AnswerContract
  -> Presentation answers original question from reviewed claims
```

- [ ] **Step 5: 运行 lint**

Run:

```bash
pnpm lint
```

Expected:

```text
exit code 0
```

## Task 9: 配置与 UI 迁移

**Files:**
- Modify: `src/config.ts`
- Modify: `src/settings/contracts.ts`
- Modify: `src/settings/model-settings.ts`
- Modify: `src/ui.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写设置保存不重置测试**

Add to `test/supper-helper.test.mjs`:

```js
test('model settings preserve rag answerability switch when form omits it', () => {
  const config = minimalConfig();
  config.agent.useModelForRagAnswerability = false;

  saveModelSettings({
    config,
    body: {
      useModelForPreflight: true,
      useModelForPresentation: true,
    },
  });

  assert.equal(config.agent.useModelForRagAnswerability, false);
});
```

- [ ] **Step 2: 添加新配置并兼容旧字段**

In `src/config.ts`:

```ts
useModelForRagAnswerability?: boolean;
useModelForEvidenceCoverage?: boolean;
ragAnswerabilityTopN?: number;
```

Normalize config:

```ts
agent.useModelForRagAnswerability =
  agent.useModelForRagAnswerability ?? agent.useModelForEvidenceCoverage ?? true;
agent.ragAnswerabilityTopN = agent.ragAnswerabilityTopN ?? agent.evidenceCoverageTopN ?? 3;
```

- [ ] **Step 3: 修改 settings contract**

In `src/settings/contracts.ts`:

```ts
useModelForRagAnswerability?: boolean;
ragAnswerabilityTopN?: number;
```

Keep old fields optional for compatibility.

- [ ] **Step 4: 修改保存逻辑**

In `src/settings/model-settings.ts`, replace:

```ts
input.config.agent.useModelForEvidenceCoverage = input.body.useModelForEvidenceCoverage ?? true;
```

with:

```ts
if ('useModelForRagAnswerability' in input.body) {
  input.config.agent.useModelForRagAnswerability = input.body.useModelForRagAnswerability;
}
if ('useModelForEvidenceCoverage' in input.body && !('useModelForRagAnswerability' in input.body)) {
  input.config.agent.useModelForRagAnswerability = input.body.useModelForEvidenceCoverage;
}
```

- [ ] **Step 5: 添加 UI 开关**

In `src/ui.ts`, in the model settings form, add a checkbox labeled:

```html
RAG 可回答性审核
```

Make `readModelForm()` send:

```js
useModelForRagAnswerability: document.getElementById('useModelForRagAnswerability').checked,
```

- [ ] **Step 6: 运行设置测试**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "rag answerability switch"
```

Expected:

```text
PASS model settings preserve rag answerability switch when form omits it
```

## Task 10: 统一离线评估与 acceptance 路径

**Files:**
- Modify: `src/runtime/retrieval-evaluation.ts`
- Modify: `src/runtime/knowledge-acceptance.ts`
- Modify: `test/retrieval-grounding.test.mjs`

- [ ] **Step 1: 写评估路径测试**

Add to `test/retrieval-grounding.test.mjs`:

```js
test('retrieval evaluation reports partial answerability separately from retrieval hit', async () => {
  const report = await runRetrievalEvaluationFixture({
    question: '学员统计缺少6月份如何补上，有没有命令行处理',
    evidence: [{
      title: '学员统计',
      answer_span: '学员统计由定时任务生成。',
      matched_terms: ['学员统计', '6月份', '命令行'],
    }],
    expectedBehavior: 'escalate',
  });

  assert.equal(report.items[0].retrievalHit, true);
  assert.equal(report.items[0].answerability, 'partial');
  assert.equal(report.items[0].passed, true);
});
```

Use existing evaluation fixture helpers; if they do not exist, add a local helper in the test file that calls the production evaluation function.

- [ ] **Step 2: 更新 evaluation result**

In `src/runtime/retrieval-evaluation.ts`, include answerability fields:

```ts
answerability: diagnosis.answerability?.answerability ?? (diagnosis.judge.answerable ? 'full' : 'none'),
missingElements: diagnosis.answerability?.missingElements ?? diagnosis.judge.missing_info,
coveredClaimCount: diagnosis.answerability?.coveredClaims.length ?? 0,
```

- [ ] **Step 3: 更新 knowledge acceptance**

In `src/runtime/knowledge-acceptance.ts`, report:

```ts
answerabilityFailures
partialButEscalated
retrievalHitButNotAnswerable
```

- [ ] **Step 4: 运行评估测试**

Run:

```bash
pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "retrieval evaluation reports partial"
```

Expected:

```text
PASS retrieval evaluation reports partial answerability separately from retrieval hit
```

## Task 11: 回归用例覆盖三个真实问题

**Files:**
- Modify: `test/supper-helper.test.mjs`
- Modify: `test/conversation-evidence-lifecycle.test.mjs`

- [ ] **Step 1: `case_a52adc7f` 等价问题**

Add regression:

```js
test('case_a52adc7f class lesson overview answers definition and capabilities', async () => {
  const response = await askAsPersona('operations', '班课是什么，有什么功能');

  assert.match(response.assistantMessage, /班课.*(是什么|用于|是一种)/);
  assert.match(response.assistantMessage, /班课管理|产品库|教务仪表盘|班课巡检/);
  assert.doesNotMatch(response.assistantMessage, /设计使然/);
  assert.doesNotMatch(response.assistantMessage, /对业务的影响：[\s\S]*你可以怎么处理：/);
});
```

- [ ] **Step 2: `case_73f80bc4` 等价问题**

Add regression:

```js
test('case_73f80bc4 class lesson config preserves entry permission and configurable items', async () => {
  const response = await askAsPersona('operations', '班课在哪配置的');

  assert.match(response.assistantMessage, /后台管理\s*→\s*教务\s*→\s*参数设置/);
  assert.match(response.assistantMessage, /路由|权限/);
  assert.match(response.assistantMessage, /基本信息|价格|封面|服务|班主任|教师|助教|课程管理|学员管理/);
  assert.doesNotMatch(response.assistantMessage, /配置或使用问题/);
});
```

- [ ] **Step 3: `case_4e905fbc` 等价问题**

Add regression:

```js
test('case_4e905fbc statistics backfill preserves partial RAG context and escalates for command evidence', async () => {
  const response = await askAsPersona('operations', '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计。有没有现成的命令行处理');

  assert.match(response.assistantMessage, /6月|月份/);
  assert.match(response.assistantMessage, /命令|脚本|任务|补/);
  assert.doesNotMatch(response.assistantMessage, /知识库命中.*可回答/);
  assert.doesNotMatch(response.assistantMessage, /设计使然/);
});
```

- [ ] **Step 4: 运行回归**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs test/conversation-evidence-lifecycle.test.mjs --test-name-pattern "case_a52adc7f|case_73f80bc4|case_4e905fbc"
```

Expected:

```text
PASS case_a52adc7f class lesson overview answers definition and capabilities
PASS case_73f80bc4 class lesson config preserves entry permission and configurable items
PASS case_4e905fbc statistics backfill preserves partial RAG context and escalates for command evidence
```

## Task 12: 全量验证与兼容性检查

**Files:**
- No source edits.

- [ ] **Step 1: 检查未提交改动**

Run:

```bash
git status --short
```

Expected:

```text
Shows only intentional files changed by this plan and pre-existing user changes.
```

- [ ] **Step 2: 文档与格式检查**

Run:

```bash
pnpm lint
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: 类型检查**

Run:

```bash
pnpm typecheck
```

Expected:

```text
exit code 0
```

- [ ] **Step 4: 构建**

Run:

```bash
pnpm build
```

Expected:

```text
exit code 0
```

- [ ] **Step 5: 全量测试**

Run:

```bash
pnpm test
```

Expected:

```text
all tests pass
```

## 验收标准

1. main Agent 文档明确拥有 `AnswerContract`，并说明各子 Agent 如何围绕同一个目标工作。
2. 每个 `DiagnosticRequest.context` 都能带上 `answerContract`。
3. RAG 检索命中但只回答部分问题时，输出 `partial`、`coveredClaims`、`missingElements` 和 `escalationFocus`。
4. partial RAG 不再被丢弃，会进入 Worker 的 request context 和 deep query focus。
5. `matched_terms` 不再参与答案覆盖判断。
6. RAG full 直答使用萃取出的 fact claims，不再生成空泛“知识库命中...可回答...”主 claim。
7. 最终回复能合并 RAG 已确认部分和代码排查结果，并围绕原问题回答。
8. `case_a52adc7f`、`case_73f80bc4`、`case_4e905fbc` 等价回归通过。
9. 旧 case JSON 可以加载；新字段是可选扩展，并有兼容测试。
10. `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test` 全部通过。

## 风险与处理

- **模型失败风险**：RAG Answerability 返回 `unknown` 时，对操作步骤、命令、入口、故障原因类问题保守升级；对低风险定义类问题可回退到确定性 Judge。
- **case JSON shape 风险**：新增字段只放在 optional context 下；旧 case 不迁移也能读取。必须补旧 case load 测试。
- **重复 Agent 风险**：`evidence-coverage` 只做兼容层，真实职责迁移到 `rag-answerability`，避免两个模型裁判同时管同一件事。
- **模板回潮风险**：main 和 presentation 文档都改成质量标准，persona 不能覆盖 questionType。
- **过度工程风险**：AnswerContract 先用本地规则生成；不引入新的模型阶段来生成 contract，避免链路变重。

## Self-Review

- **Spec coverage:** 计划覆盖了用户提出的共同目标、main 协同调度、RAG partial 萃取、升级策略引用 partial、最终合并输出、模板过固化、matched_terms 误判等要求。
- **Placeholder scan:** 未使用占位式待办描述。每个任务都有明确文件、步骤、命令和期望结果；涉及测试夹具的步骤要求沿用现有 helper 并保留断言不变。
- **Type consistency:** `AnswerContract`、`RagAnswerabilityResult`、`RagCoveredClaim` 在任务 1/3 定义，并在后续任务中保持同名使用。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-28-answer-contract-agent-orchestration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
