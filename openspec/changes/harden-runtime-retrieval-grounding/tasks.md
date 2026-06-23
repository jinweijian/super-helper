## 1. Baseline And RED Evidence

- [x] 1.1 Add real-Chinese retrieval regression fixtures for correct whitepaper ranking, unrelated no-hit, quality error, missing provenance, and stale metadata; run focused tests and record the expected RED failures in `implementation-notes.md`.
- [x] 1.2 Add runtime RED tests proving configured search currently drops retrieval trace/parent metadata and can select unsafe direct answers; completion evidence is failure for the intended missing contract, not fixture/setup errors.

## 2. Retrieval Evidence Contract

- [x] 2.1 Extend retrieval candidate/evidence types with optional canonical parent metadata, quality, source block/section provenance, answer span, and strategy trace fields without changing required public DTO fields; typecheck must pass after implementation.
- [x] 2.2 Add a knowledge-owned read-only parent/quality lookup and enrich BM25/embedding candidates inside retrieval; focused tests must cover valid parent, missing parent, old artifact, and no invented epoch/default metadata.
- [x] 2.3 Add the runtime-only configured retrieval envelope returning Evidence Pack + Trace while preserving the existing Evidence-Pack-only wrapper; retrieval contract tests must pass.
- [x] 2.4 Propagate safe filter reasons and redacted provider failures through trace; tests must prove secrets, raw vectors, complete provider payloads, and complete source text are absent.

## 3. Strict Knowledge Answer Gate

- [x] 3.1 Add strict eligibility/blocker RED tests for quality warn/error, missing source document/block/section, stale evidence, no answer span, single-character/generic matches, rerank below 0.70, and exact-title lexical fallback.
- [x] 3.2 Implement deterministic eligibility evaluation in `src/runtime/evidence-judge.ts`; native BM25/vector/RRF score alone must never authorize direct answer.
- [x] 3.3 Update knowledge result construction and Deep Query context to use validated answer span, parent source, quality/provenance gaps, and strategy scores; unsupported metadata must remain unknown.

## 4. Runtime Trace And Production Evaluation

- [x] 4.1 Wire retrieval trace into `KnowledgeTurnService` and `RuntimeEventRecorder`; runtime tests must assert strategy status, fusion, rerank, filters, Judge blockers, and no HTTP response change.
- [x] 4.2 Implement production-path retrieval evaluation service and `retrieval eval` CLI adapter with exact expected parent/behavior matching, Recall@K, MRR, direct precision, abstention, must-escalate, and redacted per-question reports.
- [x] 4.3 Add offline fake/disabled provider evaluation fixtures and command tests; default `pnpm test` must make no network or paid calls.

## 5. SiliconFlow Opt-In And Compatibility

- [x] 5.1 Verify existing SiliconFlow adapter protocol against the official sources recorded in design without adding guessed fields; add/retain fake-fetch coverage for success, credentials, timeout, 429, 5xx, malformed response, bad IDs, and dimension mismatch.
- [x] 5.2 Add opt-in acceptance instructions for settings/SecretRef smoke, current workspace vector build, rerank, and retrieval eval; if credentials are unavailable record `not run` rather than fabricating success.
- [x] 5.3 Run focused compatibility tests for HTTP responses, old case JSON, old chunks, disabled providers, stale vectors, and existing CLI commands.

## 6. Anti-Fake-Complete Audit And Completion Gates

- [x] 6.1 Perform an Anti-Fake-Complete audit: trace real configured calls from runtime, prove quality/provenance reaches Judge, prove no-hit cannot direct answer, inspect module boundaries/privacy/default-network behavior, and feed every discovered gap back into design/spec/tasks.
- [x] 6.2 Update architecture, Agent design, retrieval/knowledge CLI docs, and `implementation-notes.md` with RED/GREEN commands, fake acceptance, real opt-in status, compatibility evidence, deviations, and remaining risks.
- [x] 6.3 Run `openspec validate harden-runtime-retrieval-grounding --strict`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, and production retrieval evaluation; all required gates must pass before checking this task.
