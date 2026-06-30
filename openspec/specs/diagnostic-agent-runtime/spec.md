## Purpose

Define the diagnostic Agent runtime that owns the diagnostic turn lifecycle, separates runtime from gateway, agent configuration, and worker adapters, and turns `DiagnosticRequest` and `DiagnosticResult` into deterministic, evidence-grounded replies.

## Requirements

### Requirement: Runtime owns the diagnostic turn lifecycle

The system SHALL provide a diagnostic runtime boundary that orchestrates a user turn independently from HTTP transport and Claude CLI implementation details.

#### Scenario: Chat request delegates to runtime

- **WHEN** the local HTTP chat route receives a valid user message
- **THEN** the route SHALL delegate turn handling to the diagnostic runtime or a compatibility facade backed by that runtime
- **THEN** the route SHALL serialize the runtime response without performing preflight, worker dispatch, evidence review, or presentation decisions inline

#### Scenario: Runtime handles synchronous and accepted asynchronous turns

- **WHEN** a chat request is handled synchronously or accepted for asynchronous completion
- **THEN** the same runtime pipeline SHALL be responsible for loading the case, recording the user message, deciding preflight, dispatching a run when needed, reviewing results, and persisting the assistant response

### Requirement: Session context is owned by super helper

The system SHALL keep case memory, user messages, diagnostic runs, and diagnostic events in a session repository owned by super helper, not by worker adapters.

#### Scenario: Worker receives bounded context

- **WHEN** the runtime dispatches a diagnostic worker
- **THEN** the worker SHALL receive a structured `DiagnosticRequest` with bounded `context`
- **THEN** the worker SHALL NOT be treated as the source of long-term case memory

#### Scenario: Follow-up request uses stored case context

- **WHEN** the user sends a follow-up message in an existing case
- **THEN** the runtime SHALL build follow-up context from persisted messages and previous runs
- **THEN** the resulting `DiagnosticRequest.context` SHALL include enough recent case memory to resolve references such as previous answers or previous evidence

### Requirement: Preflight gate is an explicit runtime component

The system SHALL isolate preflight decision-making behind a runtime preflight component that can use local rules and an optional model provider.

#### Scenario: Insufficient input asks user before dispatch

- **WHEN** the preflight gate determines that required information is missing and safe read-only diagnosis is blocked
- **THEN** the runtime SHALL persist an assistant follow-up question
- **THEN** the runtime SHALL NOT dispatch the diagnostic worker for that turn

#### Scenario: Searchable workspace signal dispatches diagnosis

- **WHEN** a workspace is selected and the user message contains searchable business, feature, configuration, troubleshooting, or file-location signals
- **THEN** the preflight gate SHALL produce a dispatch decision with a structured `DiagnosticRequest`

### Requirement: Diagnostic worker adapters expose a stable contract

The system SHALL isolate worker execution behind a stable diagnostic worker contract so Claude CLI mechanics do not leak into the runtime or gateway layers.

#### Scenario: Claude worker failure becomes structured result

- **WHEN** the Claude CLI worker exits unsuccessfully, times out, is disabled, or cannot be executed
- **THEN** the worker adapter SHALL return a `DiagnosticWorkerResponse` containing a structured partial or escalation `DiagnosticResult`
- **THEN** the runtime SHALL be able to review and present that result without parsing CLI stdout or stderr itself

#### Scenario: Worker policy remains read-oriented

- **WHEN** the runtime dispatches the Claude worker adapter in the MVP configuration
- **THEN** the adapter SHALL enforce the configured read-oriented tool policy and disallowed write-capable tools before executing Claude Code

### Requirement: Evidence review happens before presentation

The system SHALL review diagnostic results for evidence support, uncertainty, missing information, and safe next action before producing the user-facing reply.

#### Scenario: Unsupported final facts are rejected

- **WHEN** a diagnostic result contains fact claims without evidence IDs and no supported claims
- **THEN** the review step SHALL prevent those unsupported facts from becoming a final user-facing conclusion

#### Scenario: Persona-aware presentation follows reviewed outcome

- **WHEN** the review step produces a final, partial, ask-user, or escalation outcome
- **THEN** the presentation step SHALL format a persona-aware user-facing reply from the reviewed outcome
- **THEN** presentation SHALL NOT invent facts that were not present in the reviewed diagnostic result

### Requirement: Observability events are structured and centralized

The system SHALL record diagnostic lifecycle events as structured events through a centralized event-recording boundary.

#### Scenario: Diagnostic logs render from stored events

- **WHEN** the logs API renders diagnostic log blocks for a case
- **THEN** it SHALL derive those blocks from persisted `DiagnosticLogEvent` records
- **THEN** route code SHALL NOT need to know the internal implementation details of preflight, worker execution, review, or presentation

#### Scenario: Runtime emits stable lifecycle phases

- **WHEN** a user turn proceeds through input receipt, preflight, diagnostic request creation, worker output capture, review, presentation, and final reply
- **THEN** the runtime or its event recorder SHALL persist stable phase events for each completed lifecycle stage

### Requirement: Refactor preserves MVP external behavior

The first implementation of this architecture SHALL preserve existing CLI commands, local HTTP endpoints, storage compatibility, and read-only Claude Code safety behavior.

#### Scenario: Existing tests remain the compatibility baseline

- **WHEN** the architecture refactor is implemented
- **THEN** the existing `pnpm test` suite SHALL pass or be updated only to reflect equivalent behavior through new module boundaries
- **THEN** changes to user-facing behavior SHALL be intentional and covered by explicit task notes

#### Scenario: Public routes remain compatible

- **WHEN** clients call existing routes such as `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, `/api/settings/model/test`, and `/api/logs`
- **THEN** those routes SHALL remain available with compatible response shapes during the first migration pass

### Requirement: DiagnosticRequest carries a structured AnswerGoal
The runtime SHALL use `DiagnosticRequest.answerGoal` as the authoritative current-turn target for preflight, knowledge, worker, review, presentation, and audit logs.

#### Scenario: Request is built from a user message
- **WHEN** runtime builds a DiagnosticRequest
- **THEN** the request contains `answerGoal.rawUserQuestion`, `answerGoal.resolvedQuestion`, `answerGoal.answerObject`, `answerGoal.mustAnswerItems`, `answerGoal.diagnosticObjective`, and `answerGoal.sourceMessageIds`

#### Scenario: Follow-up keeps user-facing goal separate from diagnostic objective
- **WHEN** runtime builds a follow-up DiagnosticRequest
- **THEN** `answerGoal.resolvedQuestion` remains the user-facing question
- **AND** internal process language is stored only in `answerGoal.diagnosticObjective`
