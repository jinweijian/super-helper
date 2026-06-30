# Implementation Notes

## Baseline

- Dependency changes completed: `complete-provider-retrieval-migration` 18/18 and `clean-knowledge-cli-compatibility-boundaries` 14/14.
- Baseline after phase 2: `pnpm test` passed 216 tests, 0 failed.
- Before extraction: `diagnostic-runtime.ts` is 696 lines; `settings/service.ts` is 374 lines.

## Red / Green Evidence

| Area | RED | GREEN |
| --- | --- | --- |
| Runtime composition root | Boundary test fails because the root is 696 lines before collaborator existence/import checks can pass. | Root is 143 lines, composes all eight required collaborators and has no knowledge/provider/path implementation imports. |
| Runtime behavior | Existing runtime/gateway suite passes 70/70 before extraction, including same-case ordering、sync/async、Deep Query、knowledge、review and event behavior. | Boundary + runtime/gateway suite passes 86/86 after extraction with the same behavior assertions. |
| Settings facade | Boundary test fails because the service is 374 lines before focused owner/facade checks can pass. | Facade is 19 lines of re-exports; contracts/public/secrets/model/provider/Claude owners all exist with no facade back-import. |
| Settings behavior | Existing settings API、secret storage/redaction and smoke behavior passes in the 70-test baseline. | Settings HTTP、secret persistence/redaction and model/provider smoke assertions remain green in the 86-test focused run. |

## Verification Evidence

| Gate | Command | Result |
| --- | --- | --- |
| OpenSpec | `openspec status --change decompose-runtime-settings-services --json` | Exit 0; proposal、design、specs and tasks are complete. |
| Lint | `pnpm lint` | Exit 0. |
| Typecheck | `pnpm typecheck` | Exit 0. |
| Build | `pnpm build` | Exit 0. |
| Focused tests | Runtime、settings、gateway、knowledge、retrieval、worker and boundary files | 133 passed, 0 failed. |
| Full tests | `pnpm test` | 218 passed, 0 failed. |

## Anti-Fake-Complete Audit

- `diagnostic-runtime.ts` imports、constructs and invokes queue、session、Preflight、experience、knowledge、worker、review and curation collaborators; the old private implementations are absent from the composition root.
- Source scans locate model Preflight only in `preflight-service.ts`, model review only in `review-presentation.ts`, secret application only in `settings/secrets.ts`, and public provider mapping only in `settings/public-view.ts`.
- Existing integration tests compare sync/async log phase sequences, assert ordered same-case reply association, exercise Deep Query pivot events, knowledge answer/escalation, review fallback and curation on production runtime paths.
- Gateway routes and DTO still import `settings/service.ts`; the facade has no function/interface/const implementation, implementation modules do not back-import it, and settings tests use local fake HTTP/fixtures without real credentials.

## Deviations And Remaining Risks

- `preflight-service.ts` is 151 lines and `review-presentation.ts` is 126 lines because each includes its existing model prompt and response mapping; their responsibilities remain singular and no further split would reduce ownership coupling.
- Runtime collaborators share the existing event recorder and file store by explicit constructor injection. This preserves event/persistence order but intentionally does not introduce narrower repository ports in this behavior-preserving change.
