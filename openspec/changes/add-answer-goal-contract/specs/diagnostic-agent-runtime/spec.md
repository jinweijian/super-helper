## ADDED Requirements

### Requirement: DiagnosticRequest carries a structured AnswerGoal
The runtime SHALL use `DiagnosticRequest.answerGoal` as the authoritative current-turn target for preflight, knowledge, worker, review, presentation, and audit logs.

#### Scenario: Request is built from a user message
- **WHEN** runtime builds a DiagnosticRequest
- **THEN** the request contains `answerGoal.rawUserQuestion`, `answerGoal.resolvedQuestion`, `answerGoal.answerObject`, `answerGoal.mustAnswerItems`, `answerGoal.diagnosticObjective`, and `answerGoal.sourceMessageIds`

#### Scenario: Follow-up keeps user-facing goal separate from diagnostic objective
- **WHEN** runtime builds a follow-up DiagnosticRequest
- **THEN** `answerGoal.resolvedQuestion` remains the user-facing question
- **AND** internal process language is stored only in `answerGoal.diagnosticObjective`
