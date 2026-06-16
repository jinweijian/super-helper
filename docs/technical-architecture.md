# super helper Technical Architecture

## Overview

`super helper` is a TypeScript application with a chat-first UI, a server-side Agent orchestration layer, and isolated diagnostic workers.

The system must support arbitrary project `workspace` configuration and arbitrary MCP protocol tools. It should not be hardcoded to one repository or one MCP server.

## Implemented Module Layout

The current MVP keeps the public import surface stable while separating product responsibilities into explicit modules:

- `src/gateway/http-server.ts` owns HTTP server startup and route composition.
- `src/gateway/routes/` owns route handlers for chat, sessions, settings, and logs.
- `src/gateway/dto.ts` owns public response shapes for settings, sessions, and model settings.
- `src/cli/` owns `dashboard`, `onboard`, `status`, and `doctor` command composition.
- `src/onboarding/` owns Setup drafts, validation, run records, progress events, recovery, provider tests, knowledge pipeline orchestration, local secrets, and config commit.
- `src/agents/` owns product Agent configs and `registry.json` stage pairings.
- `src/runtime/diagnostic-runtime.ts` owns one user turn from input receipt through final presentation.
- `src/runtime/preflight-gate.ts`, `request-builder.ts`, `review-gate.ts`, and `presenter.ts` own runtime decisions and formatting helpers.
- `src/runtime/event-recorder.ts` owns lifecycle log event creation for Agent, Claude, and system phases.
- `src/knowledge/` owns the enterprise knowledge workspace skeleton, Markdown/frontmatter parsing, source metadata, local keyword chunk index, and local evidence-pack search.
- `src/embedding/` owns embedding/rerank provider contracts, provider factories, SiliconFlow provider calls, provider smoke tests, and provider error normalization.
- `src/sessions/` owns case repository ports and request context construction.
- `src/workers/diagnostic-worker.ts` defines the stable worker port.
- `src/workers/claude/` owns the Claude Code adapter implementation, prompts, policy, CLI execution, and output parsing.
- `src/observability/log-blocks.ts` owns diagnostic log drawer block rendering.

Compatibility entry points remain thin:

- `src/agent.ts` exports `SuperHelperAgent` as a compatibility facade over `DiagnosticRuntime`.
- `src/server.ts` re-exports `startServer` from the gateway.
- `src/claude-worker.ts` re-exports the Claude worker adapter and worker port type.

Future development must follow `docs/development-standards.md`. That document is the mandatory module-boundary contract for AI coding and human coding.

## Multi-Agent Configuration

The product uses one main Agent with configured sub-agents:

- `main`: main coordinator
- `input_review` / `preflight`: input review Agent
- `experience`: prior-session experience Agent
- `output_review`: evidence review Agent
- `presentation`: persona-aware presentation Agent

`src/agents/registry.json` maps runtime stages to these configs. Runtime code resolves configs through `src/runtime/agent-configs.ts`.

Claude Code and MCP are workers/tools, not product sub-agents. They return evidence; product Agents decide whether and how evidence becomes a user-facing reply.

## Context Ownership

The service owns context.

Claude Code is not the long-term context source. It receives a bounded request for a specific diagnostic run and returns structured output.

Persistent context belongs to super helper:

- tenant records
- users
- workspace definitions
- MCP tool configurations
- case sessions
- user messages
- preflight decisions
- diagnostic runs
- evidence cards
- final replies
- audit logs

## Multi-User Isolation

Every diagnosis is scoped by:

```text
tenantId + userId + workspaceId + caseId + runId
```

Rules:

- One case can have many runs.
- The same case runs serially.
- Different cases can run concurrently.
- Different tenants must never share context.
- Worker output must be written back to the owning `caseId` and `runId`.

## Worker Queue

Future production architecture uses a Worker Pool.

```text
User message
  -> Agent Preflight Gate
  -> DiagnosticRequest
  -> Run queue
  -> Claude Code Worker
  -> structured DiagnosticResult
  -> Agent review
  -> user-facing reply
```

The MVP can mock the worker, but the API boundary should assume queue-based execution.

Queue requirements:

- per-case single active run
- per-user concurrency limit
- per-tenant concurrency limit
- cancellation
- timeout
- retry for worker failures
- immutable run log

