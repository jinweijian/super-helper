## ADDED Requirements

### Requirement: Provider capabilities are sibling modules
The system SHALL organize embedding and rerank as sibling provider capabilities rather than nesting rerank under embedding.

#### Scenario: Embedding provider module is independent
- **WHEN** embedding provider code is inspected
- **THEN** contracts, factory, smoke test, fake adapter, and vendor adapters live under `src/providers/embedding/`

#### Scenario: Rerank provider module is independent
- **WHEN** rerank provider code is inspected
- **THEN** contracts, factory, smoke test, fake adapter, and vendor adapters live under `src/providers/rerank/`

#### Scenario: Rerank is not under embedding
- **WHEN** the provider directory tree is inspected
- **THEN** no rerank adapter, rerank factory, rerank smoke test, or rerank protocol file exists under `src/providers/embedding/`

### Requirement: Provider factories select adapters only
The system SHALL keep provider factories limited to provider selection, basic config validation, and adapter construction.

#### Scenario: Factory creates provider
- **WHEN** a supported provider id is configured
- **THEN** the corresponding factory returns the provider contract implementation without embedding vendor request or response mapping in the factory file

#### Scenario: Unsupported provider
- **WHEN** an unsupported provider id is configured
- **THEN** the factory returns or throws a safe provider error without leaking secrets or raw provider payloads

### Requirement: Vendor adapters isolate protocol mapping
The system SHALL isolate vendor-specific HTTP endpoints, request bodies, response parsing, and status mapping inside the vendor provider directory.

#### Scenario: SiliconFlow embedding request mapping
- **WHEN** SiliconFlow embedding is called
- **THEN** request body construction, endpoint resolution, and response vector mapping are implemented under `src/providers/embedding/siliconflow/`

#### Scenario: SiliconFlow rerank request mapping
- **WHEN** SiliconFlow rerank is called
- **THEN** request body construction, endpoint resolution, and response score mapping are implemented under `src/providers/rerank/siliconflow/`

### Requirement: Shared provider primitives live at provider root
The system SHALL place provider-wide primitives directly under `src/providers/` instead of creating generic shared directories.

#### Scenario: Provider errors are shared
- **WHEN** embedding and rerank adapters need safe provider errors
- **THEN** they import shared error utilities from `src/providers/errors.ts`

#### Scenario: Redaction is shared
- **WHEN** embedding and rerank adapters need secret redaction
- **THEN** they import redaction helpers from `src/providers/redaction.ts`

### Requirement: Provider smoke tests are safe and bounded
The system SHALL keep embedding and rerank smoke tests separate and shall not expose secrets, raw vectors, raw documents, authorization headers, or raw provider payloads.

#### Scenario: Embedding smoke test
- **WHEN** embedding smoke test runs
- **THEN** it reports provider, model, dimension status, duration, and safe errors without printing raw vectors or secrets

#### Scenario: Rerank smoke test
- **WHEN** rerank smoke test runs
- **THEN** it reports provider, model, duration, top score when available, and safe errors without printing raw documents or secrets

### Requirement: Provider modules do not own retrieval behavior
The system SHALL prevent provider adapters from deciding retrieval strategy, evidence ranking, evidence sufficiency, or user-facing answers.

#### Scenario: Provider returns primitive result
- **WHEN** embedding or rerank provider calls complete
- **THEN** providers return vectors or scores through their contracts and do not know about Evidence Judge, runtime, cases, personas, or final replies

