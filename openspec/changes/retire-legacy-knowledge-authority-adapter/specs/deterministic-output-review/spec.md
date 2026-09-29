## MODIFIED Requirements

### Requirement: Output review validates safety and structure
Output review MUST validate structure, source binding, workspace scope, semantic labels, and sensitive information. It MUST NOT replace a usable authority conclusion with a generic evidence-insufficient response.

#### Scenario: Authority conclusion is structurally valid
- **WHEN** claims and evidence are valid and safe
- **THEN** the presentation includes the authority conclusion and supporting basis

#### Scenario: Authority result is incomplete
- **WHEN** the result is missing required structure or contains unsafe content
- **THEN** only the invalid content is removed or the run is safely downgraded, with no invented technical conclusion

#### Scenario: Rejected content claims to answer the current goal
- **WHEN** an invalid claim declares that it answers a required AnswerGoal item
- **THEN** the run is not finalized from a surviving summary-only claim and may continue diagnosis with the authority adapter

#### Scenario: A safe proposed action uses an action-like claim type
- **WHEN** a `next_action` has evidence, exact AnswerGoal bindings, `actionSafety`, and `executionStatus: proposed`, but its type is action-like instead of a semantic fact class
- **THEN** the authority adapter normalizes it as an inference before deterministic review without relaxing any action-safety requirement
