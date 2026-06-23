## 1. Red Tests

- [x] 1.1 Add boundary RED tests for `knowledge/indexer.ts` and `command-knowledge.ts` line limits, provider-shaped interfaces/ranking logic in knowledge, keyword strategy importing indexer, and legacy embedding imports in production source. Completion evidence: focused boundary tests fail on current files/imports.
- [x] 1.2 Add CLI RED tests that lock representative output/exit behavior for init、update、search、invalid quality gate、vector disabled and unknown knowledge command while requiring the new handler directory. Completion evidence: structure assertion fails before CLI split while behavior baseline remains recorded.
- [x] 1.3 Add direct compatibility RED test proving keyword strategy no longer imports knowledge indexer and old `searchKnowledge` output remains equal to retrieval compatibility output. Completion evidence: test fails because compatibility service is absent/current strategy routes through indexer.

## 2. Knowledge Local Split

- [x] 2.1 Extract document discovery and source metadata loading into `src/knowledge/documents/discovery.ts` without changing malformed/missing-file behavior. Completion evidence: focused knowledge tests pass.
- [x] 2.2 Extract chunk build/artifact fallback into `src/knowledge/documents/chunks.ts` and index rebuild/quality orchestration into `src/knowledge/indexes/build.ts` without changing artifact shapes. Completion evidence: knowledge and quality fixture tests pass.
- [x] 2.3 Move keyword scoring/filtering/evidence conversion to `src/retrieval/compatibility-search.ts` and update keyword strategy to call it directly. Completion evidence: old and new compatibility outputs match fixture-for-fixture.
- [x] 2.4 Reduce `src/knowledge/indexer.ts` to compatibility re-exports at or below 120 lines, preserving old public names/signatures. Completion evidence: legacy knowledge/RAG imports compile and tests pass.

## 3. CLI Split And Provider Imports

- [x] 3.1 Create `src/cli/knowledge/context.ts` and `output.ts` for shared path/config/flag and quality output behavior. Completion evidence: invalid flags and explicit roots remain compatible.
- [x] 3.2 Extract workspace/index/search, pipeline stages and vector build into `command-workspace.ts`, `command-pipeline.ts`, and `command-vector.ts`; reduce `command-knowledge.ts` to a dispatcher at or below 120 lines. Completion evidence: CLI routing/spawn tests pass with unchanged output and exit codes.
- [x] 3.3 Migrate CLI、onboarding、config and model smoke production imports from `src/embedding/` to `src/providers/`, preserving compatibility tests that intentionally use the old facade. Completion evidence: source import scan has no offenders outside `src/embedding/`.

## 4. Anti-Fake-Complete Audit / 回头重新思考

- [x] 4.1 Audit knowledge ownership and real call paths: prove local files own only discovery/chunks/artifacts, retrieval owns keyword ranking, indexer is facade-only, and old callers execute the new implementation rather than a duplicate copy.
- [x] 4.2 Audit CLI and provider imports: prove handlers delegate services, outputs/exits remain compatible, production has no legacy embedding imports, and default commands/tests remain offline and secret-safe.

## 5. Verification

- [x] 5.1 Record RED/GREEN and audit evidence in `implementation-notes.md`; run OpenSpec status and `pnpm lint`.
- [x] 5.2 Run `pnpm typecheck`, `pnpm build`, knowledge/retrieval/CLI/onboarding focused tests and `pnpm test`; all must pass before phase 3.
