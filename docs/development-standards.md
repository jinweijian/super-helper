# supper helper Development Standards

This document is the mandatory development contract for `supper helper`.

It exists because this project must behave like a real Agent AI system, not a pile of one-file-one-logic scripts. Future AI coding and human development must preserve the architecture created by the runtime refactor.

## Non-Negotiable Principle

Code must be organized by responsibility and contract.

Do not add logic wherever it is convenient. Every change must first answer:

- Which module owns this responsibility?
- What public contract does it consume or expose?
- What tests prove that contract still works?
- Does this change require updating architecture, Agent design, or OpenSpec artifacts?

If the answer is unclear, pause and update the design before writing implementation code.

## Required Development Flow

For every feature, bug fix, or refactor:

1. Identify the affected responsibility: agents, gateway, runtime, sessions, worker, observability, UI, config, or docs.
2. Read the relevant module section in this document and `docs/technical-architecture.md`.
3. Keep compatibility entry points thin.
4. Add or update focused tests at the contract boundary.
5. Run the required verification commands.
6. Update docs when a public contract, module boundary, workflow, or developer rule changes.

For OpenSpec changes, implementation must follow the change artifacts. Do not invent a different design during coding without updating the OpenSpec design or tasks.

## Module Ownership Map

| Area | Owns | Must Not Own |
| --- | --- | --- |
| `src/gateway/` | HTTP server, routes, DTOs, request parsing, response serialization | Preflight, worker dispatch policy, evidence review, final reply formatting |
| `src/agents/` | Product Agent configuration documents and `registry.json` stage pairings | Runtime orchestration, HTTP routing, worker execution, persistence |
| `src/runtime/` | Agent turn orchestration, Preflight Gate, request building, review decisions, presentation, lifecycle event recording | HTTP APIs, route DTOs, raw file persistence details, Claude CLI implementation |
| `src/knowledge/` | Enterprise knowledge workspace schema, templates, Markdown/frontmatter parsing, source metadata, keyword chunk index, local knowledge search | Runtime orchestration, user-facing final replies, Claude Code execution, HTTP route decisions, vector/RAG infrastructure |
| `src/sessions/` | Case repository ports, file-backed repository export, diagnostic context building | Worker execution, model calls, user-facing final replies |
| `src/workers/` | Diagnostic worker port and worker adapters | Case orchestration, user chat responses, route handling |
| `src/workers/claude/` | Claude prompts, CLI policy, CLI execution, output parsing, Claude adapter | Runtime decisions, user-facing review, HTTP behavior |
| `src/observability/` | Log block rendering and observability transformations | Runtime decisions, worker execution |
| `src/ui.ts` | Browser UI rendering and client-side interactions | Server routes, runtime decisions, worker behavior |
| `src/config.ts` | Config loading, defaults, provider/workspace settings | Runtime orchestration, route decisions |
| `src/domain.ts` | Shared domain types | Implementation behavior |

## Compatibility Entry Points

These files are compatibility facades and must stay thin:

- `src/agent.ts`
- `src/server.ts`
- `src/claude-worker.ts`

Allowed changes:

- re-exporting renamed implementations
- preserving old public names
- adding narrow type exports for compatibility

Forbidden changes:

- adding orchestration logic
- adding route handlers
- adding Claude prompt or CLI logic
- adding persistence or DTO transformation logic

If a compatibility file grows beyond a small facade, move the behavior to the owning module first.

## Runtime Contract

`src/runtime/diagnostic-runtime.ts` owns one user turn.

The runtime pipeline is:

```text
Gateway chat route
  -> SupperHelperAgent facade
  -> DiagnosticRuntime.startUserTurn
  -> Experience Agent
  -> Preflight Gate
  -> DiagnosticRequest builder
  -> DiagnosticWorker port
  -> Review Gate
  -> Presenter
  -> RuntimeEventRecorder
  -> CaseRepository
```

Synchronous chat and asynchronous chat must use the same runtime pipeline.

Rules:

- `handleUserMessage` may combine start and complete for synchronous API calls.
- `startUserTurn` may persist the user's message and initial lifecycle events.
- `completeUserTurn` must continue the same runtime pipeline, not duplicate alternate logic.
- `recordTurnFailure` handles async failure recording.
- Runtime code must create `DiagnosticRequest` through `request-builder.ts`.
- Runtime code must map worker output through `review-gate.ts` and `presenter.ts`.
- Runtime code must resolve product Agent configs through `src/agents/registry.json` using `src/runtime/agent-configs.ts`.
- Same-case async turns must be serialized so every accepted user message receives its own helper reply.

## Gateway Contract

Gateway code is transport code.

Route handlers may:

- validate method/path/body
- call runtime or repository methods
- serialize public DTOs
- return HTTP status codes
- compute response metadata such as context usage

Route handlers must not:

- decide whether a message should be dispatched
- construct Claude prompts
- call Claude worker directly
- review evidence
- format final diagnostic conclusions
- mutate case internals outside repository/runtime calls

Public response compatibility must be protected by tests for:

- `/api/chat`
- `/api/session`
- `/api/sessions`
- `/api/settings`
- `/api/settings/model/test`
- `/api/logs`

## Session and Persistence Contract

The case session is the source of long-term diagnostic context.

Rules:

- `FileMemoryStore` implements the repository boundary and preserves persisted case JSON shape.
- Session storage scoping belongs in `src/sessions/storage-scope.ts`; gateway/server startup may use the resolved path but must not invent its own workspace-directory naming logic.
- Different active workspaces must use isolated session storage by default. If this behavior changes, update the architecture docs and add compatibility tests.
- New runtime code should depend on repository-style methods, not raw JSON files.
- `context-builder.ts` is the only place that constructs `DiagnosticRequest.context`.
- Do not let Claude Code own long-term memory.
- Do not mix cases, users, tenants, workspaces, or runs.

