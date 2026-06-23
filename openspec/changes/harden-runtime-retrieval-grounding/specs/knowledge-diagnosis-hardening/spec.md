## ADDED Requirements

### Requirement: Evidence Judge consumes complete retrieval grounding
The Evidence Judge SHALL base knowledge direct-answer decisions on canonical parent metadata, quality, provenance, freshness, answer span, retrieval trace, and typed blockers rather than matched-term count alone.

#### Scenario: Retrieval migration drops metadata
- **WHEN** a retrieval strategy returns a chunk without the parent metadata required by the Judge
- **THEN** the evidence is incomplete, direct answer is blocked, and the missing fields are observable

#### Scenario: Quality report marks an active document error
- **WHEN** the canonical quality report marks the top active parent as error
- **THEN** the Judge blocks direct answer even if BM25, embedding, or rerank ranks it first

### Requirement: Runtime knowledge observability includes retrieval trace
Knowledge lifecycle logs SHALL include the configured retrieval trace and the strict eligibility rationale used for the final route decision.

#### Scenario: Embedding disabled
- **WHEN** a runtime turn searches knowledge with embedding disabled
- **THEN** logs show BM25 ran, embedding skipped with a safe reason, rerank status, final candidates, and Judge blockers

#### Scenario: Evidence is escalated
- **WHEN** strict eligibility blocks direct answer
- **THEN** the code escalation context preserves evidence IDs, answer spans when present, quality/provenance gaps, strategy scores, and the reason for escalation

### Requirement: Retrieval hardening preserves compatibility
The retrieval grounding change SHALL preserve existing public HTTP responses, existing case JSON readability, default offline behavior, and old knowledge artifact readability.

#### Scenario: Old case is loaded
- **WHEN** a persisted case lacks new retrieval trace or grounding fields
- **THEN** it loads without migration and missing fields are treated as unknown

#### Scenario: Default test suite runs
- **WHEN** `pnpm test` runs without real provider credentials
- **THEN** no paid network request occurs and fake/fixture paths provide deterministic coverage
