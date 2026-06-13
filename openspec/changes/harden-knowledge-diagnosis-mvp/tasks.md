## 1. Planning and Guardrails

- [ ] 1.1 Read `openspec/changes/harden-knowledge-diagnosis-mvp/proposal.md`, `design.md`, `specs/knowledge-diagnosis-hardening/spec.md`, `docs/development-standards.md`, `docs/technical-architecture.md`, `docs/agent-design.md`, `src/agents/README.md`, and `src/agents/main.md` before coding; do not start implementation until module ownership is clear.
- [ ] 1.2 Confirm implementation scope excludes BM25, vector retrieval, hybrid/RRF, reranker, and GraphRAG; if a task appears to require those, update OpenSpec instead of implementing them.
- [ ] 1.3 Confirm no business decision is added to `src/gateway/`; gateway changes, if any, must only validate HTTP input, call runtime methods, and serialize DTOs.
- [ ] 1.4 Confirm no knowledge search, quality audit, or review workflow logic is added to `src/workers/` or `src/workers/claude/`; workers remain read-only diagnostic tools.
- [ ] 1.5 Confirm no product Agent prompt/config is added outside `src/agents/`; any Agent config change must update `src/agents/registry.json` and docs.
- [ ] 1.6 Capture the current `openspec instructions apply --change harden-knowledge-diagnosis-mvp --json` output in implementation notes so progress can be audited.

## 2. Documentation Baseline

- [ ] 2.1 Update `docs/technical-architecture.md` runtime pipeline to show current flow: Experience -> Preflight -> Knowledge Router/Search/Evidence Judge -> knowledge direct answer or Claude Code escalation -> Output Review -> Presentation -> optional Case Curator.
- [ ] 2.2 Remove or rewrite any `docs/technical-architecture.md` statement saying knowledge runtime integration is future-only; replace it with current implemented behavior and this change's hardening roadmap.
- [ ] 2.3 Update `docs/agent-design.md` `Knowledge-First Skeleton` section to describe the existing wired runtime stages, including Knowledge Router, Evidence Judge, Deep Query Planner, Query Correction, and Case Curator.
- [ ] 2.4 Add a documentation section for quality reports: expected path `knowledge/indexes/chunk-quality-report.json`, report fields, severity meanings, and default warn-vs-strict behavior.
- [ ] 2.5 Add a documentation section for live acceptance: command name, expected prerequisites, report output path, redaction guarantees, and how to interpret failures.
- [ ] 2.6 Add a documentation section for solved case review lifecycle: `review_required`, `active`, rejected/request-edits states, unresolved conversion, dirty flag behavior, and reviewer metadata.
- [ ] 2.7 Run `pnpm lint` after documentation-only edits and fix doc lint failures before coding further.

## 3. Quality Report Type Contract

- [ ] 3.1 Add `src/knowledge/quality.ts` or equivalent module owned by `src/knowledge/`; it must not import runtime, gateway, worker, or model modules.
- [ ] 3.2 Define `KnowledgeQualitySeverity = 'info' | 'warn' | 'error'` in `src/knowledge/types.ts` or `quality.ts`.
- [ ] 3.3 Define `KnowledgeQualityIssueCode` enum/string union with at least `empty_body`, `heading_only`, `toc_like`, `too_short`, `too_long`, `duplicate_content`, `missing_source_document`, `missing_source_document_id`, `missing_section_path`, `missing_parent`, `orphan_chunk`, and `low_signal_terms`.
- [ ] 3.4 Define `KnowledgeQualityIssue` with fields: `code`, `severity`, `message`, `documentId?`, `chunkId?`, `source?`, `sourceDocument?`, `sectionPath?`, `contentHash?`, `details?`.
- [ ] 3.5 Define `KnowledgeQualityThresholds` with defaults: minimum meaningful body characters, maximum parent slice characters, duplicate normalized hash policy, minimum related term count, and toc-like detection thresholds.
- [ ] 3.6 Define `KnowledgeQualityReport` with fields: `version: 1`, `workspaceRoot`, `knowledgeRoot`, `generatedAt`, `thresholds`, `inspected`, `severityCounts`, `issueCounts`, `issues`, `recommendedActions`, and `gate`.
- [ ] 3.7 Export quality report types from `src/knowledge/index.ts` so tests and future runtime integration can import them through the knowledge public surface.
- [ ] 3.8 Add `qualityReportPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/indexes/chunk-quality-report.json`.

