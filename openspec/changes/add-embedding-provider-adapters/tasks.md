## 1. Planning and Guardrails

- [ ] 1.1 Read `openspec/changes/add-embedding-provider-adapters/proposal.md`, `design.md`, `specs/embedding-provider-adapters/spec.md`, `docs/development-standards.md`, `docs/technical-architecture.md`, `docs/agent-design.md`, `src/agents/README.md`, and `src/agents/main.md` before coding.
- [ ] 1.2 Confirm implementation scope excludes BM25, hybrid/RRF, reranker, GraphRAG, external vector databases, and final-answer generation from embedding output.
- [ ] 1.3 Confirm `src/embedding/` owns provider API calls, provider errors, provider factory, and fake provider behavior.
- [ ] 1.4 Confirm `src/knowledge/` owns vector artifact generation, vector manifest, vector dirty/stale checks, and chunk-to-embedding input conversion.
- [ ] 1.5 Confirm `src/config.ts` owns embedding config defaults and loading/merging, not runtime orchestration.
- [ ] 1.6 Confirm `src/cli.ts` only parses CLI arguments and delegates to `src/embedding/` or `src/knowledge/` helpers.
- [ ] 1.7 Confirm `src/runtime/`, `src/gateway/`, and `src/agents/` are not modified unless a task explicitly requires compatibility fields or docs; embedding must not become a product Agent.
- [ ] 1.8 Verify current official MiniMax embedding API docs before implementing any real network request/response logic in `src/embedding/minimax.ts`; if the current official MiniMax docs still do not expose an embedding-specific API page or OpenAPI spec, keep MiniMax real calls scaffolded/unsupported and update implementation notes instead of guessing.
- [ ] 1.9 Verify current official Gemini embedding API docs before implementing `src/embedding/gemini.ts`; if docs differ from this design, update OpenSpec design/tasks before coding.
- [ ] 1.10 Do not implement real Qwen network calls in this change unless the user explicitly expands scope; scaffold must fail clearly as unsupported.
- [ ] 1.11 Capture `openspec instructions apply --change add-embedding-provider-adapters --json` output in implementation notes before starting code changes.
- [ ] 1.12 Create or update `openspec/changes/add-embedding-provider-adapters/implementation-notes.md` before coding; this file must collect provider docs verification, red/green test evidence, smoke output, vector fixture output, verification commands, and deferred items.
- [ ] 1.13 If Superpowers skills are available, load and use `test-driven-development` before writing provider/vector/CLI behavior; if unavailable, explicitly follow the same red -> fail -> implement -> pass loop and record evidence.
- [ ] 1.14 If Superpowers skills are available, load and use `systematic-debugging` before changing code for provider failures, dimension mismatches, malformed responses, timeout/rate-limit behavior, vector compatibility mismatches, or flaky tests; if unavailable, record root-cause analysis before fixing.
- [ ] 1.15 If Superpowers skills are available, load and use `verification-before-completion` before marking any section complete; if unavailable, run fresh verification and record output before claiming completion.
- [ ] 1.16 Do not mark any task complete just because a file, interface, class, or command exists; completion requires tests for behavior, error path, metadata, and security/privacy where applicable.
- [ ] 1.17 For MiniMax docs verification, record official docs URL, access date, endpoint, auth header/query shape, request body fields, response vector path, dimensions behavior, batch limit, and retry guidance in implementation notes.
- [ ] 1.18 For Gemini docs verification, record official docs URL, access date, endpoint, auth shape, model naming, request body fields, response vector path, task type/output dimension behavior, batch limit, and retry guidance in implementation notes.
- [ ] 1.19 If official provider docs cannot be accessed, stop provider-specific network implementation and update OpenSpec; only scaffold/fake contract code may proceed for that provider.
- [ ] 1.20 Before coding each major section, list the focused tests that should fail first; after coding, record the matching passing test command in implementation notes.
- [ ] 1.21 Record the provider documentation baseline from `design.md` in implementation notes before coding: MiniMax official docs index/API overview/rate-limit/error-code pages, Gemini official embeddings guide/API reference, and Alibaba Cloud Model Studio embedding docs for future Qwen scope.
- [ ] 1.22 Treat third-party SDK docs, examples, community posts, prior code, or model memory as non-authoritative for provider request/response shape. Completion evidence must say whether each provider was unlocked by official docs or intentionally kept as scaffold.
- [ ] 1.23 If MiniMax real network code remains blocked by missing official embedding docs, add tests proving `minimax` selection fails safely with docs-required/unsupported behavior and does not call network, while shared fake provider/vector builder tests still pass.

## 2. Embedding Module Skeleton

