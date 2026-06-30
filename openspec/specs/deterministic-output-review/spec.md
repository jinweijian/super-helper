## Purpose

Define the deterministic validation, frozen review outcome, and accepted-content boundary that the runtime applies before the Presentation stage so that no model call can promote a partial review to a final answer, invent facts outside accepted evidence, or leak rejected claims into the user reply.

## Requirements

### Requirement: Diagnostic results are validated before presentation
The runtime SHALL deterministically validate evidence identities, claim references, claim types, and evidence confidence before choosing the review outcome.

#### Scenario: Fact references no evidence
- **WHEN** a fact claim has an empty evidence ID list
- **THEN** it is rejected or downgraded and cannot support final answer

#### Scenario: Fact references nonexistent evidence
- **WHEN** a fact claim references an ID absent from the result evidence list
- **THEN** the reference is invalid, the fact is rejected or downgraded, and the validation issue is logged

#### Scenario: Fact references only low confidence evidence
- **WHEN** a fact claim references only low-confidence or unknown evidence
- **THEN** it cannot remain a final fact

### Requirement: Review outcome is frozen before presentation
The deterministic Review Gate SHALL decide `ask_user`, `partial`, `final`, or `escalate` before Presentation and Presentation MUST NOT promote or replace that outcome.

#### Scenario: Model requests final for partial result
- **WHEN** the Presentation model returns wording or metadata that implies final answer for a frozen partial outcome
- **THEN** runtime keeps partial and renders only accepted partial claims

#### Scenario: Presentation fails
- **WHEN** the model returns malformed JSON, unknown claim IDs, or no usable presentation
- **THEN** runtime uses deterministic formatting from the same validated result and frozen outcome

### Requirement: Presentation is limited to accepted content
Presentation SHALL only select and arrange accepted claim/evidence identities; final rendering SHALL use accepted claim text and safe non-factual connective language.

#### Scenario: Model invents a new fact
- **WHEN** presentation output includes text not attributable to accepted claim IDs
- **THEN** that text is discarded and does not reach the user

#### Scenario: Persona changes wording order
- **WHEN** accepted evidence is presented to operations, support, customer, or developer personas
- **THEN** ordering and labels may differ while factual claim text and outcome remain unchanged

### Requirement: Review validation is observable
Runtime logs SHALL record rejected claims, invalid evidence references, frozen outcome, presentation fallback, and accepted claim IDs without exposing hidden prompts or sensitive payloads.

#### Scenario: Unsupported worker claim is rejected
- **WHEN** worker output contains an unsupported fact
- **THEN** the diagnostic log identifies the rejected claim and the main reply omits it
### Requirement: Review freezes a primary answer for the current AnswerGoal
The runtime SHALL validate accepted claims against `DiagnosticRequest.answerGoal` before presentation. A final answer SHALL require at least one accepted `primary_answer` claim whose `answers` cover every `answerGoal.mustAnswerItems` entry.

#### Scenario: Final result has no primary answer
- **WHEN** a worker returns `status=concluded` and `recommendedNextAction=final_answer`
- **AND** no accepted claim has `role=primary_answer`
- **THEN** runtime downgrades the result and the reply cannot lead with a supporting or process claim

#### Scenario: Primary answer does not cover the AnswerGoal
- **WHEN** a `primary_answer` claim does not include all required `answerGoal.mustAnswerItems` in `answers`
- **THEN** runtime rejects it as the frozen direct answer

#### Scenario: Process note attempts to become conclusion
- **WHEN** a claim has role `process_note`, `evidence_locator`, or `supporting_context`
- **THEN** Presentation MUST NOT use it as the first-paragraph direct answer

### Requirement: Presentation stays inside frozen claim and evidence boundaries
The runtime SHALL validate Presentation output against frozen review data before returning it to the user.

#### Scenario: Duplicate direct answer IDs hide a missing frozen primary claim
- **WHEN** Presentation returns `directAnswerClaimIds` with duplicate IDs
- **AND** the unique ID set does not equal frozen primary answer claim IDs
- **THEN** runtime rejects the Presentation output and falls back to reviewed primary answers

#### Scenario: Presentation cites unrelated evidence
- **WHEN** Presentation returns an `evidenceIds` item that exists in the result
- **BUT** that evidence is not referenced by any selected accepted claim
- **THEN** runtime rejects the Presentation output

#### Scenario: Presentation adds facts after the first paragraph
- **WHEN** the first paragraph covers `directAnswer`
- **BUT** a later paragraph adds an unsupported reason, impact, recovery method, or action
- **THEN** runtime rejects the Presentation output

#### Scenario: Supported wording uses natural modal words
- **WHEN** Presentation paraphrases an accepted next action with natural wording
- **AND** the wording is supported by selected claims/evidence/missingInfo
- **THEN** runtime MUST NOT reject it only because it contains generic words such as "需要" or "必须"
