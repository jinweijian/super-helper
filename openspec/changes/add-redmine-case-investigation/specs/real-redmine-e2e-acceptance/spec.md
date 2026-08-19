## ADDED Requirements

### Requirement: Real E2E SHALL exercise production boundaries
The opt-in acceptance command SHALL use the real fixed Redmine project, real configured model, real stdio MCP transport, production `DiagnosticRuntime`, production read-only Worker, and an explicitly supplied real workspace path.

#### Scenario: Real acceptance starts
- **GIVEN** the saved Redmine SecretRef, model credentials, Worker command, scenario manifest, and workspace path exist
- **WHEN** the operator invokes the real E2E command
- **THEN** the command SHALL fail closed on missing prerequisites
- **AND** it SHALL not substitute fixture clients, fake evidence, or test-only Runtime branches

### Requirement: Real E2E SHALL cover three ticket-value outcomes
The manifest SHALL contain one scenario each for `resolved_by_ticket`, `not_resolved_by_ticket`, and `direction_helpful`, and all three SHALL pass their structural outcome gates.

#### Scenario: Ticket helps resolve the case
- **WHEN** the `resolved_by_ticket` scenario completes
- **THEN** result SHALL contain accepted current workspace/log evidence and current-run Redmine evidence for the primary conclusion
- **AND** source status SHALL be completed and Review SHALL not downgrade the required answer

#### Scenario: Ticket cannot resolve the case
- **WHEN** the `not_resolved_by_ticket` scenario completes
- **THEN** no historical-only claim SHALL be presented as the current solution
- **AND** the result SHALL preserve no-hit, conflict, insufficient-evidence, or other accurate gap semantics

#### Scenario: Ticket provides a useful direction
- **WHEN** the `direction_helpful` scenario completes
- **THEN** at least one evidence-bound diagnostic lead SHALL remain visible as preliminary guidance
- **AND** the result MUST NOT claim a confirmed current root cause

### Requirement: Real E2E SHALL prove read-only and privacy behavior
The acceptance harness SHALL record safe structural telemetry and fail if any Redmine write method/tool, private-note marker, identity field, raw response, or credential appears.

#### Scenario: All scenarios finish
- **WHEN** the harness audits requests, persisted Case, logs, and report
- **THEN** every Redmine HTTP method SHALL be GET
- **AND** only the two read tools SHALL have been invoked
- **AND** the report SHALL contain only scenario ID, expected/actual classification, source states, evidence kinds/IDs, Review decision, counts, durations, and safe error codes

### Requirement: Real E2E SHALL be a master submission gate
The implementation MUST NOT be declared complete or left as the final master state until all three real scenarios, offline suite, web suite, build, typecheck, lint, privacy scan, and boundary audit pass.

#### Scenario: Any real scenario fails
- **WHEN** expected classification or evidence gates do not match
- **THEN** the command SHALL exit non-zero
- **AND** implementation tasks SHALL remain incomplete
- **AND** the failure SHALL be diagnosed rather than changing expectations to match output
