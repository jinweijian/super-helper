## ADDED Requirements

### Requirement: Knowledge SHALL support evidence-only collection for case investigation
Knowledge diagnosis SHALL expose a collect operation that returns bounded evidence, provenance, judge outcome, retrieval trace, answerability, and a context patch without creating a Run, Review, Presentation, or helper reply.

#### Scenario: Knowledge could answer directly
- **WHEN** Knowledge evidence fully covers AnswerGoal during a configured case investigation
- **THEN** the evidence SHALL return to the aggregator
- **AND** Knowledge SHALL NOT complete the turn before Redmine settles

#### Scenario: Knowledge requires code evidence
- **WHEN** Knowledge evidence is partial, stale, conflicting, or implementation-dependent
- **THEN** the collect result SHALL preserve evidence and gaps
- **AND** it SHALL NOT mutate the shared DiagnosticRequest concurrently

#### Scenario: Legacy workspace has no historical source
- **WHEN** case investigation is not configured
- **THEN** the existing reviewed Knowledge direct-answer and Worker-escalation path SHALL remain compatible
