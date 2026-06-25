## ADDED Requirements

### Requirement: Every dispatched turn has a canonical resolved context
Preflight SHALL create one bounded resolved turn context containing resolved query, latest raw message, confirmed facts, user claims, hypotheses, unknowns, follow-up status, and source message identities.

#### Scenario: User reports an observable symptom
- **WHEN** the user states that an endpoint returned 500
- **THEN** the observable report may be recorded as a confirmed user-provided fact with its source message ID

#### Scenario: User asks whether a cause is possible
- **WHEN** the user asks `是不是数据库字段问题`
- **THEN** that text is recorded as a hypothesis or user claim and MUST NOT enter confirmed facts

#### Scenario: Model preflight changes classification
- **WHEN** model preflight attempts to promote a local hypothesis or unknown to confirmed fact without evidence
- **THEN** reconciliation rejects the promotion

### Requirement: All diagnosis stages use the resolved query
Knowledge Router, Retrieval, Deep Query planning, and Worker `userGoal` SHALL use the same resolved query; raw latest message SHALL remain audit/UI data only.

#### Scenario: User answers unknown
- **WHEN** the previous helper requested missing information and the user replies `不清楚`
- **THEN** `不清楚` is appended to unknowns while resolved query remains the original unresolved question

#### Scenario: User provides a concrete follow-up
- **WHEN** the user adds a new feature, route, or error signal
- **THEN** resolved query incorporates the new diagnostic target and every downstream stage receives it

### Requirement: Resolved context is backward compatible and bounded
Resolved turn fields SHALL be optional in persisted DiagnosticRequest context and follow existing truncation/isolation rules.

#### Scenario: Old case is loaded
- **WHEN** a case contains no resolved turn context
- **THEN** it loads successfully and runtime derives a safe context from current bounded messages without changing persisted legacy shape

#### Scenario: Conversation is long
- **WHEN** many messages and runs exist
- **THEN** resolved context retains source identities and bounded text without including another case, user, tenant, or workspace