- [ ] 2.1 Create directory `src/embedding/`.
- [ ] 2.2 Add `src/embedding/types.ts` for public embedding types and interfaces.
- [ ] 2.3 Add `src/embedding/errors.ts` for normalized provider errors and safe error helpers.
- [ ] 2.4 Add `src/embedding/provider.ts` for provider factory and provider registry.
- [ ] 2.5 Add `src/embedding/fake.ts` for deterministic fake provider used by tests.
- [ ] 2.6 Add `src/embedding/minimax.ts` for the MiniMax docs-gated provider module.
- [ ] 2.7 Add `src/embedding/gemini.ts` for Gemini adapter.
- [ ] 2.8 Add `src/embedding/qwen.ts` for Qwen scaffold that throws unsupported-provider until implemented.
- [ ] 2.9 Add `src/embedding/metadata.ts` for vector metadata compatibility helpers shared with knowledge vector builder.
- [ ] 2.10 Add `src/embedding/index.ts` that exports only stable public types, factory, errors, fake provider, and implemented provider classes.
- [ ] 2.11 Ensure no file in `src/embedding/` imports from `src/runtime/`, `src/gateway/`, `src/workers/`, or `src/agents/`.
- [ ] 2.12 Ensure provider adapter files do not import `src/knowledge/indexer.ts`; knowledge may depend on embedding, but embedding must not depend on knowledge.

## 3. Embedding Type Contract

- [ ] 3.1 Define `EmbeddingProviderId = 'minimax' | 'gemini' | 'qwen' | 'fake'`.
- [ ] 3.2 Define `EmbeddingDistanceMetric = 'cosine' | 'dot' | 'euclidean'`.
- [ ] 3.3 Define `EmbeddingProviderConfig` with fields `enabled`, `provider`, `model`, `baseUrl?`, `endpoint?`, `apiKey?`, `apiKeyEnv?`, `dimensions`, `distance`, `batchSize?`, `timeoutMs?`, and `extra?`.
- [ ] 3.4 Define `EmbeddingDocumentInput` with fields `id`, `text`, `contentHash?`, `source?`, `documentId?`, `chunkId?`, and `metadata?`.
- [ ] 3.5 Define `EmbeddingQueryInput` with fields `id?`, `text`, and `metadata?`.
- [ ] 3.6 Define `EmbeddingRequestOptions` with fields `signal?`, `timeoutMs?`, `batchSize?`, and `requestId?`.
- [ ] 3.7 Define `EmbeddingUsage` with optional `inputTokens`, `totalTokens`, `providerRequestCount`, and `raw?`; raw must be safe and must not contain secrets.
- [ ] 3.8 Define `EmbeddingVectorResult` with fields `id`, `provider`, `model`, `dimensions`, `distance`, `vector`, `usage?`, `contentHash?`, and `metadata?`.
- [ ] 3.9 Define `EmbeddingBatchResult` with fields `provider`, `model`, `dimensions`, `distance`, `results`, `usage?`, and `warnings`.
- [ ] 3.10 Define `EmbeddingProvider` interface with readonly `id`, `model`, `dimensions`, `distance`, `embedDocuments(...)`, and `embedQuery(...)`.
- [ ] 3.11 Add a helper type or function for `EmbeddingProviderHealthCheckResult` with provider, model, dimensions, ok, durationMs, and safe error fields.
- [ ] 3.12 Ensure all exported types are TypeScript strict-mode compatible and do not use `any`.

## 4. Embedding Error Contract

- [ ] 4.1 Implement `EmbeddingProviderError` in `src/embedding/errors.ts` extending `Error`.
- [ ] 4.2 `EmbeddingProviderError` must include `provider`, `code`, `retryable`, `status?`, `safeMessage`, and `cause?`.
- [ ] 4.3 Define error codes including `missing_credentials`, `unsupported_provider`, `docs_required`, `timeout`, `rate_limited`, `invalid_request`, `provider_error`, `malformed_response`, `dimension_mismatch`, and `network_error`.
- [ ] 4.4 Add `isEmbeddingProviderError(error)` type guard.
- [ ] 4.5 Add `redactEmbeddingErrorMessage(value)` helper that removes API keys, bearer tokens, cookies, and long credential-like strings.
- [ ] 4.6 Add `formatEmbeddingSafeError(error)` helper for CLI output; it must never include request headers, API key values, cookies, or raw payloads.
- [ ] 4.7 Add tests proving redaction catches `apiKey`, `Authorization`, `Bearer ...`, `cookie`, `token`, and nested string values.
- [ ] 4.8 Add tests proving unknown thrown errors are converted to safe provider errors by adapters or factory helpers.

## 5. Config Integration

- [ ] 5.1 Update `src/config.ts` `SuperHelperConfig` to include `embedding: EmbeddingProviderConfig`.
- [ ] 5.2 Avoid importing runtime-heavy code into `src/config.ts`; if type imports from `src/embedding/types.ts` create cycles, define a narrow config type in config or move shared type carefully.
- [ ] 5.3 Update `defaultConfig()` so `embedding.enabled` is `false` by default.
- [ ] 5.4 Set default `embedding.provider` to `minimax`.
- [ ] 5.5 Set default `embedding.model` to a documented MiniMax example only if verified; otherwise use a safe placeholder and require explicit model in CLI setup.
- [ ] 5.6 Set default `embedding.dimensions` to a positive integer only if verified for the configured default model; otherwise require explicit dimensions before enabling.
- [ ] 5.7 Set default `embedding.distance` to `cosine`.
- [ ] 5.8 Set default `embedding.batchSize` to a conservative number such as 16 unless provider docs require a lower value.
- [ ] 5.9 Set default `embedding.timeoutMs` to 60000 unless provider docs require a different value.
- [ ] 5.10 Update `loadConfig()` merge logic to preserve existing config files that do not contain `embedding`.
- [ ] 5.11 Add `getEmbeddingConfig(config)` helper returning the embedding config.
- [ ] 5.12 Add `isEmbeddingEnabled(config)` helper returning a boolean.
- [ ] 5.13 Add `resolveEmbeddingSecret(config.embedding)` helper or reuse `resolveSecret` without duplicating secret logic.
- [ ] 5.14 Ensure `saveConfig()` writes embedding config in a stable JSON shape.
- [ ] 5.15 Add tests that old config JSON without `embedding` loads successfully.
- [ ] 5.16 Add tests that `embedding.enabled: false` prevents provider creation from being required.
- [ ] 5.17 Add tests that Agent `models.providers` and `embedding` can select different providers without conflict.

