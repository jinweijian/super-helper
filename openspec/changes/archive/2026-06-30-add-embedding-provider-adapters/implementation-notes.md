# Implementation Notes: add-embedding-provider-adapters

This file is required execution evidence for the change. Do not mark the change complete until every applicable section below is filled with actual commands, outputs, decisions, or explicit deferrals.

## Spec Author Hardening Audit

- Audit date: 2026-06-14
- Skill/process used: `openspec-change-hardening`
- Audit result: the change already had strong provider/vector/testing gates, but needed a stricter provider documentation baseline and an explicit MiniMax docs gate to prevent guessed real adapter work.
- Required correction from this audit: MiniMax remains the preferred target, but real MiniMax network code is blocked unless current official MiniMax embedding API docs are found and recorded. Until then, MiniMax completion means safe scaffold/fake-contract behavior plus tests, not guessed endpoint implementation.
- Required correction from this audit: anti-fake-complete review must identify file-only, mock-only, stale-artifact, third-party-doc, accidental-network, boundary, and privacy failure modes, then update OpenSpec artifacts for any gap found.

## Spec Author Re-Audit / Mandatory Apply Workflow

- Re-audit date: 2026-06-14
- Reviewer: Codex
- Skills/process used: `using-superpowers`, `openspec-apply-change`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`
- OpenSpec status before edits: `openspec status --change add-embedding-provider-adapters --json` reported schema `spec-driven`, planning artifacts complete, 337/337 tasks remaining from the older MiniMax/Gemini/Qwen-oriented scope.
- Hardening changes made to proposal/design/spec/tasks: scope updated to make SiliconFlow the only real provider for this implementation; Gemini/Qwen/MiniMax/rerank moved to README extension guidance or safe unsupported scaffold behavior.
- Remaining OpenSpec gaps, if any: none known before implementation; real runtime vector retrieval/rerank remains a future retrieval change and is not part of this spec.

Use this section to prove the implementer followed the mandatory checkpoint workflow instead of doing a file-only implementation.

| Checkpoint | RED test or failing fixture recorded first | GREEN command recorded | Implementation notes updated before moving on | Remaining risk/deferred item |
| --- | --- | --- | --- | --- |
| Provider contract | `node --test test/embedding.test.mjs` initially failed because `runEmbeddingSmokeTest` and SiliconFlow factory behavior were missing. | `pnpm build && node --test test/embedding.test.mjs` passed after adding SiliconFlow adapter, smoke helper, unsupported-provider scaffolds, and safe error tests. | yes | Runtime vector retrieval remains out of scope. |
| Vector artifact | `node --test test/knowledge-vector.test.mjs` initially failed because vector paths/types/build/compatibility helpers were missing. | `pnpm build && node --test test/knowledge-vector.test.mjs` passed after adding vector JSONL, manifest, report, restricted skip, and compatibility checks. | yes | Existing runtime search still uses keyword/frontmatter. |
| CLI/smoke | CLI/UI focused tests initially failed because `embedding test`, `rerank test`, `knowledge vector build`, and settings test actions were absent. | `pnpm build && node --test test/embedding.test.mjs test/knowledge-vector.test.mjs test/supper-helper.test.mjs` passed; real SiliconFlow smoke also passed. | yes | Real smoke is explicit/operator-run, not part of default `pnpm test`. |
| Docs/boundary | Docs still said `src/knowledge/` must not own vector infrastructure at all, conflicting with local vector artifacts. | Docs updated to say `src/embedding/` owns remote provider calls and `src/knowledge/` owns rebuildable local vector artifacts/compatibility only. | yes | Future retrieval/rerank changes must update architecture again. |
| Final audit | Final fresh verification was run after code/docs/OpenSpec updates. | `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, focused embedding/vector tests, fake smoke, fake vector fixture, acceptance, and OpenSpec status all passed. | yes | None known. |

Minimum fake acceptance spine evidence:

