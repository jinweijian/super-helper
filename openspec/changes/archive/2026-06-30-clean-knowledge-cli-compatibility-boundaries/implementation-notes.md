# Implementation Notes

## Baseline

- Dependency change: `complete-provider-retrieval-migration` completed 18/18.
- Baseline after phase 1: `pnpm test` passed 209 tests, 0 failed.

## Red / Green Evidence

| Area | RED | GREEN |
| --- | --- | --- |
| Knowledge boundary | `node --test test/module-boundaries.test.mjs` failed on 484-line indexer and embedded provider/ranking responsibilities; an audit RED also found a provider-shaped vector port. | Indexer is 14 lines; discovery/chunks/build are focused; vector builder consumes `src/contracts/embedding.ts`; knowledge/quality tests pass. |
| Keyword compatibility | Boundary test failed on keyword strategy importing knowledge indexer; compatibility test failed because `retrieval/compatibility-search.js` did not exist. | Keyword strategy imports retrieval compatibility directly and old/new output deep-equality test passes. |
| CLI decomposition | Structure RED failed on 398-line dispatcher and missing handler directory; existing/new CLI behavior tests passed 7/7 as baseline. | Dispatcher is 13 lines; context/output/workspace/pipeline/vector handlers exist; CLI tests pass 7/7 unchanged. |
| Legacy provider imports | Source audit failed with 8 real production offenders in CLI/config/model-smoke/onboarding. | Production import scan passes after direct provider migration; legacy tests still use the facade. |

## Verification Evidence

| Gate | Command | Result |
| --- | --- | --- |
| OpenSpec | `openspec status --change clean-knowledge-cli-compatibility-boundaries --json` | Exit 0; proposal、design、specs and tasks are complete. |
| Lint | `pnpm lint` | Exit 0. |
| Typecheck | `pnpm typecheck` | Exit 0. |
| Build | `pnpm build` | Exit 0. |
| Focused tests | Knowledge、retrieval、CLI、onboarding、boundary and HTTP/runtime compatibility files | 180 passed, 0 failed. |
| Full tests | `pnpm test` | 216 passed, 0 failed. |

## Anti-Fake-Complete Audit

- `knowledge/indexer.ts` is 14 lines and contains only compatibility re-exports; `command-knowledge.ts` is a 13-line dispatcher. Full implementations live in the new owner directories.
- Keyword scoring、filtering、ranking and evidence conversion occur only in `retrieval/compatibility-search.ts`; keyword strategy imports that module directly. A deep-equality test proves the legacy export reaches the same implementation.
- The production-source scan finds no imports from `src/embedding/` outside the compatibility directory itself; provider adapters do not import the old facade.
- CLI handlers delegate to knowledge/provider services, and representative success、validation、disabled-vector and unknown-command outputs/exits remain covered. Tests use fake providers/fixtures and no real credentials or network calls.

## Deviations And Remaining Risks

- `command-pipeline.ts` remains 181 lines because it is one cohesive CLI adapter over the existing pipeline stages; the public dispatcher and shared parsing/output responsibilities are separated.
- Legacy knowledge and embedding entry points remain intentionally available as compatibility re-exports. Boundary tests prevent production code from adopting them again.
