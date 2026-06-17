## ADDED Requirements

### Requirement: Retrieval strategies are pluggable
The system SHALL model each recall route as a registered retrieval strategy so strategies can be added, removed, enabled, or disabled without changing runtime orchestration.

#### Scenario: Default strategies are registered
- **WHEN** the retrieval registry is created with default configuration
- **THEN** it includes BM25 recall as a lexical strategy and embedding recall as a semantic strategy

#### Scenario: Strategy can be disabled
- **WHEN** a strategy reports that it is not enabled for the current retrieval context
- **THEN** the retrieval service skips that strategy and records the skip reason in the retrieval trace

#### Scenario: Future strategy does not change runtime
- **WHEN** a new recall strategy is added under `retrieval/recall/<strategy>/` and registered
- **THEN** runtime continues to call the same retrieval service entrypoint without strategy-specific branches

### Requirement: BM25 and embedding recall are sibling strategies
The system SHALL represent BM25 recall and embedding recall as sibling retrieval strategies under the retrieval module.

#### Scenario: BM25 recall uses local knowledge artifacts
- **WHEN** BM25 recall runs
- **THEN** it reads local knowledge chunks or BM25 index artifacts and returns recall candidates without calling an embedding or rerank provider

#### Scenario: Embedding recall uses vector artifacts
- **WHEN** embedding recall runs
- **THEN** it uses an embedding provider only to embed the query and searches compatible local vector artifacts for candidates

#### Scenario: Knowledge does not own recall strategy logic
- **WHEN** knowledge indexes are read during retrieval
- **THEN** knowledge provides documents, chunks, and artifacts while strategy scoring and recall behavior remain under `retrieval/recall/`

### Requirement: Retrieval service runs multi-route recall
The retrieval service SHALL run all enabled recall strategies independently and combine their candidates into a single retrieval result.

#### Scenario: Multiple strategies return candidates
- **WHEN** BM25 and embedding recall both return candidates for the same query
- **THEN** the retrieval service includes candidates from both strategies before fusion

#### Scenario: One strategy fails
- **WHEN** one recall strategy fails with a recoverable error
- **THEN** the retrieval service records the failure in the trace and continues with other enabled strategies

#### Scenario: No strategy returns candidates
- **WHEN** all enabled strategies return no candidates
- **THEN** the retrieval service returns an empty evidence pack with trace details that explain which strategies ran

### Requirement: Retrieval fusion is strategy-neutral
The system SHALL fuse candidates without hardcoding assumptions about the number or type of recall strategies.

#### Scenario: Duplicate candidates are deduplicated
- **WHEN** multiple strategies return the same knowledge chunk or parent document
- **THEN** fusion produces one candidate that preserves per-strategy score details

#### Scenario: Rank fusion is deterministic
- **WHEN** strategies return ranked candidate lists
- **THEN** fusion produces deterministic final ordering using a documented fusion algorithm such as Reciprocal Rank Fusion

#### Scenario: Strategy-specific scores remain visible
- **WHEN** a fused candidate contains contributions from multiple strategies
- **THEN** the candidate retains enough retrieval metadata to explain keyword, BM25, embedding, and rerank contributions

### Requirement: Rerank is optional after fusion
The system SHALL apply rerank only after recall candidates have been fused and only when rerank is enabled and available.

#### Scenario: Rerank enabled
- **WHEN** rerank is enabled and fused candidates exist
- **THEN** the retrieval service calls the rerank provider through the rerank provider contract and updates candidate ordering

#### Scenario: Rerank unavailable
- **WHEN** rerank is disabled, missing credentials, or fails safely
- **THEN** the retrieval service returns the fused ordering and records the rerank status in the trace

### Requirement: Retrieval trace is first-class
The system SHALL return structured retrieval trace data for diagnostics, evaluation, and observability.

#### Scenario: Trace records strategy execution
- **WHEN** retrieval completes
- **THEN** the trace lists which strategies ran, skipped, failed, and how many candidates each strategy returned

#### Scenario: Trace records fusion and rerank
- **WHEN** candidates are fused or reranked
- **THEN** the trace records dedupe counts, fusion method, rerank status, and final candidate count

