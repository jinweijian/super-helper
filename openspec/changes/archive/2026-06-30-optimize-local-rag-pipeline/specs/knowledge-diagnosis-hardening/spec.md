## MODIFIED Requirements

### Requirement: Configured retrieval reranks parent-level candidates
The configured retrieval pipeline SHALL deduplicate fused child candidates to one representative per parent before rerank, pass at most the configured rerank Top N candidates to the provider, and return at most 8 final evidence results.

#### Scenario: Multiple children share a parent
- **GIVEN** BM25 or embedding recall returns multiple children for the same parent
- **WHEN** configured retrieval prepares rerank input
- **THEN** it keeps one representative candidate for that parent, preserves child hit metadata, and does not spend multiple rerank slots on the same parent

#### Scenario: Default rerank budget is used
- **GIVEN** a fresh config has no explicit rerank Top N override
- **WHEN** configured retrieval creates the reranker
- **THEN** the default Top N is 8 and aligns with the final evidence limit

#### Scenario: Setup or settings UI persists rerank defaults
- **GIVEN** a user submits setup or settings without editing rerank Top N
- **WHEN** the UI serializes the rerank config
- **THEN** it submits 8, not the historical value 2

### Requirement: Rerank score fusion is normalized within the candidate batch
The rerank service SHALL compute final scores from batch-local normalized rerank scores and batch-local normalized RRF scores, with rerank weighted at 0.7 and RRF weighted at 0.3.

#### Scenario: Rerank scores vary
- **GIVEN** rerank returns different scores for candidates that already have RRF final scores
- **WHEN** final scores are calculated
- **THEN** final scores are in the `[0,1]` range and rerank ordering dominates ties or weaker RRF differences

#### Scenario: Rerank scores are all equal
- **GIVEN** all returned rerank scores are equal
- **WHEN** final scores are calculated
- **THEN** the system falls back to RRF ordering instead of inventing rerank separation

#### Scenario: Rerank fails
- **GIVEN** rerank throws, times out, lacks credentials, or returns malformed candidate IDs
- **WHEN** retrieval completes
- **THEN** fused candidates remain available, the trace records a redacted failure or skip reason, and no provider secret or raw request text is exposed

### Requirement: Default semantic recall degrades safely without credentials
The system SHALL default to `knowledge.buildVectorIndex=true` and `embedding.enabled=true`, while keeping no-key and no-network paths usable through explicit skip/degrade behavior.

#### Scenario: Retrieval runs without embedding credentials
- **GIVEN** embedding is enabled by default and no materialized API key exists
- **WHEN** configured retrieval runs
- **THEN** BM25 still runs, embedding is skipped with a safe trace reason, and no network request is attempted

#### Scenario: Onboarding runs without embedding credentials
- **GIVEN** setup defaults enable vector build and embedding but the user has not supplied an embedding key
- **WHEN** onboarding validates, tests providers, plans vector build, and runs the knowledge pipeline
- **THEN** embedding credentials are not a blocking validation error, provider smoke is skipped as `missing_credentials`, vector build is skipped, and keyword/BM25 indexing can still complete

#### Scenario: Existing config explicitly disables embedding
- **GIVEN** an existing config sets `embedding.enabled=false` or `knowledge.buildVectorIndex=false`
- **WHEN** config is loaded
- **THEN** the explicit false value is preserved and defaults do not silently re-enable the provider

### Requirement: Query normalization and alias expansion are shared by recall strategies
Configured retrieval SHALL normalize the user query once at the retrieval service boundary and pass the same normalized query to recall strategies while preserving the original query for rerank.

#### Scenario: Fullwidth and traditional query text is used
- **GIVEN** the user query includes fullwidth ASCII, fullwidth spaces, common traditional Chinese characters, redundant whitespace, or boundary punctuation
- **WHEN** retrieval normalizes the query
- **THEN** recall receives the normalized text, boundary punctuation is stripped, and rerank receives the original user text

#### Scenario: Alias text needs normalization
- **GIVEN** taxonomy aliases contain fullwidth or traditional Chinese text
- **WHEN** a normalized query contains the normalized alias
- **THEN** the normalized alias term is added to `expandedTerms` and BM25 tokenization uses both the normalized query and expanded terms

#### Scenario: No alias matches
- **GIVEN** no taxonomy alias appears in the normalized query
- **WHEN** retrieval runs
- **THEN** no unrelated expanded term is added and the original query remains available for trace/evidence context

### Requirement: Parent-child chunking remains configurable and versioned
The knowledge chunk builder SHALL expose chunking parameters through configuration, split long answer-bearing blocks by sentence/window when possible, and version new artifacts as `parent-child-v3`.

#### Scenario: Chunking options are omitted
- **GIVEN** no custom chunking config is provided
- **WHEN** knowledge chunks are built
- **THEN** defaults are `maxChars=800`, `overlapStrategy=sentence`, `overlapChars=120`, and `minChars=80`

#### Scenario: Long block has sentence boundaries
- **GIVEN** a single source block exceeds `maxChars` but contains Chinese or English sentence boundaries
- **WHEN** chunking runs
- **THEN** it creates bounded overlapping windows instead of marking the entire block as manual-split-only

#### Scenario: Long block has no safe split point
- **GIVEN** a single source block exceeds `maxChars` and has no sentence boundary
- **WHEN** chunking runs
- **THEN** the block is preserved with `manual_split_required` so no answer-bearing text is silently dropped

#### Scenario: Chunk strategy version changes
- **GIVEN** chunks are rebuilt with `parent-child-v3` and `artifact_version=3`
- **WHEN** vector compatibility is checked against v2 vector artifacts
- **THEN** compatibility reports `rebuild-required` for source chunk mismatch and v2 chunks are treated as legacy
