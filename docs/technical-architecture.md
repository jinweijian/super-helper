# supper helper Technical Architecture

## Overview

`supper helper` is a TypeScript application with a chat-first UI, a server-side Agent orchestration layer, and isolated diagnostic workers.

The system must support arbitrary project `workspace` configuration and arbitrary MCP protocol tools. It should not be hardcoded to one repository or one MCP server.

## Implemented Module Layout

The current MVP keeps the public import surface stable while separating product responsibilities into explicit modules:

- `src/gateway/http-server.ts` owns HTTP server startup and route composition.
- `src/gateway/routes/` owns route handlers for chat, sessions, settings, and logs.
- `src/gateway/dto.ts` owns public response shapes for settings, sessions, and model settings.
- `src/agents/` owns product Agent configs and `registry.json` stage pairings.
- `src/runtime/diagnostic-runtime.ts` owns one user turn from input receipt through final presentation.
- `src/runtime/preflight-gate.ts`, `request-builder.ts`, `review-gate.ts`, and `presenter.ts` own runtime decisions and formatting helpers.
- `src/runtime/event-recorder.ts` owns lifecycle log event creation for Agent, Claude, and system phases.
- `src/sessions/` owns case repository ports and request context construction.
- `src/workers/diagnostic-worker.ts` defines the stable worker port.
- `src/workers/claude/` owns the Claude Code adapter implementation, prompts, policy, CLI execution, and output parsing.
- `src/observability/log-blocks.ts` owns diagnostic log drawer block rendering.

Compatibility entry points remain thin:

- `src/agent.ts` exports `SupperHelperAgent` as a compatibility facade over `DiagnosticRuntime`.
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

Persistent context belongs to supper helper:

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

Route code must not embed preflight, worker, review, or presentation decisions. It validates HTTP input, invokes the runtime, and serializes response DTOs.

Same-case async turns are serialized in the runtime so every accepted user message receives its own helper reply.

## Session Repository

The session layer defines a repository-style boundary in `src/sessions/case-repository.ts`.

`FileMemoryStore` implements that repository while preserving the existing persisted case JSON shape. `src/sessions/file-case-repository.ts` is a named file-backed repository export for future injection.

Session storage is scoped by the active workspace at server startup. `src/sessions/storage-scope.ts` resolves the effective storage root from the configured base `storage.rootDir` and the active workspace root path. With the default `storage.isolateByWorkspace: true`, starting two services with different `--workspace` values stores their cases under different workspace-specific directories even when they share the same base config directory. This changes file placement only; it must not change the persisted case JSON shape.

`src/sessions/context-builder.ts` constructs bounded diagnostic request context from recent messages and prior runs. Claude Code receives this context through `DiagnosticRequest.context`; it does not own long-term conversation state.

## Workspace Configuration

A workspace is any project codebase the helper is allowed to inspect.

```ts
interface WorkspaceConfig {
  id: string;
  name: string;
  rootPath: string;
  claudeInstructionsPath?: string;
  mcpToolIds: string[];
}
```

If the workspace contains a `CLAUDE.md`, that file guides Claude Code inside that workspace. It does not replace the supper helper Agent configuration.

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
