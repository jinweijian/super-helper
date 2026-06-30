## Purpose

Define the retrieval evidence contract that standardizes how retrieval strategies surface parent metadata, quality flags, provenance, freshness, answer span, retrieval trace, and typed blockers to the Evidence Judge.

## Requirements

### Requirement: Runtime retrieval returns evidence and trace
The configured retrieval system SHALL expose a runtime-only result containing both the compatible Knowledge Evidence Pack and the Retrieval Trace while preserving the existing Evidence-Pack-only entrypoint.

#### Scenario: Runtime consumes configured retrieval
- **WHEN** runtime searches the configured knowledge workspace
- **THEN** it receives the final evidence pack and the trace for every recall strategy, fusion, rerank, and filter stage

#### Scenario: Legacy caller uses compatible search
- **WHEN** an existing caller invokes the Evidence-Pack-only configured search function
- **THEN** it receives the existing Knowledge Evidence Pack shape without a new required public field

### Requirement: Evidence preserves canonical parent metadata
Every retrieval evidence result SHALL preserve the canonical parent document metadata required for freshness, quality, provenance, visibility, and claim review.

#### Scenario: Indexed chunk has a parent document
- **WHEN** BM25 or embedding recall maps a chunk to its parent
- **THEN** the candidate and evidence include document type, status, confidence, visibility, last verified time, source document identity, source block IDs, section path, quality, and retrieval strategy scores when those values exist

#### Scenario: Old artifact lacks safety metadata
- **WHEN** an old chunk artifact can be read but lacks parent safety metadata
- **THEN** retrieval marks the metadata as missing and MUST NOT invent epoch timestamps, active status, quality, or provenance

#### Scenario: Parent document is missing
- **WHEN** a chunk cannot be resolved to a canonical parent document
- **THEN** it is excluded from direct-answer evidence and the trace records a `missing_parent` filter reason

### Requirement: Retrieval errors and traces are safe
Retrieval trace and errors SHALL be observable without exposing secrets, raw vectors, complete provider payloads, or complete source documents.

#### Scenario: Provider fails
- **WHEN** embedding or rerank returns timeout, rate limit, server, malformed-response, or dimension errors
- **THEN** the trace contains a redacted failure category and other successful recall candidates remain available

#### Scenario: Trace is persisted in runtime logs
- **WHEN** a knowledge search completes in a user turn
- **THEN** the runtime log records strategy status, candidate counts, fusion, rerank, and filter summaries without changing the public chat response shape
