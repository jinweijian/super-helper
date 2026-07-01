# super helper Agent Design

## Role

`super helper Agent` is the middle person, AnswerGoal owner, and reviewer between the user and diagnostic tools.

The authoritative product Agent configs live in `src/agents/`, not root `AGENT.md`.

Current configured Agents:

- `main.md`: 主 Agent，负责用户回合、AnswerGoal 所有权、协同调度与最终回复责任。
- `input-review.md`: 输入审核与 Preflight Gate。
- `experience.md`: 经验 Agent，负责复用历史会话答案。
- `knowledge-router.md`: 知识路由 Agent，负责识别模块、意图、关键词和代码升级信号。
- `evidence-judge.md`: 证据充分性 Agent，负责判断知识库证据是否足够或是否需要升级到代码。
- `rag-answerability.md`: RAG 可回答性与有效信息萃取 Agent，负责判断知识库结果是否满足 AnswerGoal，并在 partial 时输出可保留 claim 和升级焦点。
- `case-curator.md`: Case 沉淀 Agent，负责用户确认解决后的 solved case 草稿生成。
- `output-review.md`: 输出审核 Agent，负责证据审核。
- `presentation.md`: 美化输出 Agent，负责用户视角表达。
- `registry.json`: runtime stage 到 Agent 配置的配对表。

端到端协作、数据契约和运维日志的展开说明见 [Agent Runtime 技术总览](agent-runtime/README.md)。这里继续保留产品 Agent 的角色设计；runtime 方案细节以该文档组和代码为准。

It is different from `CLAUDE.md`:

- `CLAUDE.md` belongs to a specific workspace and tells Claude Code how to inspect that project.
- `super helper Agent` defines how the product talks to users, decides whether to ask questions, controls uncertainty, reviews evidence, and prevents unsupported conclusions.

Claude Code is a tool. It must not directly reply to the user in the MVP.

## Preflight Gate

Every user message first gets a runtime-owned `ResolvedTurnContext` and `AnswerGoal`, then goes through a `Preflight Gate`.

Concrete implementation:

- `src/runtime/diagnostic-runtime.ts` starts the user turn and calls the gate.
- `src/runtime/agent-configs.ts` resolves the `input-review` Agent config from `src/agents/registry.json`.
- `src/runtime/preflight-gate.ts` owns deterministic local preflight decisions and model/local reconciliation helpers.
- Model preflight is optional. If it fails, the runtime records the failure and falls back to local rules.
- The local builder owns `resolvedQuery` and source message identity. A model may downgrade local facts but cannot promote hypotheses/unknowns or replace the resolved query.

The Agent decides whether the message is enough to create a meaningful diagnosis task.

The decision should be workspace-aware. A message is not low-value merely because it lacks a product name, code path, or complete background. If the current workspace is selected and the user provides searchable business terms, feature names, route/location words, configuration words, impact questions, or troubleshooting symptoms, the Agent should usually dispatch a read-only diagnosis first.

If the input is insufficient:

- Do not call Claude Code.
- Do not call MCP tools in the first MVP preflight path.
- Ask a specific follow-up question.
- Let the user answer `不清楚`.
- Record missing information as unknown, not as a guessed fact.

Only ask before dispatch when the missing information blocks the next safe read-only action, such as no workspace, no searchable signal, unclear permission scope, or a required customer/runtime selector for a configured MCP lookup.

If the input is sufficient:

- Normalize the user's intent.
- Extract known facts and unknowns.
- Attach the active workspace and allowed MCP tools.
- Generate a structured `DiagnosticRequest`.
- Dispatch that request to the worker queue.

## Experience Agent

The `experience` Agent runs after safety/permission/resolved-query Preflight and before knowledge/Claude Code dispatch.

Concrete implementation:

- `src/agents/experience.md` defines the Agent role and reuse rules.
- `src/runtime/experience-agent.ts` searches only the same tenant/user/workspace, requires exact reply-to/source-run attribution, and revalidates visibility/status/freshness/quality/current review constraints.
- Reused answers become `history` evidence and still pass through Output Review and Presentation.
- If no safe match exists, the runtime continues through knowledge and normal worker diagnosis.

## Knowledge-First Skeleton

The current knowledge-first runtime is fully wired into the agent pipeline. Knowledge Router, Retrieval Service, Evidence Judge, Deep Query Planner, Query Correction, and Case Curator are all live runtime stages that run after Preflight and before Claude Code escalation.

Implemented local commands:

