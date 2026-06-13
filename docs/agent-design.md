# super helper Agent Design

## Role

`super helper Agent` is the middle person and reviewer between the user and diagnostic tools.

The authoritative product Agent configs live in `src/agents/`, not root `AGENT.md`.

Current configured Agents:

- `main.md`: 主 Agent，负责用户回合与最终回复责任。
- `input-review.md`: 输入审核与 Preflight Gate。
- `experience.md`: 经验 Agent，负责复用历史会话答案。
- `knowledge-router.md`: 知识路由 Agent，负责识别模块、意图、关键词和代码升级信号。
- `evidence-judge.md`: 证据充分性 Agent，负责判断知识库证据是否足够或是否需要升级到代码。
- `case-curator.md`: Case 沉淀 Agent，负责用户确认解决后的 solved case 草稿生成。
- `output-review.md`: 输出审核 Agent，负责证据审核。
- `presentation.md`: 美化输出 Agent，负责用户视角表达。
- `registry.json`: runtime stage 到 Agent 配置的配对表。

It is different from `CLAUDE.md`:

- `CLAUDE.md` belongs to a specific workspace and tells Claude Code how to inspect that project.
- `super helper Agent` defines how the product talks to users, decides whether to ask questions, controls uncertainty, reviews evidence, and prevents unsupported conclusions.

Claude Code is a tool. It must not directly reply to the user in the MVP.

## Preflight Gate

Every user message first goes through a `Preflight Gate`.

Concrete implementation:

- `src/runtime/diagnostic-runtime.ts` starts the user turn and calls the gate.
- `src/runtime/agent-configs.ts` resolves the `input-review` Agent config from `src/agents/registry.json`.
- `src/runtime/preflight-gate.ts` owns deterministic local preflight decisions and model/local reconciliation helpers.
- Model preflight is optional. If it fails, the runtime records the failure and falls back to local rules.

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

The `experience` Agent runs after input receipt and before Claude Code dispatch.

Concrete implementation:

- `src/agents/experience.md` defines the Agent role and reuse rules.
- `src/runtime/experience-agent.ts` searches prior readable case sessions for the same or substantially same question.
- Reused answers become `history` evidence and still pass through Output Review and Presentation.
- If no safe match exists, the runtime continues through Preflight Gate and normal worker diagnosis.

## Knowledge-First Skeleton

The first enterprise knowledge-base skeleton adds local workspace commands and product Agent configs for the later layered workflow.

Implemented local commands:

- `super-helper knowledge init --workspace <project-path> [--knowledge-root <path>]` creates the isolated knowledge workspace structure, taxonomy examples, Markdown templates, source metadata example, and empty derived indexes.
- `super-helper knowledge update --workspace <project-path> [--knowledge-root <path>]` rebuilds `knowledge/indexes/manifest.json`, `keyword-index.json`, and `chunks.jsonl` from Markdown parent slices in the resolved knowledge workspace.
- `super-helper knowledge search --workspace <project-path> --query <question> [--knowledge-root <path>]` performs local keyword search and expands chunk hits back to parent slice evidence.

Runtime behavior:

- `--workspace` and runtime workspace selection point to the project/service directory used for code and MCP inspection.
- Knowledge files are stored under the configured knowledge root, isolated by the same workspace key strategy used for session storage; they are not created inside the project code directory by default.
- After an Experience miss, the runtime searches the resolved knowledge workspace before dispatching Claude Code. Answerable knowledge evidence still passes Evidence Judge, Output Review, and Presentation; insufficient evidence is attached to `DiagnosticRequest.context` before code escalation.
- Knowledge Router, Evidence Judge, and Case Curator are registered configs and wired into the current knowledge-first runtime path.

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

- `src/runtime/request-builder.ts` builds first-run and follow-up `DiagnosticRequest` objects.
- `src/sessions/context-builder.ts` attaches recent messages and prior run evidence under `DiagnosticRequest.context`.
- `src/domain.ts` defines the request, context, evidence, claim, run, and case session types.

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
      "text": "The problem may be data/config related",
      "evidenceIds": ["ev_01"]
    }
  ],
  "recommendedNextAction": "ask_user"
}
```

Claude Code 不直接回复用户. The Agent reviews this output first.

## Agent Review Step

After a worker run completes, the Agent checks:

- Does every conclusion have evidence?
- Are assumptions clearly labeled?
- Are unknowns exposed?
- Is the recommended next action safe?
- Should the user be asked a question before continuing?
- Should the case be escalated to a human?

Only after this review can the Agent write a user-facing answer.

Concrete implementation:

- `src/runtime/review-gate.ts` maps worker result status and model review outcomes into case status and user-facing decisions.
- `src/runtime/agent-configs.ts` resolves the `output-review` Agent config for model review prompts.
- `src/runtime/presenter.ts` formats preflight questions and persona-aware final replies without inventing unsupported facts.
- `src/agents/presentation.md` defines presentation constraints; the presentation step must not add unsupported facts.
- `src/runtime/event-recorder.ts` records the review and presentation lifecycle events used by the diagnostic log drawer.
- `src/agent.ts` remains a thin compatibility facade; new orchestration lives in `src/runtime/diagnostic-runtime.ts`.

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
