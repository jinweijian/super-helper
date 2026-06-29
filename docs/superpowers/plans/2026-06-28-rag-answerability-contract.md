# RAG Answerability Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 RAG Evidence Judge 从“词/字段匹配可直答”改为“先理解原问题需要什么答案，再判断 evidence 是否覆盖答案需求”。

**Architecture:** Retrieval 继续负责召回相关材料，Evidence Judge 负责答案充分性。新增 `QuestionAnswerContract` 作为 runtime 内部纯函数模块：从原问题生成答案需求契约，再用 evidence 的 `title/summary/answer_span/excerpt` 判断覆盖度；`matched_terms` 只作为召回解释，不再授权直答。

**Tech Stack:** TypeScript runtime pure functions, Node test runner, existing `KnowledgeEvidenceResult` / `KnowledgeRoute` contracts.

---

## 文件结构

- Create: `src/runtime/question-answer-contract.ts`
  - 负责根据原问题生成 `QuestionAnswerContract`。
  - 负责评估 evidence 是否覆盖合同中的答案需求。
  - 不调用模型，不读取文件，不改 case JSON，不生成用户回复。

- Modify: `src/runtime/evidence-judge.ts`
  - 移除当前内联的窄化 `inferAnswerRequirements/evaluateQuestionAnswerCoverage`。
  - 引入 `buildQuestionAnswerContract` 和 `evaluateAnswerCoverage`。
  - `coverage` 改为“答案需求覆盖度”参与评分；source type 只影响 authority/actionability。

- Modify: `test/retrieval-grounding.test.mjs`
  - 增加通用反例：入口问题、操作问题、原因问题不能被功能说明误直答。
  - 增加正例：当 runbook/FAQ 真包含入口、步骤、原因时可以直答。

- Modify: `test/runtime-retrieval-eval.test.mjs`
  - 增加离线评估样本，确认 `expectedBehavior: "escalate"` 不是只靠无命中，而是能拒绝“相关但不回答”的命中。

- Modify: `src/agents/evidence-judge.md`
  - 写清 Evidence Judge 的判断标准：answerability 高于 retrieval relevance。

- Modify: `docs/agent-design.md`
  - 更新 Knowledge-First Skeleton：RAG 直答必须通过答案契约覆盖检查。

## Task 1: 写通用失败测试，证明当前评分把相关性误当充分性

**Files:**
- Modify: `test/retrieval-grounding.test.mjs`

- [ ] **Step 1: 添加“入口问题不能被功能说明回答”的红测**

在 `test/retrieval-grounding.test.mjs` 末尾添加：

```js
test('knowledge judge rejects feature descriptions for configuration-location questions', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '班课在哪配置',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: ['how_to'],
      keywords: ['班课', '配置'],
      sourceTypes: ['whitepaper', 'faq'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_class_feature_description',
      document_id: 'kb_class_feature_description',
      parent_id: 'kb_class_feature_description',
      title: '班课管理',
      module: 'edusoho-training',
      intent: 'product_rule',
      source_type: 'whitepaper',
      matched_terms: ['班课', '配置'],
      summary: '班课管理用于维护班课基本信息、教师和学员。',
      answer_span: '班课管理支持维护班课基本信息、教师、助教和学员。',
      source: 'knowledge/whitepapers/edusoho-training/class-feature.md',
    })),
    question: '班课在哪配置？',
  });

  assert.equal(result.answerable, false);
  assert.equal(result.blockers.includes('question_not_answered'), true);
  assert.match(result.missing_info.join('\n'), /入口|路径|位置/);
});
```

- [ ] **Step 2: 添加“故障原因问题不能被能力说明回答”的红测**

继续追加：

```js
test('knowledge judge rejects capability docs for troubleshooting-cause questions', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '课程搜索失败为什么',
      moduleCandidates: ['course'],
      intentCandidates: ['troubleshooting'],
      keywords: ['课程搜索', '失败'],
      sourceTypes: ['faq', 'runbook', 'whitepaper'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_course_search_capability',
      document_id: 'kb_course_search_capability',
      parent_id: 'kb_course_search_capability',
      title: '课程搜索',
      module: 'course',
      intent: 'product_rule',
      source_type: 'whitepaper',
      matched_terms: ['课程搜索', '失败'],
      summary: '课程搜索支持按课程名称、分类和创建者进行搜索。',
      answer_span: '课程搜索支持按课程名称、课程分类和创建者搜索课程。',
      source: 'knowledge/whitepapers/course/search-capability.md',
    })),
    question: '课程搜索失败一般为什么？',
  });

  assert.equal(result.answerable, false);
  assert.equal(result.blockers.includes('question_not_answered'), true);
  assert.match(result.missing_info.join('\n'), /原因|排查依据|处理条件/);
});
```

