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
- [ ] 2.7 Add a documentation section for the knowledge processing pipeline: intake -> extract -> normalize -> draft slice -> audit -> repair -> review -> publish -> index -> eval.
- [ ] 2.8 Document every pipeline artifact path: `_sources`, `_pipeline/extracts`, `_pipeline/normalized`, `_pipeline/drafts`, `_pipeline/repair-plans`, `_pipeline/review`, `_pipeline/publish`, `indexes`, and `reports`.
- [ ] 2.9 Document that one-shot `knowledge init` is a compatibility wrapper and must still leave intermediate artifacts for review and re-run.
- [ ] 2.10 Document that only published/active formal knowledge documents can support high-confidence direct answers; draft/review/error/rejected artifacts cannot.
- [ ] 2.11 Run `pnpm lint` after documentation-only edits and fix doc lint failures before coding further.

## 2A. Pipeline Directory and Path Contracts

- [ ] 2A.1 Update `src/knowledge/paths.ts` to add `pipelineRoot(workspaceRoot)`, returning `knowledge/_pipeline`.
- [ ] 2A.2 Add `pipelineExtractsRoot(workspaceRoot)` returning `knowledge/_pipeline/extracts`.
- [ ] 2A.3 Add `pipelineNormalizedRoot(workspaceRoot)` returning `knowledge/_pipeline/normalized`.
- [ ] 2A.4 Add `pipelineDraftsRoot(workspaceRoot)` returning `knowledge/_pipeline/drafts`.
- [ ] 2A.5 Add `pipelineRepairPlansRoot(workspaceRoot)` returning `knowledge/_pipeline/repair-plans`.
- [ ] 2A.6 Add `pipelineReviewRoot(workspaceRoot)` returning `knowledge/_pipeline/review`.
- [ ] 2A.7 Add `pipelinePublishRoot(workspaceRoot)` returning `knowledge/_pipeline/publish`.
- [ ] 2A.8 Add `knowledgeReportsRoot(workspaceRoot)` returning `knowledge/reports`.
- [ ] 2A.9 Add path helpers for source-specific files: `sourceBlocksPath(workspaceRoot, sourceDocumentId)`, `sourceExtractReportPath(...)`, `normalizedBlocksPath(...)`, and `sourceDraftRoot(...)`.
- [ ] 2A.10 Add path helpers for reports: `sourceQualityReportPath(workspaceRoot)`, `publishReportPath(workspaceRoot)`, `knowledgeEvalReportPath(workspaceRoot)`, and timestamped `repairPlanPath(workspaceRoot, timestamp)`.
- [ ] 2A.11 Update `src/knowledge/templates.ts` `KNOWLEDGE_DIRECTORIES` so `knowledge init` creates `_pipeline/extracts`, `_pipeline/normalized`, `_pipeline/drafts`, `_pipeline/repair-plans`, `_pipeline/review`, `_pipeline/publish`, and `reports`.
- [ ] 2A.12 Keep `src/knowledge/indexer.ts` `shouldSkipMarkdown` excluding `_pipeline/`, `_sources/`, `_taxonomy/`, and `indexes/`; add tests if needed so draft Markdown is never indexed.
- [ ] 2A.13 Add a path safety helper in `src/knowledge/paths.ts` or a new `src/knowledge/path-safety.ts` that verifies every write target stays under `knowledge/`.
- [ ] 2A.14 Export all new path helpers through `src/knowledge/index.ts` only if tests or CLI need them; avoid leaking internal helpers unnecessarily.

## 2B. Pipeline Type Contracts

