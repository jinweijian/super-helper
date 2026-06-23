## ADDED Requirements

### Requirement: Configured hybrid retrieval uses fixed candidate budgets
When embedding is enabled and compatible, configured retrieval SHALL recall BM25 Top 40 and Embedding Top 40, fuse with RRF `k=60`, retain Top 20 for rerank, and return Top 8 final evidence results.

#### Scenario: Both recall routes succeed
- **WHEN** BM25 and embedding return overlapping and unique child candidates
- **THEN** RRF deduplicates by child identity, preserves both strategy scores, passes at most 20 candidates to rerank, and returns at most 8 results

#### Scenario: One recall route fails
- **WHEN** embedding times out, is rate limited, lacks credentials, or has incompatible vectors
- **THEN** BM25 candidates remain available and the trace records a redacted semantic failure

### Requirement: Embedding recall applies metadata filters before similarity
Embedding retrieval SHALL apply module, intent, source type, visibility, status, and quality eligibility before vector similarity and before returning candidates.

#### Scenario: Customer query encounters internal vector
- **WHEN** the request visibility allows only `customer_safe`
- **THEN** internal, support, and restricted chunks are excluded before ranking

#### Scenario: Restricted document exists
- **WHEN** a restricted chunk is present in local knowledge
- **THEN** its text is not sent to the remote embedding provider and it is absent from normal semantic recall

#### Scenario: Quality-error vector ranks highly
- **WHEN** a quality-error chunk has high cosine similarity
- **THEN** it is excluded from direct-answer candidates and the filter reason is observable

### Requirement: Rerank cannot erase safe fallback candidates
Rerank SHALL reorder fused candidates but MUST NOT own recall or discard all successful candidates when the provider fails or returns malformed IDs.

#### Scenario: Rerank succeeds
- **WHEN** SiliconFlow returns valid relevance scores
- **THEN** final candidates preserve rerank score, pre-rerank strategy scores, parent identity, and provenance

#### Scenario: Rerank fails
- **WHEN** rerank fails safely
- **THEN** the Top 20 fused order remains available and strict Judge determines whether lexical exact-title fallback can answer

### Requirement: Repository defaults remain offline
Hybrid retrieval provider calls SHALL remain disabled by default and require explicit runtime configuration and materialized credentials.

#### Scenario: Fresh installation runs tests
- **WHEN** no provider opt-in or credential exists
- **THEN** all tests and local indexing complete without network access or paid calls