## 4. Quality Audit Implementation

- [ ] 4.1 Implement `auditKnowledgeQuality({ workspaceRoot, thresholds?, gate? })` in `src/knowledge/quality.ts`; it must load discovered Markdown documents and derived chunks using existing knowledge module helpers.
- [ ] 4.2 Implement meaningful body extraction that strips YAML frontmatter, Markdown headings, boilerplate sections such as `## 可回答的问题` and `## 原文来源`, list-only source references, and repeated title-only lines before measuring content.
- [ ] 4.3 Implement `empty_body`: emit `warn` when meaningful body is empty after boilerplate stripping.
- [ ] 4.4 Implement `heading_only`: emit `warn` when meaningful content contains only headings or near-identical title repetitions.
- [ ] 4.5 Implement `toc_like`: emit `warn` when a slice contains many short lines, repeated numbering, high heading/list density, or words such as `目录` with little explanatory prose.
- [ ] 4.6 Implement `too_short`: emit `warn` when meaningful body length is below the configured minimum and source type is not glossary/module overview.
- [ ] 4.7 Implement `too_long`: emit `warn` when parent slice body exceeds the configured maximum and should be split further.
- [ ] 4.8 Implement `low_signal_terms`: emit `info` or `warn` when `related_terms`, title, and headings provide too few searchable business terms.
- [ ] 4.9 Implement duplicate detection by normalizing meaningful body text, hashing it, grouping identical or near-identical hashes, and emitting `duplicate_content` for all affected slices except the first canonical member.
- [ ] 4.10 Implement provenance checks: emit `error` if a whitepaper slice lacks `source_document` or `source_document_id`; emit `warn` if `section_path` is missing or empty.
- [ ] 4.11 Implement chunk-parent checks: emit `error` when `chunks.jsonl` contains a chunk whose `parent_id` cannot be found among parsed parent slice documents.
- [ ] 4.12 Implement parent-without-chunk checks: emit `warn` when an active parent slice has no derived chunk after index generation.
- [ ] 4.13 Implement issue aggregation so `severityCounts` and `issueCounts` are deterministic and sorted.
- [ ] 4.14 Implement recommended actions, for example: re-run ingest, review duplicate slices, merge title-only slices, add provenance, or convert low-quality slices to draft.
- [ ] 4.15 Ensure `auditKnowledgeQuality` never mutates Markdown source files; it only reads knowledge files and writes the report when explicitly asked.

## 5. Quality Report Persistence and CLI Output

- [ ] 5.1 Implement `writeKnowledgeQualityReport({ workspaceRoot, report })` and ensure `knowledge/indexes/` is created before writing.
- [ ] 5.2 Implement `readKnowledgeQualityReport(workspaceRoot)` returning `undefined` when the report is absent or malformed; malformed reports must not crash normal search.
- [ ] 5.3 Add `--quality-gate warn|strict|off` option to `knowledge init`; default must be `warn`.
- [ ] 5.4 Add `--quality-gate warn|strict|off` option to `knowledge update`; default must be `warn`.
- [ ] 5.5 Wire `knowledge init` so after source ingest and index update it runs quality audit unless `--quality-gate off` is provided.
- [ ] 5.6 Wire `knowledge update` so after rebuilding manifest/chunks it runs quality audit unless `--quality-gate off` is provided.
- [ ] 5.7 CLI output must include quality report path, total issue count, error/warn/info counts, and top issue codes.
- [ ] 5.8 Strict gate behavior: if any `error` issue exists and gate is `strict`, command exits non-zero after writing the report and printing a short remediation message.
- [ ] 5.9 Warn gate behavior: warnings/errors must be visible in output, but command exits zero unless existing ingest/update fails.
- [ ] 5.10 Off gate behavior: quality audit is skipped and output must explicitly say quality audit was skipped.
- [ ] 5.11 Add npm script if needed, for example `knowledge:audit`, only if it maps to the same CLI implementation and does not duplicate logic.