- Config used: `provider=fake`, `model=fake-vector`, `dimensions=5`, `distance=cosine`, `enabled=true`
- Provider created through factory: yes
- Fake provider dimensions/distance: 5 / cosine
- Fixture workspace: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh` (ephemeral local temp directory)
- Eligible chunk ids submitted to provider: `chk_public`
- Restricted chunk ids skipped before provider call: `chk_restricted`
- Vectors path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vectors.jsonl`
- Manifest path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vector-manifest.json`
- Build report path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vector-build-report.json`
- Compatibility success evidence: `test/knowledge-vector.test.mjs` checks matching config returns `compatible`; later mismatches return `rebuild-required`.
- Provider/model/dimensions/distance mismatch evidence: `test/knowledge-vector.test.mjs` mutates provider, dimensions, and chunk text hash and checks `rebuild-required` with mismatch/stale reasons.
- Confirmed no raw restricted text in report/notes: yes, fake CLI fixture reported `restrictedTextInReport: false`.
- Confirmed no API key/header/cookie/bearer token/raw provider payload in report/notes: yes, no secrets are used in fake fixture and provider errors are redacted in unit tests.

## Provider Documentation Baseline From Spec Hardening

This section is a starting baseline, not a replacement for implementer verification. Re-check official docs before provider-specific coding.

| Provider | Official docs checked during hardening | Baseline finding | Implementation decision |
| --- | --- | --- | --- |
| MiniMax | `https://platform.minimaxi.com/docs/llms.txt`, `https://platform.minimaxi.com/docs/api-reference/api-overview`, `https://platform.minimaxi.com/docs/guides/rate-limits`, `https://platform.minimaxi.com/docs/api-reference/errorcode` | Current MiniMax official docs index/API overview did not expose an embedding-specific API page or embedding OpenAPI spec during this audit. | Do not implement real MiniMax HTTP calls from third-party SDK docs, old memory, or inferred OpenAI-compatible assumptions. Keep MiniMax as scaffold/unsupported/docs-required unless current official embedding docs are found or supplied. |
| Gemini | `https://ai.google.dev/gemini-api/docs/embeddings`, `https://ai.google.dev/api/embeddings` | Official docs describe Gemini embedding models, `embedContent`, `batchEmbedContents`, API key header, output dimensions/task behavior, and response embedding fields. | Gemini real adapter may proceed after implementer re-verifies current docs and records endpoint/auth/request/response/dimensions/batch/error behavior below. |
| Qwen / Alibaba Cloud Model Studio | `https://www.alibabacloud.com/help/en/model-studio/embedding` | Official docs describe Model Studio embedding models and OpenAI-compatible embedding calls. | Keep Qwen scaffold-only in this change unless the user explicitly expands scope and OpenSpec is updated first. |

## OpenSpec Apply Context

- Command used for apply context capture:

```bash
openspec instructions apply --change add-embedding-provider-adapters --json
```

- Summary of output: schema `spec-driven`; context files were proposal, design, spec, and tasks under `openspec/changes/add-embedding-provider-adapters`; previous task list had 337 remaining tasks and instructed checkpointed TDD implementation.
- Date/time captured: 2026-06-14
- Executor: Codex

## Provider Documentation Verification

### SiliconFlow

- Official docs URL: `https://api-docs.siliconflow.cn/docs/api/embeddings-post`, `https://api-docs.siliconflow.cn/docs/api/rerank-post`
- Access date: 2026-06-14
- Embeddings endpoint: `POST https://api.siliconflow.cn/v1/embeddings`
- Auth shape: `Authorization: Bearer <token>` header plus `Content-Type: application/json`
- Request body fields: `model`, `input`, optional `encoding_format`, optional `dimensions` for Qwen/Qwen3 series, optional `user`, optional `truncate`
- Response vector path: `data[].embedding`, indexed by `data[].index`; response model at `model`; usage at `usage`
- Dimensions behavior: Qwen/Qwen3 embedding series supports configured dimensions. Local smoke verified `Qwen/Qwen3-Embedding-0.6B` with `dimensions: 1024` returned a 1024-length vector.
- Batch limits: docs allow `input` as a string or array; model token limits vary by model. This implementation uses configurable `batchSize` and does not hard-code provider-wide maximums.
- Rerank endpoint: `POST https://api.siliconflow.cn/v1/rerank` with `model`, `query`, `documents`, optional `instruction`, `top_n`, `return_documents`, `max_chunks_per_doc`, `overlap_tokens`; documented for future extension only.
- Decision: implement real SiliconFlow embedding adapter; document rerank extension path only.
- Real smoke: passed sanitized official embeddings test with status 200, model `Qwen/Qwen3-Embedding-0.6B`, vector length 1024, prompt tokens 6.