- [ ] **Step 3: 添加“真实入口 evidence 可以回答入口问题”的绿向目标测试**

继续追加：

```js
test('knowledge judge answers configuration-location questions when evidence contains entry path', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '班课在哪配置',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: ['how_to'],
      keywords: ['班课', '配置'],
      sourceTypes: ['faq', 'runbook'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_class_config_entry',
      document_id: 'kb_class_config_entry',
      parent_id: 'kb_class_config_entry',
      title: '班课配置入口',
      module: 'edusoho-training',
      intent: 'how_to',
      source_type: 'faq',
      matched_terms: ['班课', '配置', '入口'],
      summary: '班课配置入口在后台管理 → 教务 → 参数设置。',
      answer_span: '班课配置入口：后台管理 → 教务 → 参数设置，可配置基本信息、价格、封面、服务、班主任、教师、助教、课程管理和学员管理。',
      source: 'knowledge/faq/edusoho-training/class-config-entry.md',
    })),
    question: '班课在哪配置？',
  });

  assert.equal(result.answerable, true, `blockers=${result.blockers.join(',')}, reason=${result.reason}`);
});
```

- [ ] **Step 4: 运行红测并确认失败原因**

Run:

```bash
pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "configuration-location|troubleshooting-cause"
```

Expected:

```text
FAIL knowledge judge rejects feature descriptions for configuration-location questions
FAIL knowledge judge rejects capability docs for troubleshooting-cause questions
```

失败原因应是当前 Judge 仍根据 `matched_terms/source_type/title` 判为 answerable，或没有 `question_not_answered` blocker。

## Task 2: 新增 QuestionAnswerContract 通用模块

**Files:**
- Create: `src/runtime/question-answer-contract.ts`
- Test: `test/retrieval-grounding.test.mjs`

- [ ] **Step 1: 创建答案契约模块**

Create `src/runtime/question-answer-contract.ts`:

```ts
import type { KnowledgeEvidenceResult, KnowledgeRoute } from '../knowledge/index.js';

export type QuestionAnswerKind =
  | 'definition'
  | 'feature_overview'
  | 'configuration_location'
  | 'operation_procedure'
  | 'troubleshooting_cause'
  | 'rule_explanation'
  | 'unknown';

export interface QuestionAnswerRequirement {
  id: string;
  label: string;
  evidencePattern: RegExp;
}

export interface QuestionAnswerContract {
  kind: QuestionAnswerKind;
  sourceQuestion: string;
  requirements: QuestionAnswerRequirement[];
}

export interface AnswerCoverageResult {
  contract: QuestionAnswerContract;
  score: number;
  matched: QuestionAnswerRequirement[];
  missing: QuestionAnswerRequirement[];
}

export function buildQuestionAnswerContract(input: {
  question: string;
  route: KnowledgeRoute;
}): QuestionAnswerContract {
  const question = input.question.trim();
  const normalized = normalize(question);
  const requirements: QuestionAnswerRequirement[] = [];

  if (/(在哪|哪里|入口|路径|位置|从哪|配置).*?(配置|设置)|(?:配置|设置).*?(在哪|哪里|入口|路径|位置)/.test(normalized)) {
    requirements.push({
      id: 'entry_path',
      label: '入口、路径或位置',
      evidencePattern: /(入口|路径|位置|菜单|后台|管理后台|后台管理|进入|打开|导航|→|>|\/).{0,80}(配置|设置|页面|模块)|(配置|设置).{0,80}(入口|路径|位置|页面|模块)/i,
    });
    return { kind: 'configuration_location', sourceQuestion: question, requirements };
  }

  if (/是什么|定义|什么意思|介绍/.test(normalized)) {
    requirements.push({
      id: 'definition',
      label: '定义或概念解释',
      evidencePattern: /(是指|指的是|定义为|是一种|是一个|用于|主要用于|表示|含义)/,
    });
    return { kind: 'definition', sourceQuestion: question, requirements };
  }

  if (/有哪些功能|有什么功能|功能有哪些|功能清单|有哪些能力|有什么能力|支持哪些|能做什么|主要功能/.test(normalized) || input.route.intentCandidates.includes('feature_overview')) {
    requirements.push({
      id: 'capability_list',
      label: '功能或能力列表',
      evidencePattern: /(支持|包含|包括|可|可以|能够).{0,80}(功能|能力|管理|查看|配置|设置|搜索|统计|巡检|提醒|学习|处理)|[、，,].{0,20}(管理|查看|配置|搜索|统计|巡检|提醒)/,
    });
    return { kind: 'feature_overview', sourceQuestion: question, requirements };
  }

  if (/为什么|原因|失败|异常|报错|不生效|不能|无法/.test(normalized)) {
    requirements.push({
      id: 'cause_or_diagnostic_basis',
      label: '原因、排查依据或处理条件',
      evidencePattern: /(原因|因为|由于|导致|触发|失败时|异常时|排查|检查|确认|如果|当).{0,100}(失败|异常|不生效|不能|无法|报错|处理|修复|解决)/,
    });
    return { kind: 'troubleshooting_cause', sourceQuestion: question, requirements };
  }

  if (/怎么|如何|步骤|处理|补|重跑|回补|命令|命令行|执行|操作/.test(normalized)) {
    requirements.push({
      id: 'procedure_or_action',
      label: '操作步骤、动作或命令',
      evidencePattern: /(步骤|执行|运行|操作|处理|命令|命令行|console|cli|command|app\/console|bin\/console|--[A-Za-z0-9-]+|先|然后|最后|可通过|可以通过).{0,120}/i,
    });
    return { kind: 'operation_procedure', sourceQuestion: question, requirements };
  }

  if (/规则|条件|什么时候|是否|会不会|支持不支持|限制/.test(normalized)) {
    requirements.push({
      id: 'rule_or_condition',
      label: '规则、条件或限制',
      evidencePattern: /(规则|条件|当|如果|若|仅|必须|需要|支持|不支持|会|不会|限制|前提).{0,100}/,
    });
    return { kind: 'rule_explanation', sourceQuestion: question, requirements };
  }

  return { kind: 'unknown', sourceQuestion: question, requirements };
}

export function evaluateAnswerCoverage(input: {
  contract: QuestionAnswerContract;
  evidence: KnowledgeEvidenceResult[];
}): AnswerCoverageResult {
  if (input.contract.requirements.length === 0) {
    return {
      contract: input.contract,
      score: 1,
      matched: [],
      missing: [],
    };
  }

  const text = evidenceText(input.evidence);
  const matched = input.contract.requirements.filter((requirement) => requirement.evidencePattern.test(text));
  const missing = input.contract.requirements.filter((requirement) => !requirement.evidencePattern.test(text));

  return {
    contract: input.contract,
    score: Number((matched.length / input.contract.requirements.length).toFixed(2)),
    matched,
    missing,
  };
}

function evidenceText(evidence: KnowledgeEvidenceResult[]): string {
  return evidence.map((item) => [
    item.title,
    item.summary,
    item.answer_span,
    item.excerpt,
  ].filter(Boolean).join('\n')).join('\n').toLowerCase();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s，。！？、,.!?：:；;（）()\[\]【】《》<>"'“”‘’_-]+/g, '');
}
```

- [ ] **Step 2: 运行类型检查，确认新模块无类型错误**

Run:

```bash
pnpm typecheck
```

Expected:

```text
tsc --noEmit
```

命令退出码为 0。

## Task 3: 将 Evidence Judge 改为使用答案契约覆盖度

**Files:**
- Modify: `src/runtime/evidence-judge.ts`
- Test: `test/retrieval-grounding.test.mjs`

- [ ] **Step 1: 引入新模块并保留 blocker**

在 [src/runtime/evidence-judge.ts](/Users/king/my/super-helper/src/runtime/evidence-judge.ts:1) 顶部加入：

```ts
import { buildQuestionAnswerContract, evaluateAnswerCoverage } from './question-answer-contract.js';
```

确保 `EvidenceJudgeBlocker` 包含：

```ts
  | 'question_not_answered'
```

- [ ] **Step 2: 在 `judgeKnowledgeEvidence` 中计算答案覆盖**

替换当前内联覆盖逻辑为：

