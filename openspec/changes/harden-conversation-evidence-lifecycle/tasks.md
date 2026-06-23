## 1. Conversation Semantics RED Evidence

- [x] 1.1 Add RED tests proving `不清楚` currently replaces knowledge search text, user hypotheses enter known facts, and downstream stages receive different effective queries.
- [x] 1.2 Add RED tests proving Experience can run before safety preflight, can attach the latest unrelated run evidence, and lacks tenant/user/freshness/quality revalidation.
- [x] 1.3 Add RED tests proving nonexistent evidence IDs pass shallow review, model outcome can promote partial to final, and worker stdout/stderr can reach main chat.

## 2. Resolved Turn Context

- [x] 2.1 Add optional domain types for resolved query, confirmed facts with source IDs, user claims, hypotheses, unknowns, and follow-up metadata; old case JSON must load unchanged.
- [x] 2.2 Implement runtime-owned local resolved-turn builder and model/local reconciliation that may downgrade but never promote unsupported hypotheses to facts.
- [x] 2.3 Make Knowledge Router, Retrieval, Deep Query, DiagnosticRequest userGoal, and Worker consume the same resolved query while preserving raw latest message for UI/audit.
- [x] 2.4 Extend bounded context tests for long conversations, source message identity, same-case follow-up, and tenant/user/workspace isolation.

## 3. Validated Experience Reuse

- [x] 3.1 Move Experience after safety/permission/resolved-query Preflight without changing Curator ownership or same-case turn serialization.
- [x] 3.2 Bind reusable history to the answered user message, helper reply, and specific source run/evidence instead of case latest result; unattributable replies must not auto-reuse.
- [x] 3.3 Revalidate history by tenant, user, workspace, persona/visibility, status, freshness, quality, and current strict review; failed history remains context and normal diagnosis continues.

## 4. Deterministic Review And Presentation

- [x] 4.1 Implement pure DiagnosticResult validation for unique evidence IDs, existing claim references, fact confidence, unsupported fact downgrade/rejection, and observable validation issues.
- [x] 4.2 Freeze review outcome before Presentation and remove model authority to return/promote outcome; add compatibility fallback for malformed presentation responses.
- [x] 4.3 Restrict Presentation output to accepted claim/evidence IDs and render final factual text from accepted claims; persona may change order/labels but not facts or outcome.
- [x] 4.4 Replace raw worker failure replies with safe category/state/next-action/case-run summaries; keep bounded redacted stdout/stderr only in diagnostic logs.

## 5. Agent Registry, API Compatibility, And Docs

- [x] 5.1 Add optional Agent `executionMode` metadata for deterministic, model-assisted, and presentation-only stages; update `/api/agents` compatibility tests and UI/docs without removing existing fields.
- [x] 5.2 Update main/input-review/experience/output-review/presentation Agent configs plus architecture docs to match the implemented resolved context, frozen review, and raw-output boundary.
- [x] 5.3 Run focused session/runtime/worker/gateway compatibility tests and prove persisted legacy cases and public responses remain readable/compatible.

## 6. Anti-Fake-Complete Audit And Completion Gates

- [x] 6.1 Trace real sync/async turns and prove all stages share resolved query, history uses the correct run, rejected claims stay out of replies, model cannot promote outcome, and raw worker output never appears in main chat; audit module boundaries and feed gaps back into artifacts.
- [x] 6.2 Record RED/GREEN, isolation, privacy, compatibility, fallback, and default-network evidence in `implementation-notes.md`; do not substitute mock-only assertions for runtime path tests.
- [x] 6.3 Run `openspec validate harden-conversation-evidence-lifecycle --strict`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`; all required gates must pass before completion.