- `super-helper knowledge init --workspace <project-path> [--knowledge-root <path>]` creates the isolated knowledge workspace structure and runs intake, extract, normalize, draft slice, audit, and index for already-published formal documents. It does not publish unchecked drafts unless `--legacy-active-publish` is explicitly passed.
- `super-helper knowledge update --workspace <project-path> [--knowledge-root <path>]` rebuilds `knowledge/indexes/manifest.json`, `keyword-index.json`, and `chunks.jsonl` from formal published Markdown parent slices.
- `super-helper retrieval search|debug --workspace <project-path> --query <question> [--knowledge-root <path>]` is the canonical query/debug surface for BM25/embedding recall, fusion, optional rerank, and trace inspection.
- `super-helper retrieval eval --workspace <project-path> --questions <json> [--knowledge-root <path>] [--report <json>]` 复用生产 Router、configured retrieval 和 Evidence Judge，验证 Recall@5、MRR、直答精度、拒答与必须升级行为。
- `super-helper knowledge migration-report` 只读盘点 legacy parent/chunk、生成 `ai-companion -> edusoho-training` 分批状态和人工 review queue；它不会自动迁移或批准语料。
- `super-helper knowledge extract` / `normalize` / `slice` / `audit` / `repair` / `review` / `publish` run individual pipeline stages and write their own artifacts under `knowledge/_pipeline/` and `knowledge/reports/`.
- `super-helper accept knowledge` (alias `pnpm accept:knowledge`) runs a repeatable local acceptance check and writes a redacted acceptance report.

Runtime behavior:

- `--workspace` and runtime workspace selection point to the project/service directory used for code and MCP inspection.
- Knowledge files are stored under the configured knowledge root, isolated by the same workspace key strategy used for session storage; they are not created inside the project code directory by default.
- After an Experience miss, runtime calls `src/retrieval/` against the resolved knowledge workspace. Answerable knowledge evidence passes Evidence Judge and then RAG Answerability. Full RAG answerability goes to Output Review and Presentation; partial answerability keeps covered claims, attaches missing elements to `DiagnosticRequest.context.knowledge.answerability`, and escalates to code review with focused Deep Query context.
- Retrieval 先用 canonical parent 回填 freshness、quality、source block/section provenance 和 answer span。Evidence Judge 采用严格门禁：只有 active、fresh、`ok|info`、溯源完整、答案片段明确且检索置信条件达标的证据可直答；缺失、`warn|error`、过期、冲突、风险或实现细节均升级只读调查。
- Rerank top score 必须至少为 `0.70`；未运行 Rerank 时，仅允许完整标题命中且至少两个非泛化多字符词匹配。BM25、向量和 RRF 原始分数不构成直答授权。
- Runtime 使用 `parent-child-v2` child 召回、parent 去重和 bounded answer span。Hybrid 固定执行 BM25/Embedding Top 40、RRF Top 20、Rerank Top 8；Embedding 的权限、质量和 legacy 过滤发生在相似度排序之前。
- Taxonomy 必须登记已发布 module。默认模板包含 `ai-companion`、`edusoho-training` 及常用别名；未知 module 会进入 index warning，依赖该 module 的直答必须阻断。
- Knowledge Router, Retrieval Service handoff, Evidence Judge, Deep Query Planner, Query Correction, and Case Curator are wired into the current knowledge-first runtime path.
- Solved case drafts are written with `status: review_required` and require explicit approval before becoming `active` knowledge.
- 功能概览类问题（例如“某功能有哪些能力”“支持哪些功能”）由 Knowledge Router 标记为 `feature_overview`。当知识证据满足直答资格时，runtime 应聚合多条功能 evidence/claim 直接回答；这类问题不应因为运营 persona 被强制定性为 bug、配置问题或设计使然。
- 补数据、补统计、补跑、重跑、定时任务、队列、脚本或命令行处理不能只按关键词强制升级，也不能只按字段命中直答。Evidence Judge 必须基于原问题抽取答案需求，并检查 evidence 是否覆盖补跑步骤、命令名称、参数或适用条件；只有页面/功能说明时必须拒绝知识直答。
- Evidence Judge 之后叠加 RAG Answerability Agent（model_assisted）：它拿 `AnswerGoal + evidence` 判断 `full | partial | none | unknown`。`full` 才允许知识库直答；`partial` 必须萃取可用 coveredClaims 并带着 missingElements/escalationFocus 升级代码诊断；`none/unknown` 在需要强答案形态时保守升级。该机制防止“相关但不回答”的高分证据误导直答（如 case_4e905fbc）。

目标工作流：

```text
User message
  -> Build ResolvedTurnContext
  -> Build AnswerGoal
  -> Preflight Gate
  -> Experience against AnswerGoal
  -> Knowledge Router / Retrieval
  -> RAG Answerability Agent
     -> full direct knowledge answer
     -> partial extracted knowledge + code escalation
     -> none code escalation
  -> Claude Code Worker fills missing AnswerGoal items
  -> Output Review verifies merged claims against AnswerGoal
  -> Presentation answers original question from reviewed claims
```

这条链路的阶段级说明见 [知识库、Worker 与 Review 流程](agent-runtime/knowledge-worker-review-flow.md)。

## Non-Guessing Contract

The Agent 不能乱猜.

Mandatory rules:

- 证据不足必须追问 or mark the conclusion as uncertain.
- Do not invent logs, commands, server facts, customer environment, code locations, or MCP results.
- Distinguish fact, inference, assumption, and unknown.
- Never turn a plausible cause into a final conclusion without evidence.
- If the user challenges a conclusion, evaluate the challenge instead of defending the previous answer reflexively.

## DiagnosticRequest

The Agent sends Claude Code a structured request, not raw user chat.

Concrete implementation:

- `src/runtime/request-builder.ts` builds first-run and follow-up `DiagnosticRequest` objects and attaches `AnswerGoal`.
- `src/sessions/context-builder.ts` attaches recent messages and prior run evidence under `DiagnosticRequest.context`.
- `src/domain.ts` defines the request, context, evidence, claim, run, and case session types.
- `src/runtime/resolved-turn.ts` derives one bounded effective query plus source-bound facts, user claims, hypotheses, and unknowns. Raw chat remains unchanged in the case.

```json
{
  "caseId": "case_7f29",
  "runId": "run_03",
  "workspaceId": "workspace_current_project",
  "userGoal": "Diagnose why course task save returns 500",
  "knownFacts": [
    "User reports save failure",
    "Network returns 500",
    "Course ID is 823"
  ],
  "unknowns": [
    "traceId",
    "exact server log line"
  ],
  "constraints": [
    "read-only diagnosis",
    "return structured evidence",
    "do not final-claim without evidence"
  ],
  "allowedMcpToolIds": ["readshield"]
}
```

## Claude Code Output Contract

Claude Code must return structured diagnostic output.

Concrete implementation:

- `src/workers/diagnostic-worker.ts` defines the stable worker port consumed by the runtime.
- `src/workers/claude/claude-code-worker.ts` implements that port for Claude Code.
- `src/workers/claude/claude-output-parser.ts` parses worker JSON and converts CLI failures into partial `DiagnosticResult` values.
- `src/workers/claude/claude-policy.ts` keeps the adapter read-oriented by narrowing tools and validating host commands.

```json
{
  "status": "need_input | partial | concluded",
  "summary": "short diagnostic summary",
  "missingInfo": ["traceId"],
  "evidence": [
    {
      "id": "ev_01",
      "kind": "workspace",
      "source": "src/.../Controller.php",
      "summary": "Save endpoint found",
      "confidence": "medium"
    }
  ],
  "claims": [
    {
      "type": "inference",
      "role": "primary_answer",
      "text": "The problem may be data/config related",
      "evidenceIds": ["ev_01"],
      "answers": ["cause_or_likely_cause"]
    }
  ],
  "recommendedNextAction": "ask_user"
}
```

Claude Code 不直接回复用户. The Agent reviews this output first.

## Agent Review Step

After a worker run completes, a deterministic validator and Review Gate check:

- Does every conclusion have evidence?
- Are assumptions clearly labeled?
- Are unknowns exposed?
- Is the recommended next action safe?
- Does the final claim set cover `answerGoal.mustAnswerItems`, or are uncovered items still visible as unknown/missing?
- Should the user be asked a question before continuing?
- Should the case be escalated to a human?

Only after this review can Presentation generate the user-facing answer from accepted IDs. The presentation model may return `reply + claimIds + evidenceIds`, but the reply must be grounded in accepted claims/evidence, pass deterministic validation, and cannot promote a partial result or add new factual text.

Concrete implementation:

- `src/runtime/result-validator.ts` rejects invalid evidence references and unsupported facts and records observable validation issues.
- `src/runtime/review-presentation.ts` validates Presentation output contract data, including accepted IDs, frozen primary answer IDs, selected-claim evidence binding, first-paragraph coverage, and unsupported facts across the full visible reply.
- `src/runtime/review-gate.ts` maps the validated result into a frozen case status and user-facing decision; model output cannot promote it.
- `src/runtime/agent-configs.ts` resolves the `output-review` Agent config for model review prompts.
- `src/runtime/presenter.ts` formats preflight questions, worker failure summaries, and reviewed fallback replies without inventing unsupported facts. If a result is partial but has accepted fact/inference claims, the fallback leads with `初步判断` and keeps the evidence gap visible instead of hiding the accepted judgment behind a generic downgrade summary.
- `src/agents/presentation.md` defines presentation constraints; the presentation step must express the frozen `primary_answer` for `answerGoal` and must not add unsupported facts.
- `src/runtime/event-recorder.ts` records the review and presentation lifecycle events used by the diagnostic log drawer.
- `src/runtime/diagnostic-runtime.ts` is the runtime orchestration entry; private root facades are intentionally not used.
- Presentation 先表达 frozen primary answer；运营、支持、客户、开发 persona 只能调整表达顺序和补充信息，不能通过问题类型分流或模板归类改写主答。

Worker command, cwd, stdout, stderr, stack, raw provider payload, and internal prompt data are diagnostic-log-only. Logs remain bounded and redacted. If a worker fails before usable evidence exists, the main reply contains only a safe failure category, current diagnosis state, next action, and case/run identity.

## Initial Built-In Agent Configuration

The first version uses one built-in main Agent with configured sub-agents, not a marketplace of agents.

```yaml
agent:
  id: default-helper-agent
  name: super helper
  language: zh-CN
  tone: calm_professional

rules:
  no_guessing: true
  require_evidence_for_conclusion: true
  ask_when_missing_required_info: true
  allow_unknown_answer: true
  distinguish_fact_inference_assumption: true

claude_worker:
  role: diagnostic_tool
  direct_user_response: false
  output_format: structured_json

mcp:
  mode: configurable
  default_permission: read_only
```
