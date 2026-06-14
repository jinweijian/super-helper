# Implementation Notes: add-embedding-provider-adapters

This file is required execution evidence for the change. Do not mark the change complete until every applicable section below is filled with actual commands, outputs, decisions, or explicit deferrals.

## Spec Author Hardening Audit

- Audit date: 2026-06-14
- Skill/process used: `openspec-change-hardening`
- Audit result: the change already had strong provider/vector/testing gates, but needed a stricter provider documentation baseline and an explicit MiniMax docs gate to prevent guessed real adapter work.
- Required correction from this audit: MiniMax remains the preferred target, but real MiniMax network code is blocked unless current official MiniMax embedding API docs are found and recorded. Until then, MiniMax completion means safe scaffold/fake-contract behavior plus tests, not guessed endpoint implementation.
- Required correction from this audit: anti-fake-complete review must identify file-only, mock-only, stale-artifact, third-party-doc, accidental-network, boundary, and privacy failure modes, then update OpenSpec artifacts for any gap found.

## Spec Author Re-Audit / Mandatory Apply Workflow

- Re-audit date:
- Reviewer:
- Skills/process used:
- OpenSpec status before edits:
- Hardening changes made to proposal/design/spec/tasks:
- Remaining OpenSpec gaps, if any:

Use this section to prove the implementer followed the mandatory checkpoint workflow instead of doing a file-only implementation.

| Checkpoint | RED test or failing fixture recorded first | GREEN command recorded | Implementation notes updated before moving on | Remaining risk/deferred item |
| --- | --- | --- | --- | --- |
| Provider contract |  |  |  |  |
| Vector artifact |  |  |  |  |
| CLI/smoke |  |  |  |  |
| Docs/boundary |  |  |  |  |
| Final audit |  |  |  |  |

Minimum fake acceptance spine evidence:

- Config used:
- Provider created through factory: yes/no
- Fake provider dimensions/distance:
- Fixture workspace:
- Eligible chunk ids submitted to provider:
- Restricted chunk ids skipped before provider call:
- Vectors path:
- Manifest path:
- Build report path:
- Compatibility success evidence:
- Provider/model/dimensions/distance mismatch evidence:
- Confirmed no raw restricted text in report/notes: yes/no
- Confirmed no API key/header/cookie/bearer token/raw provider payload in report/notes: yes/no

## Provider Documentation Baseline From Spec Hardening

This section is a starting baseline, not a replacement for implementer verification. Re-check official docs before provider-specific coding.

| Provider | Official docs checked during hardening | Baseline finding | Implementation decision |
| --- | --- | --- | --- |
| MiniMax | `https://platform.minimaxi.com/docs/llms.txt`, `https://platform.minimaxi.com/docs/api-reference/api-overview`, `https://platform.minimaxi.com/docs/guides/rate-limits`, `https://platform.minimaxi.com/docs/api-reference/errorcode` | Current MiniMax official docs index/API overview did not expose an embedding-specific API page or embedding OpenAPI spec during this audit. | Do not implement real MiniMax HTTP calls from third-party SDK docs, old memory, or inferred OpenAI-compatible assumptions. Keep MiniMax as scaffold/unsupported/docs-required unless current official embedding docs are found or supplied. |
| Gemini | `https://ai.google.dev/gemini-api/docs/embeddings`, `https://ai.google.dev/api/embeddings` | Official docs describe Gemini embedding models, `embedContent`, `batchEmbedContents`, API key header, output dimensions/task behavior, and response embedding fields. | Gemini real adapter may proceed after implementer re-verifies current docs and records endpoint/auth/request/response/dimensions/batch/error behavior below. |
| Qwen / Alibaba Cloud Model Studio | `https://www.alibabacloud.com/help/en/model-studio/embedding` | Official docs describe Model Studio embedding models and OpenAI-compatible embedding calls. | Keep Qwen scaffold-only in this change unless the user explicitly expands scope and OpenSpec is updated first. |

## OpenSpec Apply Context

- Command:

```bash
openspec instructions apply --change add-embedding-provider-adapters --json
```

- Summary of output:
- Date/time captured:
- Executor:

## Provider Documentation Verification

### MiniMax

