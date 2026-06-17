## ADDED Requirements

### Requirement: Knowledge-first runtime uses retrieval service boundary
The knowledge-first runtime SHALL consume knowledge evidence through the retrieval service instead of owning retrieval strategy selection or provider construction.

#### Scenario: Runtime searches knowledge
- **WHEN** a user question reaches the knowledge-first diagnosis stage
- **THEN** runtime calls the retrieval service with the question, route candidates, persona visibility, workspace context, and retrieval limit

#### Scenario: Runtime receives retrieval evidence
- **WHEN** retrieval returns candidates
- **THEN** runtime converts the retrieval result into the existing knowledge evidence pack shape before Evidence Judge evaluates answerability

#### Scenario: Runtime escalates with retrieval context
- **WHEN** Evidence Judge blocks direct answer or requires code escalation
- **THEN** runtime attaches retrieval evidence and trace context to `DiagnosticRequest.context` without exposing provider internals in the user-facing reply

### Requirement: Runtime does not instantiate retrieval providers
The runtime SHALL NOT directly create embedding providers, rerank providers, or vendor adapters.

#### Scenario: Embedding recall is enabled
- **WHEN** embedding recall is available for a workspace
- **THEN** provider creation happens behind retrieval strategy setup and not inside `DiagnosticRuntime`

#### Scenario: Rerank is enabled
- **WHEN** rerank is available for fused candidates
- **THEN** rerank provider creation happens behind retrieval rerank service and not inside `DiagnosticRuntime`

### Requirement: Existing knowledge diagnosis behavior remains compatible
The retrieval refactor SHALL preserve existing Evidence Judge and presentation behavior while changing the retrieval implementation boundary.

#### Scenario: Knowledge direct answer remains reviewed
- **WHEN** retrieval evidence is answerable
- **THEN** the result still passes Evidence Judge, Output Review, and Presentation before becoming user-visible

#### Scenario: Knowledge absent fallback remains
- **WHEN** the active workspace has no usable knowledge directory or retrieval returns no evidence
- **THEN** runtime preserves the existing Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation flow

#### Scenario: Restricted evidence remains hidden
- **WHEN** retrieval finds evidence that is not visible to the current persona
- **THEN** that evidence cannot be used as a direct user-facing answer and the existing restricted-evidence behavior remains intact

