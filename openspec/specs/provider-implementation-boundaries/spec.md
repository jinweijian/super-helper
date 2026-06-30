## Purpose

Define the provider implementation boundaries that keep vendor-specific retrieval, embedding, and rerank adapter code out of runtime, gateway, and CLI command modules.

## Requirements

### Requirement: Provider implementation ownership
系统 SHALL 将 embedding 和 rerank 的真实 provider 实现放在 `src/providers/<capability>/`，provider factory 和 adapter MUST NOT import `src/embedding/`、knowledge、retrieval、runtime、gateway 或 CLI。

#### Scenario: SiliconFlow embedding is created through provider factory
- **WHEN** caller creates a SiliconFlow embedding provider through `src/providers/embedding/factory.ts`
- **THEN** factory returns the adapter implemented under `src/providers/embedding/siliconflow/`
- **AND** no code from `src/embedding/` owns the HTTP request or response mapping

#### Scenario: Fake provider remains offline
- **WHEN** caller creates the fake embedding provider
- **THEN** implementation is loaded from `src/providers/embedding/fake.ts`
- **AND** no network request or real credential is required

### Requirement: Vendor protocol separation
SiliconFlow embedding implementation SHALL separate endpoint resolution, protocol mapping, and HTTP adapter orchestration. Unsupported Gemini、MiniMax、Qwen scaffolds SHALL live in vendor-specific provider directories and MUST NOT infer or execute network protocols.

#### Scenario: SiliconFlow response is malformed
- **WHEN** SiliconFlow returns missing vectors, duplicate indexes, wrong dimensions, invalid JSON, timeout, 429 or 5xx
- **THEN** adapter returns a normalized safe provider error
- **AND** the error contains no secret, Authorization header, raw vector or complete payload

#### Scenario: Unsupported vendor is selected
- **WHEN** Gemini、MiniMax or Qwen scaffold is selected without an implemented official adapter
- **THEN** provider returns the existing unsupported/docs-gated error
- **AND** fetch is never called

### Requirement: Compatibility embedding surface
`src/embedding/` SHALL remain a source-compatible re-export surface and MUST NOT contain provider classes, request mapping, scoring, smoke orchestration or other implementation behavior.

#### Scenario: Existing embedding import is used
- **WHEN** an existing caller imports provider symbols or metadata helpers from `src/embedding/index.ts`
- **THEN** the same public names and compatible behavior remain available through re-exports from `src/providers/`

#### Scenario: Boundary audit scans compatibility files
- **WHEN** module-boundary tests inspect every TypeScript file under `src/embedding/`
- **THEN** each file contains only imports needed for type forwarding and export/re-export declarations

### Requirement: Capability-neutral provider errors
New provider code SHALL use `ProviderError` and neutral formatting/type guards. Embedding-named errors SHALL remain compatibility aliases only.

#### Scenario: Rerank request fails
- **WHEN** rerank receives missing credentials, timeout, rate limit, malformed response or provider failure
- **THEN** it returns a neutral provider error classification
- **AND** existing safe formatting remains compatible for old callers
