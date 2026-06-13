## ADDED Requirements

### Requirement: Knowledge slice quality audit
The system SHALL audit generated knowledge parent slices and derived chunks before treating an ingest as production-ready.

#### Scenario: Quality report generated
- **WHEN** `knowledge init` or `knowledge update` processes source documents or parent slices
- **THEN** the system writes `knowledge/indexes/chunk-quality-report.json` containing inspected source documents, parent slice counts, chunk counts, issue counts, severity counts, thresholds, and recommended actions

#### Scenario: Empty or heading-only slice detected
- **WHEN** a generated parent slice has no meaningful body content beyond frontmatter, headings, boilerplate, or the source reference block
- **THEN** the quality report records an `empty_body` or `heading_only` issue for that slice and marks it at least `warn`

#### Scenario: Directory-like slice detected
- **WHEN** a generated parent slice appears to be a table of contents, page header/footer, repeated document title, or navigation-only content
- **THEN** the quality report records a `toc_like` issue and includes the slice path for human review

#### Scenario: Duplicate slice detected
- **WHEN** two or more parent slices have substantially identical normalized body text
- **THEN** the quality report records `duplicate_content` with all affected slice paths and the shared content hash

#### Scenario: Provenance issue detected
- **WHEN** a parent slice or chunk lacks `source_document`, `source_document_id`, `section_path`, or a valid parent relationship
- **THEN** the quality report records a provenance issue and marks orphan chunks or missing parent links as `error`

### Requirement: Knowledge quality gate behavior
The system SHALL make knowledge quality issues visible without silently blocking MVP usage by default.

#### Scenario: Default gate warns
- **WHEN** quality audit finds warnings but no errors under the default quality gate
- **THEN** `knowledge init` or `knowledge update` completes successfully and prints the quality report path, warning count, and top issue categories

#### Scenario: Strict gate blocks errors
- **WHEN** strict quality gate is enabled and the audit finds `error` severity issues
- **THEN** the command exits non-zero, leaves the report on disk, and explains which issue categories must be fixed

#### Scenario: Search avoids fatal-quality evidence
- **WHEN** a document or chunk is marked with fatal quality issues
- **THEN** knowledge search excludes it from answerable evidence or marks it as non-answerable evidence for Evidence Judge

### Requirement: Evidence Judge hardening
The system SHALL produce explainable evidence sufficiency decisions with score breakdowns, blockers, and false-positive controls.

#### Scenario: Score breakdown included
- **WHEN** Evidence Judge evaluates an evidence pack
- **THEN** the result includes `answer_score`, component scores for relevance, coverage, source authority, freshness, version match, agreement, actionability, and penalties, plus a human-readable rationale

#### Scenario: Generic keyword false positive blocked
- **WHEN** evidence only matches generic terms such as "课程", "配置", "功能", "怎么", or "支持" without matching a business entity, module alias, title, or answer-bearing sentence
- **THEN** Evidence Judge lowers the score, adds an ambiguity blocker, and prevents high-confidence direct answers

#### Scenario: Low-quality slice cannot direct answer
- **WHEN** the top evidence has quality issues such as empty body, directory-like content, duplicate content, or missing provenance
- **THEN** Evidence Judge requires additional evidence or code/human escalation rather than using that evidence alone for a final answer

#### Scenario: Conflict and stale evidence blocked
- **WHEN** active evidence conflicts with deprecated, archived, review-required, or stale evidence for the same module and intent
- **THEN** Evidence Judge returns `answerable: false`, lists conflicts or stale blockers, and selects code or human escalation

#### Scenario: High-risk uncertainty blocked
- **WHEN** the question involves production incident, payment, permissions, security, or data repair and evidence leaves unresolved uncertainty
- **THEN** Evidence Judge prevents direct answer even if keyword relevance is high

### Requirement: Evidence claim boundary
The system SHALL preserve the distinction between fact, inference, assumption, and unknown from Evidence Judge through final result construction.

#### Scenario: Unsupported fact downgraded
- **WHEN** a knowledge-derived fact has no evidence id or only low-quality evidence
- **THEN** the final `DiagnosticResult` downgrades it to inference, assumption, or unknown before Output Review

#### Scenario: Unknowns remain visible
- **WHEN** Evidence Judge identifies missing version, tenant, environment, current implementation, or source quality information
- **THEN** the resulting diagnostic output keeps those items in `missingInfo` or unknown claims

### Requirement: Deep Query retry and pivot
The system SHALL support bounded retry and deterministic query correction when the first code escalation does not produce sufficient evidence.

#### Scenario: Attempt state attached
- **WHEN** runtime escalates from knowledge to Claude Code
- **THEN** `DiagnosticRequest.context.deepQuery` includes attempt number, max attempts, artifact targets, anchor terms, likely paths, tried queries, failed reasons, and correction actions

#### Scenario: One safe retry
- **WHEN** the first worker result is partial, has insufficient evidence, or Output Review requests continued diagnosis and correction actions remain
- **THEN** runtime may dispatch one follow-up `DiagnosticRequest` with a pivoted deep query while preserving the same Claude session and read-only constraints

#### Scenario: Scheduler pivot
- **WHEN** the first attempt targets scheduler artifacts and finds no scheduler evidence
- **THEN** Query Correction pivots toward queue, callback, state machine, or state update artifacts before asking the user

