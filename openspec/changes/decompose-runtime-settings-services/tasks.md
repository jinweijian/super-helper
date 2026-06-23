## 1. Red Tests

- [x] 1.1 Add runtime boundary RED tests for the 300-line composition root, required collaborator modules, forbidden knowledge/provider/path ownership and real imports/delegation.
- [x] 1.2 Add settings boundary RED tests for the 120-line facade, required owner modules, no facade back-import and preserved public exports.
- [x] 1.3 Record behavior baselines for same-case queue、sync/async pipeline、Deep Query retry、event phases and settings HTTP/secret behavior before extraction.

## 2. Settings Decomposition

- [x] 2.1 Extract request and secret-store contracts to `settings/contracts.ts`, plus secret application/configured-secret helpers to `settings/secrets.ts`.
- [x] 2.2 Extract config/public/agent response mapping to `settings/public-view.ts` without changing fields or redaction.
- [x] 2.3 Extract model update/test/mapping to `settings/model-settings.ts` and embedding/rerank update/test/mapping to `settings/provider-settings.ts`.
- [x] 2.4 Extract Claude mutation to `settings/claude-settings.ts` and reduce `settings/service.ts` to compatibility re-exports at or below 120 lines.

## 3. Runtime Foundations

- [x] 3.1 Extract same-case serialization to `runtime/turn-queue.ts`, preserving ordered execution、failure isolation and cleanup.
- [x] 3.2 Extract case load/create/start/failure/pending-reply behavior to `runtime/session-lifecycle.ts`.
- [x] 3.3 Extract local/model decision and reconciliation to `runtime/preflight-service.ts`.
- [x] 3.4 Extract Evidence Review/model presentation to `runtime/review-presentation.ts` with unchanged fallback.

## 4. Runtime Turn Services

- [x] 4.1 Extract prior-case reuse to `runtime/experience-turn.ts` and resolution curation to `runtime/case-curation-service.ts`.
- [x] 4.2 Extract knowledge diagnosis/escalation to `runtime/knowledge-turn.ts`; composition root must no longer import knowledge path/index helpers.
- [x] 4.3 Extract worker dispatch、trace、one follow-up and Deep Query pivot to `runtime/worker-diagnosis.ts`.
- [x] 4.4 Reduce `runtime/diagnostic-runtime.ts` to composition/orchestration at or below 300 lines while preserving constructor and public methods.

## 5. Anti-Fake-Complete Audit / 回头重新思考

- [x] 5.1 Prove each new runtime collaborator is reached by production `DiagnosticRuntime`, old full implementations are removed and event/order behavior is covered beyond mocks.
- [x] 5.2 Prove settings facade contains no implementation, gateway still imports it, secret/public mappings have one owner and tests remain offline/secret-safe.

## 6. Verification

- [x] 6.1 Record RED/GREEN/audit evidence; run OpenSpec status、`pnpm lint`、`pnpm typecheck` and `pnpm build`.
- [x] 6.2 Run focused runtime/settings/gateway/knowledge/worker tests and `pnpm test`; all must pass before the final all-stage audit.