### MiniMax

- Official docs URL: not re-expanded for implementation after user changed scope away from MiniMax.
- Access date: 2026-06-14
- Endpoint: not implemented in this change.
- Auth shape: not implemented in this change.
- Request body fields: not implemented in this change.
- Response vector path: not implemented in this change.
- Dimensions behavior: not implemented in this change.
- Batch limits: not implemented in this change.
- Retry/rate-limit guidance: not implemented in this change.
- Decision: scaffold only / OpenSpec update required for any future real adapter.
- If scaffold only, confirm `embedDocuments` and `embedQuery` fail safely without network: yes, `test/embedding.test.mjs` checks MiniMax returns `unsupported_provider` without calling fetch.
- If third-party docs were consulted, list them as non-authoritative clues only: none used for implementation.

### Gemini

- Official docs URL: baseline docs recorded above only; no real adapter implemented in this change.
- Access date: 2026-06-14
- Endpoint: not implemented in this change.
- Auth shape: not implemented in this change.
- Model naming: not implemented in this change.
- Request body fields: not implemented in this change.
- Response vector path: not implemented in this change.
- Task type / output dimension behavior: not implemented in this change.
- Batch limits: not implemented in this change.
- Retry/rate-limit guidance: not implemented in this change.
- Decision: scaffold only / OpenSpec update required for any future real adapter.

### Qwen

- Scope decision: scaffold only unless user explicitly expands scope.
- If scope changed, link to the OpenSpec update: not changed; Qwen stays unsupported scaffold.

## Red-Green Test Evidence

Record focused failing tests before implementation, then the passing command after implementation.

| Area | RED command and failure summary | GREEN command and pass summary |
| --- | --- | --- |
| Provider types/factory | `node --test test/embedding.test.mjs` failed before `siliconflow` factory/default config existed. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| MiniMax docs-gated scaffold | Test added expecting MiniMax to fail with `unsupported_provider` and no fetch; initially failed against older behavior expectations. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| Gemini scaffold | Test coverage confirms unsupported providers are explicit and do not silently fall back. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| Qwen unsupported scaffold | Test expects Qwen scaffold `embedQuery` to reject safely. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| Error redaction | Fake 429 response included a bearer-like secret in provider message; test asserted safe message must not include it. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| Metadata/fingerprint/dimensions | Dimension mismatch tests failed before SiliconFlow response validation and metadata helpers were complete. | `pnpm build && node --test test/embedding.test.mjs` passed. |
| Vector builder | `node --test test/knowledge-vector.test.mjs` failed because `buildKnowledgeVectorIndex` was missing. | `pnpm build && node --test test/knowledge-vector.test.mjs` passed. |
| Vector compatibility | Missing/mismatch/stale compatibility tests failed before manifest reader/checker existed. | `pnpm build && node --test test/knowledge-vector.test.mjs` passed. |
| CLI dispatch/output | CLI smoke tests failed before `embedding test`, `rerank test`, and `knowledge vector build` routing existed. | `pnpm build && node --test test/embedding.test.mjs test/knowledge-vector.test.mjs test/supper-helper.test.mjs` passed. |
| Security/privacy | Restricted-chunk test expected no restricted text in report; failed before remote-embedding eligibility filter. | `pnpm build && node --test test/knowledge-vector.test.mjs` passed; fake CLI fixture also confirmed `restrictedTextInReport=false`. |

## Debugging / Root Cause Notes