#### Scenario: Route pivot
- **WHEN** the first attempt targets route artifacts and finds only endpoint evidence without implementation cause
- **THEN** Query Correction pivots toward controller, service, repository, or config artifacts

#### Scenario: Retry stops safely
- **WHEN** max attempts are reached, high-risk escalation is required, or the next step requires user-provided runtime context
- **THEN** runtime stops retrying and returns a reviewed partial, ask-user, or human-escalation result

### Requirement: Live knowledge acceptance checks
The system SHALL provide a repeatable local acceptance command for validating the real layered knowledge setup without exposing secrets.

#### Scenario: Acceptance command checks config
- **WHEN** the acceptance command runs
- **THEN** it verifies active workspace, model provider activation, knowledge directory presence, source ingest report, Claude Code availability, and read-only worker policy

#### Scenario: Acceptance command checks knowledge direct answer
- **WHEN** the acceptance command asks a configured question whose answer exists in the ingested whitepapers
- **THEN** it records that no worker call was needed and that the final reply cites knowledge evidence

#### Scenario: Acceptance command checks no-hit escalation
- **WHEN** the acceptance command asks a no-hit question with enough workspace signal to dispatch
- **THEN** it records that knowledge evidence count is zero and that deep query correction actions include alias or source-type broadening

#### Scenario: Acceptance command checks implementation escalation
- **WHEN** the acceptance command asks an endpoint, file path, config, log, or current implementation question
- **THEN** it records that Evidence Judge required code escalation and that the worker request kept read-only constraints

#### Scenario: Acceptance report is redacted
- **WHEN** the acceptance command writes its report
- **THEN** the report omits API keys, tokens, raw secrets, cookies, and full model payloads while preserving pass/fail, case id, run id, phases, and evidence summaries

### Requirement: Case curation review workflow
The system SHALL support review of generated solved case drafts before they become active knowledge.

#### Scenario: Draft remains review required
- **WHEN** Case Curator generates a solved case draft
- **THEN** the document remains `status: review_required` and `confidence: medium` until a reviewer approves it

#### Scenario: Approve solved case
- **WHEN** a reviewer approves a solved case draft
- **THEN** the system records reviewer metadata, changes status to `active`, preserves provenance, marks the knowledge index dirty, and logs the review action

#### Scenario: Reject solved case
- **WHEN** a reviewer rejects a solved case draft
- **THEN** the system keeps or sets status to `review_required`, records rejection notes, does not mark it high confidence, and logs the review action

#### Scenario: Convert to unresolved case
- **WHEN** a reviewer decides the draft lacks enough evidence to be a solved case
- **THEN** the system creates or moves the content into `knowledge/tickets/unresolved-cases/<module-id>/`, preserves fact/inference/unknown distinctions, and marks the index dirty

#### Scenario: Review API remains transport-only
- **WHEN** an HTTP API is added for case review actions
- **THEN** gateway code only validates input and serializes DTOs; runtime and knowledge modules own review decisions and file mutations

### Requirement: Observability for hardening workflows
The system SHALL make quality audits, hardened judge decisions, deep query retries, live acceptance checks, and case review actions observable.

#### Scenario: Quality audit logged
- **WHEN** a quality audit runs during ingest or update
- **THEN** logs or command output include issue counts, report path, and whether the gate passed, warned, or failed

#### Scenario: Judge blockers logged
- **WHEN** Evidence Judge blocks a direct answer
- **THEN** diagnostic logs include score breakdown, blockers, missing info, and selected escalation path

#### Scenario: Deep query retry logged
- **WHEN** runtime dispatches a retry or pivot
- **THEN** diagnostic logs include attempt number, previous failed reason, next artifact family, and stop condition when finished

#### Scenario: Case review logged
- **WHEN** a reviewer approves, rejects, requests edits, or converts a case
- **THEN** diagnostic logs include action, reviewer, document id, target path, and resulting status

### Requirement: Documentation alignment
The system documentation SHALL accurately describe the current knowledge-first runtime and the new hardening workflows.

#### Scenario: Runtime docs updated
- **WHEN** this change is implemented
- **THEN** `docs/technical-architecture.md`, `docs/agent-design.md`, and related developer docs no longer state that knowledge runtime integration is only future work

#### Scenario: Acceptance docs added
- **WHEN** live acceptance tooling is implemented
- **THEN** documentation explains how to run it, where reports are written, what secrets are redacted, and what failures mean

### Requirement: Compatibility preserved
The system SHALL preserve existing runtime, worker, gateway, session, and knowledge contracts while adding hardening behavior.

#### Scenario: Existing chat APIs compatible
- **WHEN** quality audit, hardened judge, deep query retry, live acceptance, or case review is added
- **THEN** existing `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, and `/api/logs` response shapes remain backward compatible

#### Scenario: Existing case JSON readable
- **WHEN** existing case JSON files are loaded after hardening changes
- **THEN** they remain readable without destructive migration

#### Scenario: Knowledge can be disabled or absent
- **WHEN** the active workspace has no usable `knowledge/` directory or knowledge hardening is disabled
- **THEN** runtime preserves the existing Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation flow
