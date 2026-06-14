## ADDED Requirements

### Requirement: Embedding provider abstraction
The system SHALL provide a provider-neutral embedding interface for converting documents and queries into vectors.

#### Scenario: Document embedding
- **WHEN** a caller submits one or more document inputs to an embedding provider
- **THEN** the provider returns one vector result per accepted input with stable input id, provider id, model, dimensions, distance metric, vector values, and usage metadata

#### Scenario: Query embedding
- **WHEN** a caller submits a query input to an embedding provider
- **THEN** the provider returns exactly one query vector result with provider id, model, dimensions, distance metric, vector values, and usage metadata

#### Scenario: Query and document APIs remain separate
- **WHEN** a provider supports different task types or input types for queries and documents
- **THEN** the system preserves separate document and query embedding methods instead of forcing both through one generic method

#### Scenario: Provider errors are normalized
- **WHEN** a provider request fails because of missing credentials, timeout, rate limit, invalid request, server error, or malformed response
- **THEN** the system raises a normalized embedding provider error with provider id, retryable flag, safe message, and no secret values

### Requirement: Embedding configuration
The system SHALL configure embedding providers independently from Agent chat model providers.

#### Scenario: Embedding disabled by default
- **WHEN** a new config is created
- **THEN** embedding is disabled unless the user explicitly enables it

#### Scenario: Agent model provider remains independent
- **WHEN** the Agent uses one model provider and embedding uses another provider
- **THEN** the system treats them as independent configurations and does not infer embedding settings from Agent model settings

#### Scenario: MiniMax configured as primary provider
- **WHEN** embedding config selects provider `minimax`
- **THEN** the system can create a MiniMax embedding provider from configured model, base URL, API key or API key environment variable, dimensions, distance metric, batch size, and timeout

#### Scenario: Gemini configured as secondary provider
- **WHEN** embedding config selects provider `gemini`
- **THEN** the system can create a Gemini embedding provider from configured model, base URL or endpoint, API key or API key environment variable, dimensions, distance metric, batch size, and timeout

#### Scenario: Qwen reserved for later use
- **WHEN** embedding config selects provider `qwen` before a real Qwen adapter is implemented
- **THEN** the system fails with a clear unsupported-provider error instead of silently using another provider

#### Scenario: Missing credentials blocked
- **WHEN** embedding is enabled but neither API key nor API key environment variable resolves to a secret
- **THEN** provider creation or provider smoke test fails with a safe missing-credentials error

### Requirement: Embedding provider registry
The system SHALL create embedding providers through a registry or factory rather than importing provider classes directly from knowledge indexing code.

#### Scenario: Known provider created
- **WHEN** the embedding factory receives a supported provider id and valid config
- **THEN** it returns a provider implementation matching that id

#### Scenario: Unknown provider rejected
- **WHEN** the embedding factory receives an unknown provider id
- **THEN** it fails with a safe unsupported-provider error

#### Scenario: Fake provider available for tests
- **WHEN** tests need deterministic embedding behavior
- **THEN** the factory or test helpers can create a fake embedding provider without network access

### Requirement: Vector metadata contract
The system SHALL record embedding provider metadata with every generated vector and vector index.

#### Scenario: Vector record metadata
- **WHEN** a chunk is embedded
- **THEN** the vector record includes vector id, document id, chunk id, source, text hash, provider id, model, dimensions, distance metric, vector values, and creation timestamp

#### Scenario: Vector manifest metadata
- **WHEN** a vector index is built
- **THEN** the vector manifest includes provider id, model, dimensions, distance metric, source chunk manifest hash, vector count, skipped count, and generation timestamp

#### Scenario: Text hash changes trigger re-embedding
- **WHEN** a chunk text hash differs from the hash stored in the vector record
- **THEN** the system treats the existing vector as stale and requires re-embedding for that chunk

#### Scenario: Vector artifacts are rebuildable
- **WHEN** vector index files are deleted
- **THEN** the system can rebuild them from knowledge chunks and source configuration without losing canonical knowledge content