## 6. Provider Factory and Registry

- [ ] 6.1 Implement `createEmbeddingProvider(config, options?)` in `src/embedding/provider.ts`.
- [ ] 6.2 Factory must return `MiniMaxEmbeddingProvider` when `provider === 'minimax'`.
- [ ] 6.3 Factory must return `GeminiEmbeddingProvider` when `provider === 'gemini'`.
- [ ] 6.4 Factory must return `QwenEmbeddingProvider` scaffold when `provider === 'qwen'`; scaffold must throw unsupported-provider on use.
- [ ] 6.5 Factory must return `FakeEmbeddingProvider` only when explicitly requested in tests or when provider is `fake`.
- [ ] 6.6 Factory must reject unknown provider ids with `EmbeddingProviderError` code `unsupported_provider`.
- [ ] 6.7 Factory must validate `model` is non-empty when embedding is enabled.
- [ ] 6.8 Factory must validate `dimensions` is a positive integer.
- [ ] 6.9 Factory must validate `distance` is one of supported metrics.
- [ ] 6.10 Factory must not resolve or print API key values during validation except through safe missing-credential checks.
- [ ] 6.11 Add optional dependency injection for `fetch` implementation to support fake HTTP tests.
- [ ] 6.12 Add tests for each provider id, invalid provider id, missing model, invalid dimensions, invalid distance, and fake fetch injection.

## 7. Fake Provider

- [ ] 7.1 Implement `FakeEmbeddingProvider` in `src/embedding/fake.ts`.
- [ ] 7.2 Fake provider constructor must accept provider id, model, dimensions, distance, and optional deterministic seed.
- [ ] 7.3 Fake `embedDocuments` must return one vector per input in the same order as input.
- [ ] 7.4 Fake `embedQuery` must return exactly one vector.
- [ ] 7.5 Fake vectors must be deterministic for the same text/model/dimensions.
- [ ] 7.6 Fake provider must produce vectors with exactly configured dimensions.
- [ ] 7.7 Fake provider must not call network.
- [ ] 7.8 Fake provider usage metadata must be deterministic and safe.
- [ ] 7.9 Add tests for deterministic output, input ordering, dimensions, query output, and no network behavior.

## 8. MiniMax Provider Adapter

- [ ] 8.1 Create `MiniMaxEmbeddingProvider` in `src/embedding/minimax.ts` as a docs-gated provider module.
- [ ] 8.2 Before coding request/response shape, check current MiniMax official embedding API docs and update this OpenSpec if endpoint, model, auth, dimensions, batch limit, or response format differs from assumptions.
- [ ] 8.2a If current official MiniMax docs do not document embedding endpoint/auth/request/response/dimensions/batch limits, do not implement real HTTP calls; implement a safe scaffold that throws `EmbeddingProviderError` code `unsupported_provider` or `docs_required` with a safe message.
- [ ] 8.2b If the user supplies current official MiniMax embedding docs, record the supplied docs URL and access date in implementation notes before switching 8.2a from scaffold to real adapter work.
- [ ] 8.3 Constructor must accept `EmbeddingProviderConfig` and optional injected `fetch`.
- [ ] 8.4 Provider id must be `minimax`.
- [ ] 8.5 Adapter must resolve credentials from `apiKey` or `apiKeyEnv` at request time.
- [ ] 8.6 Adapter must throw `missing_credentials` when credentials are absent.
- [ ] 8.7 If real MiniMax docs are verified, adapter must build request URL from configured `baseUrl` or `endpoint`; do not hard-code a single endpoint if docs/config require flexibility.
- [ ] 8.8 If real MiniMax docs are verified, adapter must set authorization headers according to current official docs and must never log them.
- [ ] 8.9 If real MiniMax docs are verified, adapter must support document batch requests up to configured `batchSize`.
- [ ] 8.10 If real MiniMax docs are verified, adapter must split larger document input arrays into provider-sized batches.
- [ ] 8.11 If real MiniMax docs are verified, adapter must support `embedQuery` using the query/document distinction required by docs; if MiniMax has no distinction, document that both use the same endpoint with different local method names.
- [ ] 8.12 If real MiniMax docs are verified, adapter must use `AbortController` and respect configured `timeoutMs`.
- [ ] 8.13 If real MiniMax docs are verified, adapter must normalize non-2xx responses into `EmbeddingProviderError` with status and retryable flag.
- [ ] 8.14 If real MiniMax docs are verified, adapter must classify 429 and 5xx as retryable unless provider docs specify otherwise.
- [ ] 8.15 If real MiniMax docs are verified, adapter must parse successful responses into `EmbeddingVectorResult[]`.
- [ ] 8.16 If real MiniMax docs are verified, adapter must verify every returned vector length equals configured `dimensions`.
- [ ] 8.17 If real MiniMax docs are verified, adapter must throw `dimension_mismatch` when provider vector length differs from config.
- [ ] 8.18 If real MiniMax docs are verified, adapter must preserve input id to output id mapping.
- [ ] 8.19 If real MiniMax docs are verified, adapter must aggregate usage metadata when provider returns token or request usage.
- [ ] 8.20 If real MiniMax docs are verified, adapter must reject malformed responses with `malformed_response`.
- [ ] 8.21 If real MiniMax docs are verified, add fake HTTP tests for successful document batch, successful query, missing credentials, timeout, 429, 500, malformed JSON, missing vector, and dimension mismatch.
- [ ] 8.22 If real MiniMax docs are not verified, add scaffold tests proving `embedDocuments` and `embedQuery` fail with safe docs-required/unsupported errors, no network call occurs even when `fetch` is injected, and no secret/config values appear in the error.