- Official docs URL:
- Access date:
- Endpoint:
- Auth shape:
- Request body fields:
- Response vector path:
- Dimensions behavior:
- Batch limits:
- Retry/rate-limit guidance:
- Decision: real adapter / scaffold only / OpenSpec update required
- If scaffold only, confirm `embedDocuments` and `embedQuery` fail safely without network:
- If third-party docs were consulted, list them as non-authoritative clues only:

### Gemini

- Official docs URL:
- Access date:
- Endpoint:
- Auth shape:
- Model naming:
- Request body fields:
- Response vector path:
- Task type / output dimension behavior:
- Batch limits:
- Retry/rate-limit guidance:
- Decision: real adapter / scaffold only / OpenSpec update required

### Qwen

- Scope decision: scaffold only unless user explicitly expands scope.
- If scope changed, link to the OpenSpec update:

## Red-Green Test Evidence

Record focused failing tests before implementation, then the passing command after implementation.

| Area | RED command and failure summary | GREEN command and pass summary |
| --- | --- | --- |
| Provider types/factory |  |  |
| MiniMax fake HTTP adapter or docs-gated scaffold |  |  |
| Gemini fake HTTP adapter |  |  |
| Qwen unsupported scaffold |  |  |
| Error redaction |  |  |
| Metadata/fingerprint/dimensions |  |  |
| Vector builder |  |  |
| Vector compatibility |  |  |
| CLI dispatch/output |  |  |
| Security/privacy |  |  |

## Debugging / Root Cause Notes

Use this section whenever provider docs, fake HTTP tests, dimensions, timeout, malformed response, vector artifacts, or compatibility checks fail.

| Issue | Evidence gathered | Root cause | Fix | Verification |
| --- | --- | --- | --- | --- |

## Fake Smoke Test

- Command:
- Provider:
- Model:
- Dimensions:
- Distance:
- Result:
- Duration:
- Safe error, if any:
- Confirmed no raw vector values printed: yes/no

## Fake Vector Build Fixture

- Command:
- Fixture workspace:
- Vectors path:
- Manifest path:
- Build report path:
- Vector count:
- Skipped count:
- Failed count:
- Provider/model/dimensions/distance:
- Confirmed restricted chunks skipped without sending text: yes/no
- Confirmed report omits raw chunk text: yes/no

## Real Provider Smoke Status

### MiniMax

- Run status: not run / passed / failed
- Command, if run:
- Provider/model/dimensions:
- Sanitized result:
- If not run, reason:

### Gemini

- Run status: not run / passed / failed
- Command, if run:
- Provider/model/dimensions:
- Sanitized result:
- If not run, reason:

## Security and Privacy Audit

- API keys absent from errors/logs/reports/CLI output: yes/no
- Bearer tokens/cookies/headers absent: yes/no
- Raw provider payloads absent or sanitized: yes/no
- Raw chunk text absent from vector reports: yes/no
- Raw vector values hidden by default: yes/no
- Restricted chunks skipped by default for remote embedding: yes/no

## Compatibility Audit

- Provider mismatch behavior:
- Model mismatch behavior:
- Dimensions mismatch behavior:
- Distance mismatch behavior:
- Text hash stale/rebuild behavior:
- `embedding.enabled: false` keyword-only fallback:

## Diff Boundary Audit

- Provider network code stayed in `src/embedding/`: yes/no
- Vector artifact code stayed in `src/knowledge/`: yes/no
- Config changes stayed in `src/config.ts` or narrow config helpers: yes/no
- CLI only parsed/delegated: yes/no
- No embedding business logic added to `src/runtime/`: yes/no
- No embedding business logic added to `src/gateway/`: yes/no
- No embedding business logic added to `src/workers/`: yes/no
- No product Agent prompt/config added outside `src/agents/`: yes/no

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

- `pnpm lint`:
- `pnpm typecheck`:
- `pnpm build`:
- `pnpm test`:
- Focused embedding tests:
- Focused knowledge vector tests:
- OpenSpec status:

## Deferred or Skipped Items

Every skipped item must include why it is safe to defer and what future change should own it.

| Item | Reason | Follow-up owner/change |
| --- | --- | --- |