## 6. Quality-Aware Search and Evidence

- [ ] 6.1 Extend knowledge search internals to optionally load `chunk-quality-report.json` and map issue codes by document id and chunk id.
- [ ] 6.2 Add optional quality metadata to `KnowledgeEvidenceResult`, for example `quality?: { severity: 'ok' | 'info' | 'warn' | 'error'; issues: [...] }`, without breaking existing callers.
- [ ] 6.3 Ensure evidence with `error` quality issues is excluded from direct-answer candidates or clearly marked as non-answerable for Evidence Judge.
- [ ] 6.4 Ensure evidence with `warn` quality issues can still appear in evidence packs but lowers Evidence Judge confidence.
- [ ] 6.5 Add tests proving search does not crash when quality report is missing, stale, or malformed.

## 7. Quality Audit Test Fixtures

- [ ] 7.1 Add fixture Markdown document with empty body and assert `empty_body` issue.
- [ ] 7.2 Add fixture Markdown document with headings only and assert `heading_only` issue.
- [ ] 7.3 Add fixture Markdown document that resembles a table of contents and assert `toc_like` issue.
- [ ] 7.4 Add fixture pair with duplicate normalized body and assert `duplicate_content` issue on both affected paths.
- [ ] 7.5 Add fixture whitepaper slice without `source_document` and assert `missing_source_document` error.
- [ ] 7.6 Add fixture whitepaper slice without `source_document_id` and assert `missing_source_document_id` error.
- [ ] 7.7 Add fixture chunk with unknown `parent_id` in `chunks.jsonl` and assert `orphan_chunk` error.
- [ ] 7.8 Add CLI test for warn gate: command exits zero and writes report.
- [ ] 7.9 Add CLI test for strict gate: command exits non-zero when error issue exists and report still exists.
- [ ] 7.10 Add regression test against the real-style DOCX ingest fixture to ensure quality audit returns deterministic issue counts.

## 8. Evidence Judge Type and Contract Changes

- [ ] 8.1 Extend `EvidenceJudgeResult` in `src/runtime/evidence-judge.ts` with `score_breakdown`, `rationale`, `blockers`, `ambiguity`, and `quality_issues` fields; keep existing fields backward compatible.
- [ ] 8.2 Define `EvidenceJudgeScoreBreakdown` with numeric components: `relevance`, `coverage`, `source_authority`, `freshness`, `version_match`, `agreement`, `actionability`, `conflict_penalty`, `ambiguity_penalty`, `risk_penalty`, and `quality_penalty`.
- [ ] 8.3 Define blocker codes such as `generic_keyword_only`, `low_quality_evidence`, `module_mismatch`, `stale_knowledge`, `conflicting_knowledge`, `high_risk_uncertainty`, `implementation_detail`, and `missing_answer_bearing_sentence`.
- [ ] 8.4 Ensure existing `answer_score` remains a number between 0 and 1 and is computed from the breakdown in a deterministic function.
- [ ] 8.5 Update `DiagnosticRequest.context.knowledge.judge` type in `src/domain.ts` to include new optional judge fields without requiring migration of existing case JSON.
- [ ] 8.6 Update log serialization to include new fields but avoid dumping overly large evidence excerpts.

## 9. Evidence Judge Scoring and Blockers

- [ ] 9.1 Implement relevance scoring that uses matched term count, title match, related term match, and module alias match; generic terms alone must cap relevance below direct-answer threshold.
- [ ] 9.2 Implement coverage scoring that favors FAQ/runbook/whitepaper slices with answer-bearing content and penalizes glossary-only or module-overview-only hits for troubleshooting questions.
- [ ] 9.3 Implement source authority scoring using source type, document confidence, status, and whether the document is active.
- [ ] 9.4 Implement freshness scoring using `last_verified_at` and optional `review_cycle_days`; invalid dates must be treated as stale.
- [ ] 9.5 Implement version match scoring with current behavior: empty `product_versions` is neutral, explicit non-match is a penalty, explicit match is a boost.
- [ ] 9.6 Implement agreement scoring by comparing top evidence module/intent/status and detecting active-vs-deprecated/archive/review_required conflicts.
- [ ] 9.7 Implement actionability scoring: evidence with concrete steps, rules, conditions, or answer sentences scores higher than generic description.
- [ ] 9.8 Implement ambiguity penalty for generic keyword-only hits, multi-module hits without clear alias, or top scores too close across unrelated modules.
- [ ] 9.9 Implement quality penalty using quality report metadata from evidence results.
- [ ] 9.10 Implement high-risk override: payment, permission, security, production incident, and data repair with unresolved blockers must require code or human escalation.
- [ ] 9.11 Preserve must-escalate behavior for logs, errors, table names, class names, endpoint paths, config keys, file paths, current project/codebase signals, and follow-up references.