## Runtime Pipeline

`DiagnosticRuntime` is the runtime orchestrator for a single user turn. Synchronous chat calls use `handleUserMessage`. Asynchronous chat calls split the same pipeline into `startUserTurn` and `completeUserTurn`, so `/api/chat` can return `202 Accepted` while the runtime continues the diagnosis.

The runtime pipeline is:

```text
Gateway chat route
  -> SuperHelperAgent facade
  -> DiagnosticRuntime.startUserTurn
  -> Experience Agent
  -> Preflight Gate
  -> Knowledge Router / Knowledge Search / Evidence Judge
       -> knowledge direct answer (when evidence is answerable)
       -> or continuation to Claude Code escalation
  -> DiagnosticRequest builder
  -> DiagnosticWorker port
       -> bounded retry / pivot (Deep Query Correction)
  -> Review Gate
  -> Presenter
  -> RuntimeEventRecorder
  -> CaseRepository
  -> optional Case Curator (solved case draft, review workflow)
```

Route code must not embed preflight, worker, review, or presentation decisions. It validates HTTP input, invokes the runtime, and serializes response DTOs.

Same-case async turns are serialized in the runtime so every accepted user message receives its own helper reply.

## Dashboard Onboarding

The default local setup flow is Dashboard-driven:

```bash
pnpm onboard
pnpm dashboard
pnpm status
pnpm doctor
```

`onboard` and `dashboard` both start the HTTP service. `onboard` always opens `/setup`; `dashboard` opens `/setup` until onboarding is completed and opens `/` afterwards. `--bind loopback` listens on `127.0.0.1`; `--bind lan` listens on `0.0.0.0` and prints a trusted-LAN warning. The MVP intentionally does not enforce access tokens yet, so LAN mode is only for trusted internal networks.

Setup state is persisted under `storage.rootDir`:

```text
onboarding/
  draft.json
  runs/
secrets.json
config.json
```

The HTTP routes under `/api/onboarding/*` are transport adapters only. They save drafts, start/retry runs, expose run snapshots, and stream progress through Server-Sent Events. The recoverable execution model belongs to `src/onboarding/runner.ts`; route code must not run provider calls or knowledge pipeline steps directly.

Submitted API keys are stored outside `config.json` and referenced through `SecretRef`. `config.json` may contain `apiKeyRef` or environment variable references, while `secrets.json` contains local file-backed values with restricted permissions. Public DTOs expose only `hasApiKey` and never return raw secret values or file secret keys.

## Knowledge Processing Pipeline

Knowledge lives behind a strict local processing pipeline so that only audited, published slices can support high-confidence direct answers. The full pipeline is:

```text
intake -> extract -> normalize -> draft slice -> audit -> repair -> review -> publish -> index -> eval
```

- `intake` copies the source file into `knowledge/_sources/<kind>/` and writes a `.meta.json` with id, sha256, parser, and import metadata.
- `extract` produces structured `blocks.jsonl` (heading / paragraph / list_item / table / toc / header_footer / image_caption) plus an `extract-report.json`.
- `normalize` cleans blocks, attaches `section_path` from heading inheritance, and labels boilerplate blocks (TOC, headers, footers, repeated titles) with `included_in_slice: false`.
- `slice` writes candidate parent slices under `knowledge/_pipeline/drafts/<source-id>/` with `status: draft`, `quality_status: unchecked`, and `source_block_ids` provenance. Drafts are not active knowledge.
- `audit` writes `knowledge/indexes/chunk-quality-report.json` and `knowledge/reports/source-quality-report.json` listing `empty_body`, `toc_like`, `duplicate_content`, `missing_source_block_ids`, `multi_topic_slice`, `broken_coreference`, `not_answer_bearing`, and similar issues.
- `repair` writes a `repair-plan-<timestamp>.json` derived from audit issues and only applies deterministic safe actions (`merge_adjacent_short_slices`, `add_section_path`, `add_related_terms`, `mark_review_required`). Unsafe actions are kept in the plan as `review_required` and never auto-applied.
- `review` records `reviewer`, `action`, `notes`, and status transitions in `knowledge/_pipeline/review/<source-id>.review.json`.
- `publish` writes approved slices to the formal `knowledge/whitepapers/<module>/<source-slug>/` tree with `status: active`, `pipeline_status: published`, and preserved provenance, then sets the index dirty flag.
- `index` (`knowledge update`) rebuilds `chunks.jsonl`, `manifest.json`, and `keyword-index.json` from formal published documents only. Drafts, repair plans, and review records are never indexed.
- `eval` runs the golden question set and reports `Hit@1/3/5`, answer-bearing rate, false positives, and per-question failure attribution.