## 9. Gemini Provider Adapter

- [ ] 9.1 Implement `GeminiEmbeddingProvider` in `src/embedding/gemini.ts`.
- [ ] 9.2 Before coding request/response shape, check current Gemini official embedding API docs and update this OpenSpec if endpoint, model, auth, task type, or response format differs from assumptions.
- [ ] 9.3 Constructor must accept `EmbeddingProviderConfig` and optional injected `fetch`.
- [ ] 9.4 Provider id must be `gemini`.
- [ ] 9.5 Adapter must resolve credentials from `apiKey` or `apiKeyEnv` at request time.
- [ ] 9.6 Adapter must throw `missing_credentials` when credentials are absent.
- [ ] 9.7 Adapter must build request URL from configured `baseUrl` or `endpoint`.
- [ ] 9.8 Adapter must support configured model name and must not hard-code a single Gemini model in core logic.
- [ ] 9.9 Adapter must support document embedding and query embedding as separate methods.
- [ ] 9.10 Adapter must support task type or output dimension parameters if current Gemini docs require them.
- [ ] 9.11 Adapter must support batch splitting according to provider limits confirmed in docs.
- [ ] 9.12 Adapter must use `AbortController` and respect configured `timeoutMs`.
- [ ] 9.13 Adapter must normalize non-2xx responses into `EmbeddingProviderError`.
- [ ] 9.14 Adapter must verify returned vector length equals configured `dimensions`.
- [ ] 9.15 Adapter must preserve input id to output id mapping.
- [ ] 9.16 Adapter must reject malformed responses with `malformed_response`.
- [ ] 9.17 Add fake HTTP tests for successful document batch, successful query, missing credentials, timeout, provider error, malformed response, and dimension mismatch.

## 10. Qwen Provider Scaffold

- [ ] 10.1 Implement `QwenEmbeddingProvider` scaffold in `src/embedding/qwen.ts`.
- [ ] 10.2 Provider id must be `qwen`.
- [ ] 10.3 Constructor must accept `EmbeddingProviderConfig` for future compatibility.
- [ ] 10.4 `embedDocuments` must throw `EmbeddingProviderError` code `unsupported_provider` with safe message explaining Qwen is reserved but not implemented.
- [ ] 10.5 `embedQuery` must throw `EmbeddingProviderError` code `unsupported_provider` with safe message explaining Qwen is reserved but not implemented.
- [ ] 10.6 Add tests that selecting `qwen` creates the scaffold but calling it fails clearly.
- [ ] 10.7 Add a design note in docs that Qwen can be implemented later using the same interface without changing knowledge vector builder.

## 11. Embedding Metadata Helpers

- [ ] 11.1 Implement `embeddingConfigFingerprint(config)` in `src/embedding/metadata.ts`.
- [ ] 11.2 Fingerprint must include provider, model, dimensions, and distance.
- [ ] 11.3 Fingerprint must exclude API key, API key env value, headers, and endpoint secrets.
- [ ] 11.4 Implement `assertEmbeddingDimensions(vector, expectedDimensions, provider, model)` helper.
- [ ] 11.5 Implement `isEmbeddingManifestCompatible(manifest, config)` returning structured compatible/mismatch result.
- [ ] 11.6 Mismatch result must identify provider, model, dimensions, or distance mismatch separately.
- [ ] 11.7 Implement `hashEmbeddingText(text)` using stable sha256 hashing.
- [ ] 11.8 Add tests for stable fingerprint, secret exclusion, dimension assertion, each mismatch type, and text hash stability.

## 12. Knowledge Vector Types and Paths

