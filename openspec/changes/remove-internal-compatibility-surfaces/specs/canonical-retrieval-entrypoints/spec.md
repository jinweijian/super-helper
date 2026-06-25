## ADDED Requirements

### Requirement: Production knowledge queries use one configured retrieval path
Runtime、knowledge health and knowledge acceptance SHALL use the same configured retrieval composition that owns field-weighted BM25、optional filtered Embedding、RRF、optional Rerank、parent grounding and Retrieval Trace. They MUST NOT call keyword compatibility or legacy RAG APIs.

#### Scenario: Runtime diagnosis queries knowledge
- **WHEN** a user turn reaches knowledge diagnosis
- **THEN** it executes route -> configured Hybrid retrieval -> strict Evidence Judge -> resolved-turn review
- **AND** no compatibility search or simplified lexical shortcut participates

#### Scenario: Health query has providers disabled or unavailable
- **WHEN** the knowledge health endpoint evaluates a query with embedding/rerank disabled、missing credentials or safe provider failure
- **THEN** it uses BM25 fallback through configured retrieval and preserves the existing HTTP response shape
- **AND** it does not call keyword compatibility or leak provider/document details

#### Scenario: Acceptance evaluates legacy or incomplete evidence
- **WHEN** knowledge acceptance runs against legacy、missing-provenance or quality-ineligible fixtures
- **THEN** it uses production diagnosis/retrieval contracts and records investigation/escalation rather than unsafe direct success
- **AND** it does not lower the strict Judge gate to preserve an old expectation

### Requirement: Retrieval CLI is the only knowledge query and evaluation surface
The CLI SHALL expose `retrieval search`、`retrieval debug` and `retrieval eval` as the only query/debug/evaluation commands. Redundant `knowledge search`、`knowledge eval` and package aliases MUST be removed.

#### Scenario: User runs canonical retrieval commands
- **WHEN** the user runs search、debug or production evaluation
- **THEN** the command executes configured retrieval and, for eval, the production Router/Judge path
- **AND** reports preserve safe trace、metrics and no-network defaults

#### Scenario: Retrieval search and debug do not bypass configured composition
- **WHEN** `retrieval search` or `retrieval debug` runs with embedding/rerank disabled、enabled fake providers or unavailable providers
- **THEN** it creates the same configured retrieval composition used by runtime retrieval
- **AND** it does not manually instantiate a BM25-only service or skip fusion/rerank trace fields

#### Scenario: Removed Knowledge command is requested
- **WHEN** `knowledge search` or `knowledge eval` is passed to the CLI
- **THEN** it is not registered as a valid subcommand
- **AND** canonical usage points to `retrieval search|debug|eval` without executing a hidden compatibility handler

### Requirement: Cleanup preserves the optimized Hybrid and evidence contracts
Removing compatibility surfaces MUST NOT change tokenizer、field weights、Parent-Child boundaries、candidate budgets、metadata filters、parent dedupe、answer span、strict eligibility、trace or resolved-turn behavior established by the current retrieval/evidence changes.

#### Scenario: Hybrid providers are enabled with fake fixtures
- **WHEN** BM25 and fake Embedding return candidates and fake Rerank succeeds
- **THEN** the system preserves 40/40 recall、RRF Top 20、Rerank Top 8、parent identity and explainable strategy scores
- **AND** restricted、legacy or quality-ineligible content is filtered before remote submission/similarity as currently specified

#### Scenario: Provider or vector path fails
- **WHEN** credentials、timeout、429/5xx、malformed response、dimension mismatch or stale vectors make a semantic strategy unavailable
- **THEN** BM25 evidence and safe Retrieval Trace remain available
- **AND** strict Judge eligibility determines direct answer without a compatibility fallback

#### Scenario: Parent or provenance metadata is incomplete
- **WHEN** retrieved evidence lacks required source block、section、quality、freshness or answer-span grounding
- **THEN** the existing blocker/abstain/escalate behavior remains fail closed
- **AND** cleanup does not invent defaults or discard the blocker in presentation

### Requirement: Query-term rules have a pure owner
Taxonomy and local knowledge rules SHALL use a pure term-normalization API under `knowledge/documents/` and MUST NOT import retrieval compatibility, provider or runtime modules.

#### Scenario: Chinese and Latin query terms are normalized
- **WHEN** taxonomy processes Chinese business terms、registered one-character terms、Latin tokens、punctuation or empty input
- **THEN** the pure term API returns deterministic terms compatible with current routing behavior
- **AND** it performs no artifact、network or provider access