## 10. Answer-Bearing Evidence and Claim Boundaries

- [ ] 10.1 Implement helper to detect answer-bearing sentences in evidence excerpts, looking for product rules, conditions, steps, outcomes, or direct explanation phrases; keep it deterministic and language-aware for Chinese.
- [ ] 10.2 If no answer-bearing sentence exists in top evidence, add blocker `missing_answer_bearing_sentence` and prevent direct answer.
- [ ] 10.3 Update `diagnosticResultFromKnowledge` in `src/runtime/diagnostic-runtime.ts` or extract helper so knowledge-derived facts only use accepted evidence ids.
- [ ] 10.4 Unsupported knowledge-derived fact claims must be downgraded to inference, assumption, or unknown before Output Review.
- [ ] 10.5 Missing version, tenant, environment, current implementation, stale source, and quality uncertainty must remain visible in `missingInfo` or unknown claims.
- [ ] 10.6 Add final reply regression test that evidence sources remain visible and unsupported facts do not appear as facts.

## 11. Evidence Judge Tests

- [ ] 11.1 Add direct FAQ success test with high score and no blockers.
- [ ] 11.2 Add direct runbook success test with high score and no blockers.
- [ ] 11.3 Add direct whitepaper success test where excerpt contains an answer-bearing rule sentence.
- [ ] 11.4 Add generic keyword false-positive test where terms like `课程` and `功能` alone cannot direct answer.
- [ ] 11.5 Add module mismatch test where query alias points to one module but top evidence is from another module.
- [ ] 11.6 Add low-quality evidence test where top hit has `error` or severe `warn` quality issues.
- [ ] 11.7 Add stale evidence test using old `last_verified_at` or expired review cycle.
- [ ] 11.8 Add conflict test with active and deprecated/review_required evidence for the same module/intent.
- [ ] 11.9 Add high-risk uncertainty test for payment, permission, security, production incident, or data repair.
- [ ] 11.10 Add implementation-detail escalation test for endpoint, file path, config key, and current project/codebase language.
- [ ] 11.11 Run focused tests: `pnpm build && node --test test/knowledge.test.mjs test/supper-helper.test.mjs`.

## 12. Deep Query Context Type Changes

- [ ] 12.1 Extend `DiagnosticRequestContext.deepQuery` in `src/domain.ts` with optional `attempt`, `maxAttempts`, `triedQueries`, `failedReasons`, `nextPivot`, `stopReason`, and `previousArtifactTargets`.
- [ ] 12.2 Update `src/runtime/deep-query-planner.ts` `DeepQueryPlan` to include the same fields with deterministic defaults.
- [ ] 12.3 Ensure `attachDeepQueryContext` appends attempt data without erasing existing `context.recentMessages` or `context.previousRuns`.
- [ ] 12.4 Add type-safe helper to summarize a worker result into failed reasons, for example `missing_current_implementation`, `no_matching_route`, `only_generic_evidence`, or `needs_user_runtime_context`.
- [ ] 12.5 Keep serialized context bounded: cap arrays such as `anchorTerms`, `likelyPaths`, `triedQueries`, and `failedReasons`.

## 13. Query Correction Pivot Engine