- [ ] 2B.1 Extend `src/knowledge/types.ts` with `KnowledgePipelineStage = 'intake' | 'extract' | 'normalize' | 'slice' | 'audit' | 'repair' | 'review' | 'publish' | 'index' | 'eval'`.
- [ ] 2B.2 Add `KnowledgePipelineStatus = 'imported' | 'extracted' | 'normalized' | 'draft' | 'quality_warn' | 'quality_error' | 'review_required' | 'approved' | 'rejected' | 'published'`.
- [ ] 2B.3 Add `KnowledgeSourceBlockType = 'heading' | 'paragraph' | 'list_item' | 'table' | 'toc' | 'header_footer' | 'image_caption' | 'unknown'`.
- [ ] 2B.4 Add `KnowledgeSourceBlock` with fields `block_id`, `source_document_id`, `order`, `type`, `text`, `heading_level?`, `section_path`, `raw?`, `parser?`, and `metadata?`.
- [ ] 2B.5 Add `KnowledgeNormalizedBlock` with fields `block_id`, `source_document_id`, `order`, `type`, `text`, `normalized_text`, `section_path`, `included_in_slice`, `excluded_reason?`, and `source_block_id`.
- [ ] 2B.6 Extend `KnowledgeFrontmatter` with optional `quality_status`, `source_block_ids`, `pipeline_stage`, `pipeline_status`, `review_id`, `publish_id`, and `repair_plan_ids`; all fields must be optional to preserve old Markdown compatibility.
- [ ] 2B.7 Add `KnowledgeExtractReport` with version, sourceDocumentId, generatedAt, parserStrategy, blockCounts, unknownBlockCount, skippedTocCount, warnings, errors, and fatal flag.
- [ ] 2B.8 Add `KnowledgeNormalizeReport` with sourceDocumentId, inputBlockCount, outputBlockCount, excludedBlockCounts, headingStructureWarnings, and generatedAt.
- [ ] 2B.9 Add `KnowledgeDraftSliceReport` with sourceDocumentId, draftSliceCount, draftPaths, sourceBlockCoverage, warnings, and generatedAt.
- [ ] 2B.10 Add `KnowledgeRepairActionType` including `merge_adjacent_short_slices`, `split_oversized_slice`, `remove_duplicate_draft`, `add_section_path`, `add_related_terms`, `mark_review_required`, `mark_quality_error`, and `manual_review_required`.
- [ ] 2B.11 Add `KnowledgeRepairPlan` with version, planId, generatedAt, sourceReportPaths, qualityReportPath, actions, summary, and safetySummary.
- [ ] 2B.12 Add `KnowledgeRepairAction` with actionId, issueIds, actionType, targetPaths, targetIds, beforeSummary, afterSummary, safety, requiresHumanReview, and details.
- [ ] 2B.13 Add `KnowledgeRepairResult` with planId, appliedActions, skippedActions, changedFiles, previousHashes, newHashes, rollbackNotes, and generatedAt.
- [ ] 2B.14 Add `KnowledgeSliceReviewRecord` for draft slice review with reviewId, sourceDocumentId, reviewer, action, notes, reviewedIds, previousStatuses, nextStatuses, qualityIssueIds, and reviewedAt.
- [ ] 2B.15 Add `KnowledgePublishReport` with publishId, generatedAt, publishedIds, rejectedIds, warningOverrides, sourceDocumentIds, outputPaths, and indexDirty.
- [ ] 2B.16 Add `KnowledgeEvalQuestion` with id, question, shouldHit, expectedDocument?, expectedSection?, expectedKeywords?, expectedSourceType?, and expectedEscalation?.
- [ ] 2B.17 Add `KnowledgeEvalReport` with generatedAt, questionCount, hitAt1, hitAt3, hitAt5, answerBearingRate, falsePositiveCount, escalationResults, failures, and perQuestion results.
- [ ] 2B.18 Export stable public types from `src/knowledge/index.ts`; keep deeply internal implementation-only types unexported.

## 2C. Source Intake Refactor

- [ ] 2C.1 In `src/knowledge/ingest.ts`, split `ingestOneSource` into `intakeSourceDocument`, `extractSourceBlocks`, `normalizeSourceBlocks`, `buildDraftSlices`, and `publishDraftSlices` or equivalent helpers.
- [ ] 2C.2 Keep `ingestSourceDocuments` public API compatible while internally calling the new pipeline functions.
- [ ] 2C.3 Implement `intakeSourceDocument({ workspaceRoot, sourcePath, force })` so it copies the source file, computes sha256, infers sourceDocumentId, writes source metadata, and returns a typed source intake result.
- [ ] 2C.4 Extend source metadata JSON with `original_path`, `stored_path`, `pipeline_status: imported`, `parser`, `imported_at`, and `source_kind`; keep existing fields so old ingest reports remain understandable.
- [ ] 2C.5 Ensure source ids stay deterministic by keeping the existing sha256-based id strategy unless a collision is detected.
- [ ] 2C.6 When `force` is false and a source file already exists with the same hash, reuse existing source metadata and do not duplicate source files.
- [ ] 2C.7 When the same filename has different content, keep deterministic behavior by source hash, not filename alone.
- [ ] 2C.8 Add a structured skip result when a source extension is unsupported; do not throw raw parser exceptions to the CLI.
- [ ] 2C.9 Update `KnowledgeIngestReport.imported[]` to optionally include pipeline artifact paths: sourceMetaPath, blocksPath, normalizedBlocksPath, draftRoot, publishReportPath.
- [ ] 2C.10 Add tests for id stability, duplicate source handling, changed file handling, unsupported file skip, and metadata field compatibility.