If persisted shape changes, add migration logic and tests.

## Worker Contract

Workers are tools, not Agents.

All worker adapters must implement the `DiagnosticWorker` port from `src/workers/diagnostic-worker.ts`.

Workers receive structured `DiagnosticRequest` and return structured `DiagnosticResult` plus trace. They must not write the final user reply.

Claude adapter rules:

- Prompt generation belongs in `claude-prompts.ts`.
- Read-only policy belongs in `claude-policy.ts`.
- CLI execution belongs in `claude-cli.ts`.
- Output parsing and failure conversion belong in `claude-output-parser.ts`.
- Adapter composition belongs in `claude-code-worker.ts`.

Host commands must remain constrained by `docs/command-whitelist.md`.

## Knowledge Workspace Contract

`src/knowledge/` owns the local enterprise knowledge base skeleton.

Rules:

- Knowledge files live under the active workspace `knowledge/` directory.
- Original PDFs and source files belong under `knowledge/_sources/`; they are provenance, not direct answer context.
- Structured Markdown parent slices under `knowledge/faq/`, `knowledge/runbooks/`, `knowledge/whitepapers/`, `knowledge/modules/`, `knowledge/glossary/`, and `knowledge/tickets/` are the canonical editable knowledge.
- `knowledge/indexes/chunks.jsonl`, `keyword-index.json`, and `manifest.json` are derived artifacts and must be rebuildable from parent slices.
- MVP knowledge search is local Markdown/frontmatter/keyword search only. Do not add vector databases, GraphRAG, Obsidian runtime dependency, or model-based RAG inside this module.
- The knowledge module returns structured evidence packs. It must not produce user-facing final replies.
- Runtime integration must preserve the existing Evidence Review contract before any knowledge evidence reaches the user.

## Agent Evidence Contract

The Agent must not guess.

Product Agent configs live in `src/agents/`:

- `main.md`: main coordinator
- `input-review.md`: input review and Preflight Gate
- `experience.md`: prior-session answer reuse
- `output-review.md`: evidence review
- `presentation.md`: persona-aware final wording
- `registry.json`: stage-to-Agent pairing

Every final answer must pass evidence review:

- Facts require evidence IDs.
- Inferences must be labeled as inferences.
- Assumptions must be labeled as assumptions.
- Unknowns must stay visible.
- Unsupported fact-only conclusions must be blocked, downgraded, or converted into follow-up questions.

Claude Code output is not user-facing until the runtime review step accepts it.

## Observability Contract

Lifecycle events are part of the product contract because the log drawer is the audit layer.

Event creation belongs in `src/runtime/event-recorder.ts`. Log drawer rendering belongs in `src/observability/log-blocks.ts`.

Agent events must include Agent identity metadata so the diagnostic log and loading state can show which Agent handled each step.

Preserve established phases unless a documented migration is added:

- `conversation_started`
- `input_received`
- `persona_agent_result`
- `input_review_started`
- `preflight_started`
- `local_preflight_result`
- `model_preflight_result`
- `preflight_decision`
- `diagnostic_request`
- `command`
- `raw_output`
- `evidence_review_started`
- `model_review_result`
- `presentation_agent_result`
- `user_reply`
- `turn_failed`

Do not scatter ad hoc log event objects through unrelated modules.

## Session Lifecycle Contract

Sessions may be pinned, archived, or deleted.

- Pinned sessions sort before unpinned sessions.
- Archived sessions remain readable but must reject new chat turns.
- Deleted sessions remove the local case file.
- Generic session titles should refresh from the first meaningful user message.

## Testing Contract

Tests should protect contracts, not implementation trivia.

Required coverage by change type:

- Gateway changes: route compatibility tests and response shape tests.
- Runtime changes: preflight, request building, review, presentation, sync/async pipeline tests.
- Agent config changes: registry resolution, `/api/agents`, and docs lint tests.
- Worker changes: prompt separation, read-only policy, CLI failure conversion, output parsing tests.
- Session changes: repository behavior and context builder tests.
- Observability changes: log block and drawer behavior tests.
- Public API changes: compatibility tests and docs updates.

Before claiming completion, run the strongest feasible verification:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Documentation Contract

Documentation is not optional architecture theater. It is the source of future coding constraints.

Update docs when changing:

- module boundaries
- runtime pipeline
- public API shape
- worker contracts
- persistence shape
- evidence/review rules
- command permissions
- Agent behavior
- OpenSpec workflow

Minimum docs to consider:

- `AGENTS.md`
- `AGENT.md`
- `docs/development-standards.md`
- `docs/technical-architecture.md`
- `docs/agent-design.md`
- `docs/product-requirements.md`
- `docs/command-whitelist.md`
- related OpenSpec change artifacts

## Anti-Patterns

Do not introduce these patterns:

- A route handler that grows into a mini Agent.
- A worker adapter that knows how to talk to the user.
- A runtime method that parses HTTP or renders DTOs.
- A storage module that calls models or workers.
- A UI event handler that encodes diagnostic decisions.
- A product Agent prompt/config outside `src/agents/`.
- A runtime stage-to-Agent pairing hardcoded outside `src/agents/registry.json`.
- A compatibility facade that becomes the real implementation again.
- A giant file containing gateway, runtime, worker, and presentation logic.
- A final answer generated directly from Claude output without Agent review.

When tempted to add quick logic in the nearest file, stop and route the responsibility to the correct module.
