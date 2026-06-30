## Purpose

Define the strict knowledge answer gate that the Evidence Judge applies before allowing a direct answer, including required grounding fields and rejection rules.

## Requirements

### Requirement: Knowledge direct answer is fail closed
The Evidence Judge SHALL permit a knowledge direct answer only when every strict eligibility condition is satisfied; missing or ambiguous eligibility data SHALL block direct answer.

#### Scenario: Fully eligible reranked evidence
- **WHEN** top evidence is active, quality `ok` or `info`, fresh, provenance-complete, module-compatible, answer-bearing, risk-free, conflict-free, and has rerank score at least `0.70`
- **THEN** the Judge may return `final_answer`

#### Scenario: Rerank is unavailable
- **WHEN** rerank is unavailable but the normalized query contains the complete evidence title, at least two non-generic multi-character terms match, and all other strict conditions pass
- **THEN** the Judge may return `final_answer` and records the lexical fallback rationale

#### Scenario: Eligibility metadata is missing
- **WHEN** quality, source document identity, source block IDs, section path, freshness, or answer span is missing
- **THEN** the Judge returns a typed blocker and dispatches read-only diagnosis instead of direct answer

### Requirement: Native retrieval scores cannot authorize direct answer alone
BM25, vector, RRF, and embedding similarity scores SHALL be recall/ranking signals and MUST NOT independently authorize a final answer.

#### Scenario: High vector similarity without answer span
- **WHEN** vector recall ranks a candidate first but the parent has no supported answer span
- **THEN** the Judge blocks direct answer

#### Scenario: Many single-character matches
- **WHEN** lexical recall reports only generic or single-character overlap
- **THEN** the Judge classifies the result as low-signal evidence even if the candidate rank is first

### Requirement: Unsafe knowledge conditions always block
Quality errors, warnings without direct-answer eligibility, stale evidence, conflicts, high-risk questions, implementation-detail questions, non-active status, module mismatch, and missing parents SHALL block direct answer.

#### Scenario: Warning-quality legacy slice
- **WHEN** a legacy active slice has warning quality or accepted warnings but has not become `ok` or `info`
- **THEN** it remains usable as investigation context but cannot produce a direct answer

#### Scenario: Provider fallback returns lexical candidates
- **WHEN** semantic providers fail and BM25 returns candidates that do not meet the exact-title fallback
- **THEN** runtime escalates to read-only investigation and records provider fallback in the trace
