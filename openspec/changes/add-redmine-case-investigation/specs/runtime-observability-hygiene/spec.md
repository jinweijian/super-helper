## ADDED Requirements

### Requirement: Case-investigation events SHALL use a safe detail whitelist
Runtime SHALL record query planning, parallel collection, Redmine search/details, historical analysis, mandatory current verification, historical gate, and final review without persisting raw source or model payloads.

#### Scenario: A lifecycle phase is recorded
- **WHEN** Runtime appends an investigation event
- **THEN** detail MAY include status, duration, counts, selected issue IDs, evidence IDs, source statuses, degraded flag, and Worker-dispatched flag
- **AND** it MUST NOT include query, signals, ticket/journal text, identity, URL, key, model reason, verification plan, or raw error

### Requirement: Public DTOs SHALL not expose investigation internals
Session/log serialization SHALL preserve current top-level shapes and exclude unselected Redmine content and ephemeral model/Worker plans.

#### Scenario: Client polls an active investigation
- **WHEN** `/api/session`, `/api/sessions`, or `/api/logs` serializes a Case
- **THEN** only safe phase summaries and Agent/tool identities SHALL be visible

### Requirement: Dashboard SHALL show progress through existing polling
Observability and Dashboard SHALL map investigation phases to concise Chinese progress labels without adding a Gateway state machine.

#### Scenario: Sources collect concurrently
- **WHEN** parallel collection is active
- **THEN** loading UI SHALL state that knowledge and historical tickets are being queried

#### Scenario: Worker verifies history-derived checks
- **WHEN** the mandatory case Worker runs
- **THEN** loading UI SHALL state that the current project is being checked