- [ ] 12.1 Add vector-related types to `src/knowledge/types.ts` or a new `src/knowledge/vector-types.ts`.
- [ ] 12.2 Define `KnowledgeVectorRecord` with vector id, source, document id, chunk id, text hash, provider, model, dimensions, distance, vector, created_at, and metadata.
- [ ] 12.3 Define `KnowledgeVectorManifest` with version, provider, model, dimensions, distance, source_chunk_manifest_hash, vector_count, skipped_count, failed_count, generated_at, and embedding_config_fingerprint.
- [ ] 12.4 Define `KnowledgeVectorBuildReport` with version, generatedAt, provider, model, dimensions, vectorCount, skipped, failures, durationMs, vectorsPath, and manifestPath.
- [ ] 12.5 Add `vectorsPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/indexes/vectors.jsonl`.
- [ ] 12.6 Add `vectorManifestPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/indexes/vector-manifest.json`.
- [ ] 12.7 Add `vectorBuildReportPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/indexes/vector-build-report.json` or documented equivalent.
- [ ] 12.8 Export vector types and path helpers through `src/knowledge/index.ts` only where needed by CLI/tests.
- [ ] 12.9 Add tests for vector path helpers and type-level compile coverage through TypeScript.

## 13. Knowledge Vector Builder

- [ ] 13.1 Add `src/knowledge/vector-index.ts` owned by the knowledge module.
- [ ] 13.2 Implement `loadKnowledgeChunksForEmbedding(workspaceRoot)` that reads existing `chunks.jsonl`.
- [ ] 13.3 The loader must tolerate absent `chunks.jsonl` by returning a structured empty result, not throwing an uncaught exception.
- [ ] 13.4 The loader must reject malformed JSONL lines with a structured failure summary.
- [ ] 13.5 Implement `chunkToEmbeddingDocumentInput(chunk)` preserving chunk id, parent id, source, and content hash.
- [ ] 13.6 Implement `isChunkEligibleForRemoteEmbedding(chunk, options)` to skip restricted visibility or unsupported source types when configured.
- [ ] 13.7 Implement `buildKnowledgeVectorIndex({ workspaceRoot, provider, config, options })`.
- [ ] 13.8 Vector builder must read chunks, filter eligible chunks, call `provider.embedDocuments`, and write vectors JSONL.
- [ ] 13.9 Vector builder must create `knowledge/indexes/` before writing artifacts.
- [ ] 13.10 Vector builder must write one valid JSON object per line to `vectors.jsonl`.
- [ ] 13.11 Vector builder must write `vector-manifest.json` after vectors are written.
- [ ] 13.12 Vector builder must write build report after completion or partial failure.
- [ ] 13.13 Vector builder must compute source chunk manifest hash from chunk ids and text hashes.
- [ ] 13.14 Vector builder must record skipped restricted chunks without sending their text to provider.
- [ ] 13.15 Vector builder must support partial failures by recording failed chunk ids and not marking manifest healthy.
- [ ] 13.16 Vector builder must not delete existing vector artifacts until new artifacts are ready; if atomic write is implemented, document temp file behavior.
- [ ] 13.17 Add tests for empty chunks, malformed chunks, eligible chunks, restricted skip, vector JSONL output, manifest output, report output, partial failure, and source hash changes.

## 14. Vector Artifact Read and Compatibility

- [ ] 14.1 Implement `readKnowledgeVectorManifest(workspaceRoot)` returning undefined for absent manifest.
- [ ] 14.2 Implement `readKnowledgeVectorRecords(workspaceRoot)` returning records plus malformed-line failures.
- [ ] 14.3 Implement `checkKnowledgeVectorCompatibility({ workspaceRoot, embeddingConfig })`.
- [ ] 14.4 Compatibility check must return compatible when provider/model/dimensions/distance match.
- [ ] 14.5 Compatibility check must return rebuild-required on provider mismatch.
- [ ] 14.6 Compatibility check must return rebuild-required on model mismatch.
- [ ] 14.7 Compatibility check must return rebuild-required on dimension mismatch.
- [ ] 14.8 Compatibility check must return rebuild-required on distance mismatch.
- [ ] 14.9 Compatibility check must return missing-index when manifest or vector file is absent.
- [ ] 14.10 Search/runtime integration, if added in this change, must downgrade to keyword-only when vector index is incompatible.
- [ ] 14.11 Add tests for each compatibility result and malformed vector artifact handling.

## 15. CLI Command Shape

- [ ] 15.1 Decide final CLI shape before implementation and update `design.md` if it changes.
- [ ] 15.2 Preferred command: `super-helper embedding test --workspace <path> [--provider minimax|gemini|qwen]`.
- [ ] 15.3 Preferred command: `super-helper knowledge vector build --workspace <path> [--provider minimax|gemini]`.
- [ ] 15.4 Update `src/cli.ts` top-level command handling to route `embedding` commands.
- [ ] 15.5 Update `handleKnowledgeCommand` in `src/cli.ts` to route `knowledge vector build` without embedding business logic in CLI.
- [ ] 15.6 Add parser helpers for `--provider`, `--model`, `--base-url`, `--endpoint`, `--api-key-env`, `--dimensions`, `--distance`, `--batch-size`, and `--timeout-ms` where needed.
- [ ] 15.7 CLI must prefer config values when flags are absent.
- [ ] 15.8 CLI flags must override config for the current command only unless using an explicit config write command.
- [ ] 15.9 CLI output must print provider id, model, dimensions, distance, artifact paths, counts, and safe errors.
- [ ] 15.10 CLI output must not print API keys, bearer tokens, cookies, raw request headers, or raw chunk text.
- [ ] 15.11 Update `printUsage()` with embedding and knowledge vector commands.
- [ ] 15.12 Add CLI dispatch tests for valid commands, missing args, invalid provider, disabled embedding, and safe output.