One-shot `knowledge init` is a safe compatibility wrapper. By default it runs intake, extract, normalize, draft slice, audit, and indexing for already-published formal documents, but it does not convert unchecked drafts into active formal knowledge. If an old one-command active publish flow is needed, the user must pass `--legacy-active-publish`; the command output and ingest report mark that normal review/publish was bypassed. Intermediate artifacts under `knowledge/_pipeline/` and `knowledge/reports/` are always retained for re-runs and audits.

## Knowledge Quality Reports

Quality reports are written next to the indexes and reports directories. Severity levels are `info`, `warn`, and `error`. The default `--quality-gate` is `warn`: warnings are visible but the command still exits 0, while `strict` exits non-zero on any `error` issue. The `off` gate skips audit entirely.

- `knowledge/indexes/chunk-quality-report.json`: per-slice and per-chunk issues.
- `knowledge/reports/source-quality-report.json`: parser failures, unknown-block ratio, table/list preservation, heading structure, and source provenance issues.
- Knowledge search reads the chunk-quality-report.json and attaches `quality: { severity, issues }` to each evidence result. Evidence with `error` severity is excluded from direct-answer candidates; `warn` lowers judge confidence.

## Embedding Provider and Vector Artifacts

Embeddings are configured independently from the Agent chat model. The default config keeps embedding disabled and points at SiliconFlow only as the primary real provider for this implementation:

```json
{
  "embedding": {
    "enabled": false,
    "provider": "siliconflow",
    "model": "Qwen/Qwen3-Embedding-0.6B",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKeyEnv": "SILICONFLOW_API_KEY",
    "dimensions": 1024,
    "distance": "cosine"
  },
  "rerank": {
    "enabled": false,
    "provider": "siliconflow",
    "model": "BAAI/bge-reranker-v2-m3",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKeyEnv": "SILICONFLOW_API_KEY"
  }
}
```

`src/embedding/` is the only module that should call remote embedding or rerank provider APIs. It normalizes missing credentials, timeout, rate-limit, invalid request, provider failure, malformed response, and dimension mismatch errors without exposing API keys, bearer headers, cookies, raw provider payloads, raw vectors, or source chunk text.

`src/knowledge/` owns only local vector artifacts:

```text
knowledge/indexes/
  vectors.jsonl
  vector-manifest.json
  vector-build-report.json
```

`knowledge vector build` reads the existing `chunks.jsonl`, skips restricted or inactive chunks before calling the provider, writes vector records, and records provider/model/dimensions/distance/source manifest hash in the manifest. Compatibility checks refuse to use stale or mismatched vector artifacts and report that a rebuild is required.

Runtime retrieval uses a RAG-style flow. Keyword/frontmatter recall runs first. When embedding is enabled and compatible vector artifacts exist, vector recall adds semantically similar chunks. The merged candidate set is then passed through the configured rerank provider when rerank is enabled. Evidence Judge receives the reranked evidence pack and decides whether it is sufficient for a direct answer or whether the turn should escalate to Claude Code.

Current embedding commands:

```bash
node dist/cli.js embedding test --enable --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY --dimensions 1024
node dist/cli.js rerank test --enable --provider siliconflow --model BAAI/bge-reranker-v2-m3 --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY
node dist/cli.js knowledge vector build --workspace /path/to/workspace --knowledge-root /path/to/knowledge-root --enable --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY --dimensions 1024
```

The settings drawer exposes the same checks through `测试 Embedding` and `测试 Rerank`; gateway routes remain DTO/config endpoints and do not own provider request logic.

## Live Knowledge Acceptance

`node dist/cli.js accept knowledge --workspace <path>` (npm alias `accept:knowledge`) runs a repeatable local acceptance check that verifies workspace, model provider activation, knowledge directory presence, source ingest report, Claude Code availability, and read-only worker policy. The default scenarios are:

1. Direct whitepaper answer for `AI伴学助手学习日晚上8点未完成任务会怎么提醒？`.
2. EduSoho whitepaper search for `EduSoho 教培线课程搜索栏支持按什么搜索课程？`.
3. No-hit escalation that records evidence count 0 and Deep Query correction actions.
4. Implementation-detail escalation that requires code escalation with read-only constraints.
5. Solved case curation smoke test that confirms a review-required draft is generated in a temporary knowledge workspace by default. Passing `--keep-cases` keeps the smoke-test draft in the configured knowledge workspace for manual inspection.

Reports are written to `reports/knowledge-acceptance-<timestamp>.json`. The redaction helper strips API keys, bearer tokens, cookies, and known secret fields before writing. The acceptance command does not call paid model endpoints by default.

## Solved Case Review Lifecycle

Solved case drafts under `knowledge/tickets/solved-cases/<module>/` are written with `status: review_required` and `confidence: medium`. A reviewer can change the status to `active` (approve) or keep it as `review_required` (reject / request edits) using either the CLI or the runtime orchestration method. Review metadata (`reviewer`, `reviewed_at`, `review_notes`, `review_action`, `review_source`) is written to the case frontmatter and an optional `<case>.review.json` sidecar is stored next to the file. A reviewer can also convert a solved case to an unresolved case under `knowledge/tickets/unresolved-cases/<module>/`. Each action marks the knowledge index dirty so the next `knowledge update` rebuilds the indexes.

## Knowledge Workspace Contract Updates

`src/knowledge/` continues to own the local enterprise knowledge base. Pipeline stages run inside this module and the runtime only orchestrates the slice review lifecycle. Knowledge search excludes `_pipeline/`, `_sources/`, `_taxonomy/`, `indexes/`, and `reports/` from the searchable tree so draft and review artifacts cannot support high-confidence direct answers.

## Session Repository

The session layer defines a repository-style boundary in `src/sessions/case-repository.ts`.

`FileMemoryStore` implements that repository while preserving the existing persisted case JSON shape. `src/sessions/file-case-repository.ts` is a named file-backed repository export for future injection.

Session storage is scoped by the active workspace at server startup. `src/sessions/storage-scope.ts` resolves the effective storage root from the configured base `storage.rootDir` and the active workspace root path. With the default `storage.isolateByWorkspace: true`, starting two services with different `--workspace` values stores their cases under different workspace-specific directories even when they share the same base config directory. This changes file placement only; it must not change the persisted case JSON shape.

`src/sessions/context-builder.ts` constructs bounded diagnostic request context from recent messages and prior runs. Claude Code receives this context through `DiagnosticRequest.context`; it does not own long-term conversation state.

## Knowledge Repository Storage

Knowledge storage is scoped separately from the inspected project workspace. `src/knowledge/storage-scope.ts` resolves the effective knowledge workspace root from configured `knowledge.rootDir`, the active workspace id, and the active workspace root path. It uses the same workspace key strategy as session storage so multiple local services can share one super helper config directory while keeping separate knowledge bases.

With the default `knowledge.isolateByWorkspace: true`, `--workspace /path/to/service-a` and `--workspace /path/to/service-b` resolve to different knowledge workspace roots under the configured knowledge base directory. The editable knowledge tree still uses the same internal layout, but it lives under `<resolved-knowledge-workspace>/knowledge/` instead of inside the service code directory.

## Workspace Configuration

A workspace is any project or service directory the helper is allowed to inspect.

```ts
interface WorkspaceConfig {
  id: string;
  name: string;
  rootPath: string;
  claudeInstructionsPath?: string;
  mcpToolIds: string[];
}
```

If the workspace contains a `CLAUDE.md`, that file guides Claude Code inside that workspace. It does not replace the super helper Agent configuration.

The knowledge-base MVP assumes the resolved knowledge workspace contains:

```text
knowledge/
  _sources/
  _taxonomy/
  faq/
  runbooks/
  tickets/
  whitepapers/
  glossary/
  modules/
  indexes/
```

`knowledge/_sources/` preserves original PDFs or source files for provenance. Structured Markdown parent slices are the editable knowledge source. `knowledge/indexes/` contains derived artifacts such as `chunks.jsonl`, `keyword-index.json`, `manifest.json`, and optional vector artifacts; these can be rebuilt from parent slices.

