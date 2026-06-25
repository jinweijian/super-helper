## Purpose

Define the validated Experience reuse flow so that a historical reply is only auto-attached after safety preflight, is bound to its specific source run and evidence, and is revalidated against current scope, freshness, quality, and strict review before it can support a final answer.

## Requirements

### Requirement: Experience reuse occurs after safety preflight
Experience matching SHALL occur only after workspace, risk, permission, and resolved-query preflight has completed.

#### Scenario: Historical risky request matches
- **WHEN** a new risky or write request is textually similar to a concluded historical case
- **THEN** safety preflight prevents history from bypassing permission or escalation rules

### Requirement: Historical reply binds to its source run and evidence
Every reusable historical reply SHALL be associated with the user message it answers and the specific diagnostic run/evidence that produced it.

#### Scenario: Case contains several runs
- **WHEN** an earlier user question matches but the case has a newer unrelated run
- **THEN** Experience uses the earlier reply's associated run and MUST NOT attach evidence from the latest run

#### Scenario: Reply has no attributable run
- **WHEN** a historical helper message cannot be associated with a reviewed final run
- **THEN** it is not eligible for automatic reuse

### Requirement: Experience is revalidated against current scope
Historical evidence SHALL be revalidated for workspace, persona/visibility, status, freshness, quality, and current strict Review/Judge rules before it can support a final answer.

#### Scenario: Historical evidence is stale
- **WHEN** a high-similarity historical answer relies on stale or missing evidence
- **THEN** history is recorded as a candidate and runtime continues with current knowledge or worker diagnosis

#### Scenario: Current evidence confirms history
- **WHEN** history matches and its evidence remains current, visible, quality-eligible, and accepted by current review
- **THEN** it may be included as history evidence without calling a worker unnecessarily

### Requirement: Experience matching remains isolated
Experience search SHALL use only cases belonging to the same tenant, user, and workspace scope.

#### Scenario: Different user or tenant has identical question
- **WHEN** another scope contains an identical concluded question
- **THEN** it is not considered a candidate