```ts
  const answerContract = buildQuestionAnswerContract({
    question: input.question,
    route: input.route,
  });
  const answerCoverage = evaluateAnswerCoverage({
    contract: answerContract,
    evidence: results,
  });
  const missingAnswerRequirements = answerCoverage.missing.map((requirement) => requirement.label);
```

保留 `question_not_answered` 判定：

```ts
  if (missingAnswerRequirements.length > 0) {
    blockers.push('question_not_answered');
    ambiguity.push(`知识证据未覆盖原问题需要的答案：${missingAnswerRequirements.join('、')}`);
  }
```

- [ ] **Step 3: 修改 `computeBreakdown`，coverage 不再等于 source type**

在 `computeBreakdown` 中替换 coverage 计算：

```ts
  const sourceCoverage = /faq|runbook|whitepaper|solved_case/.test(top.source_type) ? 0.85 : 0.45;
  const answerContract = buildQuestionAnswerContract({
    question: state.question,
    route: state.route,
  });
  const answerCoverage = evaluateAnswerCoverage({
    contract: answerContract,
    evidence: results,
  });
  const coverage = answerContract.requirements.length > 0
    ? Math.min(sourceCoverage, answerCoverage.score)
    : sourceCoverage;
```

- [ ] **Step 4: 删除 Evidence Judge 中的局部窄化函数**

从 `src/runtime/evidence-judge.ts` 删除这些函数和接口：

```ts
interface AnswerRequirement {
  id: string;
  label: string;
  evidencePattern: RegExp;
}

function evaluateQuestionAnswerCoverage(...) { ... }
function inferAnswerRequirements(...) { ... }
function normalizeEvidenceText(...) { ... }
```

- [ ] **Step 5: 跑 Task 1 的测试，确认红测变绿**

Run:

```bash
pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "configuration-location|troubleshooting-cause"
```

Expected:

```text
pass
```

## Task 4: 保留 case_4e905fbc 回归，但表达为通用答案覆盖问题

**Files:**
- Modify: `test/retrieval-grounding.test.mjs`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 调整 retrieval grounding 回归命名**

将当前 case 相关测试命名为：

```js
test('knowledge judge rejects page-description evidence that does not answer operation-procedure questions', () => {
```

断言保留：

```js
assert.equal(result.answerable, false);
assert.equal(result.need_code_escalation, true);
assert.equal(result.recommended_next_action, 'dispatch_code_diagnosis');
assert.equal(result.blockers.includes('question_not_answered'), true);
```

- [ ] **Step 2: 保留正例，证明知识库有答案时可以直答**

保留或新增：

```js
test('knowledge judge answers operation-procedure questions when evidence contains procedure', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '学员数据统计缺失如何补上',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: ['how_to'],
      keywords: ['学员数据统计', '补跑', '命令行'],
      sourceTypes: ['runbook'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_student_statistics_backfill_command',
      document_id: 'kb_student_statistics_backfill_command',
      parent_id: 'kb_student_statistics_backfill_command',
      title: '学员数据统计补跑命令',
      module: 'edusoho-training',
      intent: 'how_to',
      source_type: 'runbook',
      matched_terms: ['学员数据统计', '补跑', '命令行'],
      summary: '学员数据统计缺失时，可使用命令行补跑指定月份统计。',
      answer_span: '步骤1：执行 php app/console student:statistics:rebuild --month=2024-06 补跑指定月份的学员数据统计。',
      source: 'knowledge/runbooks/edusoho-training/student-statistics-backfill.md',
    })),
    question: '学员数据统计缺失如何补上，有没有现成命令行？',
  });

  assert.equal(result.answerable, true, `blockers=${result.blockers.join(',')}`);
});
```

- [ ] **Step 3: 调整 runtime 端到端测试断言**

在 `test/supper-helper.test.mjs` 中保留：

```js
assert.equal(workerRequests[0].context.knowledge.judge.blockers.includes('question_not_answered'), true);
assert.equal(workerRequests[0].context.knowledge.evidence.some((item) => item.title === '用户数据统计'), true);
```

删除任何依赖 `command_or_job` 或 `data_backfill` 的断言。该测试必须证明“知识命中但不回答原问题，因此升级”。

- [ ] **Step 4: 运行回归**

Run:

```bash
pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "operation-procedure|statistics backfill" && node --test test/supper-helper.test.mjs --test-name-pattern "scheduled-statistics backfill"
```

Expected:

```text
pass
```

## Task 5: 将评估集扩展为“相关但不回答”的 RAG 质量门禁

**Files:**
- Modify: `test/runtime-retrieval-eval.test.mjs`

- [ ] **Step 1: 增加评估样本**

在 `test/runtime-retrieval-eval.test.mjs` 的问题 fixtures 中加入：

```js
{
  id: 'abstain_related_but_not_answering_location',
  question: '班课在哪配置？',
  expectedBehavior: 'escalate',
  category: 'answerability',
  split: 'calibration',
}
```

再加入：

```js
{
  id: 'abstain_related_but_not_answering_cause',
  question: '课程搜索失败为什么？',
  expectedBehavior: 'escalate',
  category: 'answerability',
  split: 'calibration',
}
```

- [ ] **Step 2: 断言失败归因是 Evidence Judge，而不是 Retrieval**

在该测试的报告断言中加入：

```js
assert.equal(
  report.questions.some((question) =>
    question.id === 'abstain_related_but_not_answering_location' &&
    question.answerable === false &&
    question.recommendedAction === 'dispatch_code_diagnosis'
  ),
  true,
);
```

- [ ] **Step 3: 运行评估测试**

Run:

```bash
pnpm build && node --test test/runtime-retrieval-eval.test.mjs
```

Expected:

```text
pass
```

## Task 6: 更新 Agent 和架构文档

**Files:**
- Modify: `src/agents/evidence-judge.md`
- Modify: `docs/agent-design.md`

- [ ] **Step 1: 更新 Evidence Judge Agent 规则**

在 `src/agents/evidence-judge.md` 的 Rules 中加入：

```markdown
- Retrieval relevance 不是 direct-answer authorization。`matched_terms`、标题命中、source type 只能说明“相关”，不能说明“能回答”。
- 直答前必须根据原问题建立答案需求：定义、功能列表、入口路径、操作步骤、故障原因、规则条件等。
- Evidence 必须覆盖答案需求；只命中同一业务对象但缺少答案要素时，返回 `question_not_answered` 并升级。
```

- [ ] **Step 2: 更新 Agent Design**

在 `docs/agent-design.md` Knowledge-First Skeleton 段落加入：

```markdown
Evidence Judge 将 retrieval relevance 与 answerability 分离：召回阶段可以用 BM25、embedding、rerank 和 matched terms 找相关证据；直答阶段必须用 `QuestionAnswerContract` 检查 evidence 是否覆盖原问题需要的答案形态。只有“相关但不回答”的 evidence 必须拒绝直答并升级。
```

- [ ] **Step 3: 运行 docs lint**

Run:

```bash
pnpm lint
```

Expected:

```text
Docs lint passed
```

## Task 7: 完整验证

**Files:**
- No file changes.

- [ ] **Step 1: 运行 lint**

Run:

```bash
pnpm lint
```

Expected:

```text
Docs lint passed
```

- [ ] **Step 2: 运行类型检查**

Run:

```bash
pnpm typecheck
```

Expected:

```text
tsc --noEmit
```

退出码为 0。

- [ ] **Step 3: 运行构建**

Run:

```bash
pnpm build
```

Expected:

```text
rm -rf dist && tsc -p tsconfig.build.json
```

退出码为 0。

- [ ] **Step 4: 运行全量测试**

Run:

```bash
pnpm test
```

Expected:

```text
fail 0
```

全量测试通过后，检查新增测试数量增加，且以下行为同时成立：

```text
1. 相关但不回答的问题被拒绝知识直答。
2. 真正包含答案形态的知识仍可直答。
3. case_4e905fbc 这类问题升级原因是 question_not_answered，不是关键词强制升级。
4. 既有 feature_overview、where/how-to、whitepaper 直答回归未被破坏。
```

## 自检

- Spec coverage：计划覆盖了用户指出的根因，即评分规则混淆切词匹配和答案充分性。
- Placeholder scan：未发现占位指令。
- Type consistency：`QuestionAnswerContract`、`QuestionAnswerRequirement`、`AnswerCoverageResult`、`buildQuestionAnswerContract`、`evaluateAnswerCoverage` 在所有任务中命名一致。

## 执行建议

优先使用 Subagent-Driven，每个任务一个干净执行单元；主线程在每个任务后 review diff 和测试输出。该计划改的是 RAG 判定核心，不建议一次性大批量改完后再看测试。