Use this section whenever provider docs, fake HTTP tests, dimensions, timeout, malformed response, vector artifacts, or compatibility checks fail.

| Issue | Evidence gathered | Root cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| EduSoho whitepaper direct-answer acceptance failed despite relevant hit | Acceptance showed relevant whitepaper evidence but Evidence Judge score remained too low because ambiguity penalty fired on generic terms. | Ambiguity penalty was too broad and punished otherwise answer-bearing whitepaper results. | Narrowed penalty in `src/runtime/evidence-judge.ts` to cases with too few matched terms, too few non-generic terms, or generic-term dominance. | `pnpm build && node --test test/judge-fixtures.test.mjs`; `node dist/cli.js accept knowledge ... --mock-worker` passed. |
| Reminder how-to query lost whitepaper evidence | Route source type selection filtered out answer-bearing whitepaper slices for reminder questions. | Taxonomy route did not include whitepaper/module docs for reminder wording. | Added reminder route handling in `src/knowledge/taxonomy.ts` and kept fallback search without source-type filter. | `pnpm build && node --test test/judge-fixtures.test.mjs`; HTTP direct-hit smoke passed. |
| Post-implementation review: partial SiliconFlow vector responses could look healthy | Review found `mapResponseVectors` did not require one vector per input and could silently accept partial `data[]`. | Response count and `data[].index` were not validated before writing vector records. | Added malformed-response checks for vector count, non-integer/out-of-range/duplicate indexes. | `pnpm build && node --test test/embedding.test.mjs` passed with partial-response regression. |
| Post-implementation review: non-JSON 5xx provider errors were classified as malformed | Review found provider HTTP failures with plain text/HTML bodies were parsed as JSON before status handling. | Non-OK responses used the strict JSON parser before HTTP status normalization. | Added lenient parse for non-OK embedding/rerank responses and mapped by status first. | `pnpm build && node --test test/embedding.test.mjs` passed with embedding/rerank non-JSON 503 regressions. |
| Post-implementation review: settings UI saved embedding/rerank as always enabled | Review found `readEmbeddingForm` and `readRerankForm` hard-coded `enabled: true`, so saving unrelated settings could enable remote providers. | UI lacked explicit enable checkboxes and reused the same payload for save and smoke test. | Added `启用 Embedding` / `启用 Rerank` checkboxes; save respects them, while test buttons force one explicit smoke call without saving. | `pnpm build && node --test --test-name-pattern "app exposes a model settings" test/supper-helper.test.mjs` passed. |

## Fake Smoke Test

- Command: `node dist/cli.js embedding test --home /tmp/super-helper-fake-smoke-home --enable --provider fake --model fake-embedding-v1 --dimensions 4`
- Provider: `fake`
- Model: `fake-embedding-v1`
- Dimensions: 4
- Distance: cosine
- Result: `embedding model ok`
- Duration: 0 ms
- Safe error, if any: none
- Confirmed no raw vector values printed: yes

## Fake Vector Build Fixture

