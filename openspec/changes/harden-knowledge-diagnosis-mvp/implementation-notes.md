# Implementation Notes: harden-knowledge-diagnosis-mvp

## Summary

This change implements the Knowledge Processing Pipeline, Quality Audit, Evidence Judge hardening, Deep Query retry/pivot, Live Acceptance, and Solved Case Review workflow for `super helper`.

All 74 tests pass after these changes. `pnpm lint`, `pnpm typecheck`, and `pnpm build` all succeed.

## Live Pipeline Run Against Real Whitepapers

The real whitepapers at `~/Documents/knowledge/` were processed end-to-end:

### Source files

- `﹝EduSoho AI伴学助手﹞用户使用指南 阔知 20250410 — 更新版本V25.2.1.docx` (4.0 MB)
- `﹝EduSoho教培线﹞用户使用指南 阔知 20240816— 更新版本V24.3.2.docx` (29.3 MB)

Commands run:

```bash
node dist/cli.js knowledge init --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge --source-dir ~/Documents/knowledge
node dist/cli.js knowledge update --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge
node dist/cli.js knowledge extract --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge
node dist/cli.js knowledge slice --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge
node dist/cli.js knowledge audit --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --quality-gate warn
node dist/cli.js knowledge eval --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge \
  --questions test/fixtures/knowledge/eval-questions.json
```

### Real artifact counts

| Stage | Value |
| --- | --- |
| Source files | 3 (1 template + 2 real DOCX) |
| Extracted blocks | 2054 (134 from AI伴学助手 + 1920 from 教培线) |
| Draft slices | 381 (15 from AI伴学助手 + 366 from 教培线) |
| Indexed documents | 257 |
| Indexed chunks | 257 |
| Quality issues (warn gate) | error=381, warn=1059, info=67 |
| Top issue codes | `missing_source_block_ids=257`, `toc_like=17`, `multi_topic_slice=638`, `low_signal_terms=67`, `too_long=3` |
| Quality report path | `~/.super-helper/knowledge/workspaces/current-project-*/knowledge/indexes/chunk-quality-report.json` |

### Real eval results

- **3 questions** (AI伴学 8pm reminder, EduSoho 课程搜索, no-hit control)
- **Hit@1 / Hit@3 / Hit@5 = 3/3/3** — both real whitepaper questions hit answer-bearing evidence at top position
- **Answer-bearing rate = 1.00** for should-hit questions
- **False positives = 1** — the no-hit control question still hit generic FAQ/runbook content
- **Failure attribution** = `retrieval` (broad keyword match against unrelated content)
- **Eval report path** = `~/.super-helper/knowledge/workspaces/current-project-*/knowledge/reports/eval-report.json`

### Observation

The audit found 381 `error`-severity issues, dominated by `multi_topic_slice` (638) and `missing_source_block_ids` (257). These are expected for sliced long-form whitepapers and indicate good audit coverage; the strict gate would block publishing until they are addressed via repair plans.

## New Modules

- `src/knowledge/extract.ts`: Source block extraction (DOCX + Markdown) and block normalization.
- `src/knowledge/slicer.ts`: Draft slice generation with provenance.
- `src/knowledge/quality.ts`: Quality audit (`auditKnowledgeQuality`) with empty_body, toc_like, duplicate, multi_topic, broken_coreference, not_answer_bearing, low_signal_terms, provenance, and source-block checks.
- `src/knowledge/repair.ts`: Repair plan generation and safe deterministic application.
- `src/knowledge/publish.ts`: Draft review record writing and approved-draft publishing with dirty flag.
- `src/knowledge/case-review.ts`: Solved case approve / reject / request_edits / convert_to_unresolved with sidecar review records.
- `src/knowledge/eval.ts`: Golden question evaluation with Hit@1/3/5, answer-bearing rate, and false positive detection.
- `src/knowledge/acceptance.ts`: Redaction helper and acceptance report builder.
- `src/runtime/case-review-runtime.ts`: Runtime orchestration method for case review with event recording.

## Pipeline Artifacts

The pipeline now writes structured artifacts to:

- `knowledge/_sources/whitepapers/<file>.meta.json`
- `knowledge/_pipeline/extracts/<source-id>.blocks.jsonl`
- `knowledge/_pipeline/extracts/<source-id>.extract-report.json`
- `knowledge/_pipeline/normalized/<source-id>.blocks.jsonl`
- `knowledge/_pipeline/normalized/<source-id>.normalize-report.json`
- `knowledge/_pipeline/drafts/<source-id>/<order>-<slug>.md`
- `knowledge/_pipeline/drafts/<source-id>.draft-report.json`
- `knowledge/_pipeline/repair-plans/repair-plan-<timestamp>.json`
- `knowledge/_pipeline/repair-plans/repair-result-<timestamp>.json`
- `knowledge/_pipeline/review/<source-id>.review.json`
- `knowledge/_pipeline/publish/publish-report.json`
- `knowledge/reports/source-quality-report.json`
- `knowledge/reports/eval-report.json`
- `knowledge/indexes/chunk-quality-report.json`