- [ ] 13.1 Replace or extend `src/runtime/query-correction.ts` with a pure function `nextDeepQueryPivot(input)` that accepts previous plan, worker result, judge result, and attempt number.
- [ ] 13.2 Implement scheduler pivot: scheduler/job/cron/task targets pivot to queue, callback, state_machine, or state update when no scheduler evidence is found.
- [ ] 13.3 Implement route pivot: route/router/controller targets pivot to controller, service, repository, config, or feature flag when endpoint is found but cause is missing.
- [ ] 13.4 Implement payment pivot: payment/order/refund targets pivot to permission, audit log, transaction state, and config when direct payment evidence is insufficient.
- [ ] 13.5 Implement permission pivot: auth/role/permission targets pivot to tenant scope, policy, middleware, and role mapping.
- [ ] 13.6 Implement config pivot: env/settings/config targets pivot to admin UI, feature flag, default config, and runtime loader.
- [ ] 13.7 Implement no-hit pivot: alias expansion, neighboring modules, broader source types, and static workspace search.
- [ ] 13.8 Implement stop decision when no new artifact target would be produced or max attempts is reached.
- [ ] 13.9 Add unit tests for every pivot family and for deterministic ordering of output artifact targets.

## 14. Runtime Deep Query Retry Loop

- [ ] 14.1 Update `src/runtime/diagnostic-runtime.ts` so retry logic remains inside runtime orchestration and does not move into workers.
- [ ] 14.2 Reuse existing follow-up request creation where possible; if new helper is needed, add it to `src/runtime/request-builder.ts`.
- [ ] 14.3 Allow at most one additional worker run by default when first worker result is partial or Output Review returns `continue_diagnosis`, and correction actions remain.
- [ ] 14.4 Preserve `claudeSessionId` across retry attempts.
- [ ] 14.5 Preserve same-case serialization by using the existing case turn queue; do not introduce parallel worker runs inside one case.
- [ ] 14.6 Ensure every retry request includes read-only constraints and existing allowed MCP tool ids.
- [ ] 14.7 Add stop conditions for `max_attempts`, high-risk human escalation, user-required runtime context, worker failure, or no new pivot.
- [ ] 14.8 Ensure retry failures produce a reviewed partial/escalate result, not an uncaught exception.
- [ ] 14.9 Add runtime tests for retry success, retry stop, high-risk stop, worker failure stop, and preservation of prior messages/evidence context.

## 15. Deep Query Observability

- [ ] 15.1 Add event recorder methods in `src/runtime/event-recorder.ts` for `deep_query_retry_requested`, `deep_query_pivot_selected`, and `deep_query_stopped`.
- [ ] 15.2 Events must include attempt number, max attempts, previous artifact targets, next artifact targets, failed reasons, correction actions, and stop reason.
- [ ] 15.3 Add labels in `src/observability/log-blocks.ts` for deep query retry and stop phases.
- [ ] 15.4 Update session `agentActivity` derivation if necessary so retry activity appears without breaking existing DTO shape.
- [ ] 15.5 Add observability tests proving logs API returns retry events with stable shape.

## 16. Live Acceptance Command Shape

- [ ] 16.1 Choose command shape and document it before implementation; preferred shape is `node dist/cli.js accept knowledge --workspace <path>` plus npm alias `accept:knowledge`.
- [ ] 16.2 Add CLI command parsing under `src/cli.ts` without mixing acceptance scenario logic into the parser; parser should call an acceptance module.
- [ ] 16.3 Add `src/runtime/acceptance.ts` or `src/knowledge/acceptance.ts` only if ownership is clear; runtime behavior scenarios belong in runtime, static knowledge checks belong in knowledge.
- [ ] 16.4 Acceptance command options must include `--workspace`, `--report-dir`, `--mock-worker`, `--real-worker`, `--timeout-ms`, and `--redact`.
- [ ] 16.5 Default mode must avoid surprising paid calls; if real model/Claude Code calls are used, command output must state that clearly before executing.

## 17. Live Acceptance Config Checks