- Command: temporary Node fixture invoking `node dist/cli.js knowledge vector build --workspace <tmp> --knowledge-root <tmp> --enable --provider fake --model fake-vector --dimensions 5`
- Fixture workspace: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh`
- Vectors path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vectors.jsonl`
- Manifest path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vector-manifest.json`
- Build report path: `/var/folders/qn/pjl1mzpn6pg0r9xl_0mj38j40000gn/T/super-helper-cli-vector-final-IhoRsh/knowledge/indexes/vector-build-report.json`
- Vector count: 1
- Skipped count: 1
- Failed count: 0
- Provider/model/dimensions/distance: `fake` / `fake-vector` / 5 / `cosine`
- Confirmed restricted chunks skipped without sending text: yes, unit test intercepts provider input and sees only `chk_public`.
- Confirmed report omits raw chunk text: yes, fake CLI fixture reported `restrictedTextInReport: false`.

## Real Provider Smoke Status

### SiliconFlow Embedding

- Run status: passed
- Command, if run: `SILICONFLOW_API_KEY=<from local .key shell only> node dist/cli.js embedding test --enable --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY --dimensions 1024`
- Provider/model/dimensions: `siliconflow` / `Qwen/Qwen3-Embedding-0.6B` / 1024
- Sanitized result: `embedding model ok`, duration about 176 ms, no raw vector printed.

### SiliconFlow Rerank

- Run status: passed
- Command, if run: `SILICONFLOW_API_KEY=<from local .key shell only> node dist/cli.js rerank test --enable --provider siliconflow --model BAAI/bge-reranker-v2-m3 --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY`
- Provider/model: `siliconflow` / `BAAI/bge-reranker-v2-m3`
- Sanitized result: `rerank model ok`, top score about `0.99915`, no raw documents or secret printed.

### SiliconFlow Knowledge Vector Build

- Run status: passed
- Command, if run: `SILICONFLOW_API_KEY=<from local .key shell only> node dist/cli.js knowledge vector build --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --enable --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --base-url https://api.siliconflow.cn/v1 --api-key-env SILICONFLOW_API_KEY --dimensions 1024 --batch-size 16 --timeout-ms 60000`
- Sanitized result: vectors 295, skipped 0, failed 0; manifest and report written under `/Users/king/.super-helper/knowledge/knowledge/indexes/`.

### MiniMax

- Run status: not run
- Command, if run: n/a
- Provider/model/dimensions: n/a
- Sanitized result: n/a
- If not run, reason: user changed scope; MiniMax does not currently have a verified implementation channel for this work.

### Gemini

- Run status: not run
- Command, if run: n/a
- Provider/model/dimensions: n/a
- Sanitized result: n/a
- If not run, reason: user does not currently have an integration channel; README documents future extension only.

### Qwen

- Run status: not run
- Command, if run: n/a
- Provider/model/dimensions: n/a
- Sanitized result: n/a
- If not run, reason: user does not currently have an integration channel; README documents future extension only.

## End-to-End Knowledge and Runtime Smoke

- Knowledge init command: `node dist/cli.js knowledge init --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --source-dir ~/Documents/knowledge`
- Init result: source docs 2 from CLI output; pipeline produced 382 draft parent slices; warnings only, no errors.
- Review/publish: approved and published source ids `src_1c0bc3610f76` and `src_7f73dea0a142` with `--quality-gate warn`.
- Knowledge update result: 295 formal active documents/chunks indexed.
- Search query: `AI伴学助手学习日晚上8点未完成任务会怎么提醒？`
- Search result: top hit `knowledge/whitepapers/ai-companion/src_1c0bc3610f76/8.md`, title `学习日晚上8点`.
- Acceptance command: `node dist/cli.js accept knowledge --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --mock-worker --report-dir /Users/king/.super-helper/knowledge/reports`
- Acceptance result: passed all scenarios; latest report `/Users/king/.super-helper/knowledge/reports/knowledge-acceptance-2026-06-14T16-06-56-249Z.json`.
- HTTP smoke result: temporary service with `claude.enabled=false` returned direct knowledge final answer for the reminder query and partial code-escalation response for `这个提醒功能在当前实现里是哪个 service 或 scheduler 触发的？`.
- HTTP direct-hit phases: `knowledge_router_started`, `knowledge_search_result`, `evidence_judge_result`, `knowledge_answer_selected`, `evidence_review_started`.
- HTTP deep-query phases: `knowledge_router_started`, `knowledge_search_result`, `evidence_judge_result`, `code_escalation_requested`, `evidence_review_started`.
- Deep Query request context: `permission=read_only`, `artifactTargets=[scheduler, service]`, evidence count 8, constraints include knowledge-insufficient/current-implementation read-only investigation hints.

## Security and Privacy Audit

- API keys absent from errors/logs/reports/CLI output: yes
- Bearer tokens/cookies/headers absent: yes
- Raw provider payloads absent or sanitized: yes
- Raw chunk text absent from vector reports: yes
- Raw vector values hidden by default: yes for CLI smoke/reports; `vectors.jsonl` intentionally stores vectors as the rebuildable vector artifact.
- Restricted chunks skipped by default for remote embedding: yes
- Local `.key` handling: used only to set `SILICONFLOW_API_KEY` in the current shell for manual smoke; never written into repo files or config.

