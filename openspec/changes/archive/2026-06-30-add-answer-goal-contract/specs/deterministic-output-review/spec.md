## ADDED Requirements

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