- [ ] 17.1 Verify active workspace exists and matches requested `--workspace`.
- [ ] 17.2 Verify `knowledge/` exists and contains `indexes/ingest-report.json`, `manifest.json`, and `chunks.jsonl`.
- [ ] 17.3 Verify `ingest-report.json` reports at least two source documents for the current whitepaper setup when run against `/Users/king/my/super-helper`.
- [ ] 17.4 Verify config has an active model provider or can auto-activate the single provider; report provider name but never API key.
- [ ] 17.5 Verify Claude command is configured and executable when real-worker mode is requested.
- [ ] 17.6 Verify Claude worker policy is read-only: allowed tools include only configured read tools and disallowed write tools remain blocked.
- [ ] 17.7 Report config check failures as structured acceptance failures, not thrown stack traces.

## 18. Live Acceptance Scenarios

- [ ] 18.1 Implement direct whitepaper answer scenario using question `AI伴学助手学习日晚上8点未完成任务会怎么提醒？`; expected behavior: decision final, zero worker calls in mock mode, evidence kind `knowledge`, source contains AI companion whitepaper.
- [ ] 18.2 Implement EduSoho whitepaper search scenario using question `EduSoho 教培线课程搜索栏支持按什么搜索课程？`; expected behavior: knowledge evidence from EduSoho training whitepaper.
- [ ] 18.3 Implement no-hit escalation scenario using a unique token plus file/path signal; expected behavior: zero knowledge evidence, code escalation required, correction actions include `expand_aliases` or `broaden_source_types`.
- [ ] 18.4 Implement implementation-detail escalation scenario using endpoint/config/file path language; expected behavior: Evidence Judge requires code escalation and deepQuery permission is `read_only`.
- [ ] 18.5 Implement solved-case curation smoke scenario in mock mode; expected behavior: confirmation message generates review-required draft and dirty flag.
- [ ] 18.6 Each scenario must produce pass/fail, reason, relevant case id, run id, evidence ids, worker call count, and log phases.
- [ ] 18.7 Scenario runner must clean up temporary case storage unless `--keep-cases` is provided.

## 19. Acceptance Report and Redaction

- [ ] 19.1 Define `KnowledgeAcceptanceReport` type with version, generatedAt, workspaceRoot, config summary, scenarios, failures, redaction summary, and environment summary.
- [ ] 19.2 Write report to `reports/knowledge-acceptance-<timestamp>.json` by default, creating the directory if needed.
- [ ] 19.3 Implement redaction helper that replaces API keys, bearer tokens, cookies, known secret field values, and long credential-like strings with `[REDACTED]`.
- [ ] 19.4 Ensure report never includes raw model request/response payloads, raw Claude stdout with secrets, full env, or full config.
- [ ] 19.5 Add tests that redaction catches `apiKey`, `Authorization`, `Bearer ...`, `cookie`, `token`, and nested secret fields.
- [ ] 19.6 Add tests for acceptance report shape in mock mode without external network calls.
- [ ] 19.7 Add documentation for interpreting acceptance reports and safely sharing them.

## 20. Solved Case Review Metadata Contract

- [ ] 20.1 Extend knowledge frontmatter parsing to tolerate optional review fields without requiring them: `reviewer`, `reviewed_at`, `review_notes`, `review_status`, `review_action`, and `review_source`.
- [ ] 20.2 Define `KnowledgeCaseReviewAction = 'approve' | 'reject' | 'request_edits' | 'convert_to_unresolved'`.
- [ ] 20.3 Define `KnowledgeCaseReviewRecord` with document id, action, reviewer, reviewedAt, notes, previousStatus, nextStatus, sourcePath, targetPath, and createdAt.
- [ ] 20.4 Decide and document sidecar naming: `<solved-case-basename>.review.json` next to the Markdown file.
- [ ] 20.5 Ensure old solved case Markdown without review fields still parses and searches.

## 21. Knowledge-Layer Case Review Helpers

