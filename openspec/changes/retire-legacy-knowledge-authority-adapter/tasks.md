## 1. Authority adapter contract

- [x] 1.1 Define the stable authority diagnostic port and normalized result types without changing public Case/Run shapes.
- [x] 1.2 Wrap the existing Claude Code worker as the first authority adapter and preserve read-only, cancellation, timeout, retry, and redaction behavior.
- [x] 1.3 Add a fake authority adapter and contract tests proving adapter replacement is invisible to Runtime and UI.

## 2. Thin online orchestration

- [x] 2.1 Refactor Runtime to prepare DiagnosticRequest and invoke one authority adapter as the technical diagnosis owner.
- [x] 2.2 Ensure the first investigation runs before technical clarification when question and workspace are present.
- [x] 2.3 Generate follow-up questions only from authority missingInfo/unknowns and preserve the completed first-run result.
- [x] 2.4 Keep Experience and bounded MCP/Redmine as input context and prevent them from directly producing the final technical answer.

## 3. Retire legacy knowledge online

- [x] 3.1 Remove KnowledgeTurn, Knowledge Router, RAG Answerability, BM25, embedding, and rerank from online Runtime and historical parallel collection.
- [x] 3.2 Stop exposing legacy knowledge settings and operations in the Dashboard while retaining migration-period offline commands.
- [x] 3.3 Add an architecture regression test proving online diagnosis does not invoke legacy knowledge services.

## 4. Safety and presentation boundary

- [ ] 4.1 Reduce Review to structure, evidence binding, scope, semantic labels, sensitive data, and operation safety checks.
- [x] 4.2 Preserve usable authority conclusions and inferences during output formatting; only remove invalid or unsafe fragments.
- [x] 4.3 Update the page to present conclusion, basis, inference, unknowns, and next action without exposing internal Agent stages.

## 5. Experience and graph seam

- [x] 5.1 Keep CSV and Markdown experience provenance, revision, hash, review status, and existing persistence compatible.
- [x] 5.2 Define an optional ExperienceGraphProvider input contract that cannot directly produce a user reply.
- [x] 5.3 Verify graph-provider absence or failure does not block authority diagnosis.

## 6. Verification and rollout

- [x] 6.1 Add regression scenarios for valid authority conclusion, authority inference, authority failure, and post-investigation clarification.
- [x] 6.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`.
- [ ] 6.3 Run one real CC diagnosis and confirm the page preserves its conclusion and evidence; document remaining live-environment limitations.