## 16. Embedding Provider Smoke Test

- [ ] 16.1 Implement `runEmbeddingSmokeTest({ config, providerOverride?, sampleText? })` in `src/embedding/provider.ts` or a focused `src/embedding/smoke-test.ts`.
- [ ] 16.2 Smoke test must not run when embedding is disabled unless an explicit override enables it.
- [ ] 16.3 Smoke test must use a harmless short sample string, not real knowledge text.
- [ ] 16.4 Smoke test must call `embedQuery` or the provider's cheapest recommended endpoint.
- [ ] 16.5 Smoke test must verify vector dimensions.
- [ ] 16.6 Smoke test must return provider, model, dimensions, ok, durationMs, and safe error.
- [ ] 16.7 CLI must display smoke test result without raw vector values by default.
- [ ] 16.8 Add tests for disabled config, success, dimension mismatch, missing credentials, provider error, and redacted output.

## 17. Config CLI Support

- [ ] 17.1 Decide whether to add `super-helper embedding set` in this change; if omitted, document manual config editing or existing config path.
- [ ] 17.2 If adding `embedding set`, implement `super-helper embedding set --provider <id> --model <model> --dimensions <n> --api-key-env <env> [--base-url <url>]`.
- [ ] 17.3 `embedding set` must not require raw `--api-key`; prefer `--api-key-env`.
- [ ] 17.4 If raw `--api-key` is supported for parity with model set, CLI output must never echo it.
- [ ] 17.5 `embedding set` must set `embedding.enabled` explicitly when `--enable` is provided.
- [ ] 17.6 Add tests that config writes preserve existing model provider settings.
- [ ] 17.7 Add tests that invalid dimensions, invalid distance, and missing model are rejected.
- [ ] 17.8 Update docs with recommended MiniMax-first config and Gemini fallback config.

## 18. Package Scripts

- [ ] 18.1 Add npm script `embedding:test` only if it maps to the CLI smoke test and does not duplicate logic.
- [ ] 18.2 Add npm script `knowledge:vector` only if it maps to the CLI vector build and does not duplicate logic.
- [ ] 18.3 Scripts must run `pnpm build` before invoking `node dist/cli.js`.
- [ ] 18.4 Do not add scripts that call real remote providers as part of `pnpm test`.
- [ ] 18.5 Update `package.json` tests if new test files require inclusion under existing `node --test test/*.test.mjs` pattern.

## 19. Documentation Updates

- [ ] 19.1 Update `docs/technical-architecture.md` to add `src/embedding/` to the implemented or planned module layout.
- [ ] 19.2 Update `docs/development-standards.md` module ownership table to include `src/embedding/` and its must-not-own boundaries.
- [ ] 19.3 Document that `src/embedding/` must not own retrieval ranking, Evidence Judge, runtime orchestration, HTTP routes, or final replies.
- [ ] 19.4 Add docs section explaining Agent model provider and embedding provider are independent.
- [ ] 19.5 Add docs section explaining MiniMax is the current preferred embedding provider, Gemini is the fallback provider, and Qwen is reserved.
- [ ] 19.6 Add docs section explaining vector index compatibility: provider/model/dimensions/distance must match.
- [ ] 19.7 Add docs section explaining changing embedding provider or model requires rebuilding vector artifacts.
- [ ] 19.8 Add docs section explaining remote embedding privacy: restricted knowledge should be skipped unless policy allows it.
- [ ] 19.9 Add docs section explaining smoke test command and vector build command.
- [ ] 19.10 Add docs section explaining reports and artifact paths: `vectors.jsonl`, `vector-manifest.json`, and vector build report.
- [ ] 19.11 Ensure docs do not claim BM25/hybrid/reranker/GraphRAG is implemented by this change.
- [ ] 19.12 Run `pnpm lint` after docs changes and fix failures.

## 20. Unit Tests

- [ ] 20.1 Add `test/embedding.test.mjs`.
- [ ] 20.2 Test type-level behavior through compiled TypeScript exports by importing built modules from `dist` after build.
- [ ] 20.3 Test fake provider deterministic vectors.
- [ ] 20.4 Test provider factory for MiniMax, Gemini, Qwen scaffold, fake provider, and unknown provider.
- [ ] 20.5 Test provider config validation.
- [ ] 20.6 Test safe error redaction.
- [ ] 20.7 Test MiniMax real adapter with injected fake fetch only if official MiniMax embedding docs are verified; otherwise test the MiniMax scaffold/docs-required behavior and prove injected fetch is not called.
- [ ] 20.8 Test Gemini adapter with injected fake fetch.
- [ ] 20.9 Test Qwen unsupported behavior.
- [ ] 20.10 Test smoke test helper with fake provider.
- [ ] 20.11 Tests must not require network access or API keys.
- [ ] 20.12 Add fixtures under `test/fixtures/embedding/` only if needed; fixtures must not contain real API keys or sensitive source text.