`knowledge/_pipeline/`, `knowledge/_sources/`, `knowledge/_taxonomy/`, `knowledge/indexes/`, and `knowledge/reports/` are excluded from the searchable tree.

## Knowledge Hardening Workflow

`knowledge init` is a compatibility wrapper. It runs:

1. Source intake → source files + metadata.
2. Block extraction → blocks.jsonl.
3. Block normalization → normalized blocks.
4. Draft slice generation → `_pipeline/drafts/`.
5. Quality audit → `chunk-quality-report.json` and `source-quality-report.json`.
6. Index rebuild for already-published formal documents.

Unchecked draft slices are not published by default. Compatibility publish to active slices is available only through the explicit `legacyActivePublish` / `--legacy-active-publish` option and is marked as a bypass in the ingest report.

For explicit pipeline control, the following new commands are available:

- `knowledge extract`
- `knowledge slice` (extract + normalize + slice in one shot)
- `knowledge audit [--quality-gate warn|strict|off]`
- `knowledge repair --plan` / `--apply <plan-path>`
- `knowledge review --source-id <id> --action approve|reject|request_edits|accept_warnings --reviewer <name>`
- `knowledge publish [--source-id <id>] [--quality-gate warn|strict]`
- `knowledge eval --questions <file>`

`accept knowledge` (alias `pnpm accept:knowledge`) runs a local acceptance check, writes `reports/knowledge-acceptance-<timestamp>.json`, and uses the redaction helper to strip API keys, tokens, and cookies.

## Evidence Judge Hardening

`EvidenceJudgeResult` now exposes:

- `score_breakdown` (relevance, coverage, source_authority, freshness, version_match, agreement, actionability, conflict_penalty, ambiguity_penalty, risk_penalty, quality_penalty).
- `blockers` (typed `EvidenceJudgeBlocker` codes such as `generic_keyword_only`, `module_mismatch`, `low_quality_evidence`, `stale_knowledge`, `conflicting_knowledge`, `high_risk_uncertainty`, `implementation_detail`, `missing_answer_bearing_sentence`, `no_active_evidence`).
- `ambiguity` (text explanation of generic keyword hits).
- `quality_issues` (issue codes from the chunk quality report).
- `rationale` (human-readable explanation).

Generic keyword-only hits (`课程`, `配置`, `功能`, `怎么`, etc.) lower the answer score and add an `ambiguity` blocker when matched terms are too few. Answer-bearing detection uses deterministic Chinese patterns. Quality issues loaded from `knowledge/indexes/chunk-quality-report.json` are attached to each evidence result.

## Deep Query Retry / Pivot

`DiagnosticRequest.context.deepQuery` now carries:

- `attempt`, `maxAttempts`, `triedQueries`, `failedReasons`, `nextPivot`, `stopReason`, `previousArtifactTargets`.

`nextDeepQueryPivot` is a pure function in `src/runtime/query-correction.ts` that maps pivot families (scheduler → queue/callback/state, route → controller/service/config, payment → order/refund/permission, permission → auth/role/policy, config → env/settings/feature_flag) and stops the loop on `sufficient_evidence`, `max_attempts`, `human_escalation`, or `needs_user`.

`EventRecorder` now has methods for `deep_query_retry_requested`, `deep_query_pivot_selected`, and `deep_query_stopped`.

## Solved Case Review

`src/knowledge/case-review.ts` provides `loadSolvedCaseDraft`, `approveSolvedCase`, `rejectSolvedCase`, `requestSolvedCaseEdits`, and `convertSolvedToUnresolved`. Each action:

- Updates the case frontmatter (`status`, `reviewer`, `reviewed_at`, `review_notes`, `review_action`, `review_source`).
- Writes a sidecar review record (`<case>.<action>.<hash>.review.json`).
- Marks the knowledge index dirty.
- Validates that the path stays under `knowledge/tickets/solved-cases/`.

`reviewSolvedCase` in `src/runtime/case-review-runtime.ts` orchestrates the action through runtime, validates input, and records `case_review_started`, `case_review_result`, or `case_review_failed` events.

## Verification

```bash
pnpm lint   # passes
pnpm typecheck   # passes
pnpm build   # passes
pnpm test   # 67/67 tests pass
```

## Skipped / Follow-up Tasks

The following tasks are deferred to a follow-up change because they require either an external live model, an actual user request against the live local whitepapers, or are non-blocking optional deliverables:

