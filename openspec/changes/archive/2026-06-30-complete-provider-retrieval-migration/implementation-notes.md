# Implementation Notes

## Baseline

- Upstream revision: `1178f33`
- Baseline command: `pnpm test`
- Baseline result: 201 passed, 0 failed on 2026-06-22.

## Provider Documentation

- Prior verified official sources: `https://api-docs.siliconflow.cn/docs/api/embeddings-post`, `https://api-docs.siliconflow.cn/docs/api/rerank-post`.
- Prior verified access date: 2026-06-14 in `add-embedding-provider-adapters/implementation-notes.md`.
- Recheck on 2026-06-22: blocked by Cloudflare HTTP 403.
- Decision: move the already tested endpoint/auth/request/response mapping without adding fields; no Gemini/MiniMax/Qwen real protocol is implemented.

## Red / Green Evidence

| Area | RED command and expected failure | GREEN command and result |
| --- | --- | --- |
| Provider ownership | `node --test test/module-boundaries.test.mjs` failed with reverse imports from factory/fake/SiliconFlow and implementation declarations under `src/embedding/`. | `pnpm typecheck`, `pnpm build`, and `node --test test/embedding.test.mjs test/providers.test.mjs` passed; boundary test now passes provider ownership and compatibility-only checks. |
| Configured retrieval | `node --test test/module-boundaries.test.mjs` failed on `searchKnowledge`/`legacy-rag`; `node --test test/retrieval.test.mjs` failed because `createConfiguredRetrievalService` was absent. | `node --test test/retrieval.test.mjs test/module-boundaries.test.mjs` passed with BM25 disabled-provider, hybrid fake, invalid provider and production composition scenarios. |
| Stale vector fallback | With compatibility check temporarily removed, `node --test --test-name-pattern "stale vector artifacts" test/retrieval.test.mjs` failed because embedding trace was `ran`. | After restoring manifest/source hash compatibility enforcement, `node --test test/retrieval.test.mjs` passed 9/9. |
| Rerank fallback | `node --test test/retrieval.test.mjs` preserved the candidate but failed because trace contained `sk-rerank-secret`. | Retrieval now redacts strategy/rerank failure reasons; focused retrieval tests pass. |
| Compatibility imports | Boundary RED exposed reverse imports and implementation-bearing legacy files. | `test/embedding.test.mjs`, `test/providers.test.mjs`, `test/knowledge-vector.test.mjs`, `test/knowledge.test.mjs`, `test/retrieval.test.mjs`, `test/module-boundaries.test.mjs` and `test/supper-helper.test.mjs` pass after migration. |

## Verification Evidence

| Gate | Command | Result |
| --- | --- | --- |
| OpenSpec | `openspec status --change complete-provider-retrieval-migration --json` | exit 0; proposal/design/specs/tasks all done. |
| Docs lint | `pnpm lint` | exit 0; docs lint passed. |
| Typecheck | `pnpm typecheck` | exit 0. |
| Build | `pnpm build` | exit 0. |
| Focused tests | `node --test test/embedding.test.mjs test/providers.test.mjs test/retrieval.test.mjs test/module-boundaries.test.mjs test/knowledge-vector.test.mjs test/knowledge.test.mjs test/supper-helper.test.mjs` | 136 passed, 0 failed. |
| Full tests | `pnpm test` | 209 passed, 0 failed. |

## Real Opt-In Status

- SiliconFlow embedding smoke: not run by default; requires explicit `SILICONFLOW_API_KEY` opt-in.
- SiliconFlow rerank smoke: not run by default; requires explicit `SILICONFLOW_API_KEY` opt-in.
- No real credential or raw provider payload may be recorded here.

## Anti-Fake-Complete Audit

- `rg` found no provider import of the legacy embedding facade; all old embedding files contain only re-exports/type exports.
- `configured-search.ts` imports registry/service directly and contains no `searchKnowledge` or `legacy-rag` shortcut. `legacy-rag.ts` selects compatibility options through the shared registry and does not construct concrete recall strategies.
- Configured production tests exercise disabled providers, fake hybrid fusion, invalid provider fallback and stale vector fallback. Runtime focused tests exercise the real configured search handoff.
- Strategy/rerank errors use shared redaction. Existing fake-fetch tests cover missing credentials, 429, non-JSON 503, malformed vectors and dimension mismatch; stale source hash has a dedicated retrieval regression.
- Default tests use fake provider/fake fetch. Real SiliconFlow smoke was not run because this refactor does not require credentials and the user did not explicitly opt in.
- Public HTTP/config/case/artifact shapes were not changed; no migration is required.

## Deviations And Remaining Risks

- SiliconFlow official docs recheck was blocked by Cloudflare 403 on 2026-06-22; implementation preserves the protocol verified on 2026-06-14 and adds no fields.
- Production callers outside providers still using the old embedding compatibility import are intentionally handled by the next sequential change.