## Compatibility Audit

- Provider mismatch behavior: `checkKnowledgeVectorCompatibility` returns `rebuild-required` with `provider` mismatch.
- Model mismatch behavior: returns `rebuild-required` with `model` mismatch.
- Dimensions mismatch behavior: provider response validation rejects vectors with unexpected length; manifest/config mismatch returns `rebuild-required`.
- Distance mismatch behavior: manifest/config mismatch returns `rebuild-required`.
- Text hash stale/rebuild behavior: changed chunk text hash returns `rebuild-required` with stale chunk ids.
- `embedding.enabled: false` keyword-only fallback: `embedding test` reports disabled without network; normal `knowledge update`, `knowledge search`, and runtime knowledge search do not call providers.

## Diff Boundary Audit

- Provider network code stayed in `src/embedding/`: yes (`siliconflow.ts`, `smoke-test.ts`, `rerank-smoke-test.ts`).
- Vector artifact code stayed in `src/knowledge/`: yes (`vector-index.ts`, paths/types exports).
- Config changes stayed in `src/config.ts` or narrow config helpers: yes.
- CLI only parsed/delegated: yes.
- No embedding business logic added to `src/runtime/`: yes.
- No embedding business logic added to `src/gateway/`: yes; settings routes call smoke helpers and serialize DTOs only.
- No embedding business logic added to `src/workers/`: yes.
- No product Agent prompt/config added outside `src/agents/`: yes.

## Verification Transcript Summary

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
node --test test/embedding.test.mjs
node --test test/knowledge-vector.test.mjs
openspec status --change add-embedding-provider-adapters --json
```

- `pnpm lint`: passed, docs lint reported core product/agent/architecture/roadmap terms covered.
- `pnpm typecheck`: passed, `tsc --noEmit`.
- `pnpm build`: passed, `tsc -p tsconfig.build.json`.
- `pnpm test`: passed, 135 tests, 135 pass, 0 fail.
- Focused embedding tests: `node --test test/embedding.test.mjs` passed, 10 tests.
- Focused knowledge vector tests: `node --test test/knowledge-vector.test.mjs` passed, 2 tests.
- Fake smoke: `node dist/cli.js embedding test --home /tmp/super-helper-fake-smoke-home --enable --provider fake --model fake-embedding-v1 --dimensions 4` passed.
- Fake vector build: temporary fixture passed with vectorCount 1, skipped 1, failed 0, restrictedTextInReport false.
- Knowledge acceptance: `node dist/cli.js accept knowledge --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --mock-worker --report-dir /Users/king/.super-helper/knowledge/reports` passed all scenarios.
- OpenSpec status: `openspec status --change add-embedding-provider-adapters --json` reported `isComplete: true` and all planning artifacts `done`.

## Deferred or Skipped Items

Every skipped item must include why it is safe to defer and what future change should own it.

| Item | Reason | Follow-up owner/change |
| --- | --- | --- |
| Runtime vector retrieval / hybrid RRF | Current change only proves provider adapter and vector artifact build; retrieval behavior remains keyword/frontmatter and Evidence Judge based. | Future retrieval-ranking OpenSpec change. |
| Runtime rerank sorting | User requested model correctness detection and extension reservation, not production rerank ranking. | Future rerank retrieval OpenSpec change. |
| Gemini real adapter | User does not currently have an integration channel and requested README extension guidance only. | Future provider-adapter OpenSpec change after official docs/access are confirmed. |
| Qwen real adapter | User does not currently have an integration channel and requested README extension guidance only. | Future provider-adapter OpenSpec change after official docs/access are confirmed. |
| MiniMax real adapter | Current MiniMax official docs were not sufficient for a real embedding/rerank adapter and user selected SiliconFlow. | Future provider-adapter OpenSpec change only after official current docs are recorded. |