## 21. Knowledge Vector Tests

- [ ] 21.1 Add `test/knowledge-vector.test.mjs` or extend `test/knowledge.test.mjs` if project conventions prefer fewer files.
- [ ] 21.2 Test `chunks.jsonl` to embedding input conversion.
- [ ] 21.3 Test vector build using fake provider.
- [ ] 21.4 Test `vectors.jsonl` one-line-per-record output.
- [ ] 21.5 Test `vector-manifest.json` metadata.
- [ ] 21.6 Test vector build report.
- [ ] 21.7 Test restricted chunk skip.
- [ ] 21.8 Test malformed chunks handling.
- [ ] 21.9 Test provider partial failure handling.
- [ ] 21.10 Test vector manifest compatibility success.
- [ ] 21.11 Test provider mismatch.
- [ ] 21.12 Test model mismatch.
- [ ] 21.13 Test dimensions mismatch.
- [ ] 21.14 Test distance mismatch.
- [ ] 21.15 Test absent vector files.
- [ ] 21.16 Test source chunk hash change marks stale or rebuild-required.

## 22. CLI Tests

- [ ] 22.1 Add CLI smoke tests using fake provider or fake fetch; do not call real MiniMax/Gemini.
- [ ] 22.2 Test `embedding test` reports disabled state without network call.
- [ ] 22.3 Test `embedding test` success path with fake provider.
- [ ] 22.4 Test `embedding test` missing credentials error is redacted.
- [ ] 22.5 Test `knowledge vector build` writes vector artifacts with fake provider.
- [ ] 22.6 Test invalid provider id exits non-zero with safe message.
- [ ] 22.7 Test CLI does not print raw vector values unless an explicit debug flag exists.
- [ ] 22.8 Test CLI does not print raw chunk text in vector build output.

## 23. Optional Settings API and UI Compatibility

- [ ] 23.1 Decide whether settings API should expose embedding config in this change; if not, document CLI/config-only setup.
- [ ] 23.2 If updating settings API, modify `src/gateway/dto.ts` using optional `embedding` fields so existing clients remain compatible.
- [ ] 23.3 If updating settings routes, keep route code transport-only and delegate validation to config/embedding helpers.
- [ ] 23.4 If updating UI, keep it limited to config display/edit; UI must not implement provider calls.
- [ ] 23.5 Add compatibility tests for `/api/settings` response shape if settings API changes.
- [ ] 23.6 Add tests that existing model settings behavior is unchanged.

## 24. Security and Privacy Checks

- [ ] 24.1 Ensure provider adapters never include API key values in thrown messages.
- [ ] 24.2 Ensure CLI output never prints API key values.
- [ ] 24.3 Ensure vector build reports never include raw chunk text.
- [ ] 24.4 Ensure vector manifest never includes API keys, headers, cookies, or environment variable values.
- [ ] 24.5 Ensure restricted chunks are skipped by default for remote embedding unless a documented option allows them.
- [ ] 24.6 Ensure raw provider responses are not persisted unless explicitly sanitized.
- [ ] 24.7 Add tests covering secret redaction in nested error objects and provider response text.

## 25. Real Provider Acceptance Notes

- [ ] 25.1 Add documentation for running MiniMax smoke test locally with `MINIMAX_API_KEY` only if official MiniMax embedding docs are verified; otherwise document why MiniMax real smoke is blocked by docs gate.
- [ ] 25.2 Add documentation for running Gemini smoke test locally with the configured Gemini API key env.
- [ ] 25.3 Real smoke tests must be optional and excluded from `pnpm test`.
- [ ] 25.4 Real smoke test output must record provider, model, dimensions, duration, and ok/fail only.
- [ ] 25.5 If real MiniMax credentials or official MiniMax embedding docs are unavailable during implementation, document that real MiniMax smoke was not run and only scaffold/fake-contract tests were run.
- [ ] 25.6 If real Gemini credentials are unavailable during implementation, document that only fake-fetch adapter tests were run.
- [ ] 25.7 If official docs cannot be accessed by the implementer, stop provider-specific coding and update OpenSpec rather than guessing endpoint/response shape.

## 26. Verification

- [ ] 26.1 Run `pnpm lint`.
- [ ] 26.2 Run `pnpm typecheck`.
- [ ] 26.3 Run `pnpm build`.
- [ ] 26.4 Run `pnpm test`.
- [ ] 26.5 Run focused embedding tests after build, for example `node --test test/embedding.test.mjs`.
- [ ] 26.6 Run focused knowledge vector tests after build, for example `node --test test/knowledge-vector.test.mjs`, if that file exists.
- [ ] 26.7 Run embedding smoke test with fake provider or disabled mode and capture safe output in implementation notes.
- [ ] 26.8 Run knowledge vector build with fake provider against a fixture knowledge workspace and capture artifact paths/counts in implementation notes.
- [ ] 26.9 Review git diff to confirm module boundaries: provider code in `src/embedding/`, vector artifacts in `src/knowledge/`, config in `src/config.ts`, CLI parsing in `src/cli.ts`, docs in `docs/`, tests in `test/`.
- [ ] 26.10 Confirm no new default command calls remote embedding providers.
- [ ] 26.11 Confirm old config files without `embedding` still load.
- [ ] 26.12 Confirm existing keyword knowledge search still works when embedding is disabled.