## 2D. Source Block Extraction

- [ ] 2D.1 Move existing DOCX paragraph parsing logic from `parseDocx` into a new extraction helper in `src/knowledge/ingest.ts` or `src/knowledge/extract.ts`.
- [ ] 2D.2 Change extraction output from `ParsedParagraph[]` to `KnowledgeSourceBlock[]`; preserve heading level and section path.
- [ ] 2D.3 For DOCX styles with TOC names, emit block type `toc` or skip with extract-report count; choose one approach and document it in design notes.
- [ ] 2D.4 Preserve list-like paragraphs as `list_item` when the text or DOCX paragraph style clearly indicates list numbering/bullets; otherwise keep as `paragraph`.
- [ ] 2D.5 Detect repeated document titles, page headers, and likely footers as `header_footer` when they recur with low content variety.
- [ ] 2D.6 If table XML extraction is not implemented in this round, detect table presence from DOCX XML and add an extract warning `table_lost`; do not pretend table structure is preserved.
- [ ] 2D.7 For Markdown sources, parse headings into `heading` blocks and non-empty text into paragraph/list blocks.
- [ ] 2D.8 Generate deterministic `block_id` values such as `blk_<source-id>_<order padded>`; do not use random ids.
- [ ] 2D.9 Write `blocks.jsonl` using one valid JSON object per line and stable ordering by source order.
- [ ] 2D.10 Write `extract-report.json` after every extraction, including zero-block and parser-warning cases.
- [ ] 2D.11 Add `readSourceBlocks(workspaceRoot, sourceDocumentId)` and `writeSourceBlocks(...)` helpers in `src/knowledge/extract.ts` or `src/knowledge/pipeline-storage.ts`.
- [ ] 2D.12 Add tests for DOCX heading extraction, Markdown heading extraction, TOC detection, zero-block report, deterministic block ids, and JSONL read/write round trip.

## 2E. Block Normalization

- [ ] 2E.1 Add `src/knowledge/normalize.ts` or a similarly owned knowledge module; it must not import runtime, gateway, worker, or model code.
- [ ] 2E.2 Implement `normalizeSourceBlocks({ workspaceRoot, sourceDocumentId, blocks })` returning normalized blocks and a normalize report.
- [ ] 2E.3 Strip empty text, repeated whitespace, hidden control characters, and Markdown-only boilerplate from normalized text.
- [ ] 2E.4 Preserve original `block_id` through `source_block_id`; do not lose source provenance when changing text.
- [ ] 2E.5 Build and attach `section_path` by walking heading blocks; paragraph/list/table blocks inherit the nearest heading path.
- [ ] 2E.6 Label TOC/header/footer/navigation-only blocks with `included_in_slice: false` and an `excluded_reason`.
- [ ] 2E.7 Detect title-only repetitions and exclude them when they do not add business content.
- [ ] 2E.8 Keep excluded blocks in normalized output for audit visibility; slicing should skip them by `included_in_slice`.
- [ ] 2E.9 Write normalized blocks to `knowledge/_pipeline/normalized/<source-id>.blocks.jsonl`.
- [ ] 2E.10 Write a normalize report with excluded counts and heading structure warnings.
- [ ] 2E.11 Add tests for heading inheritance, TOC exclusion, repeated title exclusion, whitespace cleanup, provenance preservation, and JSONL round trip.

## 2F. Draft Slice Generation

