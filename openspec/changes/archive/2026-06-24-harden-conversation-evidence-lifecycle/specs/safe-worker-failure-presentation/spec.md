## ADDED Requirements

### Requirement: Worker raw failure output stays in diagnostic logs
Worker command, cwd, stdout, stderr, stack, raw provider payload, and internal prompt data MUST NOT be copied into the main user-facing reply.

#### Scenario: Worker exits nonzero
- **WHEN** a worker fails before producing a usable result
- **THEN** the main reply contains a safe failure category, current diagnosis state, next action, and case/run identity while raw output remains in the diagnostic log

#### Scenario: Presentation model also fails
- **WHEN** worker failure is followed by model review/presentation failure
- **THEN** deterministic safe failure formatting is used and raw stdout/stderr is still not exposed

### Requirement: Failure logging remains redacted and auditable
Diagnostic logs SHALL retain bounded troubleshooting data after existing redaction and SHALL classify worker failure severity and phase.

#### Scenario: Failure output contains secret-like text
- **WHEN** stdout, stderr, or error contains API keys, bearer tokens, cookies, or configured secrets
- **THEN** stored and rendered log details redact those values
