## Purpose

Define the configured retrieval path that becomes the single runtime entry for knowledge recall, fusing BM25, embedding, taxonomy alias expansion, and rerank through a service boundary.

## Requirements

### Requirement: Default configured retrieval uses registry
Configured runtime retrieval SHALL create its recall routes through `createDefaultRetrievalStrategies` and `createRetrievalService`. BM25 SHALL be registered even when embedding and rerank are disabled or unavailable.

#### Scenario: Remote providers are disabled
- **WHEN** configured retrieval runs with embedding and rerank disabled
- **THEN** BM25 runs against local chunks
- **AND** no provider network request occurs
- **AND** embedding and rerank are recorded as skipped

#### Scenario: Fake embedding is enabled
- **WHEN** compatible vector artifacts exist and fake embedding is enabled
- **THEN** BM25 and embedding recall both run
- **AND** candidates are deduplicated and fused through the retrieval service

### Requirement: Rerank occurs only after fusion
Configured retrieval SHALL send fused candidates to the optional reranker and MUST NOT let rerank own recall or erase successful fallback candidates.

#### Scenario: Rerank succeeds
- **WHEN** multiple recall routes return candidates and rerank is enabled
- **THEN** rerank receives the already fused candidate list
- **AND** final evidence reflects rerank scores without exposing raw provider documents

#### Scenario: Rerank fails
- **WHEN** rerank times out, is rate limited, returns malformed data or otherwise fails
- **THEN** retrieval returns the fused pre-rerank candidates
- **AND** trace records a safe failed reason

### Requirement: Recall failures degrade independently
Embedding construction, vector compatibility and individual recall failures SHALL NOT prevent another successful strategy from returning evidence.

#### Scenario: Embedding configuration is unsupported
- **WHEN** embedding is enabled with an unsupported or invalid provider configuration
- **THEN** BM25 results are still returned
- **AND** trace exposes a redacted unavailable or failed reason

#### Scenario: Vector artifacts are stale or mismatched
- **WHEN** vector artifacts do not match provider, model, dimensions, distance or current chunks
- **THEN** stale vectors are not mixed into results
- **AND** BM25 remains available

#### Scenario: Knowledge has no matches
- **WHEN** all enabled strategies return no candidates
- **THEN** configured retrieval returns an empty compatible evidence pack
- **AND** runtime Evidence Judge and escalation behavior remain unchanged

### Requirement: Legacy retrieval delegates to the same service
The old `searchKnowledgeWithRag` contract SHALL be preserved as a parameter adapter over the same registry/service and MUST NOT maintain a separate hardcoded strategy workflow.

#### Scenario: Existing RAG caller supplies embedding and rerank ports
- **WHEN** an existing caller uses `searchKnowledgeWithRag`
- **THEN** the wrapper maps the ports into the shared retrieval composition
- **AND** legacy limits and evidence shape remain compatible

### Requirement: Default verification is offline and observable
Normal tests and startup SHALL be deterministic, offline and credential-free. Real provider verification MUST be explicit opt-in and sanitized.

#### Scenario: Full test suite runs
- **WHEN** `pnpm test` is executed without provider credentials
- **THEN** tests use fake providers or fake fetch
- **AND** no paid provider request is made

#### Scenario: Real SiliconFlow smoke is not available
- **WHEN** implementation verification has no explicit real-provider opt-in or credential
- **THEN** implementation notes record it as not run with the reason
- **AND** the change is accepted based on fake contract tests and compatibility gates