- [ ] 2F.1 Add `src/knowledge/slicer.ts` or refactor `buildParentSlices` into a dedicated knowledge slicer module.
- [ ] 2F.2 Implement `buildDraftSlices({ workspaceRoot, sourceDocumentId, normalizedBlocks, thresholds? })` returning draft slice descriptors and report.
- [ ] 2F.3 Generate draft slice Markdown under `knowledge/_pipeline/drafts/<source-id>/`, not under `knowledge/whitepapers/`.
- [ ] 2F.4 Draft frontmatter must set `status: draft`, `quality_status: unchecked`, `pipeline_stage: slice`, `pipeline_status: draft`, `source_document_id`, `source_document`, `source_block_ids`, `section_path`, `chunking_strategy`, and `related_terms`.
- [ ] 2F.5 Draft body must include inherited heading context and a `## 核心内容` section; avoid adding generic boilerplate that can dominate retrieval.
- [ ] 2F.6 Preserve source block order and record the first/last block id in draft metadata or report.
- [ ] 2F.7 Keep parent slice target size configurable; default can retain current approximate 2800 character parent maximum until tuned.
- [ ] 2F.8 Split on heading boundaries first, then list/table boundaries, then size thresholds; do not split in the middle of a short coherent paragraph.
- [ ] 2F.9 Merge tiny adjacent blocks into a nearby draft slice when they share the same section path and business topic.
- [ ] 2F.10 Mark ambiguous or multi-topic candidates for review instead of forcing a confident split.
- [ ] 2F.11 Implement stable filenames using order and slug; preserve current safe slug behavior where possible.
- [ ] 2F.12 Write a draft slice report listing draft ids, paths, source block coverage, uncovered included blocks, and warnings.
- [ ] 2F.13 Add tests for draft location, frontmatter fields, source block ids, heading-context preservation, threshold split, short-block merge, and uncovered block reporting.

## 2G. Pipeline CLI Commands

- [ ] 2G.1 Update `src/cli.ts` `handleKnowledgeCommand` to route new subcommands without embedding pipeline business logic in CLI parsing.
- [ ] 2G.2 Add a `src/knowledge/pipeline.ts` facade with functions for `runKnowledgeExtract`, `runKnowledgeNormalize`, `runKnowledgeSlice`, `runKnowledgeAudit`, `runKnowledgeRepairPlan`, `runKnowledgeRepairApply`, `runKnowledgeReview`, `runKnowledgePublish`, and `runKnowledgeEval`.
- [ ] 2G.3 Add CLI command `knowledge extract --workspace <path> [--source-id <id>]` that reads source metadata and writes blocks/extract reports.
- [ ] 2G.4 Add CLI command `knowledge normalize --workspace <path> [--source-id <id>]` that reads blocks and writes normalized blocks/reports.
- [ ] 2G.5 Add CLI command `knowledge slice --workspace <path> [--source-id <id>]` that reads normalized blocks and writes draft slices/reports.
- [ ] 2G.6 Add CLI command `knowledge audit --workspace <path> [--quality-gate warn|strict|off]` that runs source and slice quality audit without rebuilding indexes unless required.
- [ ] 2G.7 Add CLI command `knowledge repair --plan --workspace <path>` that writes a repair plan and prints its path.
- [ ] 2G.8 Add CLI command `knowledge repair --apply <plan-path> --workspace <path>` that applies deterministic safe actions and prints a repair result path.
- [ ] 2G.9 Add CLI command `knowledge review --source-id <id> --action approve|reject|request_edits|accept_warnings --reviewer <name> [--notes <text>]`.
- [ ] 2G.10 Add CLI command `knowledge publish --workspace <path> [--source-id <id>] [--quality-gate warn|strict]` that writes formal active documents and marks dirty flag.
- [ ] 2G.11 Add CLI command `knowledge eval --workspace <path> --questions <file> [--report-dir <path>]`.
- [ ] 2G.12 Update `printUsage` in `src/cli.ts` to list the new commands and the existing compatibility commands.
- [ ] 2G.13 Update `package.json` npm scripts if appropriate: `knowledge:extract`, `knowledge:slice`, `knowledge:audit`, `knowledge:repair`, `knowledge:publish`, `knowledge:eval`; each must call the same CLI implementation.
- [ ] 2G.14 Each CLI command must print artifact paths, counts, warnings/errors, and next recommended command; do not print raw source document content.
- [ ] 2G.15 Add CLI tests for command dispatch, missing required args, invalid action, path safety, and zero-source friendly output.

## 2H. Repair Plan Implementation