## 27. Completion Gates and Anti-Fake-Complete Audit

- [ ] 27.1 Review every checked task and confirm each has either a behavior test, documented verification evidence, or a clearly documented reason why it is documentation-only.
- [ ] 27.2 Confirm provider adapter completion is not based only on class existence; Gemini and any docs-unlocked MiniMax real adapter must have fake HTTP tests for success, missing credentials, timeout/provider error, malformed response, and dimension mismatch. If MiniMax remains docs-blocked, completion requires scaffold/unsupported tests and explicit implementation-notes evidence.
- [ ] 27.3 Confirm Qwen is not described as implemented unless real Qwen network calls were explicitly added by scope change; scaffold must throw `unsupported_provider`.
- [ ] 27.4 Confirm fake provider smoke test output is captured in implementation notes and includes provider, model, dimensions, distance, ok/fail, duration, and safe error if any.
- [ ] 27.5 Confirm fake vector build fixture output is captured in implementation notes and includes vectors path, manifest path, vector count, skipped count, failed count, provider, model, dimensions, and distance.
- [ ] 27.6 Confirm real MiniMax smoke status is explicit: either record sanitized success output or record that credentials/network/docs were unavailable and only fake-fetch tests were run.
- [ ] 27.7 Confirm real Gemini smoke status is explicit: either record sanitized success output or record that credentials/network/docs were unavailable and only fake-fetch tests were run.
- [ ] 27.8 Confirm no raw vector values are printed by default in CLI output, reports, or implementation notes.
- [ ] 27.9 Confirm no raw chunk text is printed or persisted in vector build reports; reports must use ids, hashes, counts, paths, and safe summaries.
- [ ] 27.10 Confirm no API key, bearer token, cookie, request header, or provider raw payload appears in errors, reports, logs, CLI output, vector manifest, or implementation notes.
- [ ] 27.11 Confirm changing provider, model, dimensions, or distance produces `rebuild_required` or equivalent refusal to use old vectors.
- [ ] 27.12 Confirm deleting vector artifacts leaves canonical knowledge intact and rebuildable.
- [ ] 27.13 Confirm `pnpm test` and normal `knowledge update` do not call real MiniMax, Gemini, or Qwen by default.
- [ ] 27.14 Confirm `embedding.enabled: false` returns the system to keyword-only knowledge behavior.
- [ ] 27.15 Review git diff and record boundary audit in implementation notes: provider network logic in `src/embedding/`, vector artifact logic in `src/knowledge/`, config in `src/config.ts`, CLI only parses/delegates, no embedding business logic in `src/runtime/`, `src/gateway/`, `src/workers/`, or `src/agents/`.
- [ ] 27.16 Run `openspec status --change add-embedding-provider-adapters --json` and record whether OpenSpec artifacts remain complete.
- [ ] 27.17 Do not mark this change complete until implementation notes include fresh verification summaries for `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, focused embedding tests, focused knowledge vector tests, fake smoke, fake vector build, and the diff boundary audit.
- [ ] 27.18 Anti-fake-complete rethink: list every place where an implementer could create files/classes/interfaces but fail to move real data through the provider/vector path; add missing behavior tests or tasks before completing.
- [ ] 27.19 Anti-fake-complete rethink: list every test that could pass while only testing mocks or scaffolds; confirm at least one fixture path exercises factory -> provider/fake -> vector builder -> artifact metadata.
- [ ] 27.20 Anti-fake-complete rethink: list every stale artifact/cache/schema path that could make vector compatibility look green; confirm rebuild-required behavior for provider/model/dimensions/distance/text hash changes.
- [ ] 27.21 Anti-fake-complete rethink: list every provider-specific assumption that came from third-party docs or memory; confirm it is either replaced by official docs evidence or blocked as scaffold.
- [ ] 27.22 Anti-fake-complete rethink: list every command that could accidentally call network, spend money, write outside the configured knowledge workspace, or persist raw chunk text; confirm default commands are safe.
- [ ] 27.23 Anti-fake-complete rethink: list every module boundary that could be violated; confirm no embedding provider logic was added to `src/runtime/`, `src/gateway/`, `src/workers/`, `src/agents/`, or compatibility entry points.
- [ ] 27.24 Anti-fake-complete rethink: list every place secrets/raw provider payloads/raw vectors/raw chunk text could appear; confirm redaction tests and report inspections cover them.
- [ ] 27.25 Anti-fake-complete rethink: after answering 27.18-27.24, update `design.md`, `specs/embedding-provider-adapters/spec.md`, `tasks.md`, or `implementation-notes.md` for any gap found; do not leave the rethink only as a checklist assertion.