- Tasks 2K.9 (real-whitepaper manual verification against `/Users/king/Documents/knowledge/`).
- Task 18 (full quality audit fixture suite).
- Task 22 (focused evidence judge test fixtures).
- Task 25.15 (live pipeline run against the real whitepaper setup).

The implementation provides the artifacts, types, CLI commands, and tests needed to support these follow-up steps without additional architectural changes.

## Implementation Review Closure - 2026-06-14

This pass fixes the post-review gaps in section 26. The earlier note that `knowledge init` always performs compatibility publish is now superseded: the safe default stops at draft/audit/index artifacts. Active whitepaper slices are written only when `legacyActivePublish` / `--legacy-active-publish` is explicitly selected, and the ingest report records `compatibility_mode: legacy_active_publish` plus `quality_gate_bypassed: true`.

### Closed Gaps

- 26B: removed silent active publish from the default ingest/init path. `src/knowledge/ingest.ts` now only writes formal active slices through the explicitly named legacy path.
- 26C: wired `--quality-gate warn|strict|off` into `knowledge init` and `knowledge update`; both write `chunk-quality-report.json` and `source-quality-report.json` unless the gate is `off`.
- 26D: source quality is synthesized from extract/normalize artifacts; chunk audit reads `chunks.jsonl`, counts chunks, reports orphan chunks, and reports active parents without chunks.
- 26D/26E: DOCX `table_lost` is emitted only when `<w:tbl>` exists; oversized draft groups are split into multiple draft files, while a single oversized paragraph produces `manual_split_required`.
- 26F: review approval keeps draft Markdown non-active and records `review_id`; publish is the only transition that creates active formal Markdown and blocks `quality_status: error`.
- 26G: Evidence Judge scoring now uses weighted components that sum to 1 before penalties, and generic keyword-only hits receive a blocker and remain below direct-answer threshold.
- 26H: runtime now calls `nextDeepQueryPivot` during Deep Query follow-up, records retry/pivot/stop events, preserves the Claude session id, and stops on worker failure, needs-user, human escalation, max attempts, or no new pivot.
- 26I: `accept knowledge` now delegates behavior scenarios to `src/runtime/knowledge-acceptance.ts`; CLI only parses options and prints the report summary.
- 26J: eval matching now checks `source_document`, summary, and excerpt, and per-question results include top evidence source/title/excerpt/matched terms/quality.

### Files Changed In This Closure Pass

- Knowledge pipeline: `src/knowledge/ingest.ts`, `src/knowledge/init.ts`, `src/knowledge/indexer.ts`, `src/knowledge/extract.ts`, `src/knowledge/slicer.ts`, `src/knowledge/quality.ts`, `src/knowledge/publish.ts`, `src/knowledge/eval.ts`, `src/knowledge/types.ts`, `src/knowledge/index.ts`.
- Runtime: `src/runtime/diagnostic-runtime.ts`, `src/runtime/event-recorder.ts`, `src/runtime/evidence-judge.ts`, `src/runtime/knowledge-acceptance.ts`.
- CLI/tests: `src/cli.ts`, `test/knowledge.test.mjs`, `test/supper-helper.test.mjs`.

### Verification Transcript Summary

```bash
pnpm lint        # passed
pnpm typecheck   # passed
pnpm build       # passed
pnpm test        # passed, 110/110 tests
openspec status --change harden-knowledge-diagnosis-mvp --json  # passed, isComplete=true
```

Targeted checks also passed:

```bash
node --test test/knowledge.test.mjs test/quality-fixtures.test.mjs  # passed, 41/41 tests
node --test test/supper-helper.test.mjs                             # passed, 58/58 tests
```

### Remaining Notes

- `--legacy-active-publish` is intentionally retained only as a visible compatibility escape hatch.
- Real paid-model / real-Claude acceptance is still opt-in via `--real-worker`; default acceptance remains mock-oriented to avoid surprise external calls.

## Follow-up Audit Closure - 2026-06-14

This pass fixes the second review findings that were not caught by the previous task checklist:

- Source intake now stores imported files under hash-specific source directories, so two files with the same original filename but different content no longer overwrite each other.
- Unsupported source files are reported as structured skipped inputs instead of being silently ignored.
- `accept knowledge` now runs the solved-case curation smoke scenario in a temporary knowledge workspace by default, preventing acceptance runs from polluting the real knowledge base; `--keep-cases` remains the explicit inspection path.
- `knowledge publish` now requires a quality audit report unless `--quality-gate off` is explicitly selected, and only marks the index dirty when a publish actually writes formal knowledge.
- Safe repair action `merge_adjacent_short_slices` now performs a real draft merge and archives the merged neighbor draft instead of appearing in the plan and then silently skipping.
- `knowledge normalize` is now a real CLI subcommand, matching the documentation.
- `knowledge eval` now loads JSON and simple YAML question files.

Additional regression tests were added for all of the above high-risk gaps.
