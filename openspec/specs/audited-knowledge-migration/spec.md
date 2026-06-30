## Purpose

Define the audited knowledge migration that rebuilds v2 knowledge from canonical sources, evaluates holdout metrics, and publishes by module batch only after quality and retrieval gates pass.

## Requirements

### Requirement: Legacy knowledge is isolated from strict direct answer
Legacy parent/chunk artifacts that lack v2 provenance or acceptable quality SHALL remain readable for investigation but MUST NOT support strict direct answer.

#### Scenario: Semantic-section-v1 parent is active
- **WHEN** an active legacy parent lacks source block provenance or has warn/error quality
- **THEN** retrieval may expose it as investigation context and the Judge blocks direct answer

### Requirement: Migration rebuilds knowledge from canonical sources
Migration SHALL rerun intake/extract/normalize/v2 slice/audit/repair/review/publish/index/vector stages from canonical sources rather than mutating legacy chunks into apparent compliance.

#### Scenario: Deterministic repair is safe
- **WHEN** the audit identifies a supported deterministic repair
- **THEN** the repair plan is recorded, applied reversibly, and re-audited before review

#### Scenario: Error or warning remains
- **WHEN** a draft retains error or warning quality after repair
- **THEN** it requires explicit human review; error cannot publish and accepted warning cannot support strict direct answer

### Requirement: Migration publishes by module batch
The initial migration SHALL publish and evaluate `ai-companion` before `edusoho-training`, with independent reports and rollback boundaries.

#### Scenario: First module passes gates
- **WHEN** reviewed AI Companion documents pass strict audit and evaluation
- **THEN** only that batch is published, indexed, vectorized, and eligible for direct answer

#### Scenario: Second module fails gates
- **WHEN** EduSoho migration or holdout evaluation fails
- **THEN** the AI Companion batch remains available and EduSoho legacy content remains investigation-only

### Requirement: Taxonomy covers published modules
Every published module SHALL exist in taxonomy with stable ID and searchable aliases; unknown modules SHALL be reported during indexing.

#### Scenario: Indexed document has unknown module
- **WHEN** a parent module is absent from taxonomy
- **THEN** index/audit reports a warning and module-dependent direct answer remains blocked until taxonomy is corrected

### Requirement: Migration evaluation meets release metrics
The migrated corpus SHALL pass a 50-question production evaluation with holdout direct precision 100 percent, no-hit abstention 100 percent, must-escalate 100 percent, Recall@5 at least 90 percent, and MRR at least 0.80.

#### Scenario: Any safety metric fails
- **WHEN** a migrated batch produces a wrong direct answer, misses abstention, or fails a must-escalate case
- **THEN** the batch cannot become direct-answer eligible
