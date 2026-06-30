## 1. Red Tests And Baseline

- [x] 1.1 Add module-boundary RED tests proving `src/providers/embedding/**` cannot import `src/embedding/**`, every `src/embedding/*.ts` file is re-export-only, and configured retrieval cannot import `searchKnowledge` or `legacy-rag`. Completion evidence: focused boundary test fails against the current reverse imports and configured shortcut.
- [x] 1.2 Add configured retrieval RED tests for BM25 with providers disabled, BM25 + fake embedding fusion, and safe embedding construction failure. Completion evidence: tests fail because the current function short-circuits to keyword/legacy paths and lacks a testable configured service.
- [x] 1.3 Add rerank fallback RED test proving fused candidates survive a rerank exception, trace reports failed, and the failure reason is redacted. Completion evidence: test fails because current trace records the raw secret-bearing exception message.

## 2. Provider Ownership Migration

- [x] 2.1 Move fake embedding and metadata implementations into `src/providers/embedding/` and convert old files to compatibility re-exports. Completion evidence: direct provider and legacy import tests both pass.
- [x] 2.2 Split SiliconFlow embedding into `siliconflow/endpoint.ts`, `protocol.ts`, and `adapter.ts` using neutral provider helpers while preserving request, response, batch, timeout, usage, dimension and redaction behavior. Completion evidence: existing fake-fetch embedding tests pass with no `src/embedding` import under providers.
- [x] 2.3 Move Gemini、MiniMax、Qwen docs-gated scaffolds into vendor-specific provider directories and update factory imports. Completion evidence: unsupported-provider tests pass and fetch remains unused.
- [x] 2.4 Replace rerank adapter/factory use of embedding-specific errors with neutral `ProviderError` helpers while preserving compatibility aliases. Completion evidence: rerank failure and redaction tests pass.

## 3. Configured Retrieval Migration

- [x] 3.1 Add `createConfiguredRetrievalService` and route `searchKnowledgeWithConfiguredRetrieval` through default registry/service with BM25 always registered. Completion evidence: disabled-provider configured path runs BM25 without network.
- [x] 3.2 Preserve safe provider construction failures as skipped/failed trace reasons and keep BM25 evidence. Completion evidence: invalid provider and stale/missing vector fixtures do not erase BM25 results or leak configuration secrets.
- [x] 3.3 Make rerank failure retain fused candidates and record a safe failed trace. Completion evidence: focused retrieval fallback test passes.
- [x] 3.4 Refactor `legacy-rag.ts` into a compatibility parameter adapter over the shared registry/service, with keyword enabled only for legacy behavior. Completion evidence: old knowledge RAG rerank/vector tests remain compatible and source audit finds no second hardcoded workflow.

## 4. Compatibility And Boundary Gates

- [x] 4.1 Convert every `src/embedding/*.ts` implementation file to re-export the new provider implementation and preserve all old public symbols. Completion evidence: `test/embedding.test.mjs` and `test/knowledge-vector.test.mjs` pass unchanged through legacy imports.
- [x] 4.2 Strengthen module-boundary tests for provider forbidden imports, compatibility-only files and configured retrieval production composition. Completion evidence: focused boundary tests pass and would fail if reverse imports or legacy shortcut return.
- [x] 4.3 Run provider, retrieval, knowledge and runtime focused tests using fake providers only; record RED/GREEN commands in `implementation-notes.md`.

## 5. Anti-Fake-Complete Audit / 回头重新思考

- [x] 5.1 Audit real source imports and production control flow: prove provider implementations live under `src/providers/`, configured runtime uses registry/BM25, legacy wrapper delegates, and tests cover production composition rather than only mocks. Feed any gap back into design/spec/tasks before completion.
- [x] 5.2 Audit failures, old artifacts, secrets and network defaults: verify timeout/429/5xx/malformed/dimension mismatch/stale vectors preserve fallback; verify logs/errors/fixtures contain no secret, raw vector or complete document; record real opt-in as run or explicitly not run.

## 6. Verification

- [x] 6.1 Run `openspec status --change complete-provider-retrieval-migration --json` and `pnpm lint`; record exact results.
- [x] 6.2 Run `pnpm typecheck`, `pnpm build`, focused tests and `pnpm test`; all must pass before the next OpenSpec change begins.