- [ ] 21.1 Add `src/knowledge/case-review.ts` or equivalent, owned by knowledge module.
- [ ] 21.2 Implement `loadSolvedCaseDraft({ workspaceRoot, pathOrId })` that validates the target is under `knowledge/tickets/solved-cases/`.
- [ ] 21.3 Implement safe frontmatter update helper preserving body content and existing required fields.
- [ ] 21.4 Implement `approveSolvedCase` that sets `status: active`, writes reviewer metadata, writes sidecar review record, and marks dirty flag.
- [ ] 21.5 Implement `rejectSolvedCase` that keeps or sets `status: review_required`, writes rejection notes and sidecar record, and marks dirty flag.
- [ ] 21.6 Implement `requestSolvedCaseEdits` that keeps `review_required`, records requested edits, writes sidecar record, and marks dirty flag.
- [ ] 21.7 Implement `convertSolvedToUnresolved` that writes content under `knowledge/tickets/unresolved-cases/<module-id>/`, changes `type` and `source_type` to `unresolved_case`, preserves evidence sections, and marks dirty flag.
- [ ] 21.8 All file writes must stay inside `knowledge/`; reject path traversal and external absolute target paths.
- [ ] 21.9 Add tests for path safety, frontmatter preservation, old file compatibility, dirty flag, and sidecar record content.

## 22. Runtime and Optional Gateway Case Review

- [ ] 22.1 Add runtime orchestration method for case review actions, for example `reviewSolvedCase(input)`, that calls knowledge helpers and records events.
- [ ] 22.2 Runtime method must validate reviewer string, action, target document, and notes before calling knowledge helper.
- [ ] 22.3 Runtime must not require loading or mutating persisted case JSON to approve an existing solved case file.
- [ ] 22.4 Add event recorder methods for `case_review_started`, `case_review_result`, and `case_review_failed`.
- [ ] 22.5 Add observability labels for case review events.
- [ ] 22.6 If adding HTTP API, place route in `src/gateway/routes/` and DTO in `src/gateway/dto.ts`; route must call runtime method and not mutate files directly.
- [ ] 22.7 If adding HTTP API, add compatibility tests proving existing public response shapes are unchanged.
- [ ] 22.8 Add tests for approve, reject, request edits, convert unresolved, review failure, restricted visibility preservation, and logging.

## 23. Integration With Search and Indexing

- [ ] 23.1 After approve action, ensure next `knowledge update` includes the active solved case in searchable documents.
- [ ] 23.2 Before approve action, ensure `review_required` solved case does not justify high-confidence direct answers by itself.
- [ ] 23.3 After reject/request edits, ensure solved case remains non-high-confidence evidence.
- [ ] 23.4 After convert-to-unresolved, ensure unresolved case can appear as low-confidence context but not direct-answer evidence.
- [ ] 23.5 Add tests for search behavior across review state transitions.

## 24. Documentation for Implementation Consumers

- [ ] 24.1 Add implementation notes inside `openspec/changes/harden-knowledge-diagnosis-mvp/design.md` if coding reveals a design gap; do not silently diverge from the design.
- [ ] 24.2 Update `retrieval-research-plan.md` only if implementation discovers constraints that affect future BM25/vector/hybrid research.
- [ ] 24.3 Add final implementation notes listing quality baseline counts for the real imported whitepapers.
- [ ] 24.4 Add final implementation notes listing acceptance command output path and pass/fail summary.
- [ ] 24.5 Add final implementation notes listing any skipped tasks and why.

## 25. Final Compatibility and Verification

- [ ] 25.1 Add or update tests that existing `/api/chat` response shape remains compatible.
- [ ] 25.2 Add or update tests that existing `/api/session` and `/api/sessions` response shapes remain compatible.
- [ ] 25.3 Add or update tests that existing `/api/settings` and `/api/logs` response shapes remain compatible.
- [ ] 25.4 Add tests that existing case JSON files remain readable without destructive migration.
- [ ] 25.5 Add tests that runtime falls back to Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation when `knowledge/` is absent.
- [ ] 25.6 Add tests that hardening disabled mode, if implemented, preserves current MVP behavior.
- [ ] 25.7 Run `pnpm lint`.
- [ ] 25.8 Run `pnpm typecheck`.
- [ ] 25.9 Run `pnpm build`.
- [ ] 25.10 Run `pnpm test`.
- [ ] 25.11 Run the real local acceptance command if available; if not run, document why and what risk remains.
- [ ] 25.12 Review git diff to confirm module ownership boundaries: knowledge data logic in `src/knowledge/`, orchestration in `src/runtime/`, transport in `src/gateway/`, tools in `src/workers/`, docs in `docs/`, Agent configs in `src/agents/`, log rendering in `src/observability/`.
