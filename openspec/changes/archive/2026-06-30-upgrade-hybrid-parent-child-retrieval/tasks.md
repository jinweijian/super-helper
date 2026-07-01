## 1. Chinese Retrieval RED Evidence

- [x] 1.1 Add tokenizer/BM25 RED tests for Chinese business bigrams, registered one-character terms, repeated term frequency, field weighting, generic-character false positives, and true no-hit behavior; record expected failures.
- [x] 1.2 Add parent-child RED fixtures for section boundaries, 300–800 target size, one-sentence/120-character overlap, oversized indivisible blocks, multiple child hits, and bounded answer span expansion.
- [x] 1.3 Add hybrid RED tests for Top 40/40 -> RRF Top 20 -> Rerank Top 8 budgets, metadata filters before vector similarity, restricted exclusion, provider fallback, and preserved strategy scores.

## 2. Parent-Child Knowledge Artifacts

- [x] 2.1 Extend additive chunk metadata for child order, source block IDs, section path, text hash, parent title/terms, and legacy marker; old JSONL readers must remain compatible.
- [x] 2.2 Implement source-block/section-aware child building in knowledge indexes with deterministic IDs, bounded overlap, manual-split reporting, and rebuild-stable hashes.
- [x] 2.3 Implement parent lookup/dedupe and bounded same-section answer span expansion in retrieval; final evidence must cite canonical parent/source while preserving child scores.
- [x] 2.4 Update chunk/vector manifest compatibility so parent or child-boundary changes require vector rebuild and stale vectors cannot mix with new chunks.

## 3. Chinese BM25 And Hybrid Retrieval

- [x] 3.1 Implement Chinese/Latin/business-term tokenizer without generic single-character recall or TF dedupe; unit tests from 1.1 must turn GREEN.
- [x] 3.2 Implement field-weighted BM25 with fixed title/headings/terms/module/body weights and explainable field contributions; exact title must outrank noisy body matches.
- [x] 3.3 Apply module, intent, source type, visibility, status, quality, and restricted filters to embedding candidates before similarity/remote submission.
- [x] 3.4 Implement fixed candidate budgets and rerank fallback while preserving RRF `k=60`, per-strategy scores, safe errors, parent identity, and final Top 8.
- [x] 3.5 Add taxonomy coverage validation and repository taxonomy entries/aliases for `ai-companion` and `edusoho-training`; unknown modules must be visible and block module-dependent direct answer.

## 4. Evaluation Set And Legacy Migration

- [x] 4.1 Add the 50-question production evaluation set with exact parent IDs and required behavior: 12 exact, 10 paraphrase, 8 generic, 8 no-hit, 6 implementation/risk, and 6 visibility/stale/conflict cases; split 35 calibration/15 holdout.
- [x] 4.2 Add migration reporting that identifies legacy v1 direct-ineligible parents/chunks without mutating them into v2 compliance.
- [x] 4.2a Add feature-overview regression coverage for concrete module feature-list questions, including production eval coverage for “AI伴学助手有哪些功能”.
- [ ] 4.3 Rerun real source extract/normalize/v2 slice/strict audit/deterministic repair and generate an AI Companion review queue; do not auto-approve warnings or errors.
- [ ] 4.4 After explicit reviewed clean slices exist, publish/reindex/vectorize/evaluate AI Companion as an independent batch; otherwise record the human-review blocker and keep it investigation-only.
- [ ] 4.5 Repeat the reviewed publish/reindex/vector/eval flow for EduSoho only after the AI Companion batch gate passes; failed batches must not affect previously eligible modules.

## 5. Acceptance And Documentation

- [x] 5.1 Run offline fake hybrid acceptance and focused knowledge/retrieval/provider/module-boundary tests; default tests must stay deterministic and no-network.
- [ ] 5.2 Run real SiliconFlow smoke/vector/rerank/holdout evaluation only with explicit credentials; reports must redact keys, raw vectors, complete documents, and provider payloads.
- [x] 5.3 Update technical architecture, Agent design, knowledge pipeline, retrieval commands, migration runbook, taxonomy guidance, and `implementation-notes.md`.

## 6. Anti-Fake-Complete Audit And Completion Gates

- [x] 6.1 Audit that runtime really uses new child/BM25/hybrid paths, filters run before vector ranking, parent provenance survives final evidence, old artifacts cannot fake eligibility, and no business logic moved into knowledge/providers/CLI/runtime wrong layers; feed gaps back into artifacts.
- [x] 6.1a Audit that draft/published mirror slices do not create `duplicate_content` warnings for the published parent, and that operations presentation uses feature-answer templates for feature-overview questions.
- [ ] 6.2 Prove holdout direct precision 100%, no-hit abstention 100%, must-escalate 100%, Recall@5 >= 90%, and MRR >= 0.80; unmet metrics keep this change incomplete.
- [x] 6.3 Run `openspec validate upgrade-hybrid-parent-child-retrieval --strict`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`; record fresh output and remaining manual-review/real-provider status.

## 7. Follow-Up Tasks (Deferred)

Tasks 4.3, 4.4, 4.5, 5.2, and 6.2 are deferred to a follow-up change because they require real source data, real SiliconFlow credentials, explicit human review, and live holdout evaluation that this change does not have access to. The code, unit tests, and offline fake acceptance for the hybrid retrieval and parent-child index are complete in tasks 1.1–3.5 and 5.1/5.3, and task 6.1 has audited module boundaries. The follow-up change will rerun the real source extract/normalize/v2 slice/strict audit flow, drive the AI Companion and EduSoho publish/reindex/vector/eval batches, run the real SiliconFlow smoke/vector/rerank/holdout evaluation, and prove the holdout metrics gate.

- [ ] FU.1 Rerun real source extract/normalize/v2 slice/strict audit/deterministic repair and generate the AI Companion review queue (was 4.3).
- [ ] FU.2 After explicit reviewed clean slices exist, publish/reindex/vectorize/evaluate AI Companion as an independent batch; otherwise record the human-review blocker and keep it investigation-only (was 4.4).
- [ ] FU.3 Repeat the reviewed publish/reindex/vector/eval flow for EduSoho only after the AI Companion batch gate passes; failed batches must not affect previously eligible modules (was 4.5).
- [ ] FU.4 Run real SiliconFlow smoke/vector/rerank/holdout evaluation with explicit credentials; reports must redact keys, raw vectors, complete documents, and provider payloads (was 5.2).
- [ ] FU.5 Prove holdout direct precision 100%, no-hit abstention 100%, must-escalate 100%, Recall@5 >= 90%, and MRR >= 0.80; unmet metrics keep the follow-up change incomplete (was 6.2).