### Requirement: Embedding configuration compatibility
The system SHALL prevent mixing incompatible vectors in the same vector index.

#### Scenario: Compatible query
- **WHEN** the vector manifest provider id, model, dimensions, and distance metric match the active embedding config
- **THEN** query vectors may be compared with document vectors from that index

#### Scenario: Provider mismatch blocked
- **WHEN** the vector manifest provider id differs from the active embedding config provider id
- **THEN** the system refuses to use that vector index and reports that a rebuild is required

#### Scenario: Model mismatch blocked
- **WHEN** the vector manifest model differs from the active embedding config model
- **THEN** the system refuses to use that vector index and reports that a rebuild is required

#### Scenario: Dimension mismatch blocked
- **WHEN** a provider returns a vector whose length differs from the configured or manifest dimensions
- **THEN** the system rejects the vector result and records a dimension mismatch error

#### Scenario: Distance mismatch blocked
- **WHEN** the vector manifest distance metric differs from the active embedding config distance metric
- **THEN** the system refuses to use that vector index and reports that a rebuild is required

### Requirement: Knowledge vector build
The system SHALL build vector artifacts from existing knowledge chunks only when explicitly requested.

#### Scenario: Explicit vector build
- **WHEN** the user runs the vector build command with embedding enabled
- **THEN** the system reads `knowledge/indexes/chunks.jsonl`, embeds eligible chunks, writes `knowledge/indexes/vectors.jsonl`, and writes `knowledge/indexes/vector-manifest.json`

#### Scenario: Default knowledge update avoids remote embedding
- **WHEN** the user runs the normal knowledge update command without an explicit vector build flag or command
- **THEN** the system does not call a remote embedding provider

#### Scenario: Restricted knowledge skipped
- **WHEN** a chunk belongs to restricted knowledge that is not allowed for remote embedding
- **THEN** the vector build skips that chunk and records the skip reason without sending the text to the provider

#### Scenario: Partial provider failure reported
- **WHEN** some batches fail during vector build
- **THEN** the system writes a structured failure summary and does not present the vector index as fully healthy

### Requirement: Embedding CLI checks
The system SHALL provide repeatable local commands for validating embedding configuration and provider connectivity without exposing secrets.

#### Scenario: Provider smoke test
- **WHEN** the user runs an embedding provider smoke test command
- **THEN** the system embeds a short harmless test string, verifies vector dimensions, prints provider/model/dimensions, and does not print API keys or raw credentials

#### Scenario: Disabled embedding check
- **WHEN** the user runs embedding diagnostics while embedding is disabled
- **THEN** the system reports that embedding is disabled and does not call any remote provider

#### Scenario: Redacted errors
- **WHEN** a provider smoke test fails
- **THEN** the CLI prints a safe error message with status and provider id but without request headers, API keys, cookies, tokens, or full sensitive payloads

### Requirement: Embedding observability and reports
The system SHALL record embedding build outcomes in local reports without exposing sensitive data.

#### Scenario: Build report written
- **WHEN** a vector build command completes
- **THEN** the system writes a report containing provider id, model, dimensions, vector count, skipped count, failed count, duration, and artifact paths

#### Scenario: No raw source text in reports
- **WHEN** embedding reports or logs are written
- **THEN** they omit raw chunk text and include only ids, counts, hashes, safe summaries, and redacted errors

#### Scenario: Usage metadata recorded safely
- **WHEN** the provider returns usage information
- **THEN** the system records aggregate usage counts when available without storing provider secrets or raw request bodies

### Requirement: Testability without network
The system SHALL verify embedding behavior in normal tests without depending on remote providers.

#### Scenario: Unit tests use fake provider
- **WHEN** normal test commands run
- **THEN** embedding provider tests use fake provider or fake fetch responses and do not require network access or API keys

#### Scenario: Real provider tests are opt-in
- **WHEN** a test or command would call MiniMax, Gemini, or Qwen over the network
- **THEN** it runs only through an explicit smoke or acceptance command and never as part of default `pnpm test`