- [ ] 2H.1 Add `src/knowledge/repair.ts` owned by the knowledge module.
- [ ] 2H.2 Implement `generateKnowledgeRepairPlan({ workspaceRoot, qualityReportPath? })` that reads quality reports and returns a `KnowledgeRepairPlan`.
- [ ] 2H.3 Map `too_short` on adjacent same-section draft slices to `merge_adjacent_short_slices` when merge can preserve source block order.
- [ ] 2H.4 Map `too_long` to `split_oversized_slice` only when there are heading/list/table boundaries; otherwise mark manual review.
- [ ] 2H.5 Map `duplicate_content` on draft slices to `remove_duplicate_draft` for non-canonical duplicates; published duplicates require manual review.
- [ ] 2H.6 Map `missing_section_path` to `add_section_path` only when all source blocks have a consistent inherited path.
- [ ] 2H.7 Map `low_signal_terms` to `add_related_terms` using title, section path, source title, module aliases, and high-signal Chinese terms.
- [ ] 2H.8 Map `missing_source_block_ids`, `multi_topic_slice`, `broken_coreference`, `table_lost`, and conflict issues to `manual_review_required`.
- [ ] 2H.9 Implement `writeKnowledgeRepairPlan` and `readKnowledgeRepairPlan` with malformed-plan handling that fails gracefully.
- [ ] 2H.10 Implement `applyKnowledgeRepairPlan({ workspaceRoot, planPath })` for safe deterministic actions only.
- [ ] 2H.11 Before modifying any Markdown file, compute and record previous sha256; after writing, compute new sha256.
- [ ] 2H.12 Reject repair plans that point outside `knowledge/`, refer to missing files, or were generated for another workspace.
- [ ] 2H.13 Write `repair-result-<timestamp>.json` next to the plan with applied/skipped actions and rollback notes.
- [ ] 2H.14 Add tests for each mapping rule, safe apply, manual-review skip, path traversal rejection, stale/malformed plan rejection, and repair result hashes.

## 2I. Review and Publish Pipeline

- [ ] 2I.1 Add `src/knowledge/publish.ts` or include publish helpers in a focused knowledge pipeline module.
- [ ] 2I.2 Implement `reviewDraftSlices({ workspaceRoot, sourceDocumentId, action, reviewer, notes, ids? })` that writes review records without directly publishing.
- [ ] 2I.3 Review actions must update draft frontmatter status consistently: approve -> `approved`, reject -> `rejected`, request_edits -> `review_required`, accept_warnings -> `approved` with warning override.
- [ ] 2I.4 Review records must preserve previous status, next status, reviewer, notes, quality issue ids, and timestamp.
- [ ] 2I.5 Implement `publishApprovedDraftSlices({ workspaceRoot, sourceDocumentId?, qualityGate })`.
- [ ] 2I.6 Publish must refuse `quality_error` or `rejected` drafts unless an explicit accepted warning override exists and the issue is not fatal.
- [ ] 2I.7 Publish must copy or render approved draft Markdown into the formal knowledge tree such as `knowledge/whitepapers/<module>/<source-slug>/...md`.
- [ ] 2I.8 Published frontmatter must set `status: active`, `pipeline_status: published`, `quality_status`, `review_id`, `publish_id`, and preserve source provenance.
- [ ] 2I.9 Publish must not delete draft files or review records; drafts remain the audit trail.
- [ ] 2I.10 Publish must mark the dirty flag so the next `knowledge update` rebuilds indexes.
- [ ] 2I.11 Publish must write `knowledge/_pipeline/publish/publish-report.json` with counts and paths.
- [ ] 2I.12 Update `src/knowledge/indexer.ts` so formal published documents are indexed and `_pipeline` Markdown remains excluded.
- [ ] 2I.13 Add tests for approve/reject/request_edits/accept_warnings, fatal quality block, publish output path, provenance preservation, dirty flag, and index exclusion of drafts.

## 2J. Golden Question Evaluation

- [ ] 2J.1 Add `src/knowledge/eval.ts` owned by the knowledge module; it can call `searchKnowledge` but must not call runtime or models in the first implementation.
- [ ] 2J.2 Support JSON and YAML question files if a YAML parser already exists; if no YAML dependency exists, support JSON first and document YAML as follow-up.
- [ ] 2J.3 Define default eval question fixture under `test/fixtures/knowledge/eval-questions.json` with at least AI companion 8 PM reminder, EduSoho course search, and one no-hit question.
- [ ] 2J.4 Implement `runKnowledgeEval({ workspaceRoot, questionsPath, limit })` returning a `KnowledgeEvalReport`.
- [ ] 2J.5 For each should-hit question, evaluate whether expected keywords/source appear in Top 1, Top 3, and Top 5 evidence.
- [ ] 2J.6 Implement answer-bearing check using the same deterministic helper planned for Evidence Judge when available; before that helper exists, use a local interim rule and replace it later.
- [ ] 2J.7 For should-not-hit questions, count any direct high-confidence knowledge hit as a false positive.
- [ ] 2J.8 Attribute failures to source extraction, normalization, slicing, retrieval, judge, missing source knowledge, or escalation based on available reports and evidence.
- [ ] 2J.9 Write eval reports to `knowledge/reports/eval-report.json` by default and support timestamped report output if requested.
- [ ] 2J.10 Add tests for Hit@ metrics, false positive, per-question failure attribution, malformed question file, and missing knowledge directory.

