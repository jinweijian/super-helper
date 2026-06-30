## Purpose

Define the runtime retrieval evaluation that records the configured retrieval trace and the strict eligibility rationale used for the final route decision in knowledge lifecycle logs.

## Requirements

### Requirement: Retrieval evaluation uses the production composition
The system SHALL provide a retrieval evaluation path that executes the same Router, configured Retrieval Service, and Evidence Judge used by runtime.

#### Scenario: Offline evaluation
- **WHEN** retrieval evaluation runs without provider credentials
- **THEN** it uses disabled or fake providers, remains offline, and reports the actual configured strategy skips and Judge decisions

#### Scenario: Real provider evaluation is requested
- **WHEN** the operator explicitly opts in with materialized SiliconFlow credentials
- **THEN** evaluation may call the real provider and writes a redacted report without raw documents, vectors, keys, or provider payloads

### Requirement: Evaluation measures answer safety and retrieval quality
The production evaluation report SHALL measure direct-answer precision, no-hit abstention, must-escalate behavior, Recall@K, MRR, blockers, and per-question top evidence.

#### Scenario: No-hit control returns candidates
- **WHEN** a no-hit question produces lexical or semantic candidates but the Judge blocks direct answer
- **THEN** abstention is counted as correct and the candidate list remains visible for diagnosis

#### Scenario: Wrong parent is ranked first
- **WHEN** the expected parent is absent from the configured top K
- **THEN** the report attributes failure to retrieval even if another document from the same module is present

### Requirement: Evaluation is a release gate
Changes that affect retrieval, evidence conversion, Judge scoring, provider composition, or knowledge indexing MUST pass the production evaluation gate before completion.

#### Scenario: Safety metric fails
- **WHEN** direct-answer precision, no-hit abstention, or must-escalate behavior is below 100 percent on the required safety set
- **THEN** the change cannot be marked complete

#### Scenario: Retrieval metric fails
- **WHEN** the phase-specific Recall@5 or MRR threshold is not met
- **THEN** the report records the failure and implementation tasks remain incomplete