Current implemented knowledge commands:

```bash
super-helper knowledge init --workspace /path/to/workspace
super-helper knowledge init --workspace /path/to/workspace --knowledge-root /path/to/knowledge-base
super-helper knowledge update --workspace /path/to/workspace
super-helper knowledge vector build --workspace /path/to/workspace --knowledge-root /path/to/knowledge-base --enable --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY --dimensions 1024
super-helper knowledge search --workspace /path/to/workspace --query "课程发布后为什么学员端看不到"
```

`--workspace` identifies the project/service workspace. `--knowledge-root` optionally overrides the configured base directory for the isolated knowledge repository. Runtime integration happens through `src/runtime/`: after an Experience miss, the runtime searches the resolved knowledge workspace, passes answerable evidence through Evidence Judge, Output Review, and Presentation, and escalates to the existing worker flow when knowledge is absent, insufficient, risky, or conflicting.

The browser health panel can operate the same service-scoped knowledge workspace through gateway endpoints:

- `GET /api/knowledge/health` returns the health summary for the current service workspace.
- `POST /api/knowledge/bind` initializes the resolved knowledge workspace skeleton for the requested `workspaceId`.
- `POST /api/knowledge/reindex` rebuilds keyword indexes and quality reports for the resolved knowledge workspace.

These routes are transport adapters only. They validate request shape, resolve the configured workspace id, call `src/knowledge/` operations with `resolveKnowledgeWorkspaceRoot`, and return DTOs. They must not decide diagnostic answers or write case-session state. Because all sessions for a service carry the same `workspaceId`, a bound knowledge workspace is shared by every session in that service.

## MCP Configuration

MCP tools are configurable per workspace.

```ts
interface McpToolConfig {
  id: string;
  name: string;
  protocol: 'stdio' | 'http' | 'sse';
  permission: 'read_only' | 'read_write';
  enabled: boolean;
}
```

MVP default permission is 只读.

The first product version should assume:

- any MCP protocol-compatible tool can be registered
- tools can be allowlisted per workspace
- tool results are stored as evidence summaries
- raw sensitive output may require retention policy later

## Claude Code Worker

Claude Code workers should be launched as isolated executions, not as one shared session.

Each run should receive:

- a generated run prompt
- the active workspace path
- allowed tool list
- strict MCP configuration
- read-only permission expectations
- output schema requirements

Each run returns structured JSON for the Agent to review.

The default local worker mode should use non-interactive read-oriented tooling. The allowed tool list should remain narrow, for example `Read`, `Glob`, and `Grep`.

The implemented Claude adapter is split by responsibility:

- `claude-prompts.ts` builds the system prompt and user payload.
- `claude-policy.ts` narrows tools and validates read-only host commands.
- `claude-cli.ts` runs the CLI process, captures bounded output, renders shell commands, and retries busy sessions.
- `claude-output-parser.ts` parses structured output and converts failures into partial diagnostic results.
- `claude-code-worker.ts` implements the `DiagnosticWorker` port.

## Observability

Runtime lifecycle events are recorded through `CaseRuntimeEventRecorder`.

Agent lifecycle events include `agentId`, `agentRole`, and `agentName`. `/api/logs` shows the responsible Agent in the diagnostic log drawer, and `/api/session` exposes recent `agentActivity` for the loading state.

The recorder preserves existing phases such as:

- `input_received`
- `preflight_started`
- `experience_started`
- `experience_hit`
- `experience_miss`
- `preflight_decision`
- `diagnostic_request`
- `command`
- `raw_output`
- `evidence_review_started`
- `presentation_agent_result`
- `user_reply`

`src/observability/log-blocks.ts` converts stored events into the public log drawer blocks used by `/api/logs`.

## Frontend Shape

The MVP UI is intentionally simple:

- chat timeline
- bottom-sticky composer
- current case title and status
- `查看诊断日志` drawer
- loading state with recent `agentActivity`
- session sidebar more menu with pin, archive, and delete actions
- settings drawer with read-only `/api/agents` multi-Agent configuration summaries
- copy conclusion action

Verbose diagnostic details stay in the log drawer, not in the main chat.