## 2K. Pipeline Compatibility and Migration

- [ ] 2K.1 Keep existing `knowledge init --source-dir ...` behavior usable for the user, but internally make it call pipeline stages and then publish/index when compatibility mode is selected.
- [ ] 2K.2 Add a `--pipeline step|full|legacy` or equivalent option only if needed; default should be documented and not surprise existing users.
- [ ] 2K.3 If current formal whitepaper slices already exist, `knowledge init` must not silently delete them; it should either reuse, supersede with published output, or report a conflict.
- [ ] 2K.4 Provide migration behavior for existing whitepaper slices that lack `source_block_ids`: audit should warn, repair should mark manual review or backfill only when source blocks can be matched safely.
- [ ] 2K.5 Ensure old `chunks.jsonl`, `manifest.json`, and `keyword-index.json` formats remain readable until rebuilt.
- [ ] 2K.6 Ensure old `KnowledgeIngestReport` JSON remains readable even if new optional pipeline fields are absent.
- [ ] 2K.7 Update tests that previously expected immediate active whitepaper slices after init; new tests should assert both compatibility output and pipeline artifacts.
- [ ] 2K.8 Add an end-to-end pipeline test using fixture documents: init/intake -> extract -> normalize -> slice -> audit -> repair plan -> review approve -> publish -> update -> search -> eval.
- [ ] 2K.9 Add a real-whitepaper manual verification task after implementation: run against `/Users/king/Documents/knowledge/`, record source counts, draft counts, quality issue counts, published counts, and eval summary in implementation notes.
- [ ] 2K.10 Confirm `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` still pass after pipeline migration.

## 3. Quality Report Type Contract

- [ ] 3.1 Add `src/knowledge/quality.ts` or equivalent module owned by `src/knowledge/`; it must not import runtime, gateway, worker, or model modules.
- [ ] 3.2 Define `KnowledgeQualitySeverity = 'info' | 'warn' | 'error'` in `src/knowledge/types.ts` or `quality.ts`.
- [ ] 3.3 Define `KnowledgeQualityIssueCode` enum/string union with at least `parser_empty`, `too_many_unknown_blocks`, `toc_not_removed`, `header_footer_noise`, `table_lost`, `list_structure_lost`, `heading_structure_broken`, `duplicate_paragraphs`, `source_provenance_missing`, `empty_body`, `heading_only`, `toc_like`, `too_short`, `too_long`, `duplicate_content`, `multi_topic_slice`, `broken_coreference`, `not_answer_bearing`, `missing_source_document`, `missing_source_document_id`, `missing_source_block_ids`, `missing_source_blocks`, `missing_section_path`, `missing_parent`, `orphan_chunk`, and `low_signal_terms`.
- [ ] 3.4 Define `KnowledgeQualityIssue` with fields: `code`, `severity`, `message`, `documentId?`, `chunkId?`, `source?`, `sourceDocument?`, `sectionPath?`, `contentHash?`, `details?`.
- [ ] 3.5 Define `KnowledgeQualityThresholds` with defaults: minimum meaningful body characters, maximum parent slice characters, maximum unknown block ratio, duplicate normalized hash policy, minimum related term count, toc-like detection thresholds, answer-bearing minimums, and multi-topic heading thresholds.
- [ ] 3.6 Define `KnowledgeQualityReport` with fields: `version: 1`, `workspaceRoot`, `knowledgeRoot`, `generatedAt`, `thresholds`, `inspected`, `stageSummaries`, `severityCounts`, `issueCounts`, `issues`, `recommendedActions`, and `gate`.
- [ ] 3.7 Export quality report types from `src/knowledge/index.ts` so tests and future runtime integration can import them through the knowledge public surface.
- [ ] 3.8 Add `qualityReportPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/indexes/chunk-quality-report.json`.
- [ ] 3.9 Add `sourceQualityReportPath(workspaceRoot)` to `src/knowledge/paths.ts`, returning `knowledge/reports/source-quality-report.json`.
- [ ] 3.10 Ensure quality types can reference source blocks, draft slices, published documents, and chunks without forcing all fields to be present.

## 4. Quality Audit Implementation

- [ ] 4.1 Implement `auditKnowledgeQuality({ workspaceRoot, thresholds?, gate? })` in `src/knowledge/quality.ts`; it must load source metadata, extracted blocks, normalized blocks, draft slices, published Markdown documents, and derived chunks using knowledge module helpers.
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
- [ ] 4.13 Implement source/block quality checks: `parser_empty`, `too_many_unknown_blocks`, `toc_not_removed`, `header_footer_noise`, `table_lost`, `list_structure_lost`, `heading_structure_broken`, `duplicate_paragraphs`, and `source_provenance_missing`.
- [ ] 4.14 Implement source block provenance checks: emit `warn` or `error` when draft/published slices lack `source_block_ids` or reference block ids missing from extracted/normalized block files.
- [ ] 4.15 Implement `not_answer_bearing`: detect slices with no product rule, condition, step, outcome, definition, or answer-bearing sentence.
- [ ] 4.16 Implement `multi_topic_slice`: detect slices with unrelated headings/modules/intents or multiple disconnected business entities.
- [ ] 4.17 Implement `broken_coreference`: detect slices dominated by references such as `该功能`, `上述`, `如下图`, `该配置`, or `该流程` without enough local context.
- [ ] 4.18 Implement issue aggregation so `severityCounts` and `issueCounts` are deterministic and sorted.
- [ ] 4.19 Implement recommended actions, for example: re-run extraction, normalize again, review duplicate slices, merge title-only slices, split multi-topic slice, add provenance, generate repair plan, or convert low-quality slices to draft.
- [ ] 4.20 Ensure `auditKnowledgeQuality` never mutates Markdown source files; it only reads knowledge files and writes reports when explicitly asked.

## 5. Quality Report Persistence and CLI Output

- [ ] 5.1 Implement `writeKnowledgeQualityReport({ workspaceRoot, report })` and ensure `knowledge/indexes/` is created before writing.
- [ ] 5.2 Implement `readKnowledgeQualityReport(workspaceRoot)` returning `undefined` when the report is absent or malformed; malformed reports must not crash normal search.
- [ ] 5.3 Implement `writeSourceQualityReport({ workspaceRoot, report })` and `readSourceQualityReport(workspaceRoot)` with absent/malformed handling.
- [ ] 5.4 Add `--quality-gate warn|strict|off` option to `knowledge init`; default must be `warn`.
- [ ] 5.5 Add `--quality-gate warn|strict|off` option to `knowledge update`; default must be `warn`.
- [ ] 5.6 Wire `knowledge init` so after source ingest and index update it runs quality audit unless `--quality-gate off` is provided.
- [ ] 5.7 Wire `knowledge update` so after rebuilding manifest/chunks it runs quality audit unless `--quality-gate off` is provided.
- [ ] 5.8 Wire `knowledge audit` so it can audit pipeline artifacts without requiring a full init/update.
- [ ] 5.9 CLI output must include quality report path, source quality report path when present, total issue count, error/warn/info counts, and top issue codes.
- [ ] 5.10 Strict gate behavior: if any `error` issue exists and gate is `strict`, command exits non-zero after writing the report and printing a short remediation message.
- [ ] 5.11 Warn gate behavior: warnings/errors must be visible in output, but command exits zero unless existing ingest/update fails.
- [ ] 5.12 Off gate behavior: quality audit is skipped and output must explicitly say quality audit was skipped.
- [ ] 5.13 Add npm script if needed, for example `knowledge:audit`, only if it maps to the same CLI implementation and does not duplicate logic.

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
- [ ] 7.8 Add fixture draft slice without `source_block_ids` and assert `missing_source_block_ids`.
- [ ] 7.9 Add fixture slice referencing a missing block id and assert `missing_source_blocks`.
- [ ] 7.10 Add fixture slice that contains multiple unrelated topics and assert `multi_topic_slice`.
- [ ] 7.11 Add fixture slice dominated by unresolved references such as `该功能` / `上述` and assert `broken_coreference`.
- [ ] 7.12 Add fixture slice with descriptive context but no rule/step/outcome and assert `not_answer_bearing`.
- [ ] 7.13 Add fixture source extract report with too many unknown blocks and assert `too_many_unknown_blocks`.
- [ ] 7.14 Add fixture source report with table loss and assert `table_lost`.
- [ ] 7.15 Add CLI test for warn gate: command exits zero and writes report.
- [ ] 7.16 Add CLI test for strict gate: command exits non-zero when error issue exists and report still exists.
- [ ] 7.17 Add regression test against the real-style DOCX ingest fixture to ensure quality audit returns deterministic issue counts.
- [ ] 7.18 Add regression test proving `_pipeline/drafts/**/*.md` is ignored by indexing and search.

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

- [ ] 23.1 Ensure `discoverKnowledgeDocuments` or its replacement excludes `_pipeline/`, `_sources/`, `_taxonomy/`, `indexes/`, and `reports/` from searchable Markdown.
- [ ] 23.2 Ensure published whitepaper slices under formal directories are included after `knowledge publish` and `knowledge update`.
- [ ] 23.3 Ensure draft, review_required, quality_error, rejected, and repair-plan Markdown never justify high-confidence direct answers.
- [ ] 23.4 Ensure search evidence can include optional quality metadata from the quality report for published documents.
- [ ] 23.5 After approve action, ensure next `knowledge update` includes the active solved case in searchable documents.
- [ ] 23.6 Before approve action, ensure `review_required` solved case does not justify high-confidence direct answers by itself.
- [ ] 23.7 After reject/request edits, ensure solved case remains non-high-confidence evidence.
- [ ] 23.8 After convert-to-unresolved, ensure unresolved case can appear as low-confidence context but not direct-answer evidence.
- [ ] 23.9 Add tests for search behavior across pipeline draft/publish states and solved-case review state transitions.

## 24. Documentation for Implementation Consumers

- [ ] 24.1 Add implementation notes inside `openspec/changes/harden-knowledge-diagnosis-mvp/design.md` if coding reveals a design gap; do not silently diverge from the design.
- [ ] 24.2 Update `retrieval-research-plan.md` only if implementation discovers constraints that affect future BM25/vector/hybrid research.
- [ ] 24.3 Add final implementation notes listing pipeline artifact counts for the real imported whitepapers: source files, extracted blocks, normalized blocks, draft slices, repaired slices, reviewed slices, published slices, and chunks.
- [ ] 24.4 Add final implementation notes listing quality baseline counts for the real imported whitepapers.
- [ ] 24.5 Add final implementation notes listing eval report output, Hit@1/3/5, answer-bearing rate, false positives, and failure attribution.
- [ ] 24.6 Add final implementation notes listing acceptance command output path and pass/fail summary.
- [ ] 24.7 Add final implementation notes listing any skipped tasks and why.

## 25. Final Compatibility and Verification

- [ ] 25.1 Add or update tests that existing `/api/chat` response shape remains compatible.
- [ ] 25.2 Add or update tests that existing `/api/session` and `/api/sessions` response shapes remain compatible.
- [ ] 25.3 Add or update tests that existing `/api/settings` and `/api/logs` response shapes remain compatible.
- [ ] 25.4 Add tests that existing case JSON files remain readable without destructive migration.
- [ ] 25.5 Add tests that runtime falls back to Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation when `knowledge/` is absent.
- [ ] 25.6 Add tests that hardening disabled mode, if implemented, preserves current MVP behavior.
- [ ] 25.7 Add tests that pipeline artifacts can be deleted and regenerated from `_sources` without losing source provenance.
- [ ] 25.8 Add tests that `knowledge publish` marks dirty flag and `knowledge update` clears it after rebuilding indexes.
- [ ] 25.9 Add tests that `knowledge eval` fails when expected whitepaper evidence is absent and passes when published slices contain the evidence.
- [ ] 25.10 Run `pnpm lint`.
- [ ] 25.11 Run `pnpm typecheck`.
- [ ] 25.12 Run `pnpm build`.
- [ ] 25.13 Run `pnpm test`.
- [ ] 25.14 Run the real local acceptance command if available; if not run, document why and what risk remains.
- [ ] 25.15 Run the real pipeline against `/Users/king/Documents/knowledge/` if the documents are available; record artifact paths and counts.
- [ ] 25.16 Review git diff to confirm module ownership boundaries: knowledge data logic in `src/knowledge/`, orchestration in `src/runtime/`, transport in `src/gateway/`, tools in `src/workers/`, docs in `docs/`, Agent configs in `src/agents/`, log rendering in `src/observability/`.
